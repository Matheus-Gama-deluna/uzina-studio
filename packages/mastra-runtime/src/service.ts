import crypto from "node:crypto";
import { Mastra } from "@mastra/core";
import {
  createWorkflowStateReader,
  type WorkflowState,
} from "@mastra/core/workflows";
import {
  DecisionSchema,
  DeliverableStatusSchema,
  DeliverableWorkflowStateSchema,
  ResolveDecisionSchema,
  StrategyRouterOutputSchema,
  WorkflowGateTypeSchema,
  WorkflowResumeInputSchema,
  WorkflowStartInputSchema,
  type BackgroundTaskSummary,
  type Decision,
  type DeliverableStatus,
  type DeliverableWorkflowState,
  type DeliverableWorkflowStatus,
  type OrgRole,
  type ResolveDecisionInput,
  type ResolveDecisionResponse,
  type StrategyRouterOutput,
  type WorkflowGateType,
  type WorkflowResumeInput,
  type WorkflowStartInput,
} from "@uzina/contracts";
import {
  acquireDeliverableLock,
  clients,
  decisions,
  deliverables,
  designAssets,
  executionEvents,
  projects,
  releaseDeliverableLock,
  renewDeliverableLock,
  type UzinaDb,
} from "@uzina/db";
import type { ExecutionWorkspace, OpenCodeTransport } from "@uzina/opencode-bridge";
import type { RunSecurityScanDeps } from "@uzina/security-engine";
import { and, desc, eq } from "drizzle-orm";
import { WorkflowRuntimeError } from "./errors.js";
import { createExecutiveCopilotAgent } from "./agents/executive-copilot.js";
import { BackgroundTasksRegistry } from "./background-tasks.js";
import { destroyAgentController } from "./controller.js";
import { getProjectAccumulatedCostUsd } from "./finops.js";
import {
  closeMastraStorage,
  getMastraStorageSingleton,
  type MastraStorageOptions,
} from "./storage.js";
import {
  LOCK_HEARTBEAT_INTERVAL_MS,
  createDeliverableLifecycleWorkflow,
  lockWorkerContext,
  type FinalizeRunner,
  type LockWorkerContextValue,
  type VerifyRunner,
} from "./workflows/deliverable-lifecycle.js";

export interface CreateMastraRuntimeOptions extends MastraStorageOptions {
  db: UzinaDb;
  masterKey?: Buffer;
  workspaceFactory?: () => ExecutionWorkspace;
  transportFactory?: () => OpenCodeTransport;
  verifyRunner?: VerifyRunner;
  securityRunnerDeps?: RunSecurityScanDeps;
  finalizeRunner?: FinalizeRunner;
  worktreesRootDir?: string;
  skillsDir?: string;
}

export interface MastraWorkflowService {
  mastra: Mastra;
  backgroundTasks: BackgroundTasksRegistry;
  getWorkflowState(params: {
    deliverableId: string;
    organizationId: string;
  }): Promise<DeliverableWorkflowState>;
  startDeliverableWorkflow(params: {
    deliverableId: string;
    organizationId: string;
    input: WorkflowStartInput;
    signal?: AbortSignal;
  }): Promise<DeliverableWorkflowState>;
  resumeDeliverableWorkflow(params: {
    deliverableId: string;
    organizationId: string;
    resolvedByUserId?: string;
    actorRole?: OrgRole;
    input: WorkflowResumeInput;
    signal?: AbortSignal;
  }): Promise<DeliverableWorkflowState>;
  resolveDecision(params: {
    decisionId: string;
    organizationId: string;
    resolvedByUserId?: string;
    actorRole?: OrgRole;
    input: ResolveDecisionInput;
  }): Promise<ResolveDecisionResponse>;
  listProjectBackgroundTasks(params: {
    organizationId: string;
    projectId: string;
  }): Promise<BackgroundTaskSummary[]>;
  abortDeliverableRun(params: {
    deliverableId: string;
    organizationId: string;
    reason?: string;
  }): Promise<{
    aborted: boolean;
    deliverableId: string;
    mastraRunId: string | null;
  }>;
  close(): Promise<void>;
}

const KNOWN_STAGES = [
  "stage_discovery",
  "stage_blueprint",
  "stage_visual_studio",
  "stage_contract_and_tests",
  "stage_build",
  "stage_verify",
  "stage_decision",
  "stage_finalize",
] as const;

function extractSuspendedStepId(
  suspended: { stepId: string; path?: string[] } | undefined
): string | null {
  if (!suspended) return null;
  if (suspended.path && suspended.path.length > 0) {
    const last = suspended.path[suspended.path.length - 1];
    if (typeof last === "string" && last.trim().length > 0) {
      return last;
    }
  }
  return suspended.stepId;
}

function mapDecisionRow(
  row: typeof decisions.$inferSelect,
  meta?: { deliverableTitle?: string; projectId?: string; projectName?: string }
): Decision {
  return DecisionSchema.parse({
    id: row.id,
    deliverableId: row.deliverableId,
    deliverableTitle: meta?.deliverableTitle,
    projectId: meta?.projectId,
    projectName: meta?.projectName,
    mastraStepId: row.mastraStepId,
    decisionType: row.decisionType,
    summary: row.summary,
    payloadJson: row.payloadJson,
    status: row.status,
    humanFeedback: row.humanFeedback,
    resolvedBy: row.resolvedBy,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

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

function parseStageHistory(
  snap: WorkflowState | null,
  eventStages: readonly string[] = []
): string[] {
  if (!snap) return [];
  const res = snap.result as { stageHistory?: unknown } | undefined;
  if (Array.isArray(res?.stageHistory)) {
    return res.stageHistory.filter(
      (item): item is string => typeof item === "string"
    );
  }
  if ("state" in snap && typeof snap.state === "object" && snap.state !== null) {
    const stateObj = snap.state as { stageHistory?: unknown };
    if (Array.isArray(stateObj.stageHistory)) {
      return stateObj.stageHistory.filter(
        (item): item is string => typeof item === "string"
      );
    }
  }
  if (eventStages.length > 0) {
    const executedSet = new Set(eventStages);
    return KNOWN_STAGES.filter((s) => executedSet.has(s));
  }
  const combined = new Set<string>(Object.keys(snap.steps ?? {}));
  return KNOWN_STAGES.filter((s) => combined.has(s));
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
    verifyRunner: options.verifyRunner,
    securityRunnerDeps: options.securityRunnerDeps,
    finalizeRunner: options.finalizeRunner,
    worktreesRootDir: options.worktreesRootDir,
    skillsDir: options.skillsDir,
  });

  const executiveCopilot = createExecutiveCopilotAgent({
    db: options.db,
    securityRunnerDeps: options.securityRunnerDeps,
    masterKey: options.masterKey,
  });

  const mastra = new Mastra({
    storage,
    workflows: {
      deliverableLifecycle,
    },
    agents: {
      executiveCopilot,
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

    const eventRows = await options.db
      .select({ stage: executionEvents.stage })
      .from(executionEvents)
      .where(eq(executionEvents.deliverableId, row.id));
    const eventStages = eventRows.map((e) => e.stage);

    return DeliverableWorkflowStateSchema.parse({
      deliverableId: row.id,
      runId,
      workflowStatus,
      deliverableStatus,
      suspendedStep:
        workflowStatus === "suspended"
          ? extractSuspendedStepId(suspendedStep)
          : null,
      gate,
      suspendPayload: workflowStatus === "suspended" ? suspendPayloadRaw : null,
      specMarkdown: row.specMarkdown ?? null,
      blueprint: parseBlueprint(row.blueprintJson),
      designMdContent,
      contractTestFiles: extractContractFilesFromSnap(snap),
      stageHistory: parseStageHistory(snap, eventStages),
      updatedAt: (snap?.updatedAt ?? row.updatedAt).toISOString(),
    });
  };

  const backgroundTasks = new BackgroundTasksRegistry();
  const activeRunAborters = new Map<string, AbortController>();

  const validateAndApplyBudgetCapOnResume = async (params: {
    projectId: string;
    decision: string;
    actorRole?: OrgRole;
    newBudgetCapUsd?: number;
  }): Promise<void> => {
    if (
      !params.actorRole ||
      (params.actorRole !== "owner" && params.actorRole !== "admin")
    ) {
      throw new WorkflowRuntimeError({
        statusCode: 403,
        code: "FORBIDDEN_SESSION_ACCESS",
        message:
          "Apenas 'owner' ou 'admin' podem aprovar ou ajustar o teto de orçamento (budgetCapUsd).",
      });
    }
    if (params.decision === "approved") {
      const accumulated = await getProjectAccumulatedCostUsd(
        options.db,
        params.projectId
      );
      if (
        params.newBudgetCapUsd === undefined ||
        !Number.isFinite(params.newBudgetCapUsd) ||
        params.newBudgetCapUsd <= accumulated
      ) {
        throw new WorkflowRuntimeError({
          statusCode: 422,
          code: "INVALID_WORKFLOW_INPUT",
          message: `Informe newBudgetCapUsd estritamente maior que o custo acumulado do projeto ($${accumulated.toFixed(4)}).`,
        });
      }
      await options.db
        .update(projects)
        .set({
          budgetCapUsd: params.newBudgetCapUsd.toFixed(6),
          updatedAt: new Date(),
        })
        .where(eq(projects.id, params.projectId));
    }
  };

  const withDeliverableLock = async <T>(
    deliverableId: string,
    fn: (workerCtx: LockWorkerContextValue) => Promise<T>,
    externalSignal?: AbortSignal
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

    const runAbort = new AbortController();
    const onExternalAbort = () => runAbort.abort(externalSignal?.reason);
    if (externalSignal) {
      if (externalSignal.aborted) {
        runAbort.abort(externalSignal.reason);
      } else {
        externalSignal.addEventListener("abort", onExternalAbort, { once: true });
      }
    }
    activeRunAborters.set(deliverableId, runAbort);

    const workerCtx: LockWorkerContextValue = {
      workerId,
      abortSignal: runAbort.signal,
    };
    const heartbeatTimer = setInterval(() => {
      void renewDeliverableLock(options.db, { deliverableId, workerId }).catch(
        () => undefined
      );
    }, LOCK_HEARTBEAT_INTERVAL_MS);

    try {
      return await lockWorkerContext.run(workerCtx, () => fn(workerCtx));
    } finally {
      clearInterval(heartbeatTimer);
      if (externalSignal) {
        externalSignal.removeEventListener("abort", onExternalAbort);
      }
      if (activeRunAborters.get(deliverableId) === runAbort) {
        activeRunAborters.delete(deliverableId);
      }
      await releaseDeliverableLock(options.db, {
        deliverableId,
        workerId,
      });
    }
  };

  return {
    mastra,
    backgroundTasks,

    async getWorkflowState({ deliverableId, organizationId }) {
      return buildWorkflowState(deliverableId, organizationId);
    },

    async startDeliverableWorkflow({
      deliverableId,
      organizationId,
      input,
      signal,
    }) {
      const parsedInput = WorkflowStartInputSchema.parse(input);
      await findScopedDeliverable(options.db, deliverableId, organizationId);

      await withDeliverableLock(
        deliverableId,
        async (workerCtx) => {
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
            verifyAttempts: 0,
            maxVerifyAttempts: current.maxVerifyAttempts,
            verifyPassed: false,
            verifyChecks: [],
            testAuditPassed: false,
            testAuditViolationsCount: 0,
            lastSecurityScanId: null,
            securitySummary: null,
            verifierVerdict: null,
            verifierNotes: null,
            evidencePack: null,
            tokensInput: 0,
            tokensOutput: 0,
            cacheReadTokens: 0,
            estimatedCostUsd: 0,
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
      },
      signal);

      return buildWorkflowState(deliverableId, organizationId);
    },

    async resumeDeliverableWorkflow({
      deliverableId,
      organizationId,
      resolvedByUserId,
      actorRole,
      input,
      signal,
    }) {
      const parsedInput = WorkflowResumeInputSchema.parse(input);
      await findScopedDeliverable(options.db, deliverableId, organizationId);

      await withDeliverableLock(
        deliverableId,
        async (workerCtx) => {
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

        const effectiveStepId = extractSuspendedStepId(suspended);
        const suspendPayloadObj =
          suspended.suspendPayload &&
          typeof suspended.suspendPayload === "object"
            ? (suspended.suspendPayload as Record<string, unknown>)
            : null;

        if (
          effectiveStepId === "stage_discovery" &&
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
          effectiveStepId === "stage_visual_studio" &&
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

        if (
          effectiveStepId === "stage_decision" &&
          parsedInput.decision === "changes_requested" &&
          (!parsedInput.feedback || parsedInput.feedback.trim().length < 3)
        ) {
          throw new WorkflowRuntimeError({
            statusCode: 422,
            code: "INVALID_WORKFLOW_INPUT",
            message:
              "Feedback humano (mínimo 3 caracteres) é obrigatório para changes_requested.",
          });
        }

        const gateParsed = WorkflowGateTypeSchema.safeParse(
          suspendPayloadObj?.gate
        );
        if (gateParsed.success && gateParsed.data === "budget_cap_pause") {
          await validateAndApplyBudgetCapOnResume({
            projectId: current.projectId,
            decision: parsedInput.decision,
            actorRole,
            newBudgetCapUsd: parsedInput.newBudgetCapUsd,
          });
        }

        if (gateParsed.success) {
          await options.db
            .update(decisions)
            .set({
              status: parsedInput.decision,
              humanFeedback: parsedInput.feedback ?? null,
              resolvedBy: resolvedByUserId ?? null,
              resolvedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(decisions.deliverableId, deliverableId),
                eq(decisions.decisionType, gateParsed.data),
                eq(decisions.status, "pending")
              )
            );
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
      },
      signal);

      return buildWorkflowState(deliverableId, organizationId);
    },

    async resolveDecision({
      decisionId,
      organizationId,
      resolvedByUserId,
      actorRole,
      input,
    }) {
      const parsedDecisionInput = ResolveDecisionSchema.parse(input);

      const [initialRow] = await options.db
        .select({
          decision: decisions,
          deliverableTitle: deliverables.title,
          projectId: projects.id,
          projectName: projects.name,
        })
        .from(decisions)
        .innerJoin(deliverables, eq(decisions.deliverableId, deliverables.id))
        .innerJoin(projects, eq(deliverables.projectId, projects.id))
        .innerJoin(clients, eq(projects.clientId, clients.id))
        .where(
          and(
            eq(decisions.id, decisionId),
            eq(clients.organizationId, organizationId)
          )
        )
        .limit(1);

      if (!initialRow) {
        throw new WorkflowRuntimeError({
          statusCode: 404,
          code: "DECISION_NOT_FOUND",
          message: `Decisão '${decisionId}' não encontrada na organização.`,
        });
      }

      const deliverableId = initialRow.decision.deliverableId;

      const updatedDecisionRow = await withDeliverableLock(
        deliverableId,
        async (workerCtx) => {
          const [lockedDecision] = await options.db
            .select()
            .from(decisions)
            .where(eq(decisions.id, decisionId))
            .limit(1);

          if (!lockedDecision) {
            throw new WorkflowRuntimeError({
              statusCode: 404,
              code: "DECISION_NOT_FOUND",
              message: `Decisão '${decisionId}' não encontrada.`,
            });
          }

          if (lockedDecision.status !== "pending") {
            throw new WorkflowRuntimeError({
              statusCode: 409,
              code: "DECISION_ALREADY_RESOLVED",
              message: `Decisão já resolvida com status '${lockedDecision.status}'.`,
            });
          }

          const current = await findScopedDeliverable(
            options.db,
            deliverableId,
            organizationId
          );

          if (!current.mastraRunId) {
            throw new WorkflowRuntimeError({
              statusCode: 409,
              code: "WORKFLOW_NOT_SUSPENDED",
              message: "Entregável não possui run Mastra suspenso.",
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

          const effectiveStepId = extractSuspendedStepId(suspended);
          const suspendPayloadObj =
            suspended.suspendPayload &&
            typeof suspended.suspendPayload === "object"
              ? (suspended.suspendPayload as Record<string, unknown>)
              : null;

          if (
            effectiveStepId === "stage_discovery" &&
            parsedDecisionInput.status === "changes_requested" &&
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

          const resolveGate = WorkflowGateTypeSchema.safeParse(
            suspendPayloadObj?.gate
          );
          if (
            lockedDecision.decisionType === "budget_cap_pause" ||
            (resolveGate.success && resolveGate.data === "budget_cap_pause")
          ) {
            await validateAndApplyBudgetCapOnResume({
              projectId: current.projectId,
              decision: parsedDecisionInput.status,
              actorRole,
              newBudgetCapUsd: parsedDecisionInput.newBudgetCapUsd,
            });
          }

          const updatedRows = await options.db
            .update(decisions)
            .set({
              status: parsedDecisionInput.status,
              humanFeedback: parsedDecisionInput.humanFeedback ?? null,
              resolvedBy: resolvedByUserId ?? null,
              resolvedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(
              and(eq(decisions.id, decisionId), eq(decisions.status, "pending"))
            )
            .returning();

          const updated = updatedRows[0];
          if (!updated) {
            throw new WorkflowRuntimeError({
              statusCode: 409,
              code: "DECISION_ALREADY_RESOLVED",
              message: "Decisão resolvida concorrentemente por outro operador.",
            });
          }

          const run = await getWorkflow().createRun({
            runId: current.mastraRunId,
            resourceId: organizationId,
          });

          const result = await run.resume({
            step: suspended.path,
            resumeData: {
              decision: parsedDecisionInput.status,
              feedback: parsedDecisionInput.humanFeedback,
              ...(parsedDecisionInput.newBudgetCapUsd !== undefined
                ? { newBudgetCapUsd: parsedDecisionInput.newBudgetCapUsd }
                : {}),
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
              message: result.error?.message || "Falha ao retomar decisão.",
              cause: result.error,
            });
          }

          return updated;
        }
      );

      const workflowState = await buildWorkflowState(
        deliverableId,
        organizationId
      );

      return {
        decision: mapDecisionRow(updatedDecisionRow, {
          deliverableTitle: initialRow.deliverableTitle,
          projectId: initialRow.projectId,
          projectName: initialRow.projectName,
        }),
        workflowState,
      };
    },

    async listProjectBackgroundTasks({ organizationId, projectId }) {
      const [proj] = await options.db
        .select({ id: projects.id })
        .from(projects)
        .innerJoin(clients, eq(projects.clientId, clients.id))
        .where(
          and(
            eq(projects.id, projectId),
            eq(clients.organizationId, organizationId)
          )
        )
        .limit(1);

      if (!proj) {
        throw new WorkflowRuntimeError({
          statusCode: 404,
          code: "FORBIDDEN_PROJECT_SCOPE",
          message: `Projeto '${projectId}' não encontrado na organização.`,
        });
      }

      return backgroundTasks.listForProject(options.db, {
        organizationId,
        projectId,
      });
    },

    async abortDeliverableRun({ deliverableId, organizationId, reason }) {
      const row = await findScopedDeliverable(
        options.db,
        deliverableId,
        organizationId
      );
      const effectiveReason = reason?.trim() || "ABORTED_BY_USER";
      const bgAborted = backgroundTasks.abortForDeliverable(
        organizationId,
        deliverableId,
        effectiveReason
      );
      const activeAborter = activeRunAborters.get(deliverableId);
      let activeAborted = false;
      if (activeAborter && !activeAborter.signal.aborted) {
        activeAborter.abort(effectiveReason);
        activeAborted = true;
      }
      return {
        aborted: bgAborted || activeAborted,
        deliverableId: row.id,
        mastraRunId: row.mastraRunId ?? null,
      };
    },

    async close() {
      await backgroundTasks.drainAll();
      await destroyAgentController();
      await mastra.shutdown();
      await closeMastraStorage();
    },
  };
}
