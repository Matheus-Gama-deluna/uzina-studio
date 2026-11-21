import crypto from "node:crypto";
import { Mastra } from "@mastra/core";
import {
  createWorkflowStateReader,
  type WorkflowState,
} from "@mastra/core/workflows";
import {
  DeliverableStatusSchema,
  DeliverableWorkflowStateSchema,
  StrategyRouterOutputSchema,
  WorkflowGateTypeSchema,
  WorkflowResumeInputSchema,
  WorkflowStartInputSchema,
  type DeliverableStatus,
  type DeliverableWorkflowState,
  type DeliverableWorkflowStatus,
  type StrategyRouterOutput,
  type WorkflowGateType,
  type WorkflowResumeInput,
  type WorkflowStartInput,
} from "@uzina/contracts";
import {
  acquireDeliverableLock,
  clients,
  deliverables,
  designAssets,
  projects,
  releaseDeliverableLock,
  type UzinaDb,
} from "@uzina/db";
import type { ExecutionWorkspace, OpenCodeTransport } from "@uzina/opencode-bridge";
import { and, desc, eq } from "drizzle-orm";
import { WorkflowRuntimeError } from "./errors.js";
import {
  closeMastraStorage,
  getMastraStorageSingleton,
  type MastraStorageOptions,
} from "./storage.js";
import {
  createDeliverableLifecycleWorkflow,
  lockWorkerContext,
  type LockWorkerContextValue,
} from "./workflows/deliverable-lifecycle.js";

export interface CreateMastraRuntimeOptions extends MastraStorageOptions {
  db: UzinaDb;
  masterKey?: Buffer;
  workspaceFactory?: () => ExecutionWorkspace;
  transportFactory?: () => OpenCodeTransport;
  worktreesRootDir?: string;
  skillsDir?: string;
}

export interface MastraWorkflowService {
  mastra: Mastra;
  getWorkflowState(params: {
    deliverableId: string;
    organizationId: string;
  }): Promise<DeliverableWorkflowState>;
  startDeliverableWorkflow(params: {
    deliverableId: string;
    organizationId: string;
    input: WorkflowStartInput;
  }): Promise<DeliverableWorkflowState>;
  resumeDeliverableWorkflow(params: {
    deliverableId: string;
    organizationId: string;
    input: WorkflowResumeInput;
  }): Promise<DeliverableWorkflowState>;
  close(): Promise<void>;
}

const KNOWN_STAGES = [
  "stage_discovery",
  "stage_blueprint",
  "stage_visual_studio",
  "stage_contract_and_tests",
  "stage_build",
] as const;

async function findScopedDeliverable(
  db: UzinaDb,
  deliverableId: string,
  organizationId: string
): Promise<typeof deliverables.$inferSelect> {
  const [row] = await db
    .select({ deliverable: deliverables })
    .from(deliverables)
    .innerJoin(projects, eq(deliverables.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(
      and(
        eq(deliverables.id, deliverableId),
        eq(clients.organizationId, organizationId)
      )
    )
    .limit(1);

  if (!row) {
    throw new WorkflowRuntimeError({
      statusCode: 404,
      code: "DELIVERABLE_NOT_FOUND",
      message: `Entregável '${deliverableId}' não encontrado na organização.`,
    });
  }

  return row.deliverable;
}

function parseGate(raw: unknown): WorkflowGateType | null {
  const parsed = WorkflowGateTypeSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function parseBlueprint(raw: unknown): StrategyRouterOutput | null {
  if (!raw) return null;
  const parsed = StrategyRouterOutputSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function parseStageHistory(snap: WorkflowState | null): string[] {
  if (!snap) return [];
  const res = snap.result as { stageHistory?: unknown } | undefined;
  if (Array.isArray(res?.stageHistory)) {
    return res.stageHistory.filter(
      (item): item is string => typeof item === "string"
    );
  }
  const stepIds = Object.keys(snap.steps ?? {});
  return KNOWN_STAGES.filter((s) => stepIds.includes(s));
}

function extractContractFilesFromSnap(snap: WorkflowState | null): string[] {
  if (!snap) return [];
  const res = snap.result as { contractTestFiles?: unknown } | undefined;
  if (Array.isArray(res?.contractTestFiles)) {
    return res.contractTestFiles.filter(
      (item): item is string => typeof item === "string"
    );
  }
  const reader = createWorkflowStateReader(snap);
  const contractStepOut = reader.getStepOutput<{
    contractTestFiles?: unknown;
  }>("stage_contract_and_tests");
  if (
    contractStepOut &&
    !Array.isArray(contractStepOut) &&
    Array.isArray(contractStepOut.contractTestFiles)
  ) {
    return contractStepOut.contractTestFiles.filter(
      (item): item is string => typeof item === "string"
    );
  }
  return [];
}

function mapSnapshotToStatus(
  snap: WorkflowState | null,
  deliverableStatus: DeliverableStatus
): DeliverableWorkflowStatus {
  if (!snap) {
    return deliverableStatus === "failed" ? "failed" : "not_started";
  }

  if (snap.status === "suspended") {
    return "suspended";
  }

  if (snap.status === "success") {
    const res = snap.result as { rejected?: unknown } | undefined;
    if (res?.rejected === true || deliverableStatus === "failed") {
      return "failed";
    }
    return "completed";
  }

  if (
    snap.status === "failed" ||
    snap.status === "canceled" ||
    snap.status === "tripwire" ||
    deliverableStatus === "failed"
  ) {
    return "failed";
  }

  return "running";
}

export async function createMastraRuntime(
  options: CreateMastraRuntimeOptions
): Promise<MastraWorkflowService> {
  const storage = await getMastraStorageSingleton({
    dataDir: options.dataDir,
    databaseUrl: options.databaseUrl,
  });

  const deliverableLifecycle = createDeliverableLifecycleWorkflow({
    db: options.db,
    masterKey: options.masterKey,
    workspaceFactory: options.workspaceFactory,
    transportFactory: options.transportFactory,
    worktreesRootDir: options.worktreesRootDir,
    skillsDir: options.skillsDir,
  });

  const mastra = new Mastra({
    storage,
    workflows: {
      deliverableLifecycle,
    },
  });

  const getWorkflow = () => mastra.getWorkflow("deliverableLifecycle");

  const buildWorkflowState = async (
    deliverableId: string,
    organizationId: string
  ): Promise<DeliverableWorkflowState> => {
    const row = await findScopedDeliverable(
      options.db,
      deliverableId,
      organizationId
    );
    const deliverableStatus = DeliverableStatusSchema.parse(row.status);
    const runId = row.mastraRunId ?? null;

    let snap: WorkflowState | null = null;
    if (runId) {
      snap = await getWorkflow().getWorkflowRunById(runId);
    }

    const reader = snap ? createWorkflowStateReader(snap) : null;
    const suspendedStep = reader?.getSuspendedStep();
    const suspendPayloadRaw =
      suspendedStep?.suspendPayload &&
      typeof suspendedStep.suspendPayload === "object"
        ? (suspendedStep.suspendPayload as Record<string, unknown>)
        : null;

    let designMdContent: string | null =
      typeof suspendPayloadRaw?.designMdContent === "string"
        ? suspendPayloadRaw.designMdContent
        : null;

    if (!designMdContent && row.hasUi) {
      const [designRow] = await options.db
        .select({ notes: designAssets.notes })
        .from(designAssets)
        .where(
          and(
            eq(designAssets.projectId, row.projectId),
            eq(designAssets.assetType, "design_md")
          )
        )
        .orderBy(desc(designAssets.updatedAt))
        .limit(1);
      designMdContent = designRow?.notes ?? null;
    }

    if (!designMdContent && reader) {
      const visualOut = reader.getStepOutput<{
        designMdContent?: unknown;
      }>("stage_visual_studio");
      if (
        visualOut &&
        !Array.isArray(visualOut) &&
        typeof visualOut.designMdContent === "string"
      ) {
        designMdContent = visualOut.designMdContent;
      }
    }

    const workflowStatus = mapSnapshotToStatus(snap, deliverableStatus);
    const gate =
      workflowStatus === "suspended"
        ? parseGate(suspendPayloadRaw?.gate)
        : null;

    return DeliverableWorkflowStateSchema.parse({
      deliverableId: row.id,
      runId,
      workflowStatus,
      deliverableStatus,
      suspendedStep:
        workflowStatus === "suspended"
          ? (suspendedStep?.stepId ?? null)
          : null,
      gate,
      suspendPayload: workflowStatus === "suspended" ? suspendPayloadRaw : null,
      specMarkdown: row.specMarkdown ?? null,
      blueprint: parseBlueprint(row.blueprintJson),
      designMdContent,
      contractTestFiles: extractContractFilesFromSnap(snap),
      stageHistory: parseStageHistory(snap),
      updatedAt: (snap?.updatedAt ?? row.updatedAt).toISOString(),
    });
  };

  const withDeliverableLock = async <T>(
    deliverableId: string,
    fn: (workerCtx: LockWorkerContextValue) => Promise<T>
  ): Promise<T> => {
    const workerId = `op-${crypto.randomUUID()}`;
    const lock = await acquireDeliverableLock(options.db, {
      deliverableId,
      workerId,
      ttlMinutes: 5,
    });
    if (!lock.acquired) {
      throw new WorkflowRuntimeError({
        statusCode: 409,
        code: "DELIVERABLE_LOCKED",
        message: `Entregável bloqueado pelo worker '${lock.lockedBy ?? "desconhecido"}'.`,
        details: {
          lockedBy: lock.lockedBy,
          lockedAt: lock.lockedAt?.toISOString() ?? null,
        },
      });
    }

    const workerCtx: LockWorkerContextValue = { workerId };
    try {
      return await lockWorkerContext.run(workerCtx, () => fn(workerCtx));
    } finally {
      await releaseDeliverableLock(options.db, {
        deliverableId,
        workerId,
      });
    }
  };

  return {
    mastra,

    async getWorkflowState({ deliverableId, organizationId }) {
      return buildWorkflowState(deliverableId, organizationId);
    },

    async startDeliverableWorkflow({ deliverableId, organizationId, input }) {
      const parsedInput = WorkflowStartInputSchema.parse(input);
      await findScopedDeliverable(options.db, deliverableId, organizationId);

      await withDeliverableLock(deliverableId, async (workerCtx) => {
        const current = await findScopedDeliverable(
          options.db,
          deliverableId,
          organizationId
        );

        if (current.mastraRunId) {
          const existingSnap = await getWorkflow().getWorkflowRunById(
            current.mastraRunId
          );
          if (
            existingSnap &&
            (existingSnap.status === "running" ||
              existingSnap.status === "suspended" ||
              existingSnap.status === "waiting" ||
              existingSnap.status === "pending")
          ) {
            throw new WorkflowRuntimeError({
              statusCode: 409,
              code: "WORKFLOW_ALREADY_RUNNING",
              message: `Entregável já possui execução Mastra ativa ('${current.mastraRunId}').`,
            });
          }
        }

        const runId = crypto.randomUUID();
        await options.db
          .update(deliverables)
          .set({
            mastraRunId: runId,
            updatedAt: new Date(),
          })
          .where(eq(deliverables.id, deliverableId));

        const run = await getWorkflow().createRun({
          runId,
          resourceId: organizationId,
        });

        const result = await run.start({
          inputData: {
            deliverableId,
            organizationId,
            overrideStrategy: parsedInput.overrideStrategy,
          },
          initialState: {
            deliverableId,
            organizationId,
            projectId: current.projectId,
            hasUi: current.hasUi,
            discoveryRound: 1,
            discoveryRounds: [],
            allAnswers: parsedInput.initialAnswers ?? [],
            specMarkdown: current.specMarkdown ?? null,
            blueprint: parseBlueprint(current.blueprintJson),
            designMdContent: null,
            worktreeHandle: null,
            contractTestFiles: [],
            stageHistory: [],
            stuckAttempts: 0,
            humanFeedback: null,
            rejected: false,
            overrideStrategy: parsedInput.overrideStrategy,
          },
          outputOptions: { includeState: true },
        });

        if (result.status === "failed") {
          if (workerCtx.lastRuntimeError) {
            throw workerCtx.lastRuntimeError;
          }
          if (result.error instanceof WorkflowRuntimeError) {
            throw result.error;
          }
          throw new WorkflowRuntimeError({
            statusCode: 500,
            code: "EXECUTION_FAILED",
            message: result.error?.message || "Falha ao iniciar workflow.",
            cause: result.error,
          });
        }
      });

      return buildWorkflowState(deliverableId, organizationId);
    },

    async resumeDeliverableWorkflow({ deliverableId, organizationId, input }) {
      const parsedInput = WorkflowResumeInputSchema.parse(input);
      await findScopedDeliverable(options.db, deliverableId, organizationId);

      await withDeliverableLock(deliverableId, async (workerCtx) => {
        const current = await findScopedDeliverable(
          options.db,
          deliverableId,
          organizationId
        );

        if (!current.mastraRunId) {
          throw new WorkflowRuntimeError({
            statusCode: 409,
            code: "WORKFLOW_NOT_SUSPENDED",
            message: "Entregável não possui run Mastra iniciado para retomar.",
          });
        }

        const snap = await getWorkflow().getWorkflowRunById(
          current.mastraRunId
        );
        const suspended = snap
          ? createWorkflowStateReader(snap).getSuspendedStep()
          : undefined;

        if (!snap || snap.status !== "suspended" || !suspended) {
          throw new WorkflowRuntimeError({
            statusCode: 409,
            code: "WORKFLOW_NOT_SUSPENDED",
            message: "Execução não está suspensa em nenhum portão humano.",
          });
        }

        const suspendPayloadObj =
          suspended.suspendPayload &&
          typeof suspended.suspendPayload === "object"
            ? (suspended.suspendPayload as Record<string, unknown>)
            : null;

        if (
          suspended.stepId === "stage_discovery" &&
          parsedInput.decision === "changes_requested" &&
          typeof suspendPayloadObj?.roundNumber === "number" &&
          suspendPayloadObj.roundNumber >= 3
        ) {
          throw new WorkflowRuntimeError({
            statusCode: 422,
            code: "INVALID_WORKFLOW_INPUT",
            message:
              "Limite máximo de 3 rodadas de Discovery atingido. Aprove ou rejeite.",
          });
        }

        if (
          suspended.stepId === "stage_visual_studio" &&
          parsedInput.decision === "approved" &&
          parsedInput.approveDesignMd === false
        ) {
          throw new WorkflowRuntimeError({
            statusCode: 422,
            code: "INVALID_WORKFLOW_INPUT",
            message:
              "Aprovação explícita do contrato visual é obrigatória (`approveDesignMd !== false`).",
          });
        }

        const run = await getWorkflow().createRun({
          runId: current.mastraRunId,
          resourceId: organizationId,
        });

        const result = await run.resume({
          step: suspended.path,
          resumeData: parsedInput,
          outputOptions: { includeState: true },
        });

        if (result.status === "failed") {
          if (workerCtx.lastRuntimeError) {
            throw workerCtx.lastRuntimeError;
          }
          if (result.error instanceof WorkflowRuntimeError) {
            throw result.error;
          }
          throw new WorkflowRuntimeError({
            statusCode: 500,
            code: "EXECUTION_FAILED",
            message: result.error?.message || "Falha ao retomar workflow.",
            cause: result.error,
          });
        }
      });

      return buildWorkflowState(deliverableId, organizationId);
    },

    async close() {
      await mastra.shutdown();
      await closeMastraStorage();
    },
  };
}
