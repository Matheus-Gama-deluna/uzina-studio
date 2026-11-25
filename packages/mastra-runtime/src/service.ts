import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Mastra } from "@mastra/core";
import type { MastraModelConfig } from "@mastra/core/llm";
import {
  createWorkflowStateReader,
  type WorkflowState,
} from "@mastra/core/workflows";
import {
  AutonomousCycleResponseSchema,
  CleanupDeliverableWorktreeResponseSchema,
  CleanupProjectWorktreesRequestSchema,
  CleanupProjectWorktreesResponseSchema,
  DecisionSchema,
  DeliverableStatusSchema,
  DeliverableWorkflowStateSchema,
  EvidencePackSchema,
  MergeDeliverableBranchResponseSchema,
  ProjectWorktreeListResponseSchema,
  ResolveDecisionSchema,
  StrategyRouterOutputSchema,
  WorkflowGateTypeSchema,
  WorkflowResumeInputSchema,
  WorkflowStartInputSchema,
  type AutonomousCycleResponse,
  type BackgroundTaskSummary,
  type CleanupDeliverableWorktreeResponse,
  type CleanupProjectWorktreesRequest,
  type CleanupProjectWorktreesResponse,
  type Decision,
  type DeliverableStatus,
  type DeliverableWorkflowState,
  type DeliverableWorkflowStatus,
  type MergeDeliverableBranchResponse,
  type OrgRole,
  type ProjectWorktreeItem,
  type ProjectWorktreeListResponse,
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
  projectRepositories,
  projects,
  providerProfiles,
  releaseDeliverableLock,
  renewDeliverableLock,
  type UzinaDb,
} from "@uzina/db";
import {
  LocalGitWorktreeWorkspace,
  listProjectWorktrees,
  removeWorktreeByPathSafe,
  type DockerProbeResult,
  type ExecutionWorkspace,
  type OpenCodeTransport,
} from "@uzina/opencode-bridge";
import type { RunSecurityScanDeps } from "@uzina/security-engine";
import { and, asc, desc, eq } from "drizzle-orm";
import { WorkflowRuntimeError } from "./errors.js";
import { createExecutiveCopilotAgent } from "./agents/executive-copilot.js";
import { BackgroundTasksRegistry } from "./background-tasks.js";
import { destroyAgentController } from "./controller.js";
import { recordExecutionEvent } from "./event-bus.js";
import { getProjectAccumulatedCostUsd } from "./finops.js";
import {
  SymbolLockManager,
  resolveDeliverableTargetSymbols,
} from "./symbol-locks.js";
import {
  closeMastraStorage,
  getMastraStorageSingleton,
  type MastraStorageOptions,
} from "./storage.js";
import {
  LOCK_HEARTBEAT_INTERVAL_MS,
  createDeliverableLifecycleWorkflow,
  lockWorkerContext,
  mergeBranchIntoBaseSafe,
  type FinalizeRunner,
  type LockWorkerContextValue,
  type VerifyRunner,
} from "./workflows/deliverable-lifecycle.js";

export interface CreateMastraRuntimeOptions extends MastraStorageOptions {
  db: UzinaDb;
  masterKey?: Buffer;
  workspaceFactory?: () => ExecutionWorkspace;
  dockerProbe?: () => Promise<DockerProbeResult>;
  githubFetchImpl?: typeof fetch;
  transportFactory?: () => OpenCodeTransport;
  verifyRunner?: VerifyRunner;
  securityRunnerDeps?: RunSecurityScanDeps;
  finalizeRunner?: FinalizeRunner;
  worktreesRootDir?: string;
  skillsDir?: string;
  codingModelOverride?: MastraModelConfig;
  verifierModelOverride?: MastraModelConfig;
}

export interface MastraWorkflowService {
  mastra: Mastra;
  backgroundTasks: BackgroundTasksRegistry;
  symbolLockManager: SymbolLockManager;
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
    status: DeliverableStatus;
  }>;
  runProjectAutonomousCycle(params: {
    projectId: string;
    organizationId: string;
  }): Promise<AutonomousCycleResponse>;
  mergeDeliverableBranch(params: {
    deliverableId: string;
    organizationId: string;
  }): Promise<MergeDeliverableBranchResponse>;
  cleanupDeliverableWorktree(params: {
    deliverableId: string;
    organizationId: string;
  }): Promise<CleanupDeliverableWorktreeResponse>;
  listProjectWorktrees(params: {
    projectId: string;
    organizationId: string;
  }): Promise<ProjectWorktreeListResponse>;
  cleanupProjectWorktrees(params: {
    projectId: string;
    organizationId: string;
    input: CleanupProjectWorktreesRequest;
  }): Promise<CleanupProjectWorktreesResponse>;
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
    dockerProbe: options.dockerProbe,
    githubFetchImpl: options.githubFetchImpl,
    transportFactory: options.transportFactory,
    verifyRunner: options.verifyRunner,
    securityRunnerDeps: options.securityRunnerDeps,
    finalizeRunner: options.finalizeRunner,
    worktreesRootDir: options.worktreesRootDir,
    skillsDir: options.skillsDir,
    codingModelOverride: options.codingModelOverride,
    verifierModelOverride: options.verifierModelOverride,
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
  const symbolLockManager = new SymbolLockManager();
  const activeRunAborters = new Map<string, AbortController>();

  const normalizeWorktreePathForMatch = (p: string): string => {
    const resolved = fs.existsSync(p)
      ? fs.realpathSync.native(p).replace(/^\\\\\?\\/, "")
      : path.resolve(p);
    const unixified = resolved.replace(/\\/g, "/");
    return process.platform === "win32" ? unixified.toLowerCase() : unixified;
  };

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

  const service: MastraWorkflowService = {
    mastra,
    backgroundTasks,
    symbolLockManager,

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

      const NON_PAUSABLE = new Set<DeliverableStatus>([
        "merged",
        "approved",
        "failed",
        "paused",
        "decision_pending",
      ]);
      const currentStatus = row.status as DeliverableStatus;
      let transitionedToPaused = false;

      if (!NON_PAUSABLE.has(currentStatus)) {
        await options.db
          .update(deliverables)
          .set({
            status: "paused",
            pausedFromStatus: currentStatus,
            updatedAt: new Date(),
          })
          .where(eq(deliverables.id, row.id));

        await recordExecutionEvent(options.db, {
          deliverableId: row.id,
          stage: "paused",
          actorRole: "operator",
          eventType: "stage_change",
          payload: {
            eventKind: "aborted",
            reason: effectiveReason,
            previousStatus: currentStatus,
            newStatus: "paused",
            backgroundAborted: bgAborted,
            activeAborted,
          },
        });
        transitionedToPaused = true;
      }

      return {
        aborted: bgAborted || activeAborted || transitionedToPaused,
        deliverableId: row.id,
        mastraRunId: row.mastraRunId ?? null,
        status: transitionedToPaused ? "paused" : currentStatus,
      };
    },

    async runProjectAutonomousCycle({ projectId, organizationId }) {
      const [projRow] = await options.db
        .select({ project: projects })
        .from(projects)
        .innerJoin(clients, eq(projects.clientId, clients.id))
        .where(
          and(
            eq(projects.id, projectId),
            eq(clients.organizationId, organizationId)
          )
        )
        .limit(1);

      if (!projRow) {
        throw new WorkflowRuntimeError({
          statusCode: 404,
          code: "FORBIDDEN_PROJECT_SCOPE",
          message: `Projeto '${projectId}' não encontrado na organização.`,
        });
      }

      const currentTasks = await backgroundTasks.listForProject(options.db, {
        organizationId,
        projectId,
      });
      const activeTask = currentTasks.find(
        (t) => t.status === "running" || t.status === "queued"
      );
      if (activeTask) {
        return AutonomousCycleResponseSchema.parse({
          dispatched: false,
          alreadyRunning: true,
          taskId: activeTask.id,
          deliverableId: activeTask.deliverableId,
          deliverableTitle: null,
          message: `Ciclo autônomo já está em andamento (${activeTask.summary}).`,
        });
      }

      const [defaultRepo] = await options.db
        .select({ id: projectRepositories.id })
        .from(projectRepositories)
        .where(eq(projectRepositories.projectId, projectId))
        .orderBy(desc(projectRepositories.createdAt))
        .limit(1);

      if (!defaultRepo) {
        return AutonomousCycleResponseSchema.parse({
          dispatched: false,
          alreadyRunning: false,
          taskId: null,
          deliverableId: null,
          deliverableTitle: null,
          message:
            "Cadastre/vincule um repositório local ao projeto antes de executar o ciclo autônomo.",
        });
      }

      const orgProviders = await options.db
        .select({ roleBindingsJson: providerProfiles.roleBindingsJson })
        .from(providerProfiles)
        .where(eq(providerProfiles.organizationId, organizationId));

      const hasBuilderProvider = orgProviders.some(
        (p) =>
          p.roleBindingsJson?.builder?.modelId &&
          p.roleBindingsJson.builder.modelId.trim().length > 0
      );
      if (!hasBuilderProvider) {
        return AutonomousCycleResponseSchema.parse({
          dispatched: false,
          alreadyRunning: false,
          taskId: null,
          deliverableId: null,
          deliverableTitle: null,
          message:
            "Configure um provedor LLM com modelo atribuído ao papel Builder antes de executar o ciclo autônomo.",
        });
      }

      const projectDelivs = await options.db
        .select()
        .from(deliverables)
        .where(eq(deliverables.projectId, projectId))
        .orderBy(asc(deliverables.createdAt));

      const eligible = projectDelivs.find(
        (d) =>
          d.status !== "merged" &&
          d.status !== "failed" &&
          d.status !== "approved" &&
          d.status !== "decision_pending"
      );

      if (!eligible) {
        return AutonomousCycleResponseSchema.parse({
          dispatched: false,
          alreadyRunning: false,
          taskId: null,
          deliverableId: null,
          deliverableTitle: null,
          message:
            "Nenhuma entrega elegível para ciclo autônomo (verifique Decisões HITL pendentes ou entregas concluídas).",
        });
      }

      const [pendingDec] = await options.db
        .select({ id: decisions.id })
        .from(decisions)
        .where(
          and(
            eq(decisions.deliverableId, eligible.id),
            eq(decisions.status, "pending")
          )
        )
        .limit(1);

      if (pendingDec) {
        return AutonomousCycleResponseSchema.parse({
          dispatched: false,
          alreadyRunning: false,
          taskId: null,
          deliverableId: eligible.id,
          deliverableTitle: eligible.title,
          message: `A entrega '${eligible.title}' possui decisão humana pendente na Caixa de Decisões.`,
        });
      }

      if (eligible.mastraRunId) {
        const st = await service
          .getWorkflowState({
            deliverableId: eligible.id,
            organizationId,
          })
          .catch(() => null);
        if (st?.workflowStatus === "suspended") {
          return AutonomousCycleResponseSchema.parse({
            dispatched: false,
            alreadyRunning: false,
            taskId: null,
            deliverableId: eligible.id,
            deliverableTitle: eligible.title,
            message: `A entrega '${eligible.title}' está suspensa em portão humano (${st.gate ?? "HITL"}).`,
          });
        }
        if (st?.workflowStatus === "running") {
          return AutonomousCycleResponseSchema.parse({
            dispatched: false,
            alreadyRunning: true,
            taskId: null,
            deliverableId: eligible.id,
            deliverableTitle: eligible.title,
            message: `A entrega '${eligible.title}' já possui execução Mastra ativa.`,
          });
        }
      }

      if (!eligible.repositoryId) {
        await options.db
          .update(deliverables)
          .set({
            repositoryId: defaultRepo.id,
            updatedAt: new Date(),
          })
          .where(eq(deliverables.id, eligible.id));
      }

      const task = backgroundTasks.enqueue({
        organizationId,
        projectId,
        deliverableId: eligible.id,
        kind: "workflow_cycle",
        summary: `Ciclo autônomo em execução para '${eligible.title}'`,
        mastraRunId: eligible.mastraRunId ?? null,
        work: async ({ signal, updateTask }) => {
          const targetSymbols = await resolveDeliverableTargetSymbols(
            options.db,
            {
              projectId,
              title: eligible.title,
              description: eligible.description,
              specMarkdown: eligible.specMarkdown,
            }
          );

          const lockResult = await symbolLockManager.acquireOrWait({
            projectId,
            deliverableId: eligible.id,
            symbols: targetSymbols,
            signal,
            onWaiting: (conflictingSymbols) => {
              updateTask({
                status: "queued_waiting_lock",
                summary: `Aguardando Lock AST em: ${conflictingSymbols.slice(0, 3).join(", ")}`,
              });
            },
          });

          if (!lockResult.acquired) {
            return;
          }

          updateTask({
            status: "running",
            summary: `Ciclo autônomo em execução para '${eligible.title}'`,
          });

          try {
            const state = await service.startDeliverableWorkflow({
              deliverableId: eligible.id,
              organizationId,
              input: {},
              signal,
            });
            updateTask({
              mastraRunId: state.runId,
              status:
                state.workflowStatus === "suspended"
                  ? "suspended"
                  : state.workflowStatus === "failed"
                    ? "failed"
                    : "completed",
              summary: `${eligible.title}: ${state.deliverableStatus} (${state.workflowStatus})`,
            });
          } finally {
            symbolLockManager.release({
              projectId,
              deliverableId: eligible.id,
            });
          }
        },
      });

      return AutonomousCycleResponseSchema.parse({
        dispatched: true,
        alreadyRunning: false,
        taskId: task.id,
        deliverableId: eligible.id,
        deliverableTitle: eligible.title,
        message: `Ciclo autônomo iniciado para '${eligible.title}' (${task.id}).`,
      });
    },

    async mergeDeliverableBranch({ deliverableId, organizationId }) {
      const row = await findScopedDeliverable(
        options.db,
        deliverableId,
        organizationId
      );
      if (row.status !== "approved" && row.status !== "merged") {
        throw new WorkflowRuntimeError({
          statusCode: 409,
          code: "WORKFLOW_NOT_SUSPENDED",
          message:
            "Apenas entregas aprovadas no portão HITL podem ser mescladas na branch base.",
        });
      }
      if (!row.branchName) {
        throw new WorkflowRuntimeError({
          statusCode: 409,
          code: "WORKFLOW_NOT_SUSPENDED",
          message: "Entregável não possui branch pendente para mesclar.",
        });
      }
      if (!row.repositoryId) {
        throw new WorkflowRuntimeError({
          statusCode: 422,
          code: "MISSING_PRECONDITION",
          message: "Entregável não está vinculado a um repositório.",
        });
      }

      const [repo] = await options.db
        .select()
        .from(projectRepositories)
        .where(eq(projectRepositories.id, row.repositoryId))
        .limit(1);

      if (!repo) {
        throw new WorkflowRuntimeError({
          statusCode: 422,
          code: "MISSING_PRECONDITION",
          message: "Repositório do entregável não encontrado.",
        });
      }

      const mergeAttempt = await mergeBranchIntoBaseSafe({
        repoPath: repo.localPath,
        branchName: row.branchName,
        baseBranch: repo.defaultBranch || "main",
        deleteBranchOnSuccess: true,
      });

      if (!mergeAttempt.ok) {
        return MergeDeliverableBranchResponseSchema.parse({
          ok: false,
          mode: "local_branch_ready",
          commitSha: mergeAttempt.commitSha,
          branchName: row.branchName,
          message:
            mergeAttempt.mergeBlockedReason ??
            "Não foi possível mesclar a branch na base.",
        });
      }

      const parsedPack = EvidencePackSchema.safeParse(row.evidencePackJson);
      const nextPack = parsedPack.success
        ? {
            ...parsedPack.data,
            finalizeInfo: {
              mode: "local_merge" as const,
              commitSha:
                mergeAttempt.commitSha ??
                parsedPack.data.finalizeInfo?.commitSha ??
                null,
              prUrl: parsedPack.data.finalizeInfo?.prUrl ?? null,
              branchName: row.branchName,
              mergeBlockedReason: null,
            },
          }
        : row.evidencePackJson;

      await options.db
        .update(deliverables)
        .set({
          branchName: null,
          evidencePackJson: nextPack as Record<string, unknown> | null,
          updatedAt: new Date(),
        })
        .where(eq(deliverables.id, row.id));

      await recordExecutionEvent(options.db, {
        deliverableId: row.id,
        stage: "stage_finalize",
        actorRole: "builder",
        eventType: "stage_change",
        payload: {
          status: row.status,
          finalizeMode: "local_merge",
          commitSha: mergeAttempt.commitSha,
          manualMerge: true,
        },
      });

      return MergeDeliverableBranchResponseSchema.parse({
        ok: true,
        mode: "local_merge",
        commitSha: mergeAttempt.commitSha,
        branchName: row.branchName,
        message: `Branch '${row.branchName}' mesclada em '${repo.defaultBranch || "main"}' (${mergeAttempt.commitSha?.slice(0, 7) ?? "HEAD"}).`,
      });
    },

    async cleanupDeliverableWorktree({ deliverableId, organizationId }) {
      const row = await findScopedDeliverable(
        options.db,
        deliverableId,
        organizationId
      );

      const projTasks = await backgroundTasks.listForProject(options.db, {
        organizationId,
        projectId: row.projectId,
      });
      const activeForDeliverable = projTasks.some(
        (t) =>
          t.deliverableId === row.id &&
          (t.status === "running" ||
            t.status === "queued" ||
            t.status === "queued_waiting_lock")
      );
      if (activeForDeliverable || activeRunAborters.has(row.id)) {
        throw new WorkflowRuntimeError({
          statusCode: 409,
          code: "WORKFLOW_ALREADY_RUNNING",
          message:
            "Não é possível limpar o worktree enquanto a entrega possui execução ativa.",
        });
      }

      if (row.worktreePath && row.repositoryId && row.branchName) {
        const [repo] = await options.db
          .select()
          .from(projectRepositories)
          .where(eq(projectRepositories.id, row.repositoryId))
          .limit(1);

        if (repo) {
          const workspace =
            options.workspaceFactory?.() ?? new LocalGitWorktreeWorkspace();
          try {
            await workspace.attach({
              deliverableId: row.id,
              repoPath: repo.localPath,
              workspacePath: row.worktreePath,
              branchName: row.branchName,
              baseBranch: repo.defaultBranch || "main",
            });
            await workspace.cleanup({ deleteBranch: false });
          } catch {
            // Melhor esforço se o diretório já foi removido manualmente
          }
        }
      }

      await options.db
        .update(deliverables)
        .set({
          worktreePath: null,
          updatedAt: new Date(),
        })
        .where(eq(deliverables.id, row.id));

      await recordExecutionEvent(options.db, {
        deliverableId: row.id,
        stage: "stage_finalize",
        actorRole: "builder",
        eventType: "stage_change",
        payload: {
          worktreeCleaned: true,
        },
      });

      return CleanupDeliverableWorktreeResponseSchema.parse({
        cleaned: true,
        deliverableId: row.id,
        message: "Worktree órfão removido e registro atualizado.",
      });
    },

    async listProjectWorktrees({ projectId, organizationId }) {
      const [scopedProject] = await options.db
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

      if (!scopedProject) {
        throw new WorkflowRuntimeError({
          statusCode: 404,
          code: "DELIVERABLE_NOT_FOUND",
          message: `Projeto '${projectId}' não encontrado na organização.`,
        });
      }

      const [repos, projectDelivs, projTasks] = await Promise.all([
        options.db
          .select()
          .from(projectRepositories)
          .where(eq(projectRepositories.projectId, projectId)),
        options.db
          .select()
          .from(deliverables)
          .where(eq(deliverables.projectId, projectId)),
        backgroundTasks.listForProject(options.db, {
          organizationId,
          projectId,
        }),
      ]);

      const activeDeliverableIds = new Set(
        projTasks
          .filter(
            (t) =>
              t.deliverableId &&
              (t.status === "running" ||
                t.status === "queued" ||
                t.status === "queued_waiting_lock")
          )
          .map((t) => t.deliverableId!)
      );
      for (const delivId of activeRunAborters.keys()) {
        activeDeliverableIds.add(delivId);
      }

      const items: ProjectWorktreeItem[] = [];
      for (const repo of repos) {
        const entries = await listProjectWorktrees(repo.localPath);
        for (const entry of entries) {
          const entryNorm = normalizeWorktreePathForMatch(entry.worktreePath);
          const matchedDeliv =
            projectDelivs.find(
              (d) =>
                (d.worktreePath &&
                  normalizeWorktreePathForMatch(d.worktreePath) ===
                    entryNorm) ||
                (!entry.isMain &&
                  entry.branchName &&
                  d.branchName === entry.branchName)
            ) ?? null;

          const hasActiveTask = matchedDeliv
            ? activeDeliverableIds.has(matchedDeliv.id)
            : false;
          const isOrphan =
            !entry.isMain &&
            !hasActiveTask &&
            (!matchedDeliv ||
              matchedDeliv.status === "merged" ||
              matchedDeliv.status === "failed" ||
              matchedDeliv.status === "approved");
          const canMerge = Boolean(
            !entry.isMain &&
              matchedDeliv &&
              entry.branchName &&
              matchedDeliv.branchName &&
              matchedDeliv.status === "approved"
          );

          items.push({
            repositoryId: repo.id,
            repositoryName: repo.name,
            worktreePath: entry.worktreePath,
            branchName: entry.branchName,
            headSha: entry.headSha,
            isMain: entry.isMain,
            isBare: entry.isBare,
            isOrphan,
            hasActiveTask,
            deliverableId: matchedDeliv?.id ?? null,
            deliverableTitle: matchedDeliv?.title ?? null,
            deliverableStatus: matchedDeliv?.status ?? null,
            canMerge,
          });
        }
      }

      const orphanCount = items.filter((item) => item.isOrphan).length;
      return ProjectWorktreeListResponseSchema.parse({
        projectId,
        items,
        orphanCount,
      });
    },

    async cleanupProjectWorktrees({ projectId, organizationId, input }) {
      const parsed = CleanupProjectWorktreesRequestSchema.parse(input);
      const listed = await service.listProjectWorktrees({
        projectId,
        organizationId,
      });

      const repos = await options.db
        .select()
        .from(projectRepositories)
        .where(eq(projectRepositories.projectId, projectId));
      const repoById = new Map(repos.map((r) => [r.id, r]));

      const removedPaths: string[] = [];
      const skippedActivePaths: string[] = [];

      const removeOne = async (item: ProjectWorktreeItem) => {
        const repo = repoById.get(item.repositoryId);
        if (!repo) return;
        await removeWorktreeByPathSafe({
          repoPath: repo.localPath,
          worktreePath: item.worktreePath,
          deleteBranch:
            Boolean(item.branchName) &&
            item.deliverableStatus !== "approved",
          branchName: item.branchName,
        });
        removedPaths.push(item.worktreePath);
        if (item.deliverableId) {
          await options.db
            .update(deliverables)
            .set({ worktreePath: null, updatedAt: new Date() })
            .where(
              and(
                eq(deliverables.id, item.deliverableId),
                eq(deliverables.projectId, projectId)
              )
            );
        }
      };

      if (parsed.worktreePath) {
        const targetNorm = normalizeWorktreePathForMatch(parsed.worktreePath);
        const target = listed.items.find(
          (i) => normalizeWorktreePathForMatch(i.worktreePath) === targetNorm
        );
        if (!target) {
          throw new WorkflowRuntimeError({
            statusCode: 404,
            code: "DELIVERABLE_NOT_FOUND",
            message: `Worktree '${parsed.worktreePath}' não encontrado no projeto.`,
          });
        }
        if (target.isMain || target.hasActiveTask) {
          throw new WorkflowRuntimeError({
            statusCode: 409,
            code: "WORKFLOW_ALREADY_RUNNING",
            message: target.isMain
              ? "Não é permitido remover a worktree principal do repositório."
              : "Não é possível remover worktree vinculado a uma execução ativa.",
          });
        }
        await removeOne(target);
      } else if (parsed.pruneAllOrphans) {
        for (const item of listed.items) {
          if (item.isMain) continue;
          if (item.hasActiveTask) {
            skippedActivePaths.push(item.worktreePath);
            continue;
          }
          if (item.isOrphan) {
            await removeOne(item);
          }
        }
      }

      return CleanupProjectWorktreesResponseSchema.parse({
        projectId,
        removedPaths,
        skippedActivePaths,
        message:
          removedPaths.length > 0
            ? `${removedPaths.length} worktree(s) removido(s) com segurança.`
            : "Nenhum worktree órfão elegível para limpeza.",
      });
    },

    async close() {
      await backgroundTasks.drainAll();
      symbolLockManager.clearAll();
      await destroyAgentController();
      await mastra.shutdown();
      await closeMastraStorage();
    },
  };

  return service;
}
