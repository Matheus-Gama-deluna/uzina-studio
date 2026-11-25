import { AsyncLocalStorage } from "node:async_hooks";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { MastraModelConfig } from "@mastra/core/llm";
import {
  ArchitectBlueprintV2Schema,
  DEFAULT_PROJECT_STAGE_AUTOMATION,
  DecisionRiskBriefingSchema,
  DeliverableStatusSchema,
  DesignAssetSchema,
  DevelopmentStrategySchema,
  DiscoveryAnswerSchema,
  DiscoveryRoundSchema,
  EvidencePackSchema,
  ProjectFinalizePolicySchema,
  ProjectStageAutomationSchema,
  PrototypeComponentManifestSchema,
  ShapeSpecSchema,
  StrategyRouterOutputSchema,
  StuckAlertSchema,
  VerifierTwoStageOutputSchema,
  VerifierVerdictOutputSchema,
  VerifyCheckSummarySchema,
  ToolCallTracePayloadSchema,
  WorkflowGateTypeSchema,
  WorkflowResumeInputSchema,
  WorktreeHandleSchema,
  type ArchitectBlueprintV2,
  type BddScenario,
  type CustomModelPricingMap,
  type DecisionRiskBriefing,
  type DecisionStatus,
  type DecisionType,
  type DeliverableStatus,
  type DesignAsset,
  type DevelopmentStrategy,
  type DiscoveryAnswer,
  type DiscoveryRound,
  type DiscoverySummary,
  type EvidencePack,
  type ProjectFinalizePolicy,
  type ProjectStageAutomation,
  type PrototypeComponentManifest,
  type ProviderType,
  type RoleBindings,
  type ShapeSpec,
  type StrategyRouterOutput,
  type VerifierTwoStageOutput,
  type VerifyCheckSummary,
  type WorktreeHandle,
} from "@uzina/contracts";
import {
  assertPathInsideWorkspace,
  assertValidTransition,
  auditTestDirectory,
  buildDiscoveryQuestions,
  consolidateDiscoverySummary,
  estimateTokenCostUsd,
  generateDesignMdContract,
  parseUnifiedDiffSemantic,
  redactSensitiveText,
  routeDevelopmentStrategy,
  scanRepositoryBrownfield,
} from "@uzina/core";
import {
  decisions,
  deliverables,
  designAssets,
  memories,
  projectRepositories,
  projects,
  providerProfiles,
  renewDeliverableLock,
  securityFindings,
  securityScans,
  type UzinaDb,
} from "@uzina/db";
import {
  LocalGitWorktreeWorkspace,
  OpenCodeRunner,
  SdkOpenCodeTransport,
  type DockerProbeResult,
  type ExecutionWorkspace,
  type OpenCodeTransport,
} from "@uzina/opencode-bridge";
import {
  runSecurityScan,
  type ExecutedSecurityScanOutput,
  type FindingSuppressionLookup,
  type RunSecurityScanDeps,
} from "@uzina/security-engine";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { WorkflowRuntimeError } from "../errors.js";
import { recordExecutionEvent } from "../event-bus.js";
import {
  createConfiguredExecutionWorkspaceScoped,
  getEngineConfigScoped,
  getProjectAccumulatedCostUsd,
  getProjectAccumulatedTokens,
} from "../finops.js";
import {
  createGitHubDraftPrViaApi,
  parseGitHubOwnerRepo,
  renderDraftPrBodyWithRiskBriefing,
  resolveOrganizationGitHubPat,
} from "../github-pr.js";
import {
  formatMemoriesForPrompt,
  resolveHierarchicalMemories,
} from "../memories.js";
import { recordDeliverableProvenance } from "../codebase.js";
import { collectOrganizationKnownSecrets } from "../model-resolver.js";
import {
  generateArchitectBlueprintV2,
  runVisualStudioThreeStagePipeline,
  validateAndBuildShapeSpec,
} from "../stages/structured-handoffs.js";
import {
  computeDecisionRiskBriefing,
  distillRetrospectiveToQmd,
  evaluateTwoStageVerifier,
  syncOpenSpecArchive,
} from "../stages/two-stage-verifier.js";
import { SymbolLockManager } from "../symbol-locks.js";
import { createCodingExecutorAdapter } from "../workspace-adapter.js";

export const LOCK_HEARTBEAT_INTERVAL_MS = 60_000;

export const WorkflowRuntimeStateSchema = z.object({
  deliverableId: z.string(),
  organizationId: z.string(),
  projectId: z.string(),
  hasUi: z.boolean(),
  discoveryRound: z.number().int().min(1).max(3).default(1),
  discoveryRounds: z.array(DiscoveryRoundSchema).default([]),
  allAnswers: z.array(DiscoveryAnswerSchema).default([]),
  specMarkdown: z.string().nullable().default(null),
  blueprint: StrategyRouterOutputSchema.nullable().default(null),
  designMdContent: z.string().nullable().default(null),
  worktreeHandle: WorktreeHandleSchema.nullable().default(null),
  contractTestFiles: z.array(z.string()).default([]),
  stageHistory: z.array(z.string()).default([]),
  stuckAttempts: z.number().int().nonnegative().default(0),
  verifyAttempts: z.number().int().nonnegative().default(0),
  maxVerifyAttempts: z.number().int().min(1).max(10).default(3),
  verifyPassed: z.boolean().default(false),
  verifyChecks: z.array(VerifyCheckSummarySchema).default([]),
  testAuditPassed: z.boolean().default(false),
  testAuditViolationsCount: z.number().int().nonnegative().default(0),
  lastSecurityScanId: z.string().nullable().default(null),
  securitySummary: EvidencePackSchema.shape.securitySummary.nullable().default(null),
  verifierVerdict: z.enum(["approved", "changes_required"]).nullable().default(null),
  verifierNotes: z.string().nullable().default(null),
  evidencePack: EvidencePackSchema.nullable().default(null),
  tokensInput: z.number().int().nonnegative().default(0),
  tokensOutput: z.number().int().nonnegative().default(0),
  cacheReadTokens: z.number().int().nonnegative().default(0),
  estimatedCostUsd: z.number().nonnegative().default(0),
  humanFeedback: z.string().nullable().default(null),
  rejected: z.boolean().default(false),
  overrideStrategy: DevelopmentStrategySchema.optional(),
  shapeSpec: ShapeSpecSchema.nullable().optional(),
  architectBlueprintV2: ArchitectBlueprintV2Schema.nullable().optional(),
  prototypeManifest: PrototypeComponentManifestSchema.nullable().optional(),
  twoStageVerifierOutput: VerifierTwoStageOutputSchema.nullable().optional(),
  decisionRiskBriefing: DecisionRiskBriefingSchema.nullable().optional(),
  lastDiffSimplificationNote: z.string().nullable().optional(),
});
export type WorkflowRuntimeState = z.infer<typeof WorkflowRuntimeStateSchema>;

export const DeliverableLifecycleInputSchema = z.object({
  deliverableId: z.uuid(),
  organizationId: z.uuid(),
  overrideStrategy: DevelopmentStrategySchema.optional(),
});

export const DeliveryCycleIOSchema = z.object({
  deliverableId: z.string(),
  worktreeHandle: WorktreeHandleSchema.nullable(),
  contractTestFiles: z.array(z.string()),
  cycleDone: z.boolean().default(false),
  verifyPassed: z.boolean().default(false),
  approved: z.boolean().default(false),
  rejected: z.boolean().default(false),
  failed: z.boolean().default(false),
  stageHistory: z.array(z.string()).default([]),
});
export type DeliveryCycleIO = z.infer<typeof DeliveryCycleIOSchema>;

export const DeliverableLifecycleOutputSchema = z.object({
  rejected: z.boolean().default(false),
  deliverableId: z.string(),
  deliverableStatus: DeliverableStatusSchema,
  worktreeHandle: WorktreeHandleSchema.nullable().optional(),
  contractTestFiles: z.array(z.string()).default([]),
  stageHistory: z.array(z.string()).default([]),
  evidencePack: EvidencePackSchema.nullable().optional(),
});

export type VerifyRunner = (ctx: {
  deliverableId: string;
  workspacePath: string;
  workspace: ExecutionWorkspace;
  attemptNumber: number;
  signal: AbortSignal;
}) => Promise<VerifyCheckSummary[]>;

export interface FinalizeOutcome {
  mode: "draft_pr" | "local_merge" | "local_branch_ready";
  commitSha: string | null;
  prUrl: string | null;
  shouldDeleteBranchOnCleanup: boolean;
  mergeBlockedReason?: string | null;
}

export type FinalizeRunner = (ctx: {
  deliverableId: string;
  workspacePath: string;
  repoPath: string | null;
  remoteUrl: string | null;
  branchName: string;
  baseBranch: string;
  finalizePolicy?: ProjectFinalizePolicy;
  commitMessage: string;
  prTitle: string;
  prBody: string;
  githubPat?: string | null;
  fetchImpl?: typeof fetch;
  signal: AbortSignal;
}) => Promise<FinalizeOutcome>;

export interface DeliverableWorkflowDeps {
  db: UzinaDb;
  masterKey?: Buffer;
  symbolLockManager?: SymbolLockManager;
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

export interface LockWorkerContextValue {
  workerId: string;
  abortSignal?: AbortSignal;
  lastRuntimeError?: WorkflowRuntimeError;
}

export const lockWorkerContext = new AsyncLocalStorage<LockWorkerContextValue>();

function failWorkflow(err: WorkflowRuntimeError): never {
  const ctx = lockWorkerContext.getStore();
  if (ctx) {
    ctx.lastRuntimeError = err;
  }
  throw err;
}

function appendStageHistory(history: readonly string[], stage: string): string[] {
  return history.includes(stage) ? [...history] : [...history, stage];
}

function mergeAnswers(
  existing: readonly DiscoveryAnswer[],
  incoming: readonly DiscoveryAnswer[] | undefined
): DiscoveryAnswer[] {
  if (!incoming || incoming.length === 0) {
    return [...existing];
  }
  const byPillar = new Map<string, DiscoveryAnswer>();
  for (const ans of existing) {
    byPillar.set(ans.pillar, ans);
  }
  for (const ans of incoming) {
    byPillar.set(ans.pillar, ans);
  }
  return Array.from(byPillar.values());
}

function parseDeliverableStatus(raw: string): DeliverableStatus {
  return DeliverableStatusSchema.parse(raw);
}

function parseDevelopmentStrategy(
  raw: string | undefined | null
): DevelopmentStrategy | undefined {
  if (!raw) return undefined;
  const parsed = DevelopmentStrategySchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

function createDefaultTransport(): OpenCodeTransport {
  const remoteUrl = process.env.OPENCODE_SERVER_URL?.trim();
  if (remoteUrl) {
    return new SdkOpenCodeTransport({
      serverMode: "remote",
      serverUrl: remoteUrl,
    });
  }
  return new SdkOpenCodeTransport({ serverMode: "embedded" });
}

function isProviderType(raw: string): raw is ProviderType {
  return (
    raw === "omniroute" ||
    raw === "openai_compatible" ||
    raw === "anthropic" ||
    raw === "google" ||
    raw === "ollama"
  );
}

async function resolveStageWorkspace(
  deps: DeliverableWorkflowDeps,
  params: {
    organizationId: string;
    deliverableId: string;
    stage: string;
  }
): Promise<ExecutionWorkspace> {
  if (deps.workspaceFactory) {
    return deps.workspaceFactory();
  }
  const resolved = await createConfiguredExecutionWorkspaceScoped(deps.db, {
    organizationId: params.organizationId,
    deliverableId: params.deliverableId,
    stage: params.stage,
    ...(deps.dockerProbe ? { dockerProbe: deps.dockerProbe } : {}),
  });
  return resolved.workspace;
}

async function resolveProjectRepository(
  db: UzinaDb,
  repositoryId: string | null
): Promise<{
  id: string;
  localPath: string;
  defaultBranch: string;
  remoteUrl: string | null;
} | null> {
  if (!repositoryId) return null;
  const [repo] = await db
    .select({
      id: projectRepositories.id,
      localPath: projectRepositories.localPath,
      defaultBranch: projectRepositories.defaultBranch,
      remoteUrl: projectRepositories.remoteUrl,
    })
    .from(projectRepositories)
    .where(eq(projectRepositories.id, repositoryId))
    .limit(1);
  return repo ?? null;
}

interface ResolvedProviderProfile {
  id: string;
  providerType: ProviderType;
  baseUrl: string | null;
  encryptedApiKey: string | null;
  roleBindings: RoleBindings;
  customPricing: CustomModelPricingMap;
}

async function resolveBuilderProviderProfile(
  db: UzinaDb,
  organizationId: string
): Promise<ResolvedProviderProfile> {
  const rows = await db
    .select()
    .from(providerProfiles)
    .where(eq(providerProfiles.organizationId, organizationId))
    .orderBy(desc(providerProfiles.isDefault), desc(providerProfiles.createdAt));

  for (const row of rows) {
    if (!isProviderType(row.providerType)) continue;
    const bindings = row.roleBindingsJson ?? {};
    if (bindings.builder?.modelId && bindings.builder.modelId.trim().length > 0) {
      return {
        id: row.id,
        providerType: row.providerType,
        baseUrl: row.baseUrl,
        encryptedApiKey: row.encryptedApiKey,
        roleBindings: bindings,
        customPricing: row.customPricingJson ?? {},
      };
    }
  }

  failWorkflow(
    new WorkflowRuntimeError({
      statusCode: 422,
      code: "MISSING_PRECONDITION",
      message:
        "Nenhum provedor com roleBindings.builder configurado para a organização.",
    })
  );
}

async function resolveVerifierProviderProfile(
  db: UzinaDb,
  organizationId: string
): Promise<ResolvedProviderProfile> {
  const rows = await db
    .select()
    .from(providerProfiles)
    .where(eq(providerProfiles.organizationId, organizationId))
    .orderBy(desc(providerProfiles.isDefault), desc(providerProfiles.createdAt));

  for (const row of rows) {
    if (!isProviderType(row.providerType)) continue;
    const bindings = row.roleBindingsJson ?? {};
    const verifierModel = bindings.verifier?.modelId?.trim();
    const builderModel = bindings.builder?.modelId?.trim();
    if (verifierModel) {
      return {
        id: row.id,
        providerType: row.providerType,
        baseUrl: row.baseUrl,
        encryptedApiKey: row.encryptedApiKey,
        roleBindings: bindings,
        customPricing: row.customPricingJson ?? {},
      };
    }
    if (builderModel) {
      return {
        id: row.id,
        providerType: row.providerType,
        baseUrl: row.baseUrl,
        encryptedApiKey: row.encryptedApiKey,
        roleBindings: {
          ...bindings,
          verifier: { modelId: builderModel },
        },
        customPricing: row.customPricingJson ?? {},
      };
    }
  }

  failWorkflow(
    new WorkflowRuntimeError({
      statusCode: 422,
      code: "MISSING_PRECONDITION",
      message:
        "Nenhum provedor com roleBindings.verifier ou builder configurado para verificação.",
    })
  );
}

async function upsertPendingDecision(
  db: UzinaDb,
  params: {
    deliverableId: string;
    mastraStepId: string;
    decisionType: DecisionType;
    summary: string;
    payloadJson: Record<string, unknown>;
  }
): Promise<void> {
  const [existingPending] = await db
    .select({ id: decisions.id })
    .from(decisions)
    .where(
      and(
        eq(decisions.deliverableId, params.deliverableId),
        eq(decisions.mastraStepId, params.mastraStepId),
        eq(decisions.decisionType, params.decisionType),
        eq(decisions.status, "pending")
      )
    )
    .limit(1);

  if (existingPending) {
    await db
      .update(decisions)
      .set({
        summary: params.summary,
        payloadJson: params.payloadJson,
        updatedAt: new Date(),
      })
      .where(eq(decisions.id, existingPending.id));
    return;
  }

  await db.insert(decisions).values({
    deliverableId: params.deliverableId,
    mastraStepId: params.mastraStepId,
    decisionType: params.decisionType,
    summary: params.summary,
    payloadJson: params.payloadJson,
    status: "pending",
  });
}

async function syncPendingDecisionResolution(
  db: UzinaDb,
  params: {
    deliverableId: string;
    mastraStepId: string;
    decisionType: DecisionType;
    status: Exclude<DecisionStatus, "pending">;
    humanFeedback?: string | null;
  }
): Promise<void> {
  await db
    .update(decisions)
    .set({
      status: params.status,
      humanFeedback: params.humanFeedback ?? null,
      resolvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(decisions.deliverableId, params.deliverableId),
        eq(decisions.mastraStepId, params.mastraStepId),
        eq(decisions.decisionType, params.decisionType),
        eq(decisions.status, "pending")
      )
    );
}

const DELIVERABLE_STAGE_ORDER: Record<DeliverableStatus, number> = {
  discovery: 0,
  spec_review: 1,
  visual_studio: 2,
  contract_tests: 3,
  building: 4,
  verifying: 5,
  decision_pending: 6,
  approved: 7,
  merged: 8,
  paused: -1,
  failed: -1,
};

function isStatusBeyondStage(
  currentStatus: DeliverableStatus,
  stage: "discovery" | "spec_review" | "visual_studio"
): boolean {
  const rank = DELIVERABLE_STAGE_ORDER[currentStatus] ?? -1;
  if (rank < 0) return false;
  return rank > DELIVERABLE_STAGE_ORDER[stage];
}

async function resolveProjectAutomationAndBudget(
  db: UzinaDb,
  projectId: string
): Promise<{
  stageAutomation: ProjectStageAutomation;
  budgetCapUsd: number | null;
  budgetCapTokens: number | null;
  finalizePolicy: ProjectFinalizePolicy;
}> {
  const [proj] = await db
    .select({
      stageAutomationJson: projects.stageAutomationJson,
      budgetCapUsd: projects.budgetCapUsd,
      budgetCapTokens: projects.budgetCapTokens,
      finalizePolicy: projects.finalizePolicy,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  const stageAutomation = ProjectStageAutomationSchema.parse({
    ...DEFAULT_PROJECT_STAGE_AUTOMATION,
    ...(proj?.stageAutomationJson ?? {}),
    decision_pending: "manual" as const,
  });

  const parsedBudget =
    proj?.budgetCapUsd != null ? Number(proj.budgetCapUsd) : null;
  const budgetCapUsd =
    parsedBudget !== null && Number.isFinite(parsedBudget) && parsedBudget > 0
      ? parsedBudget
      : null;

  const rawTokens = proj?.budgetCapTokens ?? null;
  const budgetCapTokens =
    rawTokens !== null && Number.isInteger(rawTokens) && rawTokens > 0
      ? rawTokens
      : null;

  const parsedPolicy = ProjectFinalizePolicySchema.safeParse(
    proj?.finalizePolicy ?? "local_merge"
  );
  const finalizePolicy: ProjectFinalizePolicy = parsedPolicy.success
    ? parsedPolicy.data
    : "local_merge";

  return { stageAutomation, budgetCapUsd, budgetCapTokens, finalizePolicy };
}

async function findPendingDecisionTypeForStep(
  db: UzinaDb,
  deliverableId: string,
  mastraStepId: string
): Promise<DecisionType | null> {
  const [pending] = await db
    .select({ decisionType: decisions.decisionType })
    .from(decisions)
    .where(
      and(
        eq(decisions.deliverableId, deliverableId),
        eq(decisions.mastraStepId, mastraStepId),
        eq(decisions.status, "pending")
      )
    )
    .orderBy(desc(decisions.updatedAt))
    .limit(1);
  return pending?.decisionType ?? null;
}

async function hasApprovedToolPolicyForStep(
  db: UzinaDb,
  deliverableId: string,
  mastraStepId: string
): Promise<boolean> {
  const [approved] = await db
    .select({ id: decisions.id })
    .from(decisions)
    .where(
      and(
        eq(decisions.deliverableId, deliverableId),
        eq(decisions.mastraStepId, mastraStepId),
        eq(decisions.decisionType, "tool_policy_approval"),
        eq(decisions.status, "approved")
      )
    )
    .limit(1);
  return Boolean(approved);
}

async function checkBudgetCapExceeded(
  db: UzinaDb,
  projectId: string,
  budgetCapUsd: number | null,
  budgetCapTokens: number | null = null,
  extraCostUsd = 0,
  extraTokens = 0
): Promise<{
  exceeded: boolean;
  reason: "usd" | "tokens" | null;
  accumulatedCostUsd: number;
  accumulatedTokens: number;
}> {
  if (budgetCapUsd == null && budgetCapTokens == null) {
    return {
      exceeded: false,
      reason: null,
      accumulatedCostUsd: 0,
      accumulatedTokens: 0,
    };
  }
  const [accumulatedCostUsd, accumulatedTokens] = await Promise.all([
    budgetCapUsd != null
      ? getProjectAccumulatedCostUsd(db, projectId, extraCostUsd)
      : Promise.resolve(0),
    budgetCapTokens != null
      ? getProjectAccumulatedTokens(db, projectId, extraTokens)
      : Promise.resolve(0),
  ]);
  if (budgetCapUsd != null && accumulatedCostUsd >= budgetCapUsd) {
    return {
      exceeded: true,
      reason: "usd",
      accumulatedCostUsd,
      accumulatedTokens,
    };
  }
  if (budgetCapTokens != null && accumulatedTokens >= budgetCapTokens) {
    return {
      exceeded: true,
      reason: "tokens",
      accumulatedCostUsd,
      accumulatedTokens,
    };
  }
  return {
    exceeded: false,
    reason: null,
    accumulatedCostUsd,
    accumulatedTokens,
  };
}

async function pauseDeliverableForBudgetCap(
  db: UzinaDb,
  params: {
    deliverableId: string;
    title: string;
    currentStatus: DeliverableStatus;
    hasUi: boolean;
    mastraStepId: string;
    stage: "contract_tests" | "building" | "verifying";
    budgetCapUsd: number;
    accumulatedCostUsd: number;
    budgetCapTokens?: number | null;
    accumulatedTokens?: number;
    reason?: "usd" | "tokens" | null;
  }
): Promise<void> {
  if (params.currentStatus !== "paused") {
    assertValidTransition(params.currentStatus, "paused", {
      hasUi: params.hasUi,
    });
  }
  await db
    .update(deliverables)
    .set({
      status: "paused",
      pausedFromStatus: params.stage,
      updatedAt: new Date(),
    })
    .where(eq(deliverables.id, params.deliverableId));

  const isTokenReason =
    params.reason === "tokens" && params.budgetCapTokens != null;
  const summary = isTokenReason
    ? `Orçamento de tokens atingido (${(params.accumulatedTokens ?? 0).toLocaleString("pt-BR")} / ${params.budgetCapTokens!.toLocaleString("pt-BR")} tokens) em '${params.title}'`
    : `Orçamento do projeto atingido ($${params.accumulatedCostUsd.toFixed(4)} / $${params.budgetCapUsd.toFixed(4)}) em '${params.title}'`;

  await upsertPendingDecision(db, {
    deliverableId: params.deliverableId,
    mastraStepId: params.mastraStepId,
    decisionType: "budget_cap_pause",
    summary,
    payloadJson: {
      gate: "budget_cap_pause",
      stage: params.stage,
      estimatedCostUsd: params.accumulatedCostUsd,
      budgetCapUsd: params.budgetCapUsd,
      ...(params.budgetCapTokens != null
        ? {
            accumulatedTokens: params.accumulatedTokens ?? 0,
            budgetCapTokens: params.budgetCapTokens,
          }
        : {}),
    },
  });

  await recordExecutionEvent(db, {
    deliverableId: params.deliverableId,
    stage: params.mastraStepId,
    actorRole: "verifier",
    eventType: "stage_change",
    payload: {
      gate: "budget_cap_pause",
      stage: params.stage,
      estimatedCostUsd: params.accumulatedCostUsd,
      budgetCapUsd: params.budgetCapUsd,
      ...(params.budgetCapTokens != null
        ? {
            accumulatedTokens: params.accumulatedTokens ?? 0,
            budgetCapTokens: params.budgetCapTokens,
          }
        : {}),
    },
  });
}

function createProjectSuppressionLookup(
  db: UzinaDb,
  projectId: string
): FindingSuppressionLookup {
  return {
    async getSuppressedFingerprints(fingerprints) {
      if (fingerprints.length === 0) {
        return new Set<string>();
      }
      const rows = await db
        .select({ fingerprint: securityFindings.fingerprint })
        .from(securityFindings)
        .where(
          and(
            eq(securityFindings.projectId, projectId),
            eq(securityFindings.suppressedInMemory, true),
            inArray(securityFindings.fingerprint, [...fingerprints])
          )
        );
      return new Set(rows.map((r) => r.fingerprint));
    },
  };
}

function parseChangedFilesFromDiff(diffText: string): string[] {
  const files = new Set<string>();
  for (const line of diffText.split(/\r?\n/)) {
    const match = line.match(/^\+\+\+\s+b\/(.+)$/);
    if (match?.[1] && match[1] !== "/dev/null") {
      files.add(match[1].trim());
    }
  }
  return Array.from(files);
}

function runSubprocessSafe(
  binary: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
    signal?: AbortSignal;
  }
): Promise<{ exitCode: number | null; stdout: string; stderr: string; errorCode?: string }> {
  return new Promise((resolve) => {
    execFile(
      binary,
      args,
      {
        cwd: options.cwd,
        env: options.env,
        timeout: options.timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
        shell: false,
        signal: options.signal,
      },
      (error, stdout, stderr) => {
        const errno = error as NodeJS.ErrnoException | null;
        resolve({
          exitCode:
            typeof errno?.code === "number"
              ? errno.code
              : error
                ? 1
                : 0,
          stdout: typeof stdout === "string" ? stdout : "",
          stderr: typeof stderr === "string" ? stderr : "",
          errorCode: typeof errno?.code === "string" ? errno.code : undefined,
        });
      }
    );
  });
}

async function defaultVerifyRunner(ctx: {
  deliverableId: string;
  workspacePath: string;
  workspace: ExecutionWorkspace;
  attemptNumber: number;
  signal: AbortSignal;
}): Promise<VerifyCheckSummary[]> {
  const checks: VerifyCheckSummary[] = [];
  const pkgJsonPath = path.join(ctx.workspacePath, "package.json");
  const hasNodeModules = fs.existsSync(
    /*turbopackIgnore: true*/ path.join(ctx.workspacePath, "node_modules")
  );

  if (fs.existsSync(/*turbopackIgnore: true*/ pkgJsonPath) && hasNodeModules) {
    let scripts: Record<string, string> = {};
    try {
      const parsed = JSON.parse(
        fs.readFileSync(/*turbopackIgnore: true*/ pkgJsonPath, "utf8")
      ) as { scripts?: Record<string, string> };
      scripts = parsed.scripts ?? {};
    } catch {
      scripts = {};
    }

    for (const scriptName of ["typecheck", "lint", "build", "test"]) {
      if (typeof scripts[scriptName] !== "string") {
        continue;
      }
      const started = Date.now();
      const npmExecPath = process.env.npm_execpath?.trim();
      if (!npmExecPath) {
        checks.push({
          name: scriptName,
          passed: true,
          durationMs: Date.now() - started,
          summary: `Script '${scriptName}' pulado (npm_execpath indisponível para execução shell:false).`,
        });
        continue;
      }
      const res = await ctx.workspace.exec(
        process.execPath,
        [npmExecPath, "run", "--silent", scriptName],
        { timeoutMs: 120_000, signal: ctx.signal }
      );
      checks.push({
        name: scriptName,
        passed: res.exitCode === 0,
        durationMs: Date.now() - started,
        summary:
          res.exitCode === 0
            ? `Script '${scriptName}' aprovado`
            : redactSensitiveText(res.stderr || res.stdout || `Falha em '${scriptName}'`).slice(0, 1000),
      });
      if (res.exitCode !== 0) {
        return checks;
      }
    }
  }

  if (checks.length === 0) {
    checks.push({
      name: "workspace_integrity",
      passed: fs.existsSync(/*turbopackIgnore: true*/ ctx.workspacePath),
      durationMs: 1,
      summary:
        "Worktree íntegro validado (sem scripts/node_modules locais pendentes).",
    });
  }

  return checks;
}

const SAFE_GIT_REF_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

function assertSafeBranchRefName(ref: string, fieldName: string): string {
  const trimmed = ref.trim();
  if (
    !trimmed ||
    trimmed.startsWith("-") ||
    trimmed.includes("..") ||
    trimmed.endsWith(".lock") ||
    trimmed.includes("//") ||
    !SAFE_GIT_REF_NAME_RE.test(trimmed)
  ) {
    throw new Error(`Nome de ${fieldName} inválido para finalização: '${ref}'.`);
  }
  return trimmed;
}

async function defaultFinalizeRunner(ctx: {
  deliverableId: string;
  workspacePath: string;
  repoPath: string | null;
  remoteUrl: string | null;
  branchName: string;
  baseBranch: string;
  finalizePolicy?: ProjectFinalizePolicy;
  commitMessage: string;
  prTitle: string;
  prBody: string;
  githubPat?: string | null;
  fetchImpl?: typeof fetch;
  signal: AbortSignal;
}): Promise<FinalizeOutcome> {
  const safeBranch = assertSafeBranchRefName(ctx.branchName, "branchName");
  const safeBaseBranch = assertSafeBranchRefName(ctx.baseBranch, "baseBranch");
  const policy: ProjectFinalizePolicy = ctx.finalizePolicy ?? "local_merge";

  const gitEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    SystemRoot: process.env.SystemRoot,
    GIT_AUTHOR_NAME: "Uzina Studio",
    GIT_AUTHOR_EMAIL: "uzina@local",
    GIT_COMMITTER_NAME: "Uzina Studio",
    GIT_COMMITTER_EMAIL: "uzina@local",
  };

  const statusRes = await runSubprocessSafe(
    "git",
    ["status", "--porcelain"],
    { cwd: ctx.workspacePath, env: gitEnv, timeoutMs: 30_000, signal: ctx.signal }
  );
  if (statusRes.stdout.trim().length > 0) {
    await runSubprocessSafe("git", ["add", "-A"], {
      cwd: ctx.workspacePath,
      env: gitEnv,
      timeoutMs: 30_000,
      signal: ctx.signal,
    });
    const commitRes = await runSubprocessSafe(
      "git",
      ["commit", "-m", ctx.commitMessage],
      { cwd: ctx.workspacePath, env: gitEnv, timeoutMs: 30_000, signal: ctx.signal }
    );
    if (commitRes.exitCode !== 0) {
      throw new Error(
        `Falha ao criar commit na branch '${safeBranch}': ${redactSensitiveText(commitRes.stderr).slice(0, 500)}`
      );
    }
  }

  const revRes = await runSubprocessSafe("git", ["rev-parse", "HEAD"], {
    cwd: ctx.workspacePath,
    env: gitEnv,
    timeoutMs: 15_000,
    signal: ctx.signal,
  });
  const commitSha = revRes.exitCode === 0 ? revRes.stdout.trim() : null;

  if (policy === "branch_only") {
    return {
      mode: "local_branch_ready",
      commitSha,
      prUrl: null,
      shouldDeleteBranchOnCleanup: false,
      mergeBlockedReason: null,
    };
  }

  if (ctx.remoteUrl) {
    let apiError: string | null = null;
    const pat = ctx.githubPat?.trim() || null;
    const ghRepo = pat ? parseGitHubOwnerRepo(ctx.remoteUrl) : null;

    if (pat && ghRepo) {
      const isHttpsRemote = ctx.remoteUrl.trim().toLowerCase().startsWith("https://");
      const basicAuth = Buffer.from(`x-access-token:${pat}`, "utf8").toString("base64");
      const pushEnv: NodeJS.ProcessEnv = {
        ...gitEnv,
        GIT_TERMINAL_PROMPT: "0",
        ...(isHttpsRemote
          ? {
              GIT_CONFIG_COUNT: "1",
              GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
              GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basicAuth}`,
            }
          : {}),
      };
      const pushRes = await runSubprocessSafe(
        "git",
        ["push", "-u", "origin", safeBranch],
        { cwd: ctx.workspacePath, env: pushEnv, timeoutMs: 60_000, signal: ctx.signal }
      );
      if (pushRes.exitCode === 0) {
        const prApiRes = await createGitHubDraftPrViaApi({
          owner: ghRepo.owner,
          repo: ghRepo.repo,
          head: safeBranch,
          base: safeBaseBranch,
          title: ctx.prTitle,
          body: ctx.prBody,
          pat,
          fetchImpl: ctx.fetchImpl,
          signal: ctx.signal,
        });
        if (prApiRes.ok) {
          return {
            mode: "draft_pr",
            commitSha,
            prUrl: prApiRes.prUrl,
            shouldDeleteBranchOnCleanup: false,
            mergeBlockedReason: null,
          };
        }
        apiError = prApiRes.error ?? "Falha ao abrir Draft PR via API REST do GitHub.";
      } else {
        apiError = `Falha no git push autenticado via PAT: ${redactSensitiveText(pushRes.stderr, [pat, basicAuth]).slice(0, 240)}`;
      }
    }

    const ghEnv: NodeJS.ProcessEnv = {
      ...gitEnv,
      GH_TOKEN: process.env.GH_TOKEN,
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    };
    const authRes = await runSubprocessSafe("gh", ["auth", "status"], {
      cwd: ctx.workspacePath,
      env: ghEnv,
      timeoutMs: 15_000,
      signal: ctx.signal,
    });

    if (authRes.exitCode === 0) {
      const pushRes = await runSubprocessSafe(
        "git",
        ["push", "-u", "origin", safeBranch],
        { cwd: ctx.workspacePath, env: gitEnv, timeoutMs: 60_000, signal: ctx.signal }
      );
      if (pushRes.exitCode === 0) {
        const prRes = await runSubprocessSafe(
          "gh",
          [
            "pr",
            "create",
            "--draft",
            "--base",
            safeBaseBranch,
            "--head",
            safeBranch,
            "--title",
            ctx.prTitle,
            "--body",
            ctx.prBody,
          ],
          { cwd: ctx.workspacePath, env: ghEnv, timeoutMs: 60_000, signal: ctx.signal }
        );
        if (prRes.exitCode === 0) {
          const urlLine = prRes.stdout
            .split(/\r?\n/)
            .find((l) => /^https?:\/\//.test(l.trim()));
          return {
            mode: "draft_pr",
            commitSha,
            prUrl: urlLine?.trim() ?? null,
            shouldDeleteBranchOnCleanup: false,
            mergeBlockedReason: null,
          };
        }
      }
    }

    if (policy === "draft_pr") {
      return {
        mode: "local_branch_ready",
        commitSha,
        prUrl: null,
        shouldDeleteBranchOnCleanup: false,
        mergeBlockedReason:
          apiError ??
          "Remote ou GitHub CLI (gh)/PAT indisponível para abrir Draft PR; branch local preservada.",
      };
    }
  } else if (policy === "draft_pr") {
    return {
      mode: "local_branch_ready",
      commitSha,
      prUrl: null,
      shouldDeleteBranchOnCleanup: false,
      mergeBlockedReason:
        "Projeto configurado como draft_pr mas sem remoteUrl cadastrado; branch local preservada.",
    };
  }

  let mergeBlockedReason: string | null = null;

  if (ctx.repoPath && fs.existsSync(/*turbopackIgnore: true*/ ctx.repoPath)) {
    const mergeAttempt = await mergeBranchIntoBaseSafe({
      repoPath: ctx.repoPath,
      branchName: safeBranch,
      baseBranch: safeBaseBranch,
      deleteBranchOnSuccess: false,
      signal: ctx.signal,
    });
    if (mergeAttempt.ok) {
      return {
        mode: "local_merge",
        commitSha: mergeAttempt.commitSha ?? commitSha,
        prUrl: null,
        shouldDeleteBranchOnCleanup: true,
        mergeBlockedReason: null,
      };
    }
    mergeBlockedReason = mergeAttempt.mergeBlockedReason;
  } else {
    mergeBlockedReason = "Caminho local do repositório alvo não encontrado.";
  }

  return {
    mode: "local_branch_ready",
    commitSha,
    prUrl: null,
    shouldDeleteBranchOnCleanup: false,
    mergeBlockedReason,
  };
}

export async function mergeBranchIntoBaseSafe(params: {
  repoPath: string;
  branchName: string;
  baseBranch: string;
  deleteBranchOnSuccess?: boolean;
  signal?: AbortSignal;
}): Promise<{
  ok: boolean;
  commitSha: string | null;
  mergeBlockedReason: string | null;
}> {
  const safeBranch = assertSafeBranchRefName(params.branchName, "branchName");
  const safeBaseBranch = assertSafeBranchRefName(params.baseBranch, "baseBranch");

  const gitEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    SystemRoot: process.env.SystemRoot,
    GIT_AUTHOR_NAME: "Uzina Studio",
    GIT_AUTHOR_EMAIL: "uzina@local",
    GIT_COMMITTER_NAME: "Uzina Studio",
    GIT_COMMITTER_EMAIL: "uzina@local",
  };

  if (!params.repoPath || !fs.existsSync(/*turbopackIgnore: true*/ params.repoPath)) {
    return {
      ok: false,
      commitSha: null,
      mergeBlockedReason: "Caminho local do repositório alvo não encontrado.",
    };
  }

  const branchRev = await runSubprocessSafe("git", ["rev-parse", safeBranch], {
    cwd: params.repoPath,
    env: gitEnv,
    timeoutMs: 15_000,
    signal: params.signal,
  });
  const branchSha = branchRev.exitCode === 0 ? branchRev.stdout.trim() : null;

  const repoStatus = await runSubprocessSafe(
    "git",
    ["status", "--porcelain", "--untracked-files=no"],
    {
      cwd: params.repoPath,
      env: gitEnv,
      timeoutMs: 15_000,
      signal: params.signal,
    }
  );
  if (repoStatus.exitCode !== 0 || repoStatus.stdout.trim() !== "") {
    return {
      ok: false,
      commitSha: branchSha,
      mergeBlockedReason:
        "Repositório alvo possui alterações rastreadas pendentes (working tree suja).",
    };
  }

  const headBranchRes = await runSubprocessSafe(
    "git",
    ["rev-parse", "--abbrev-ref", "HEAD"],
    { cwd: params.repoPath, env: gitEnv, timeoutMs: 15_000, signal: params.signal }
  );
  const currentHeadBranch =
    headBranchRes.exitCode === 0 ? headBranchRes.stdout.trim() : "";

  if (currentHeadBranch !== safeBaseBranch) {
    const checkoutRes = await runSubprocessSafe(
      "git",
      ["checkout", safeBaseBranch],
      {
        cwd: params.repoPath,
        env: gitEnv,
        timeoutMs: 30_000,
        signal: params.signal,
      }
    );
    if (checkoutRes.exitCode !== 0) {
      return {
        ok: false,
        commitSha: branchSha,
        mergeBlockedReason: redactSensitiveText(
          checkoutRes.stderr ||
            `Não foi possível alternar o repositório alvo para '${safeBaseBranch}'.`
        ).slice(0, 500),
      };
    }
  }

  const mergeRes = await runSubprocessSafe(
    "git",
    ["merge", "--ff-only", safeBranch],
    {
      cwd: params.repoPath,
      env: gitEnv,
      timeoutMs: 30_000,
      signal: params.signal,
    }
  );
  if (mergeRes.exitCode !== 0) {
    return {
      ok: false,
      commitSha: branchSha,
      mergeBlockedReason: redactSensitiveText(
        mergeRes.stderr ||
          mergeRes.stdout ||
          `Merge fast-forward de '${safeBranch}' em '${safeBaseBranch}' bloqueado por divergência.`
      ).slice(0, 500),
    };
  }

  const headAfter = await runSubprocessSafe("git", ["rev-parse", "HEAD"], {
    cwd: params.repoPath,
    env: gitEnv,
    timeoutMs: 15_000,
    signal: params.signal,
  });
  const mergedSha =
    headAfter.exitCode === 0 ? headAfter.stdout.trim() : branchSha;

  if (params.deleteBranchOnSuccess) {
    await runSubprocessSafe("git", ["branch", "-d", safeBranch], {
      cwd: params.repoPath,
      env: gitEnv,
      timeoutMs: 15_000,
      signal: params.signal,
    }).catch(() => undefined);
  }

  return {
    ok: true,
    commitSha: mergedSha,
    mergeBlockedReason: null,
  };
}

async function safeCleanupWorkspace(
  workspace: ExecutionWorkspace,
  deleteBranch: boolean
): Promise<void> {
  try {
    await workspace.cleanup({ deleteBranch });
  } catch {
    // Em Windows, EBUSY transitório em diretórios já removidos/travados não deve bloquear transição no DB
  }
}

function runWithLockHeartbeat(
  db: UzinaDb,
  deliverableId: string,
  externalAbort?: AbortSignal
): { signal: AbortSignal; stop: () => void } {
  const controller = new AbortController();
  const store = lockWorkerContext.getStore();
  const workerId = store?.workerId;
  const ctxAbort = store?.abortSignal;

  const onExternalAbort = () => {
    controller.abort(externalAbort?.reason);
  };
  if (externalAbort) {
    if (externalAbort.aborted) {
      controller.abort(externalAbort.reason);
    } else {
      externalAbort.addEventListener("abort", onExternalAbort, { once: true });
    }
  }

  const onCtxAbort = () => {
    controller.abort(ctxAbort?.reason);
  };
  if (ctxAbort && ctxAbort !== externalAbort) {
    if (ctxAbort.aborted) {
      controller.abort(ctxAbort.reason);
    } else {
      ctxAbort.addEventListener("abort", onCtxAbort, { once: true });
    }
  }

  let timer: ReturnType<typeof setInterval> | null = null;
  if (workerId) {
    timer = setInterval(() => {
      void renewDeliverableLock(db, { deliverableId, workerId })
        .then((renewed) => {
          if (!renewed) {
            controller.abort();
          }
        })
        .catch(() => {
          controller.abort();
        });
    }, LOCK_HEARTBEAT_INTERVAL_MS);
  }

  return {
    signal: controller.signal,
    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (externalAbort) {
        externalAbort.removeEventListener("abort", onExternalAbort);
      }
      if (ctxAbort && ctxAbort !== externalAbort) {
        ctxAbort.removeEventListener("abort", onCtxAbort);
      }
    },
  };
}

function mapDesignAssetRow(row: typeof designAssets.$inferSelect): DesignAsset {
  return DesignAssetSchema.parse({
    id: row.id,
    projectId: row.projectId,
    deliverableId: row.deliverableId,
    assetType: row.assetType,
    title: row.title,
    sourceUrl: row.sourceUrl,
    assetUrl: row.storagePath ? `/api/assets/${row.id}` : null,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    intentionTags: row.intentionTags,
    notes: row.notes,
    approved: row.approved,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function extractContractTestFiles(
  structuredOutput: unknown,
  touchedFiles: readonly string[],
  workspacePath: string
): string[] {
  const toRelativePosix = (file: string): string => {
    const rel = path.isAbsolute(file) ? path.relative(workspacePath, file) : file;
    return rel.replace(/\\/g, "/");
  };

  if (
    structuredOutput &&
    typeof structuredOutput === "object" &&
    "contractTestFiles" in structuredOutput
  ) {
    const candidate = (structuredOutput as { contractTestFiles?: unknown })
      .contractTestFiles;
    if (Array.isArray(candidate)) {
      const filtered = candidate.filter(
        (item): item is string => typeof item === "string" && item.trim().length > 0
      );
      if (filtered.length > 0) {
        return filtered.map(toRelativePosix);
      }
    }
  }
  return touchedFiles.map(toRelativePosix);
}

function buildShapeSpecFromDiscoverySummary(
  summary: DiscoverySummary,
  knownSecrets?: readonly string[]
): ShapeSpec {
  const nonGoals =
    summary.outOfScope.length > 0
      ? summary.outOfScope
      : ["Alterações fora do escopo definido no ShapeSpec desta entrega."];
  const bddScenarios: BddScenario[] =
    summary.acceptanceCriteria.length > 0
      ? summary.acceptanceCriteria.slice(0, 12).map((criterion, index) => ({
          id: `BDD-${index + 1}`,
          title: criterion.slice(0, 140),
          given: summary.objective.slice(0, 400),
          when: "O sistema executa o fluxo principal especificado para o entregável",
          then: criterion.slice(0, 400),
          roleRequired: "developer",
        }))
      : [
          {
            id: "BDD-1",
            title: summary.objective.slice(0, 140),
            given: "Organização autenticada e projeto configurado no workspace",
            when: "O entregável é executado conforme a especificação consolidada",
            then: "Todos os critérios funcionais e de isolamento multi-tenant são atendidos",
            roleRequired: "developer",
          },
        ];

  return validateAndBuildShapeSpec({
    summary,
    nonGoals,
    bddScenarios,
    knownSecrets,
  });
}

export function createDeliverableLifecycleWorkflow(deps: DeliverableWorkflowDeps) {
  const { db } = deps;
  const symbolLockManager = deps.symbolLockManager ?? new SymbolLockManager();

  const stageDiscovery = createStep({
    id: "stage_discovery",
    description: "Entrevista socrática de Discovery com até 3 rodadas antes do Blueprint.",
    inputSchema: DeliverableLifecycleInputSchema,
    outputSchema: z.object({
      deliverableId: z.string(),
      hasUi: z.boolean(),
      specMarkdown: z.string(),
    }),
    suspendSchema: z.object({
      gate: WorkflowGateTypeSchema,
      roundNumber: z.number().int().min(1).max(3),
      round: DiscoveryRoundSchema,
      hasUi: z.boolean(),
    }),
    resumeSchema: WorkflowResumeInputSchema,
    stateSchema: WorkflowRuntimeStateSchema,
    execute: async ({ inputData, resumeData, getState, setState, suspend, bail }) => {
      const currentState = await getState();
      const [row] = await db
        .select()
        .from(deliverables)
        .where(eq(deliverables.id, inputData.deliverableId))
        .limit(1);

      if (!row) {
        throw new WorkflowRuntimeError({
          statusCode: 404,
          code: "DELIVERABLE_NOT_FOUND",
          message: `Entregável '${inputData.deliverableId}' não encontrado.`,
        });
      }

      const repo = await resolveProjectRepository(db, row.repositoryId);
      let brownfieldSummary: string | undefined;
      if (repo && fs.existsSync(/*turbopackIgnore: true*/ repo.localPath)) {
        try {
          const map = scanRepositoryBrownfield(repo.localPath);
          brownfieldSummary = `Maturidade ${map.maturityScore}/100 (${map.detectedStack.join(", ") || "sem stack"})`;
        } catch {
          brownfieldSummary = undefined;
        }
      }

      const initialDiscoveryStatus = parseDeliverableStatus(row.status);
      if (!resumeData && isStatusBeyondStage(initialDiscoveryStatus, "discovery")) {
        const fastSpec =
          row.specMarkdown?.trim() ||
          currentState.specMarkdown?.trim() ||
          `# ${row.title}\n\n${row.description ?? ""}`.trim();
        await setState({
          ...currentState,
          specMarkdown: fastSpec,
          stageHistory: appendStageHistory(
            currentState.stageHistory,
            "stage_discovery"
          ),
        });
        return {
          deliverableId: row.id,
          hasUi: currentState.hasUi,
          specMarkdown: fastSpec,
        };
      }

      if (!resumeData) {
        const { stageAutomation } = await resolveProjectAutomationAndBudget(
          db,
          row.projectId
        );
        const round1 = buildDiscoveryQuestions({
          roundNumber: 1,
          title: row.title,
          description: row.description,
          hasUiKnown: true,
          hasUiValue: currentState.hasUi,
          previousAnswers: currentState.allAnswers,
          brownfieldSummary,
        });

        if (stageAutomation.discovery === "auto") {
          const autoAnswers: DiscoveryAnswer[] = round1.questions.map((q) => ({
            questionId: q.id,
            pillar: q.pillar,
            answer: q.recommendedOption,
          }));
          const mergedAutoAnswers = mergeAnswers(
            currentState.allAnswers,
            autoAnswers
          );
          const summary = consolidateDiscoverySummary({
            title: row.title,
            description: row.description,
            hasUi: currentState.hasUi,
            answers: mergedAutoAnswers,
            brownfieldSummary,
          });
          const shapeSpec = buildShapeSpecFromDiscoverySummary(summary);
          if (initialDiscoveryStatus !== "spec_review") {
            assertValidTransition(initialDiscoveryStatus, "spec_review", {
              hasUi: currentState.hasUi,
            });
          }
          await db
            .update(deliverables)
            .set({
              status: "spec_review",
              hasUi: currentState.hasUi,
              specMarkdown: summary.specMarkdown,
              updatedAt: new Date(),
            })
            .where(eq(deliverables.id, row.id));
          const nextHistory = appendStageHistory(
            currentState.stageHistory,
            "stage_discovery"
          );
          await setState({
            ...currentState,
            discoveryRound: 1,
            discoveryRounds: [round1],
            allAnswers: mergedAutoAnswers,
            specMarkdown: summary.specMarkdown,
            shapeSpec,
            stageHistory: nextHistory,
          });
          await recordExecutionEvent(db, {
            deliverableId: row.id,
            stage: "stage_discovery",
            actorRole: "discovery",
            eventType: "stage_change",
            payload: {
              mode: "auto",
              nextStatus: "spec_review",
              shapeSpecBddCount: shapeSpec.bddScenarios.length,
              ambiguityScore: shapeSpec.ambiguityCheck.score,
            },
          });
          return {
            deliverableId: row.id,
            hasUi: currentState.hasUi,
            specMarkdown: summary.specMarkdown,
          };
        }

        const nextState: WorkflowRuntimeState = {
          ...currentState,
          discoveryRound: 1,
          discoveryRounds: [round1],
          stageHistory: appendStageHistory(
            currentState.stageHistory,
            "stage_discovery"
          ),
        };
        await setState(nextState);

        await upsertPendingDecision(db, {
          deliverableId: row.id,
          mastraStepId: "stage_discovery",
          decisionType: "discovery_confirm",
          summary: `Discovery (rodada 1) para '${row.title}'`,
          payloadJson: {
            gate: "discovery_confirm",
            roundNumber: 1,
            round: round1,
            hasUi: nextState.hasUi,
          },
        });
        await recordExecutionEvent(db, {
          deliverableId: row.id,
          stage: "stage_discovery",
          actorRole: "discovery",
          eventType: "stage_change",
          payload: { gate: "discovery_confirm", roundNumber: 1 },
        });

        return suspend({
          gate: "discovery_confirm",
          roundNumber: 1,
          round: round1,
          hasUi: nextState.hasUi,
        });
      }

      await syncPendingDecisionResolution(db, {
        deliverableId: row.id,
        mastraStepId: "stage_discovery",
        decisionType: "discovery_confirm",
        status: resumeData.decision,
        humanFeedback: resumeData.feedback ?? null,
      });

      const effectiveHasUi = resumeData.hasUi ?? currentState.hasUi;
      const mergedAnswers = mergeAnswers(
        currentState.allAnswers,
        resumeData.answers
      );
      const currentStatus = parseDeliverableStatus(row.status);

      if (resumeData.decision === "rejected") {
        assertValidTransition(currentStatus, "failed", { hasUi: effectiveHasUi });
        await db
          .update(deliverables)
          .set({
            status: "failed",
            pausedFromStatus: null,
            updatedAt: new Date(),
          })
          .where(eq(deliverables.id, row.id));

        const nextHistory = appendStageHistory(
          currentState.stageHistory,
          "stage_discovery"
        );
        await setState({
          ...currentState,
          hasUi: effectiveHasUi,
          allAnswers: mergedAnswers,
          humanFeedback: resumeData.feedback ?? null,
          rejected: true,
          stageHistory: nextHistory,
        });

        return bail({
          rejected: true,
          deliverableId: row.id,
          deliverableStatus: "failed" as const,
          worktreeHandle: currentState.worktreeHandle,
          contractTestFiles: currentState.contractTestFiles,
          stageHistory: nextHistory,
        });
      }

      if (resumeData.decision === "changes_requested") {
        if (currentState.discoveryRound >= 3) {
          failWorkflow(
            new WorkflowRuntimeError({
              statusCode: 422,
              code: "INVALID_WORKFLOW_INPUT",
              message:
                "Limite máximo de 3 rodadas de Discovery atingido. Aprove ou rejeite.",
            })
          );
        }

        const nextRoundNum = currentState.discoveryRound + 1;
        const nextRound: DiscoveryRound = buildDiscoveryQuestions({
          roundNumber: nextRoundNum,
          title: row.title,
          description: row.description,
          hasUiKnown: true,
          hasUiValue: effectiveHasUi,
          previousAnswers: mergedAnswers,
          brownfieldSummary,
        });

        const nextState: WorkflowRuntimeState = {
          ...currentState,
          hasUi: effectiveHasUi,
          discoveryRound: nextRoundNum,
          discoveryRounds: [...currentState.discoveryRounds, nextRound],
          allAnswers: mergedAnswers,
          humanFeedback: resumeData.feedback ?? null,
          stageHistory: appendStageHistory(
            currentState.stageHistory,
            "stage_discovery"
          ),
        };
        await setState(nextState);

        await upsertPendingDecision(db, {
          deliverableId: row.id,
          mastraStepId: "stage_discovery",
          decisionType: "discovery_confirm",
          summary: `Discovery (rodada ${nextRoundNum}) para '${row.title}'`,
          payloadJson: {
            gate: "discovery_confirm",
            roundNumber: nextRoundNum,
            round: nextRound,
            hasUi: effectiveHasUi,
          },
        });

        return suspend({
          gate: "discovery_confirm",
          roundNumber: nextRoundNum,
          round: nextRound,
          hasUi: effectiveHasUi,
        });
      }

      const summary = consolidateDiscoverySummary({
        title: row.title,
        description: row.description,
        hasUi: effectiveHasUi,
        answers: mergedAnswers,
        brownfieldSummary,
      });
      const shapeSpec = buildShapeSpecFromDiscoverySummary(summary);

      assertValidTransition(currentStatus, "spec_review", {
        hasUi: effectiveHasUi,
      });
      await db
        .update(deliverables)
        .set({
          status: "spec_review",
          hasUi: effectiveHasUi,
          specMarkdown: summary.specMarkdown,
          updatedAt: new Date(),
        })
        .where(eq(deliverables.id, row.id));

      const nextHistory = appendStageHistory(
        currentState.stageHistory,
        "stage_discovery"
      );
      await setState({
        ...currentState,
        hasUi: effectiveHasUi,
        allAnswers: mergedAnswers,
        specMarkdown: summary.specMarkdown,
        shapeSpec,
        humanFeedback: resumeData.feedback ?? null,
        stageHistory: nextHistory,
      });

      return {
        deliverableId: row.id,
        hasUi: effectiveHasUi,
        specMarkdown: summary.specMarkdown,
      };
    },
  });

  const stageBlueprint = createStep({
    id: "stage_blueprint",
    description: "Roteamento tático e aprovação humana de estratégia antes da execução.",
    inputSchema: z.object({
      deliverableId: z.string(),
      hasUi: z.boolean(),
      specMarkdown: z.string(),
    }),
    outputSchema: z.object({
      deliverableId: z.string(),
      hasUi: z.boolean(),
      blueprint: StrategyRouterOutputSchema,
    }),
    suspendSchema: z.object({
      gate: WorkflowGateTypeSchema,
      blueprint: StrategyRouterOutputSchema,
      hasUi: z.boolean(),
    }),
    resumeSchema: WorkflowResumeInputSchema,
    stateSchema: WorkflowRuntimeStateSchema,
    execute: async ({ inputData, resumeData, getState, setState, suspend, bail }) => {
      const currentState = await getState();
      const [row] = await db
        .select()
        .from(deliverables)
        .where(eq(deliverables.id, inputData.deliverableId))
        .limit(1);

      if (!row) {
        throw new WorkflowRuntimeError({
          statusCode: 404,
          code: "DELIVERABLE_NOT_FOUND",
          message: `Entregável '${inputData.deliverableId}' não encontrado.`,
        });
      }

      const computeBlueprint = async (
        hasUiFlag: boolean,
        overrideStrategy?: DevelopmentStrategy
      ): Promise<{
        blueprint: StrategyRouterOutput;
        blueprintV2: ArchitectBlueprintV2;
      }> => {
        const repo = await resolveProjectRepository(db, row.repositoryId);
        let isBrownfield = false;
        let maturityScore: number | undefined;
        if (repo && fs.existsSync(/*turbopackIgnore: true*/ repo.localPath)) {
          try {
            const bf = scanRepositoryBrownfield(repo.localPath);
            isBrownfield = bf.totalFilesScanned > 0;
            maturityScore = bf.maturityScore;
          } catch {
            isBrownfield = false;
          }
        }
        const blueprintV2 = await generateArchitectBlueprintV2({
          db,
          organizationId: currentState.organizationId,
          projectId: row.projectId,
          deliverableId: row.id,
          title: row.title,
          description: row.description,
          shapeSpec: currentState.shapeSpec ?? undefined,
          originKind: isBrownfield ? "brownfield" : "greenfield",
          hasUi: hasUiFlag,
          riskLevel:
            row.riskLevel === "medium" || row.riskLevel === "high"
              ? row.riskLevel
              : "low",
          maturityScore: maturityScore ?? null,
          overrideStrategy,
          symbolLockManager,
          masterKey: deps.masterKey,
          ...(deps.codingModelOverride
            ? { modelOverride: deps.codingModelOverride }
            : {}),
        });
        return {
          blueprint: StrategyRouterOutputSchema.parse(blueprintV2),
          blueprintV2,
        };
      };

      const initialBlueprintStatus = parseDeliverableStatus(row.status);
      if (!resumeData && isStatusBeyondStage(initialBlueprintStatus, "spec_review")) {
        const parsedExisting = StrategyRouterOutputSchema.safeParse(
          row.blueprintJson
        );
        const parsedExistingV2 = ArchitectBlueprintV2Schema.safeParse(
          row.blueprintJson
        );
        const computedFallback = parsedExisting.success
          ? null
          : await computeBlueprint(
              inputData.hasUi,
              parseDevelopmentStrategy(currentState.overrideStrategy)
            );
        const existingBlueprint = parsedExisting.success
          ? parsedExisting.data
          : computedFallback!.blueprint;
        const existingBlueprintV2 = parsedExistingV2.success
          ? parsedExistingV2.data
          : computedFallback?.blueprintV2 ?? currentState.architectBlueprintV2;
        await setState({
          ...currentState,
          hasUi: inputData.hasUi,
          blueprint: existingBlueprint,
          architectBlueprintV2: existingBlueprintV2,
          stageHistory: appendStageHistory(
            currentState.stageHistory,
            "stage_blueprint"
          ),
        });
        return {
          deliverableId: row.id,
          hasUi: inputData.hasUi,
          blueprint: existingBlueprint,
        };
      }

      if (!resumeData) {
        const { stageAutomation } = await resolveProjectAutomationAndBudget(
          db,
          row.projectId
        );
        const { blueprint, blueprintV2 } = await computeBlueprint(
          inputData.hasUi,
          parseDevelopmentStrategy(currentState.overrideStrategy)
        );

        const nextHistory = appendStageHistory(
          currentState.stageHistory,
          "stage_blueprint"
        );

        if (stageAutomation.spec_review === "auto") {
          const nextAutoStatus: DeliverableStatus = inputData.hasUi
            ? "visual_studio"
            : "contract_tests";
          assertValidTransition(initialBlueprintStatus, nextAutoStatus, {
            hasUi: inputData.hasUi,
          });
          await db
            .update(deliverables)
            .set({
              status: nextAutoStatus,
              blueprintJson: blueprintV2,
              developmentStrategy: blueprint.developmentStrategy,
              tacticalPattern: blueprint.tacticalPattern,
              updatedAt: new Date(),
            })
            .where(eq(deliverables.id, row.id));
          await setState({
            ...currentState,
            hasUi: inputData.hasUi,
            blueprint,
            architectBlueprintV2: blueprintV2,
            stageHistory: nextHistory,
          });
          await recordExecutionEvent(db, {
            deliverableId: row.id,
            stage: "stage_blueprint",
            actorRole: "architect",
            eventType: "stage_change",
            payload: {
              mode: "auto",
              nextStatus: nextAutoStatus,
              storyShardsCount: blueprintV2.storyShards.length,
              hasOpenSpecDelta: Boolean(blueprintV2.openSpecDelta),
            },
          });
          return {
            deliverableId: row.id,
            hasUi: inputData.hasUi,
            blueprint,
          };
        }

        await db
          .update(deliverables)
          .set({
            blueprintJson: blueprintV2,
            developmentStrategy: blueprint.developmentStrategy,
            tacticalPattern: blueprint.tacticalPattern,
            updatedAt: new Date(),
          })
          .where(eq(deliverables.id, row.id));

        const nextState: WorkflowRuntimeState = {
          ...currentState,
          hasUi: inputData.hasUi,
          blueprint,
          architectBlueprintV2: blueprintV2,
          stageHistory: nextHistory,
        };
        await setState(nextState);

        await upsertPendingDecision(db, {
          deliverableId: row.id,
          mastraStepId: "stage_blueprint",
          decisionType: "blueprint_approve",
          summary: `Aprovação de Blueprint (${blueprint.developmentStrategy}) para '${row.title}'`,
          payloadJson: {
            gate: "blueprint_approve",
            blueprint,
            architectBlueprintV2: blueprintV2,
            hasUi: inputData.hasUi,
          },
        });
        await recordExecutionEvent(db, {
          deliverableId: row.id,
          stage: "stage_blueprint",
          actorRole: "architect",
          eventType: "stage_change",
          payload: {
            gate: "blueprint_approve",
            strategy: blueprint.developmentStrategy,
          },
        });

        return suspend({
          gate: "blueprint_approve",
          blueprint,
          hasUi: inputData.hasUi,
        });
      }

      await syncPendingDecisionResolution(db, {
        deliverableId: row.id,
        mastraStepId: "stage_blueprint",
        decisionType: "blueprint_approve",
        status: resumeData.decision,
        humanFeedback: resumeData.feedback ?? null,
      });

      const currentStatus = parseDeliverableStatus(row.status);
      const effectiveHasUi = resumeData.hasUi ?? currentState.hasUi;
      const effectiveOverride =
        resumeData.overrideStrategy ?? currentState.overrideStrategy;

      if (resumeData.decision === "rejected") {
        assertValidTransition(currentStatus, "failed", { hasUi: effectiveHasUi });
        await db
          .update(deliverables)
          .set({
            status: "failed",
            pausedFromStatus: null,
            updatedAt: new Date(),
          })
          .where(eq(deliverables.id, row.id));

        const nextHistory = appendStageHistory(
          currentState.stageHistory,
          "stage_blueprint"
        );
        await setState({
          ...currentState,
          rejected: true,
          humanFeedback: resumeData.feedback ?? null,
          stageHistory: nextHistory,
        });

        return bail({
          rejected: true,
          deliverableId: row.id,
          deliverableStatus: "failed" as const,
          worktreeHandle: currentState.worktreeHandle,
          contractTestFiles: currentState.contractTestFiles,
          stageHistory: nextHistory,
        });
      }

      const {
        blueprint: updatedBlueprint,
        blueprintV2: updatedBlueprintV2,
      } = await computeBlueprint(effectiveHasUi, effectiveOverride);

      if (resumeData.decision === "changes_requested") {
        await db
          .update(deliverables)
          .set({
            hasUi: effectiveHasUi,
            blueprintJson: updatedBlueprintV2,
            developmentStrategy: updatedBlueprint.developmentStrategy,
            tacticalPattern: updatedBlueprint.tacticalPattern,
            updatedAt: new Date(),
          })
          .where(eq(deliverables.id, row.id));

        await setState({
          ...currentState,
          hasUi: effectiveHasUi,
          overrideStrategy: effectiveOverride,
          blueprint: updatedBlueprint,
          architectBlueprintV2: updatedBlueprintV2,
          humanFeedback: resumeData.feedback ?? null,
          stageHistory: appendStageHistory(
            currentState.stageHistory,
            "stage_blueprint"
          ),
        });

        await upsertPendingDecision(db, {
          deliverableId: row.id,
          mastraStepId: "stage_blueprint",
          decisionType: "blueprint_approve",
          summary: `Blueprint revisado (${updatedBlueprint.developmentStrategy}) para '${row.title}'`,
          payloadJson: {
            gate: "blueprint_approve",
            blueprint: updatedBlueprint,
            architectBlueprintV2: updatedBlueprintV2,
            hasUi: effectiveHasUi,
          },
        });

        return suspend({
          gate: "blueprint_approve",
          blueprint: updatedBlueprint,
          hasUi: effectiveHasUi,
        });
      }

      const nextStatus: DeliverableStatus = effectiveHasUi
        ? "visual_studio"
        : "contract_tests";
      assertValidTransition(currentStatus, nextStatus, {
        hasUi: effectiveHasUi,
      });

      await db
        .update(deliverables)
        .set({
          status: nextStatus,
          hasUi: effectiveHasUi,
          blueprintJson: updatedBlueprintV2,
          developmentStrategy: updatedBlueprint.developmentStrategy,
          tacticalPattern: updatedBlueprint.tacticalPattern,
          updatedAt: new Date(),
        })
        .where(eq(deliverables.id, row.id));

      await setState({
        ...currentState,
        hasUi: effectiveHasUi,
        overrideStrategy: effectiveOverride,
        blueprint: updatedBlueprint,
        architectBlueprintV2: updatedBlueprintV2,
        humanFeedback: resumeData.feedback ?? null,
        stageHistory: appendStageHistory(
          currentState.stageHistory,
          "stage_blueprint"
        ),
      });

      return {
        deliverableId: row.id,
        hasUi: effectiveHasUi,
        blueprint: updatedBlueprint,
      };
    },
  });

  const stageVisualStudio = createStep({
    id: "stage_visual_studio",
    description:
      "Gera e submete o contrato visual .uzina/DESIGN.md quando has_ui=true.",
    inputSchema: z.object({
      deliverableId: z.string(),
      hasUi: z.boolean(),
      blueprint: StrategyRouterOutputSchema,
    }),
    outputSchema: z.object({
      deliverableId: z.string(),
      hasUi: z.boolean(),
      designMdContent: z.string().nullable(),
    }),
    suspendSchema: z.object({
      gate: WorkflowGateTypeSchema,
      designMdContent: z.string(),
      assetCount: z.number().int().nonnegative(),
    }),
    resumeSchema: WorkflowResumeInputSchema,
    stateSchema: WorkflowRuntimeStateSchema,
    execute: async ({ inputData, resumeData, getState, setState, suspend, bail }) => {
      const currentState = await getState();
      if (!inputData.hasUi) {
        return {
          deliverableId: inputData.deliverableId,
          hasUi: false,
          designMdContent: null,
        };
      }

      const [row] = await db
        .select()
        .from(deliverables)
        .where(eq(deliverables.id, inputData.deliverableId))
        .limit(1);

      if (!row) {
        throw new WorkflowRuntimeError({
          statusCode: 404,
          code: "DELIVERABLE_NOT_FOUND",
          message: `Entregável '${inputData.deliverableId}' não encontrado.`,
        });
      }

      const [projectRow] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, row.projectId))
        .limit(1);

      if (!projectRow) {
        throw new WorkflowRuntimeError({
          statusCode: 404,
          code: "DELIVERABLE_NOT_FOUND",
          message: `Projeto '${row.projectId}' não encontrado.`,
        });
      }

      const generateAndPersistDesignMd = async (notes?: string) => {
        const assetRows = await db
          .select()
          .from(designAssets)
          .where(eq(designAssets.projectId, projectRow.id));
        const referenceAssets = assetRows.filter(
          (a) => a.assetType !== "design_md"
        );
        const repo = await resolveProjectRepository(db, row.repositoryId);
        const visualPipeline = await runVisualStudioThreeStagePipeline({
          db,
          organizationId: currentState.organizationId,
          projectId: projectRow.id,
          deliverableId: row.id,
          title: row.title,
          shapeSpec: currentState.shapeSpec ?? undefined,
          workspaceRoot: repo?.localPath,
          masterKey: deps.masterKey,
          skillsDir: deps.skillsDir,
          ...(deps.codingModelOverride
            ? { modelOverride: deps.codingModelOverride }
            : {}),
        });

        const markdown = notes?.trim()
          ? `${visualPipeline.designMdMarkdown}\n\n## Notas de Revisão\n${notes.trim()}`
          : visualPipeline.designMdMarkdown;

        const existingDesignMd = assetRows.find(
          (a) => a.assetType === "design_md"
        );
        if (existingDesignMd) {
          await db
            .update(designAssets)
            .set({
              deliverableId: row.id,
              mimeType: "text/markdown",
              sizeBytes: Buffer.byteLength(markdown, "utf8"),
              notes: markdown,
              approved: false,
              updatedAt: new Date(),
            })
            .where(eq(designAssets.id, existingDesignMd.id));
        } else {
          await db.insert(designAssets).values({
            projectId: projectRow.id,
            deliverableId: row.id,
            assetType: "design_md",
            title: "Contrato Visual .uzina/DESIGN.md",
            mimeType: "text/markdown",
            sizeBytes: Buffer.byteLength(markdown, "utf8"),
            notes: markdown,
            intentionTags: ["design-contract"],
            approved: false,
          });
        }

        return {
          markdown,
          assetCount: referenceAssets.length,
          manifest: visualPipeline.manifest,
          critiquePassed: visualPipeline.critiquePassed,
          wcagPassed: visualPipeline.wcagContrastReport.allPassed,
        };
      };

      const initialVisualStatus = parseDeliverableStatus(row.status);
      if (
        !resumeData &&
        isStatusBeyondStage(initialVisualStatus, "visual_studio")
      ) {
        const existingDesignRows = await db
          .select()
          .from(designAssets)
          .where(eq(designAssets.projectId, projectRow.id));
        const existingMdAsset = existingDesignRows.find(
          (a) => a.assetType === "design_md"
        );
        const fastDesignMd =
          existingMdAsset?.notes ??
          currentState.designMdContent ??
          generateDesignMdContract({
            projectName: projectRow.name,
            themePreference: "dual_theme",
            assets: [],
          });
        await setState({
          ...currentState,
          designMdContent: fastDesignMd,
          stageHistory: appendStageHistory(
            currentState.stageHistory,
            "stage_visual_studio"
          ),
        });
        return {
          deliverableId: row.id,
          hasUi: true,
          designMdContent: fastDesignMd,
        };
      }

      if (!resumeData) {
        const { stageAutomation } = await resolveProjectAutomationAndBudget(
          db,
          row.projectId
        );
        const { markdown, assetCount, manifest, critiquePassed, wcagPassed } =
          await generateAndPersistDesignMd();
        const nextHistory = appendStageHistory(
          currentState.stageHistory,
          "stage_visual_studio"
        );

        if (stageAutomation.visual_studio === "auto") {
          await db
            .update(designAssets)
            .set({ approved: true, updatedAt: new Date() })
            .where(
              and(
                eq(designAssets.projectId, projectRow.id),
                eq(designAssets.assetType, "design_md")
              )
            );
          assertValidTransition(initialVisualStatus, "contract_tests", {
            hasUi: true,
          });
          await db
            .update(deliverables)
            .set({
              status: "contract_tests",
              updatedAt: new Date(),
            })
            .where(eq(deliverables.id, row.id));
          await setState({
            ...currentState,
            designMdContent: markdown,
            prototypeManifest: manifest,
            stageHistory: nextHistory,
          });
          await recordExecutionEvent(db, {
            deliverableId: row.id,
            stage: "stage_visual_studio",
            actorRole: "visual",
            eventType: "stage_change",
            payload: {
              mode: "auto",
              nextStatus: "contract_tests",
              assetCount,
              critiquePassed,
              wcagPassed,
              sectionsCount: manifest.sections.length,
            },
          });
          return {
            deliverableId: row.id,
            hasUi: true,
            designMdContent: markdown,
          };
        }

        await setState({
          ...currentState,
          designMdContent: markdown,
          prototypeManifest: manifest,
          stageHistory: nextHistory,
        });

        await upsertPendingDecision(db, {
          deliverableId: row.id,
          mastraStepId: "stage_visual_studio",
          decisionType: "visual_approve",
          summary: `Contrato Visual (.uzina/DESIGN.md) para '${row.title}'`,
          payloadJson: {
            gate: "visual_approve",
            designMdContent: markdown,
            prototypeManifest: manifest,
            critiquePassed,
            wcagPassed,
            assetCount,
          },
        });
        await recordExecutionEvent(db, {
          deliverableId: row.id,
          stage: "stage_visual_studio",
          actorRole: "visual",
          eventType: "stage_change",
          payload: { gate: "visual_approve", assetCount },
        });

        return suspend({
          gate: "visual_approve",
          designMdContent: markdown,
          assetCount,
        });
      }

      await syncPendingDecisionResolution(db, {
        deliverableId: row.id,
        mastraStepId: "stage_visual_studio",
        decisionType: "visual_approve",
        status: resumeData.decision,
        humanFeedback: resumeData.feedback ?? null,
      });

      const currentStatus = parseDeliverableStatus(row.status);
      if (resumeData.decision === "rejected") {
        assertValidTransition(currentStatus, "failed", { hasUi: true });
        await db
          .update(deliverables)
          .set({
            status: "failed",
            pausedFromStatus: null,
            updatedAt: new Date(),
          })
          .where(eq(deliverables.id, row.id));

        const nextHistory = appendStageHistory(
          currentState.stageHistory,
          "stage_visual_studio"
        );
        await setState({
          ...currentState,
          rejected: true,
          humanFeedback: resumeData.feedback ?? null,
          stageHistory: nextHistory,
        });

        return bail({
          rejected: true,
          deliverableId: row.id,
          deliverableStatus: "failed" as const,
          worktreeHandle: currentState.worktreeHandle,
          contractTestFiles: currentState.contractTestFiles,
          stageHistory: nextHistory,
        });
      }

      if (resumeData.decision === "changes_requested") {
        const { markdown, assetCount, manifest, critiquePassed, wcagPassed } =
          await generateAndPersistDesignMd(resumeData.feedback);
        await setState({
          ...currentState,
          designMdContent: markdown,
          prototypeManifest: manifest,
          humanFeedback: resumeData.feedback ?? null,
          stageHistory: appendStageHistory(
            currentState.stageHistory,
            "stage_visual_studio"
          ),
        });

        await upsertPendingDecision(db, {
          deliverableId: row.id,
          mastraStepId: "stage_visual_studio",
          decisionType: "visual_approve",
          summary: `Contrato Visual (.uzina/DESIGN.md) para '${row.title}'`,
          payloadJson: {
            gate: "visual_approve",
            designMdContent: markdown,
            prototypeManifest: manifest,
            critiquePassed,
            wcagPassed,
            assetCount,
          },
        });
        await recordExecutionEvent(db, {
          deliverableId: row.id,
          stage: "stage_visual_studio",
          actorRole: "visual",
          eventType: "stage_change",
          payload: { gate: "visual_approve", assetCount },
        });

        return suspend({
          gate: "visual_approve",
          designMdContent: markdown,
          assetCount,
        });
      }

      if (resumeData.decision === "approved" && resumeData.approveDesignMd === false) {
        failWorkflow(
          new WorkflowRuntimeError({
            statusCode: 422,
            code: "INVALID_WORKFLOW_INPUT",
            message:
              "Aprovação explícita do contrato visual é obrigatória (`approveDesignMd !== false`).",
          })
        );
      }

      const visualResult =
        currentState.designMdContent && currentState.prototypeManifest
          ? {
              markdown: currentState.designMdContent,
              manifest: currentState.prototypeManifest,
            }
          : await generateAndPersistDesignMd(resumeData.feedback);
      const finalMarkdown = visualResult.markdown;
      const finalManifest = visualResult.manifest;

      await db
        .update(designAssets)
        .set({ approved: true, updatedAt: new Date() })
        .where(
          and(
            eq(designAssets.projectId, projectRow.id),
            eq(designAssets.assetType, "design_md")
          )
        );

      await db
        .update(projects)
        .set({
          designMdPath: ".uzina/DESIGN.md",
          updatedAt: new Date(),
        })
        .where(eq(projects.id, projectRow.id));

      assertValidTransition(currentStatus, "contract_tests", { hasUi: true });
      await db
        .update(deliverables)
        .set({
          status: "contract_tests",
          updatedAt: new Date(),
        })
        .where(eq(deliverables.id, row.id));

      await setState({
        ...currentState,
        designMdContent: finalMarkdown,
        prototypeManifest: finalManifest,
        humanFeedback: resumeData.feedback ?? null,
        stageHistory: appendStageHistory(
          currentState.stageHistory,
          "stage_visual_studio"
        ),
      });

      return {
        deliverableId: row.id,
        hasUi: true,
        designMdContent: finalMarkdown,
      };
    },
  });

  const stageContractAndTests = createStep({
    id: "stage_contract_and_tests",
    description:
      "Provisiona worktree Git isolado, grava .uzina/DESIGN.md dentro do worktree e gera contratos + testes RED antes do build.",
    inputSchema: z.object({
      deliverableId: z.string(),
      hasUi: z.boolean(),
      designMdContent: z.string().nullable(),
    }),
    outputSchema: DeliveryCycleIOSchema,
    suspendSchema: z.object({
      gate: WorkflowGateTypeSchema,
      stage: z.string().optional(),
      toolClass: z.string().optional(),
      estimatedCostUsd: z.number().optional(),
      budgetCapUsd: z.number().optional(),
    }),
    resumeSchema: WorkflowResumeInputSchema,
    stateSchema: WorkflowRuntimeStateSchema,
    execute: async ({
      inputData,
      resumeData,
      getState,
      setState,
      suspend,
      bail,
      abortSignal,
    }) => {
      const currentState = await getState();
      const [row] = await db
        .select()
        .from(deliverables)
        .where(eq(deliverables.id, inputData.deliverableId))
        .limit(1);

      if (!row) {
        throw new WorkflowRuntimeError({
          statusCode: 404,
          code: "DELIVERABLE_NOT_FOUND",
          message: `Entregável '${inputData.deliverableId}' não encontrado.`,
        });
      }

      const workspace = await resolveStageWorkspace(deps, {
        organizationId: currentState.organizationId,
        deliverableId: row.id,
        stage: "stage_contract_and_tests",
      });
      const currentStatus = parseDeliverableStatus(row.status);
      let resumedContractDecisionType: DecisionType | null = null;

      if (resumeData) {
        resumedContractDecisionType = await findPendingDecisionTypeForStep(
          db,
          row.id,
          "stage_contract_and_tests"
        );
        await syncPendingDecisionResolution(db, {
          deliverableId: row.id,
          mastraStepId: "stage_contract_and_tests",
          decisionType: resumedContractDecisionType ?? "stage_gate_approve",
          status: resumeData.decision,
          humanFeedback: resumeData.feedback ?? null,
        });

        if (resumeData.decision === "rejected") {
          if (currentState.worktreeHandle) {
            await workspace.attach(currentState.worktreeHandle).catch(() => undefined);
            await safeCleanupWorkspace(workspace, true);
          }
          assertValidTransition(currentStatus, "failed", {
            hasUi: currentState.hasUi,
            pausedFromStatus:
              row.pausedFromStatus
                ? parseDeliverableStatus(row.pausedFromStatus)
                : null,
          });
          await db
            .update(deliverables)
            .set({
              status: "failed",
              pausedFromStatus: null,
              worktreePath: null,
              branchName: null,
              updatedAt: new Date(),
            })
            .where(eq(deliverables.id, row.id));
          const nextHistory = appendStageHistory(
            currentState.stageHistory,
            "stage_contract_and_tests"
          );
          await setState({
            ...currentState,
            worktreeHandle: null,
            rejected: true,
            humanFeedback: resumeData.feedback ?? null,
            stageHistory: nextHistory,
          });
          return bail({
            deliverableId: row.id,
            worktreeHandle: null,
            contractTestFiles: currentState.contractTestFiles,
            cycleDone: true,
            verifyPassed: false,
            approved: false,
            rejected: true,
            failed: false,
            stageHistory: nextHistory,
          });
        }

        if (currentStatus === "paused") {
          assertValidTransition("paused", "contract_tests", {
            hasUi: currentState.hasUi,
            pausedFromStatus: "contract_tests",
          });
          await db
            .update(deliverables)
            .set({
              status: "contract_tests",
              pausedFromStatus: null,
              updatedAt: new Date(),
            })
            .where(eq(deliverables.id, row.id));
        }
      }

      const { stageAutomation, budgetCapUsd, budgetCapTokens } =
        await resolveProjectAutomationAndBudget(db, row.projectId);
      const effectiveContractStatus: DeliverableStatus =
        resumeData && currentStatus === "paused"
          ? "contract_tests"
          : currentStatus;

      if (!resumeData && stageAutomation.contract_tests === "manual") {
        await upsertPendingDecision(db, {
          deliverableId: row.id,
          mastraStepId: "stage_contract_and_tests",
          decisionType: "stage_gate_approve",
          summary: `Aprovar início da etapa Contract & Tests para '${row.title}'`,
          payloadJson: {
            gate: "stage_gate_approve",
            stage: "contract_tests",
          },
        });
        return suspend({
          gate: "stage_gate_approve",
          stage: "contract_tests",
        });
      }

      const preBudget = await checkBudgetCapExceeded(
        db,
        row.projectId,
        budgetCapUsd,
        budgetCapTokens
      );
      if (preBudget.exceeded) {
        await pauseDeliverableForBudgetCap(db, {
          deliverableId: row.id,
          title: row.title,
          currentStatus: effectiveContractStatus,
          hasUi: currentState.hasUi,
          mastraStepId: "stage_contract_and_tests",
          stage: "contract_tests",
          budgetCapUsd: budgetCapUsd ?? preBudget.accumulatedCostUsd,
          accumulatedCostUsd: preBudget.accumulatedCostUsd,
          budgetCapTokens,
          accumulatedTokens: preBudget.accumulatedTokens,
          reason: preBudget.reason,
        });
        return suspend({
          gate: "budget_cap_pause",
          stage: "contract_tests",
          estimatedCostUsd: preBudget.accumulatedCostUsd,
          budgetCapUsd: budgetCapUsd ?? preBudget.accumulatedCostUsd,
        });
      }

      const repo = await resolveProjectRepository(db, row.repositoryId);
      if (!repo) {
        failWorkflow(
          new WorkflowRuntimeError({
            statusCode: 422,
            code: "MISSING_PRECONDITION",
            message:
              "Entregável precisa estar vinculado a um repositório local para criar worktree isolado.",
          })
        );
      }

      const provider = await resolveBuilderProviderProfile(
        db,
        currentState.organizationId
      );

      let handle: WorktreeHandle;
      if (currentState.worktreeHandle) {
        handle = currentState.worktreeHandle;
        await workspace.attach(handle);
      } else {
        handle = await workspace.prepare(
          repo.localPath,
          repo.defaultBranch,
          row.id,
          deps.worktreesRootDir
            ? { worktreesRootDir: deps.worktreesRootDir }
            : undefined
        );
        await db
          .update(deliverables)
          .set({
            worktreePath: handle.workspacePath,
            branchName: handle.branchName,
            updatedAt: new Date(),
          })
          .where(eq(deliverables.id, row.id));
        await setState({
          ...currentState,
          worktreeHandle: handle,
        });
      }

      const engineCfg = await getEngineConfigScoped(db, {
        organizationId: currentState.organizationId,
        includeDockerProbe: false,
      });
      const contractReadPolicy = engineCfg.config.toolPolicies.readCode;
      const contractWritePolicy = engineCfg.config.toolPolicies.writeFiles;

      if (contractReadPolicy === "deny" || contractWritePolicy === "deny") {
        const deniedClass =
          contractReadPolicy === "deny" ? "readCode" : "writeFiles";
        const denyMsg =
          deniedClass === "readCode"
            ? "Política granular bloqueou leitura de código em Contract & Tests ('readCode=deny')."
            : "Política granular bloqueou escrita de contrato/testes ('writeFiles=deny').";
        await recordExecutionEvent(db, {
          deliverableId: row.id,
          stage: "stage_contract_and_tests",
          actorRole: "builder",
          eventType: "tool_call",
          payload: {
            phase: "result",
            toolName: `tool_policy:${deniedClass}`,
            status: "error",
            summary: denyMsg,
          },
        });
        await safeCleanupWorkspace(workspace, false);
        assertValidTransition(effectiveContractStatus, "failed", {
          hasUi: currentState.hasUi,
        });
        await db
          .update(deliverables)
          .set({
            status: "failed",
            pausedFromStatus: null,
            updatedAt: new Date(),
          })
          .where(eq(deliverables.id, row.id));
        failWorkflow(
          new WorkflowRuntimeError({
            statusCode: 403,
            code: "TOOL_POLICY_DENIED",
            message: denyMsg,
          })
        );
      }

      const contractPolicyApproved =
        resumeData?.decision === "approved" &&
        (resumedContractDecisionType === "tool_policy_approval" ||
          (await hasApprovedToolPolicyForStep(
            db,
            row.id,
            "stage_contract_and_tests"
          )));

      if (
        (contractReadPolicy === "ask" || contractWritePolicy === "ask") &&
        !contractPolicyApproved
      ) {
        const askClass =
          contractReadPolicy === "ask" ? "readCode" : "writeFiles";
        await upsertPendingDecision(db, {
          deliverableId: row.id,
          mastraStepId: "stage_contract_and_tests",
          decisionType: "tool_policy_approval",
          summary: `Aprovar política '${askClass}=ask' em Contract & Tests para '${row.title}'`,
          payloadJson: {
            gate: "tool_policy_approval",
            stage: "contract_tests",
            toolClass: askClass,
          },
        });
        return suspend({
          gate: "tool_policy_approval",
          stage: "contract_tests",
          toolClass: askClass,
        });
      }

      if (inputData.hasUi && inputData.designMdContent) {
        const designTarget = assertPathInsideWorkspace(
          handle.workspacePath,
          ".uzina/DESIGN.md"
        );
        fs.mkdirSync(path.dirname(/*turbopackIgnore: true*/ designTarget), {
          recursive: true,
        });
        fs.writeFileSync(
          /*turbopackIgnore: true*/ designTarget,
          inputData.designMdContent,
          "utf8"
        );
      }

      const effectiveContractToolPolicies = {
        ...engineCfg.config.toolPolicies,
        readCode:
          contractReadPolicy === "ask" && contractPolicyApproved
            ? ("allow" as const)
            : contractReadPolicy,
        writeFiles:
          contractWritePolicy === "ask" && contractPolicyApproved
            ? ("allow" as const)
            : contractWritePolicy,
      };

      const transport = deps.transportFactory?.() ?? createDefaultTransport();
      const runner = new OpenCodeRunner({
        transport,
        masterKey: deps.masterKey,
      });
      const codingExecutor = createCodingExecutorAdapter({
        mode: engineCfg.config.codingExecutorMode,
        runner,
        masterKey: deps.masterKey,
      });

      const contractMemories = await resolveHierarchicalMemories(db, {
        organizationId: currentState.organizationId,
        projectId: row.projectId,
        limit: 12,
      });
      const contractMemoriesText = formatMemoriesForPrompt(contractMemories);

      const contractShardsSummary =
        currentState.architectBlueprintV2?.storyShards &&
        currentState.architectBlueprintV2.storyShards.length > 0
          ? `StoryShards do Blueprint V2:\n${currentState.architectBlueprintV2.storyShards
              .map(
                (s) =>
                  `- ${s.sliceName}: ${s.objective} (símbolos: ${s.targetSymbols.join(", ") || "nenhum"}; seq=${String(s.sequential)})`
              )
              .join("\n")}`
          : "";
      const contractManifestSummary =
        currentState.prototypeManifest?.sections &&
        currentState.prototypeManifest.sections.length > 0
          ? `PrototypeComponentManifest (data-slot & 5 estados):\n${currentState.prototypeManifest.sections
              .map(
                (sec) =>
                  `- ${sec.sectionName}: slots=[${sec.dataSlots.join(", ")}] states=[${sec.statesCovered.join(", ")}]`
              )
              .join("\n")}`
          : "";

      const heartbeat = runWithLockHeartbeat(db, row.id, abortSignal);
      let sessionResult;
      try {
        sessionResult = await codingExecutor.runSession({
          workspacePath: handle.workspacePath,
          mode: "build",
          role: "builder",
          skillNames: ["contract-first-msw", "test-quality-engineering"],
          skillsDir: deps.skillsDir,
          signal: heartbeat.signal,
          db,
          projectId: row.projectId,
          deliverableId: row.id,
          stage: "stage_contract_and_tests",
          budgetCapUsd,
          workspaceKind: engineCfg.config.workspaceKind,
          toolPolicies: effectiveContractToolPolicies,
          ...(deps.codingModelOverride
            ? { modelOverride: deps.codingModelOverride }
            : {}),
          providerConfig: {
            organizationId: currentState.organizationId,
            providerType: provider.providerType,
            baseUrl: provider.baseUrl ?? undefined,
            encryptedApiKey: provider.encryptedApiKey ?? undefined,
            roleBindings: provider.roleBindings,
          },
          prompt: [
            `stage_contract_and_tests para entregável '${row.title}'.`,
            currentState.specMarkdown ?? "",
            contractShardsSummary,
            contractManifestSummary,
            contractMemoriesText,
            "Escreva contratos e testes automatizados que falham inicialmente (RED) antes da implementação.",
          ]
            .filter(Boolean)
            .join("\n\n"),
        });
      } finally {
        heartbeat.stop();
      }

      const builderModelId = provider.roleBindings.builder?.modelId;
      const contractCost = estimateTokenCostUsd(
        builderModelId,
        sessionResult.tokenUsage,
        provider.customPricing
      );
      if (
        sessionResult.tokenUsage.inputTokens > 0 ||
        sessionResult.tokenUsage.outputTokens > 0 ||
        contractCost > 0
      ) {
        await recordExecutionEvent(db, {
          deliverableId: row.id,
          stage: "stage_contract_and_tests",
          actorRole: "builder",
          eventType: "token_usage",
          tokensInput: sessionResult.tokenUsage.inputTokens,
          tokensOutput: sessionResult.tokenUsage.outputTokens,
          cacheReadTokens: sessionResult.tokenUsage.cacheReadTokens,
          estimatedCostUsd: contractCost,
          payload: {
            status: sessionResult.status,
            ...(builderModelId ? { modelId: builderModelId } : {}),
          },
        });
      }

      const postBudget = await checkBudgetCapExceeded(
        db,
        row.projectId,
        budgetCapUsd,
        budgetCapTokens
      );
      if (
        sessionResult.errorMessage === "BUDGET_CAP_EXCEEDED" ||
        postBudget.exceeded
      ) {
        await setState({
          ...currentState,
          worktreeHandle: handle,
          tokensInput:
            currentState.tokensInput + sessionResult.tokenUsage.inputTokens,
          tokensOutput:
            currentState.tokensOutput + sessionResult.tokenUsage.outputTokens,
          cacheReadTokens:
            currentState.cacheReadTokens +
            sessionResult.tokenUsage.cacheReadTokens,
          estimatedCostUsd: Number(
            (currentState.estimatedCostUsd + contractCost).toFixed(6)
          ),
        });
        await pauseDeliverableForBudgetCap(db, {
          deliverableId: row.id,
          title: row.title,
          currentStatus: effectiveContractStatus,
          hasUi: currentState.hasUi,
          mastraStepId: "stage_contract_and_tests",
          stage: "contract_tests",
          budgetCapUsd: budgetCapUsd ?? postBudget.accumulatedCostUsd,
          accumulatedCostUsd: postBudget.accumulatedCostUsd,
          budgetCapTokens,
          accumulatedTokens: postBudget.accumulatedTokens,
          reason: postBudget.reason,
        });
        return suspend({
          gate: "budget_cap_pause",
          stage: "contract_tests",
          estimatedCostUsd: postBudget.accumulatedCostUsd,
          budgetCapUsd: budgetCapUsd ?? postBudget.accumulatedCostUsd,
        });
      }

      if (sessionResult.status !== "completed") {
        assertValidTransition(effectiveContractStatus, "failed", {
          hasUi: currentState.hasUi,
        });
        await db
          .update(deliverables)
          .set({ status: "failed", updatedAt: new Date() })
          .where(eq(deliverables.id, row.id));

        failWorkflow(
          new WorkflowRuntimeError({
            statusCode: 500,
            code: "EXECUTION_FAILED",
            message: `stage_contract_and_tests encerrou com status '${sessionResult.status}'.`,
          })
        );
      }

      const contractTestFiles = extractContractTestFiles(
        sessionResult.structuredOutput,
        sessionResult.touchedFiles,
        handle.workspacePath
      );

      assertValidTransition(effectiveContractStatus, "building", {
        hasUi: currentState.hasUi,
      });
      await db
        .update(deliverables)
        .set({
          status: "building",
          updatedAt: new Date(),
        })
        .where(eq(deliverables.id, row.id));

      const nextHistory = appendStageHistory(
        currentState.stageHistory,
        "stage_contract_and_tests"
      );

      await setState({
        ...currentState,
        worktreeHandle: handle,
        contractTestFiles,
        tokensInput: currentState.tokensInput + sessionResult.tokenUsage.inputTokens,
        tokensOutput: currentState.tokensOutput + sessionResult.tokenUsage.outputTokens,
        cacheReadTokens:
          currentState.cacheReadTokens + sessionResult.tokenUsage.cacheReadTokens,
        estimatedCostUsd: Number(
          (currentState.estimatedCostUsd + contractCost).toFixed(6)
        ),
        stageHistory: nextHistory,
      });

      return {
        deliverableId: row.id,
        worktreeHandle: handle,
        contractTestFiles,
        cycleDone: false,
        verifyPassed: false,
        approved: false,
        rejected: false,
        failed: false,
        stageHistory: nextHistory,
      };
    },
  });

  const stageBuild = createStep({
    id: "stage_build",
    description:
      "Implementa o entregável no mesmo worktree (via attach()) com intervenção humana em loop caso StuckDetector dispare.",
    inputSchema: DeliveryCycleIOSchema,
    outputSchema: DeliveryCycleIOSchema,
    suspendSchema: z.object({
      gate: WorkflowGateTypeSchema,
      stuckAlert: StuckAlertSchema.optional(),
      attempts: z.number().int().positive().optional(),
      stage: z.string().optional(),
      toolClass: z.string().optional(),
      estimatedCostUsd: z.number().optional(),
      budgetCapUsd: z.number().optional(),
    }),
    resumeSchema: WorkflowResumeInputSchema,
    stateSchema: WorkflowRuntimeStateSchema,
    execute: async ({
      inputData,
      resumeData,
      getState,
      setState,
      suspend,
      abortSignal,
    }) => {
      const currentState = await getState();
      const [row] = await db
        .select()
        .from(deliverables)
        .where(eq(deliverables.id, inputData.deliverableId))
        .limit(1);

      if (!row) {
        throw new WorkflowRuntimeError({
          statusCode: 404,
          code: "DELIVERABLE_NOT_FOUND",
          message: `Entregável '${inputData.deliverableId}' não encontrado.`,
        });
      }

      const worktreeHandle: WorktreeHandle | null =
        currentState.worktreeHandle ?? inputData.worktreeHandle;
      if (!worktreeHandle) {
        failWorkflow(
          new WorkflowRuntimeError({
            statusCode: 500,
            code: "EXECUTION_FAILED",
            message: "WorktreeHandle ausente em stage_build.",
          })
        );
      }

      const workspace = await resolveStageWorkspace(deps, {
        organizationId: currentState.organizationId,
        deliverableId: row.id,
        stage: "stage_build",
      });
      await workspace.attach(worktreeHandle);

      const currentStatus = parseDeliverableStatus(row.status);
      let nextFeedback = currentState.humanFeedback;
      let resumedBuildDecisionType: DecisionType | null = null;

      if (resumeData) {
        resumedBuildDecisionType = await findPendingDecisionTypeForStep(
          db,
          row.id,
          "stage_build"
        );
        await syncPendingDecisionResolution(db, {
          deliverableId: row.id,
          mastraStepId: "stage_build",
          decisionType: resumedBuildDecisionType ?? "stuck_intervention",
          status: resumeData.decision,
          humanFeedback: resumeData.feedback ?? null,
        });

        if (resumeData.decision === "rejected") {
          await safeCleanupWorkspace(workspace, true);
          assertValidTransition(currentStatus, "failed", {
            hasUi: currentState.hasUi,
            pausedFromStatus:
              row.pausedFromStatus
                ? parseDeliverableStatus(row.pausedFromStatus)
                : null,
          });
          await db
            .update(deliverables)
            .set({
              status: "failed",
              pausedFromStatus: null,
              worktreePath: null,
              branchName: null,
              updatedAt: new Date(),
            })
            .where(eq(deliverables.id, row.id));

          const nextHistory = appendStageHistory(
            currentState.stageHistory,
            "stage_build"
          );
          await setState({
            ...currentState,
            worktreeHandle: null,
            rejected: true,
            humanFeedback: resumeData.feedback ?? null,
            stageHistory: nextHistory,
          });

          return {
            deliverableId: row.id,
            worktreeHandle: null,
            contractTestFiles: inputData.contractTestFiles,
            cycleDone: true,
            verifyPassed: false,
            approved: false,
            rejected: true,
            failed: false,
            stageHistory: nextHistory,
          };
        }

        if (currentStatus === "paused") {
          assertValidTransition("paused", "building", {
            hasUi: currentState.hasUi,
            pausedFromStatus: "building",
          });
          await db
            .update(deliverables)
            .set({
              status: "building",
              pausedFromStatus: null,
              updatedAt: new Date(),
            })
            .where(eq(deliverables.id, row.id));
        }

        nextFeedback = resumeData.feedback?.trim()
          ? resumeData.feedback.trim()
          : currentState.humanFeedback;
      }

      const { stageAutomation, budgetCapUsd, budgetCapTokens } =
        await resolveProjectAutomationAndBudget(db, row.projectId);
      const effectiveBuildStatus: DeliverableStatus =
        resumeData && currentStatus === "paused" ? "building" : currentStatus;

      if (!resumeData && stageAutomation.building === "manual") {
        await upsertPendingDecision(db, {
          deliverableId: row.id,
          mastraStepId: "stage_build",
          decisionType: "stage_gate_approve",
          summary: `Aprovar execução de Build para '${row.title}'`,
          payloadJson: {
            gate: "stage_gate_approve",
            stage: "building",
          },
        });
        return suspend({
          gate: "stage_gate_approve",
          stage: "building",
        });
      }

      const preBudget = await checkBudgetCapExceeded(
        db,
        row.projectId,
        budgetCapUsd,
        budgetCapTokens
      );
      if (preBudget.exceeded) {
        await pauseDeliverableForBudgetCap(db, {
          deliverableId: row.id,
          title: row.title,
          currentStatus: effectiveBuildStatus,
          hasUi: currentState.hasUi,
          mastraStepId: "stage_build",
          stage: "building",
          budgetCapUsd: budgetCapUsd ?? preBudget.accumulatedCostUsd,
          accumulatedCostUsd: preBudget.accumulatedCostUsd,
          budgetCapTokens,
          accumulatedTokens: preBudget.accumulatedTokens,
          reason: preBudget.reason,
        });
        return suspend({
          gate: "budget_cap_pause",
          stage: "building",
          estimatedCostUsd: preBudget.accumulatedCostUsd,
          budgetCapUsd: budgetCapUsd ?? preBudget.accumulatedCostUsd,
        });
      }

      const engineCfg = await getEngineConfigScoped(db, {
        organizationId: currentState.organizationId,
        includeDockerProbe: false,
      });

      const readPolicy = engineCfg.config.toolPolicies.readCode;
      const writePolicy = engineCfg.config.toolPolicies.writeFiles;
      if (readPolicy === "deny" || writePolicy === "deny") {
        const deniedClass = readPolicy === "deny" ? "readCode" : "writeFiles";
        const denyMsg =
          deniedClass === "readCode"
            ? "Política granular bloqueou leitura de código ('readCode=deny')."
            : "Política granular bloqueou escrita em arquivos ('writeFiles=deny').";
        await recordExecutionEvent(db, {
          deliverableId: row.id,
          stage: "stage_build",
          actorRole: "builder",
          eventType: "tool_call",
          payload: {
            phase: "result",
            toolName: `tool_policy:${deniedClass}`,
            status: "error",
            summary: denyMsg,
          },
        });
        await safeCleanupWorkspace(workspace, false);
        assertValidTransition(effectiveBuildStatus, "failed", {
          hasUi: currentState.hasUi,
        });
        await db
          .update(deliverables)
          .set({
            status: "failed",
            pausedFromStatus: null,
            updatedAt: new Date(),
          })
          .where(eq(deliverables.id, row.id));
        failWorkflow(
          new WorkflowRuntimeError({
            statusCode: 403,
            code: "TOOL_POLICY_DENIED",
            message: denyMsg,
          })
        );
      }

      const buildPolicyApproved =
        resumeData?.decision === "approved" &&
        (resumedBuildDecisionType === "tool_policy_approval" ||
          (await hasApprovedToolPolicyForStep(db, row.id, "stage_build")));

      if ((readPolicy === "ask" || writePolicy === "ask") && !buildPolicyApproved) {
        const askClass = readPolicy === "ask" ? "readCode" : "writeFiles";
        await upsertPendingDecision(db, {
          deliverableId: row.id,
          mastraStepId: "stage_build",
          decisionType: "tool_policy_approval",
          summary: `Aprovar política '${askClass}=ask' para '${row.title}'`,
          payloadJson: {
            gate: "tool_policy_approval",
            stage: "building",
            toolClass: askClass,
          },
        });
        return suspend({
          gate: "tool_policy_approval",
          stage: "building",
          toolClass: askClass,
        });
      }

      const effectiveBuildToolPolicies = {
        ...engineCfg.config.toolPolicies,
        readCode:
          readPolicy === "ask" && buildPolicyApproved ? ("allow" as const) : readPolicy,
        writeFiles:
          writePolicy === "ask" && buildPolicyApproved ? ("allow" as const) : writePolicy,
      };

      const provider = await resolveBuilderProviderProfile(
        db,
        currentState.organizationId
      );
      const transport = deps.transportFactory?.() ?? createDefaultTransport();
      const runner = new OpenCodeRunner({
        transport,
        masterKey: deps.masterKey,
      });
      const codingExecutor = createCodingExecutorAdapter({
        mode: engineCfg.config.codingExecutorMode,
        runner,
        masterKey: deps.masterKey,
      });

      const buildMemories = await resolveHierarchicalMemories(db, {
        organizationId: currentState.organizationId,
        projectId: row.projectId,
        limit: 12,
      });
      const buildMemoriesText = formatMemoriesForPrompt(buildMemories);

      const buildShardsSummary =
        currentState.architectBlueprintV2?.storyShards &&
        currentState.architectBlueprintV2.storyShards.length > 0
          ? `StoryShards:\n${currentState.architectBlueprintV2.storyShards
              .map(
                (s) =>
                  `- ${s.sliceName}: ${s.objective} (${s.targetSymbols.join(", ") || "sem símbolos"})`
              )
              .join("\n")}`
          : null;
      const buildManifestSummary =
        currentState.prototypeManifest?.sections &&
        currentState.prototypeManifest.sections.length > 0
          ? `PrototypeComponentManifest:\n${currentState.prototypeManifest.sections
              .map(
                (sec) =>
                  `- ${sec.sectionName}: slots=[${sec.dataSlots.join(", ")}]`
              )
              .join("\n")}`
          : null;

      const promptParts = [
        `stage_build para entregável '${row.title}'.`,
        currentState.specMarkdown ?? "",
        buildShardsSummary,
        buildManifestSummary,
        buildMemoriesText || null,
        `Arquivos de contrato/teste pré-criados: ${inputData.contractTestFiles.join(", ") || "(nenhum listado)"}.`,
        nextFeedback
          ? `Orientação humana para retomada: ${nextFeedback}`
          : null,
      ].filter(Boolean);

      const heartbeat = runWithLockHeartbeat(db, row.id, abortSignal);
      let buildResult;
      try {
        buildResult = await codingExecutor.runSession({
          workspacePath: worktreeHandle.workspacePath,
          mode: "build",
          role: "builder",
          skillsDir: deps.skillsDir,
          signal: heartbeat.signal,
          db,
          projectId: row.projectId,
          deliverableId: row.id,
          stage: "stage_build",
          budgetCapUsd,
          workspaceKind: engineCfg.config.workspaceKind,
          toolPolicies: effectiveBuildToolPolicies,
          lockedReadOnlyPaths: inputData.contractTestFiles,
          ...(deps.codingModelOverride
            ? { modelOverride: deps.codingModelOverride }
            : {}),
          providerConfig: {
            organizationId: currentState.organizationId,
            providerType: provider.providerType,
            baseUrl: provider.baseUrl ?? undefined,
            encryptedApiKey: provider.encryptedApiKey ?? undefined,
            roleBindings: provider.roleBindings,
          },
          prompt: promptParts.join("\n\n"),
        });
      } finally {
        heartbeat.stop();
      }

      const builderModelId = provider.roleBindings.builder?.modelId;
      const buildCost = estimateTokenCostUsd(
        builderModelId,
        buildResult.tokenUsage,
        provider.customPricing
      );
      await recordExecutionEvent(db, {
        deliverableId: row.id,
        stage: "stage_build",
        actorRole: "builder",
        eventType:
          buildResult.status === "stuck" ? "stuck_alert" : "token_usage",
        tokensInput: buildResult.tokenUsage.inputTokens,
        tokensOutput: buildResult.tokenUsage.outputTokens,
        cacheReadTokens: buildResult.tokenUsage.cacheReadTokens,
        estimatedCostUsd: buildCost,
        payload: {
          status: buildResult.status,
          turns: buildResult.turns,
          stuckPattern: buildResult.stuckAlert?.pattern ?? null,
          ...(builderModelId ? { modelId: builderModelId } : {}),
        },
      });

      const postBuildBudget = await checkBudgetCapExceeded(
        db,
        row.projectId,
        budgetCapUsd,
        budgetCapTokens
      );
      if (
        buildResult.errorMessage === "BUDGET_CAP_EXCEEDED" ||
        (postBuildBudget.exceeded && buildResult.status !== "stuck")
      ) {
        await setState({
          ...currentState,
          worktreeHandle,
          humanFeedback: nextFeedback,
          tokensInput:
            currentState.tokensInput + buildResult.tokenUsage.inputTokens,
          tokensOutput:
            currentState.tokensOutput + buildResult.tokenUsage.outputTokens,
          cacheReadTokens:
            currentState.cacheReadTokens +
            buildResult.tokenUsage.cacheReadTokens,
          estimatedCostUsd: Number(
            (currentState.estimatedCostUsd + buildCost).toFixed(6)
          ),
        });
        await pauseDeliverableForBudgetCap(db, {
          deliverableId: row.id,
          title: row.title,
          currentStatus: effectiveBuildStatus,
          hasUi: currentState.hasUi,
          mastraStepId: "stage_build",
          stage: "building",
          budgetCapUsd: budgetCapUsd ?? postBuildBudget.accumulatedCostUsd,
          accumulatedCostUsd: postBuildBudget.accumulatedCostUsd,
          budgetCapTokens,
          accumulatedTokens: postBuildBudget.accumulatedTokens,
          reason: postBuildBudget.reason,
        });
        return suspend({
          gate: "budget_cap_pause",
          stage: "building",
          estimatedCostUsd: postBuildBudget.accumulatedCostUsd,
          budgetCapUsd: budgetCapUsd ?? postBuildBudget.accumulatedCostUsd,
        });
      }

      if (buildResult.status === "stuck" && buildResult.stuckAlert) {
        assertValidTransition("building", "paused", {
          hasUi: currentState.hasUi,
        });
        await db
          .update(deliverables)
          .set({
            status: "paused",
            pausedFromStatus: "building",
            updatedAt: new Date(),
          })
          .where(eq(deliverables.id, row.id));

        const nextAttempts = currentState.stuckAttempts + 1;
        const nextHistory = appendStageHistory(
          currentState.stageHistory,
          "stage_build"
        );
        await setState({
          ...currentState,
          worktreeHandle,
          humanFeedback: nextFeedback,
          stuckAttempts: nextAttempts,
          tokensInput:
            currentState.tokensInput + buildResult.tokenUsage.inputTokens,
          tokensOutput:
            currentState.tokensOutput + buildResult.tokenUsage.outputTokens,
          cacheReadTokens:
            currentState.cacheReadTokens +
            buildResult.tokenUsage.cacheReadTokens,
          estimatedCostUsd: Number(
            (currentState.estimatedCostUsd + buildCost).toFixed(6)
          ),
          stageHistory: nextHistory,
        });

        await upsertPendingDecision(db, {
          deliverableId: row.id,
          mastraStepId: "stage_build",
          decisionType: "stuck_intervention",
          summary: `Intervenção solicitada: ${buildResult.stuckAlert.pattern} (${row.title})`,
          payloadJson: {
            gate: "stuck_intervention",
            stuckAlert: buildResult.stuckAlert,
            attempts: nextAttempts,
          },
        });

        return suspend({
          gate: "stuck_intervention",
          stuckAlert: buildResult.stuckAlert,
          attempts: nextAttempts,
        });
      }

      if (buildResult.status !== "completed") {
        // Mantém worktree em disco para diagnóstico conforme §4.3
        assertValidTransition("building", "paused", {
          hasUi: currentState.hasUi,
        });
        assertValidTransition("paused", "failed", {
          hasUi: currentState.hasUi,
          pausedFromStatus: "building",
        });
        await db
          .update(deliverables)
          .set({
            status: "failed",
            pausedFromStatus: null,
            updatedAt: new Date(),
          })
          .where(eq(deliverables.id, row.id));

        failWorkflow(
          new WorkflowRuntimeError({
            statusCode: 500,
            code: "EXECUTION_FAILED",
            message: `stage_build encerrou com status '${buildResult.status}'.`,
          })
        );
      }

      let diffSimplificationNote: string | null = null;
      try {
        const preVerifyDiff = await workspace.getDiff(worktreeHandle.baseBranch);
        if (preVerifyDiff.trim().length > 0) {
          const semanticPreDiff = parseUnifiedDiffSemantic(preVerifyDiff);
          const oversizedFiles = semanticPreDiff.filter((f) => f.additions > 300);
          diffSimplificationNote =
            oversizedFiles.length > 0
              ? `Simplificação recomendada antes do Verify: ${oversizedFiles
                  .map((f) => `${f.filePath} (+${f.additions})`)
                  .join(", ")}.`
              : `Diff enxuto verificado (${semanticPreDiff.length} arquivo(s) alterados).`;
        }
      } catch {
        diffSimplificationNote = null;
      }

      assertValidTransition("building", "verifying", {
        hasUi: currentState.hasUi,
      });
      await db
        .update(deliverables)
        .set({
          status: "verifying",
          pausedFromStatus: null,
          updatedAt: new Date(),
        })
        .where(eq(deliverables.id, row.id));

      const nextHistory = appendStageHistory(
        currentState.stageHistory,
        "stage_build"
      );
      await setState({
        ...currentState,
        worktreeHandle,
        lastDiffSimplificationNote: diffSimplificationNote,
        humanFeedback: nextFeedback,
        tokensInput:
          currentState.tokensInput + buildResult.tokenUsage.inputTokens,
        tokensOutput:
          currentState.tokensOutput + buildResult.tokenUsage.outputTokens,
        cacheReadTokens:
          currentState.cacheReadTokens +
          buildResult.tokenUsage.cacheReadTokens,
        estimatedCostUsd: Number(
          (currentState.estimatedCostUsd + buildCost).toFixed(6)
        ),
        stageHistory: nextHistory,
      });

      return {
        deliverableId: row.id,
        worktreeHandle,
        contractTestFiles: inputData.contractTestFiles,
        cycleDone: false,
        verifyPassed: false,
        approved: false,
        rejected: false,
        failed: false,
        stageHistory: nextHistory,
      };
    },
  });

  const stageVerify = createStep({
    id: "stage_verify",
    description:
      "Executa .uzina/verify (TestAuditor + comandos + security-engine + Verifier plan sem CoT do Builder) até maxVerifyAttempts.",
    inputSchema: DeliveryCycleIOSchema,
    outputSchema: DeliveryCycleIOSchema,
    suspendSchema: z.object({
      gate: WorkflowGateTypeSchema,
      stage: z.string().optional(),
      toolClass: z.string().optional(),
      estimatedCostUsd: z.number().optional(),
      budgetCapUsd: z.number().optional(),
    }),
    resumeSchema: WorkflowResumeInputSchema,
    stateSchema: WorkflowRuntimeStateSchema,
    execute: async ({
      inputData,
      resumeData,
      getState,
      setState,
      suspend,
      abortSignal,
    }) => {
      if (inputData.cycleDone || inputData.rejected || inputData.failed) {
        return inputData;
      }

      const currentState = await getState();
      const [row] = await db
        .select()
        .from(deliverables)
        .where(eq(deliverables.id, inputData.deliverableId))
        .limit(1);

      if (!row) {
        throw new WorkflowRuntimeError({
          statusCode: 404,
          code: "DELIVERABLE_NOT_FOUND",
          message: `Entregável '${inputData.deliverableId}' não encontrado.`,
        });
      }

      const worktreeHandle =
        currentState.worktreeHandle ?? inputData.worktreeHandle;
      if (!worktreeHandle) {
        failWorkflow(
          new WorkflowRuntimeError({
            statusCode: 500,
            code: "EXECUTION_FAILED",
            message: "WorktreeHandle ausente em stage_verify.",
          })
        );
      }

      const workspace = await resolveStageWorkspace(deps, {
        organizationId: currentState.organizationId,
        deliverableId: row.id,
        stage: "stage_verify",
      });
      await workspace.attach(worktreeHandle);

      const initialVerifyStatus = parseDeliverableStatus(row.status);
      let resumedDecisionType: DecisionType | null = null;
      if (resumeData) {
        resumedDecisionType = await findPendingDecisionTypeForStep(
          db,
          row.id,
          "stage_verify"
        );
        await syncPendingDecisionResolution(db, {
          deliverableId: row.id,
          mastraStepId: "stage_verify",
          decisionType: resumedDecisionType ?? "stage_gate_approve",
          status: resumeData.decision,
          humanFeedback: resumeData.feedback ?? null,
        });

        if (resumeData.decision === "rejected") {
          await safeCleanupWorkspace(workspace, true);
          assertValidTransition(initialVerifyStatus, "failed", {
            hasUi: currentState.hasUi,
            pausedFromStatus:
              row.pausedFromStatus
                ? parseDeliverableStatus(row.pausedFromStatus)
                : null,
          });
          await db
            .update(deliverables)
            .set({
              status: "failed",
              pausedFromStatus: null,
              worktreePath: null,
              branchName: null,
              updatedAt: new Date(),
            })
            .where(eq(deliverables.id, row.id));
          const nextHistory = appendStageHistory(
            currentState.stageHistory,
            "stage_verify"
          );
          await setState({
            ...currentState,
            worktreeHandle: null,
            rejected: true,
            humanFeedback: resumeData.feedback ?? null,
            stageHistory: nextHistory,
          });
          return {
            deliverableId: row.id,
            worktreeHandle: null,
            contractTestFiles: inputData.contractTestFiles,
            cycleDone: true,
            verifyPassed: false,
            approved: false,
            rejected: true,
            failed: false,
            stageHistory: nextHistory,
          };
        }

        if (initialVerifyStatus === "paused") {
          assertValidTransition("paused", "verifying", {
            hasUi: currentState.hasUi,
            pausedFromStatus: "verifying",
          });
          await db
            .update(deliverables)
            .set({
              status: "verifying",
              pausedFromStatus: null,
              updatedAt: new Date(),
            })
            .where(eq(deliverables.id, row.id));
        }
      }

      const { stageAutomation, budgetCapUsd, budgetCapTokens } =
        await resolveProjectAutomationAndBudget(db, row.projectId);
      const effectiveVerifyStatus: DeliverableStatus =
        resumeData && initialVerifyStatus === "paused"
          ? "verifying"
          : initialVerifyStatus;

      if (!resumeData && stageAutomation.verifying === "manual") {
        await upsertPendingDecision(db, {
          deliverableId: row.id,
          mastraStepId: "stage_verify",
          decisionType: "stage_gate_approve",
          summary: `Aprovar execução de Verify para '${row.title}'`,
          payloadJson: {
            gate: "stage_gate_approve",
            stage: "verifying",
          },
        });
        return suspend({
          gate: "stage_gate_approve",
          stage: "verifying",
        });
      }

      const verifyEngineCfg = await getEngineConfigScoped(db, {
        organizationId: currentState.organizationId,
        includeDockerProbe: false,
      });
      if (
        verifyEngineCfg.config.toolPolicies.runTests === "ask" &&
        !(
          resumeData?.decision === "approved" &&
          (resumedDecisionType === "tool_policy_approval" ||
            (await hasApprovedToolPolicyForStep(db, row.id, "stage_verify")))
        )
      ) {
        await upsertPendingDecision(db, {
          deliverableId: row.id,
          mastraStepId: "stage_verify",
          decisionType: "tool_policy_approval",
          summary: `Aprovar política 'runTests=ask' para '${row.title}'`,
          payloadJson: {
            gate: "tool_policy_approval",
            stage: "verifying",
            toolClass: "runTests",
          },
        });
        return suspend({
          gate: "tool_policy_approval",
          stage: "verifying",
          toolClass: "runTests",
        });
      }

      const preVerifyBudget = await checkBudgetCapExceeded(
        db,
        row.projectId,
        budgetCapUsd,
        budgetCapTokens
      );
      if (preVerifyBudget.exceeded) {
        await pauseDeliverableForBudgetCap(db, {
          deliverableId: row.id,
          title: row.title,
          currentStatus: effectiveVerifyStatus,
          hasUi: currentState.hasUi,
          mastraStepId: "stage_verify",
          stage: "verifying",
          budgetCapUsd: budgetCapUsd ?? preVerifyBudget.accumulatedCostUsd,
          accumulatedCostUsd: preVerifyBudget.accumulatedCostUsd,
          budgetCapTokens,
          accumulatedTokens: preVerifyBudget.accumulatedTokens,
          reason: preVerifyBudget.reason,
        });
        return suspend({
          gate: "budget_cap_pause",
          stage: "verifying",
          estimatedCostUsd: preVerifyBudget.accumulatedCostUsd,
          budgetCapUsd: budgetCapUsd ?? preVerifyBudget.accumulatedCostUsd,
        });
      }

      const keepCurrentAttempt = Boolean(
        resumeData &&
          (initialVerifyStatus === "paused" ||
            resumeData.newBudgetCapUsd !== undefined ||
            resumedDecisionType === "budget_cap_pause") &&
          row.verifyAttempts > currentState.verifyAttempts
      );
      const attemptNumber = keepCurrentAttempt
        ? row.verifyAttempts
        : row.verifyAttempts + 1;
      const maxAttempts = row.maxVerifyAttempts;

      if (!keepCurrentAttempt) {
        await db
          .update(deliverables)
          .set({
            verifyAttempts: attemptNumber,
            updatedAt: new Date(),
          })
          .where(eq(deliverables.id, row.id));
      }

      const heartbeat = runWithLockHeartbeat(db, row.id, abortSignal);
      const verifyChecks: VerifyCheckSummary[] = [];
      let lastAuditReport: ReturnType<typeof auditTestDirectory> | null = null;
      let testAuditPassed = true;
      let testAuditViolationsCount = 0;
      let scanResult: ExecutedSecurityScanOutput | null = null;
      let scanId: string | null = null;
      let securityGatePassed = true;
      let verifierVerdict: "approved" | "changes_required" = "approved";
      let verifierNotes = "";
      let verifierModelUsed: string | null = null;
      let verifyTokensInput = 0;
      let verifyTokensOutput = 0;
      let verifyCacheTokens = 0;
      let verifyCostUsd = 0;
      let budgetExceededInVerifier = false;
      let budgetAccumulatedInVerifier = 0;
      const failureReasons: string[] = [];

      let rawDiff = "";
      try {
        rawDiff = await workspace.getDiff(worktreeHandle.baseBranch);
      } catch {
        rawDiff = "";
      }
      const verifyKnownSecrets = await collectOrganizationKnownSecrets(db, {
        organizationId: currentState.organizationId,
        masterKey: deps.masterKey,
      }).catch(() => [] as string[]);
      const changedFiles = parseChangedFilesFromDiff(rawDiff);
      const redactedDiffPreview = redactSensitiveText(
        rawDiff,
        verifyKnownSecrets
      ).slice(0, 8192);

      const semanticFileDiffs = parseUnifiedDiffSemantic(rawDiff, {
        knownSecrets: verifyKnownSecrets,
      });

      const emitVerifyToolTrace = async (input: {
        phase: "start" | "result";
        toolName: string;
        targetPath?: string;
        durationMs?: number;
        status: "running" | "ok" | "error";
        summary?: string;
      }) => {
        const parsed = ToolCallTracePayloadSchema.parse({
          phase: input.phase,
          toolName: input.toolName,
          ...(input.targetPath
            ? {
                targetPath: redactSensitiveText(
                  input.targetPath,
                  verifyKnownSecrets
                ).slice(0, 512),
              }
            : {}),
          ...(typeof input.durationMs === "number"
            ? { durationMs: Math.max(0, Math.round(input.durationMs)) }
            : {}),
          status: input.status,
          ...(input.summary
            ? {
                summary: redactSensitiveText(
                  input.summary,
                  verifyKnownSecrets
                ).slice(0, 1000),
              }
            : {}),
        });
        await recordExecutionEvent(db, {
          deliverableId: row.id,
          stage: "stage_verify",
          actorRole: "verifier",
          eventType: "tool_call",
          payload: parsed,
        });
      };

      try {
        // 1) TestAuditor estático
        const auditStarted = Date.now();
        await emitVerifyToolTrace({
          phase: "start",
          toolName: "audit:tests",
          targetPath: worktreeHandle.workspacePath,
          status: "running",
        });
        const auditReport = auditTestDirectory(worktreeHandle.workspacePath);
        lastAuditReport = auditReport;
        testAuditPassed = auditReport.passed;
        testAuditViolationsCount = auditReport.violations.length;
        const auditDurationMs = Math.max(1, Date.now() - auditStarted);
        const auditCheckSummary = auditReport.passed
          ? `${auditReport.scannedTests} testes auditados sem anti-patterns.`
          : auditReport.violations
              .slice(0, 5)
              .map((v) => `${v.filePath}:${v.line} (${v.rule})`)
              .join("; ");
        verifyChecks.push({
          name: "audit:tests",
          passed: auditReport.passed,
          durationMs: auditDurationMs,
          summary: auditCheckSummary,
        });
        await emitVerifyToolTrace({
          phase: "result",
          toolName: "audit:tests",
          targetPath: worktreeHandle.workspacePath,
          durationMs: auditDurationMs,
          status: auditReport.passed ? "ok" : "error",
          summary: auditCheckSummary,
        });
        if (!auditReport.passed) {
          failureReasons.push(
            `TestAuditor detectou ${auditReport.violations.length} anti-pattern(s): ${verifyChecks[0]!.summary}`
          );
        }

        // 2) Comandos determinísticos (somente se TestAuditor passou)
        if (failureReasons.length === 0) {
          if (verifyEngineCfg.config.toolPolicies.runTests === "deny") {
            const denySummary =
              "Política granular bloqueou execução de testes ('runTests=deny').";
            await emitVerifyToolTrace({
              phase: "result",
              toolName: "verify_runner",
              targetPath: worktreeHandle.workspacePath,
              durationMs: 0,
              status: "error",
              summary: denySummary,
            });
            verifyChecks.push({
              name: "policy:runTests",
              passed: false,
              durationMs: 0,
              summary: denySummary,
            });
            failureReasons.push(denySummary);
          } else {
            const verifyRunnerStarted = Date.now();
            await emitVerifyToolTrace({
              phase: "start",
              toolName: "verify_runner",
              targetPath: worktreeHandle.workspacePath,
              status: "running",
            });
            const runner = deps.verifyRunner ?? defaultVerifyRunner;
            const cmdChecks = await runner({
              deliverableId: row.id,
              workspacePath: worktreeHandle.workspacePath,
              workspace,
              attemptNumber,
              signal: heartbeat.signal,
            });
            verifyChecks.push(...cmdChecks);
            const verifyRunnerDurationMs = Math.max(
              1,
              Date.now() - verifyRunnerStarted
            );
            const failedCmd = cmdChecks.find((c) => !c.passed);
            await emitVerifyToolTrace({
              phase: "result",
              toolName: "verify_runner",
              targetPath: worktreeHandle.workspacePath,
              durationMs: verifyRunnerDurationMs,
              status: failedCmd ? "error" : "ok",
              summary: failedCmd
                ? `${failedCmd.name}: ${failedCmd.summary}`
                : `${cmdChecks.length} check(s) determinístico(s) aprovado(s).`,
            });
            if (failedCmd) {
              failureReasons.push(
                `Verify runner falhou em '${failedCmd.name}': ${failedCmd.summary}`
              );
            }
          }
        }

        // 3) Security Engine incremental no diff (somente se 1-2 passaram)
        if (failureReasons.length === 0) {
          const secStarted = Date.now();
          await emitVerifyToolTrace({
            phase: "start",
            toolName: "security-engine",
            targetPath: worktreeHandle.branchName,
            status: "running",
          });
          scanResult = await runSecurityScan(
            {
              mode: "embedded",
              targetType: changedFiles.length > 0 ? "git_diff" : "git_repo",
              targetPath: worktreeHandle.workspacePath,
              targetRef: worktreeHandle.branchName,
              changedRelativePaths:
                changedFiles.length > 0 ? changedFiles : undefined,
              triage: true,
            },
            {
              ...deps.securityRunnerDeps,
              suppressionLookup:
                deps.securityRunnerDeps?.suppressionLookup ??
                createProjectSuppressionLookup(db, row.projectId),
              signal: heartbeat.signal,
            }
          );

          const [savedScan] = await db
            .insert(securityScans)
            .values({
              organizationId: currentState.organizationId,
              projectId: row.projectId,
              deliverableId: row.id,
              mode: scanResult.mode,
              targetType: scanResult.targetType,
              targetRef: scanResult.targetRef,
              scannersRun: scanResult.scannersRun,
              scannerStatusesJson: scanResult.scannerStatuses,
              sarifRawJson: scanResult.sarifRawJson,
              summaryCountsJson: scanResult.summaryCountsJson,
              status: scanResult.status,
            })
            .returning();

          scanId = savedScan?.id ?? null;

          if (scanId && scanResult.findings.length > 0) {
            await db.insert(securityFindings).values(
              scanResult.findings.map((f) => ({
                scanId: scanId!,
                projectId: row.projectId,
                ruleId: f.ruleId,
                scanner: f.scanner,
                severity: f.severity,
                filePath: f.filePath,
                lineStart: f.lineStart,
                title: f.title,
                description: f.description,
                fingerprint: f.fingerprint,
                triageVerdict: f.triageVerdict,
                triageRationale: f.triageRationale,
                suppressedInMemory: f.suppressedInMemory,
                povTestStatus: f.povTestStatus,
              }))
            );
          }

          const blockingFindings = scanResult.findings.filter(
            (f) =>
              (f.severity === "critical" || f.severity === "high") &&
              f.triageVerdict !== "false_positive" &&
              !f.suppressedInMemory
          );

          securityGatePassed = blockingFindings.length === 0;
          const secDurationMs = Math.max(
            1,
            scanResult.scannerStatuses.reduce((acc, s) => acc + s.durationMs, 0) ||
              Date.now() - secStarted
          );
          const secSummary = securityGatePassed
            ? `${scanResult.findings.length} achados totais (0 bloqueantes critical/high); scanners pulados: ${scanResult.summaryCountsJson.skippedScannersCount}`
            : `${blockingFindings.length} achado(s) critical/high bloqueante(s): ${blockingFindings
                .slice(0, 3)
                .map((b) => `${b.ruleId}@${b.filePath ?? "repo"}`)
                .join(", ")}`;
          verifyChecks.push({
            name: "security-engine",
            passed: securityGatePassed,
            durationMs: secDurationMs,
            summary: secSummary,
          });
          await emitVerifyToolTrace({
            phase: "result",
            toolName: "security-engine",
            targetPath: worktreeHandle.branchName,
            durationMs: secDurationMs,
            status: securityGatePassed ? "ok" : "error",
            summary: secSummary,
          });

          if (!securityGatePassed) {
            failureReasons.push(
              `Gate AppSec reprovou: ${blockingFindings
                .slice(0, 3)
                .map((b) => `${b.title} (${b.severity})`)
                .join("; ")}`
            );
          }
        }

        // 4) Verifier independente em modo plan SEM CoT do Builder (somente se 1-3 passaram)
        if (failureReasons.length === 0) {
          const verifierProvider = await resolveVerifierProviderProfile(
            db,
            currentState.organizationId
          );
          const transport =
            deps.transportFactory?.() ?? createDefaultTransport();
          const verifierRunner = new OpenCodeRunner({
            transport,
            masterKey: deps.masterKey,
          });
          const verifyEngineCfg = await getEngineConfigScoped(db, {
            organizationId: currentState.organizationId,
          });
          const verifierExecutor = createCodingExecutorAdapter({
            mode: verifyEngineCfg.config.codingExecutorMode,
            runner: verifierRunner,
            masterKey: deps.masterKey,
          });

          const truncatedDiffForPrompt = redactSensitiveText(rawDiff).slice(
            0,
            32_768
          );
          const verifierPrompt = [
            `Você é o Verifier independente para o entregável '${row.title}'.`,
            "Avalie exclusivamente com base nos requisitos, diff Git e relatórios objetivos abaixo.",
            `Requisitos / Spec:\n${currentState.specMarkdown ?? row.description ?? "(sem spec)"}`,
            `Diff Git (${worktreeHandle.baseBranch}..${worktreeHandle.branchName}):\n${truncatedDiffForPrompt || "(sem diff textual)"}`,
            `Resumo das verificações determinísticas:\n${JSON.stringify(verifyChecks)}`,
            'Retorne JSON estrito no formato { "verdict": "approved" | "changes_required", "summary": string, "issues": [...] }.',
          ].join("\n\n");

          const verifierSession = await verifierExecutor.runSession({
            workspacePath: worktreeHandle.workspacePath,
            mode: "plan",
            role: "verifier",
            skillsDir: deps.skillsDir,
            signal: heartbeat.signal,
            outputSchema: VerifierVerdictOutputSchema,
            db,
            projectId: row.projectId,
            deliverableId: row.id,
            stage: "stage_verify",
            budgetCapUsd: budgetCapUsd ?? undefined,
            workspaceKind: verifyEngineCfg.config.workspaceKind,
            ...(deps.verifierModelOverride
              ? { modelOverride: deps.verifierModelOverride }
              : {}),
            providerConfig: {
              organizationId: currentState.organizationId,
              providerType: verifierProvider.providerType,
              baseUrl: verifierProvider.baseUrl ?? undefined,
              encryptedApiKey: verifierProvider.encryptedApiKey ?? undefined,
              roleBindings: verifierProvider.roleBindings,
            },
            prompt: verifierPrompt,
          });

          const verifierModelId = verifierProvider.roleBindings.verifier?.modelId;
          verifierModelUsed = verifierModelId ?? null;
          verifyTokensInput = verifierSession.tokenUsage.inputTokens;
          verifyTokensOutput = verifierSession.tokenUsage.outputTokens;
          verifyCacheTokens = verifierSession.tokenUsage.cacheReadTokens;
          verifyCostUsd = estimateTokenCostUsd(
            verifierModelId,
            verifierSession.tokenUsage,
            verifierProvider.customPricing
          );

          const postVerifyBudget = await checkBudgetCapExceeded(
            db,
            row.projectId,
            budgetCapUsd,
            budgetCapTokens,
            verifyCostUsd,
            verifyTokensInput + verifyTokensOutput
          );

          if (
            verifierSession.errorMessage === "BUDGET_CAP_EXCEEDED" ||
            postVerifyBudget.exceeded
          ) {
            budgetExceededInVerifier = true;
            budgetAccumulatedInVerifier = postVerifyBudget.accumulatedCostUsd;
          } else if (verifierSession.status !== "completed") {
            verifierVerdict = "changes_required";
            verifierNotes = `Sessão do Verifier encerrou com status '${verifierSession.status}'.`;
            failureReasons.push(verifierNotes);
          } else {
            const parsedVerdict = VerifierVerdictOutputSchema.safeParse(
              verifierSession.structuredOutput
            );
            if (!parsedVerdict.success) {
              verifierVerdict = "changes_required";
              verifierNotes =
                "Verifier retornou StructuredOutput inválido fora do contrato.";
              failureReasons.push(verifierNotes);
            } else {
              verifierVerdict = parsedVerdict.data.verdict;
              verifierNotes = parsedVerdict.data.summary;
              if (verifierVerdict === "changes_required") {
                const issuesSummary = parsedVerdict.data.issues
                  .slice(0, 3)
                  .map((i) => i.message)
                  .join("; ");
                failureReasons.push(
                  `Verifier reprovou: ${verifierNotes}${issuesSummary ? ` (${issuesSummary})` : ""}`
                );
              }
            }
          }
        }
      } finally {
        heartbeat.stop();
      }

      if (budgetExceededInVerifier) {
        if (
          verifyTokensInput > 0 ||
          verifyTokensOutput > 0 ||
          verifyCostUsd > 0
        ) {
          await recordExecutionEvent(db, {
            deliverableId: row.id,
            stage: "stage_verify",
            actorRole: "verifier",
            eventType: "token_usage",
            tokensInput: verifyTokensInput,
            tokensOutput: verifyTokensOutput,
            cacheReadTokens: verifyCacheTokens,
            estimatedCostUsd: verifyCostUsd,
            payload: {
              attemptNumber,
              pausedForBudget: true,
              ...(verifierModelUsed ? { modelId: verifierModelUsed } : {}),
            },
          });
        }
        await setState({
          ...currentState,
          worktreeHandle,
          tokensInput: currentState.tokensInput + verifyTokensInput,
          tokensOutput: currentState.tokensOutput + verifyTokensOutput,
          cacheReadTokens: currentState.cacheReadTokens + verifyCacheTokens,
          estimatedCostUsd: Number(
            (currentState.estimatedCostUsd + verifyCostUsd).toFixed(6)
          ),
        });
        const effectiveCap = budgetCapUsd ?? budgetAccumulatedInVerifier;
        const accTokensAfter =
          budgetCapTokens != null
            ? await getProjectAccumulatedTokens(db, row.projectId)
            : 0;
        await pauseDeliverableForBudgetCap(db, {
          deliverableId: row.id,
          title: row.title,
          currentStatus: effectiveVerifyStatus,
          hasUi: currentState.hasUi,
          mastraStepId: "stage_verify",
          stage: "verifying",
          budgetCapUsd: effectiveCap,
          accumulatedCostUsd: budgetAccumulatedInVerifier,
          budgetCapTokens,
          accumulatedTokens: accTokensAfter,
          reason:
            budgetCapUsd != null && budgetAccumulatedInVerifier >= budgetCapUsd
              ? "usd"
              : budgetCapTokens != null && accTokensAfter >= budgetCapTokens
                ? "tokens"
                : null,
        });
        return suspend({
          gate: "budget_cap_pause",
          stage: "verifying",
          estimatedCostUsd: budgetAccumulatedInVerifier,
          budgetCapUsd: effectiveCap,
        });
      }

      const nextHistory = appendStageHistory(
        currentState.stageHistory,
        "stage_verify"
      );

      const skippedScanners = scanResult
        ? scanResult.scannerStatuses
            .filter((s) => s.status === "skipped_missing_binary")
            .map((s) => s.scanner)
        : [];
      const securitySummary: EvidencePack["securitySummary"] = {
        scanId,
        critical: scanResult?.summaryCountsJson.critical ?? 0,
        high: scanResult?.summaryCountsJson.high ?? 0,
        medium: scanResult?.summaryCountsJson.medium ?? 0,
        low: scanResult?.summaryCountsJson.low ?? 0,
        info: scanResult?.summaryCountsJson.info ?? 0,
        scannersRun: scanResult?.scannersRun ?? [],
        skippedScanners,
        gatePassed: securityGatePassed,
      };

      const totalTokensInput = currentState.tokensInput + verifyTokensInput;
      const totalTokensOutput = currentState.tokensOutput + verifyTokensOutput;
      const totalCacheTokens = currentState.cacheReadTokens + verifyCacheTokens;
      const totalCostUsd = Number(
        (currentState.estimatedCostUsd + verifyCostUsd).toFixed(6)
      );

      const rawTestCommandOutput =
        verifyChecks.length > 0
          ? redactSensitiveText(
              verifyChecks
                .map(
                  (c) =>
                    `[${c.passed ? "PASS" : "FAIL"}] ${c.name} (${c.durationMs}ms): ${c.summary}`
                )
                .join("\n"),
              verifyKnownSecrets
            ).slice(0, 16384)
          : undefined;

      const twoStageVerifierOutput = await evaluateTwoStageVerifier({
        deliverableTitle: row.title,
        specMarkdown: currentState.specMarkdown ?? row.description ?? null,
        shapeSpec: currentState.shapeSpec ?? null,
        semanticDiffs: semanticFileDiffs,
        rawDiff,
        verifyChecks,
        testCommandOutput: rawTestCommandOutput ?? null,
        testAuditReport: lastAuditReport,
        securitySummary,
        sarifFindings: (scanResult?.findings ?? []).map((f) => ({
          ruleId: f.ruleId,
          severity: f.severity,
          title: f.title,
          filePath: f.filePath,
          triageVerdict: f.triageVerdict,
          suppressedInMemory: f.suppressedInMemory,
        })),
        knownSecrets: verifyKnownSecrets,
        evaluator: {
          evaluateStage1: async ({ criteria, semanticDiffs }) => {
            const stage1Passed =
              failureReasons.length === 0 && verifierVerdict === "approved";
            const firstCode = semanticDiffs.find((d) => d.category === "code");
            const firstTest = semanticDiffs.find((d) => d.category === "test");
            return {
              matrix: criteria.map((c, idx) => ({
                criterionId: c.id,
                criterionText: c.text,
                testFile: firstTest?.filePath ?? null,
                testLine: null,
                sourceFile: firstCode?.filePath ?? null,
                sourceLine: null,
                status: stage1Passed
                  ? ("covered" as const)
                  : idx === 0
                    ? ("missing" as const)
                    : ("covered" as const),
              })),
              summary: verifierNotes || undefined,
            };
          },
        },
      });

      if (
        failureReasons.length === 0 &&
        twoStageVerifierOutput.verdict === "changes_required"
      ) {
        verifierVerdict = "changes_required";
        verifierNotes = twoStageVerifierOutput.summary;
        failureReasons.push(twoStageVerifierOutput.summary);
      }

      const verifyPassed = failureReasons.length === 0;
      const testCommandOutput = rawTestCommandOutput;
      const evidencePack = EvidencePackSchema.parse({
        deliverableId: row.id,
        branchName: worktreeHandle.branchName,
        baseBranch: worktreeHandle.baseBranch,
        verifyAttempts: attemptNumber,
        verifyPassed,
        verifyChecks,
        testAuditPassed,
        testAuditViolationsCount,
        diffSummary: {
          filesChanged: changedFiles.length,
          diffBytes: Buffer.byteLength(rawDiff, "utf8"),
          preview: redactedDiffPreview,
          fileDiffs: semanticFileDiffs,
        },
        ...(testCommandOutput ? { testCommandOutput } : {}),
        securitySummary,
        tokenSummary: {
          totalInputTokens: totalTokensInput,
          totalOutputTokens: totalTokensOutput,
          totalCacheReadTokens: totalCacheTokens,
          estimatedCostUsd: totalCostUsd,
        },
        verifierVerdict,
        verifierNotes:
          verifierNotes ||
          (verifyPassed
            ? "Todas as verificações determinísticas passaram."
            : failureReasons.join(" | ")),
        finalizeInfo: null,
      });

      await recordExecutionEvent(db, {
        deliverableId: row.id,
        stage: "stage_verify",
        actorRole: "verifier",
        eventType: "verify_result",
        tokensInput: verifyTokensInput,
        tokensOutput: verifyTokensOutput,
        cacheReadTokens: verifyCacheTokens,
        estimatedCostUsd: verifyCostUsd,
        payload: {
          attemptNumber,
          maxAttempts,
          verifyPassed,
          verifierVerdict,
          confidenceScore: twoStageVerifierOutput.confidenceScore,
          failureReasons,
          scanId,
          ...(verifierModelUsed ? { modelId: verifierModelUsed } : {}),
        },
      });

      if (!verifyPassed) {
        const currentStatus = effectiveVerifyStatus;
        if (attemptNumber < maxAttempts) {
          assertValidTransition(currentStatus, "building", {
            hasUi: currentState.hasUi,
            verifyAttempts: attemptNumber,
            maxVerifyAttempts: maxAttempts,
          });
          const feedback = redactSensitiveText(failureReasons.join("\n"));
          await db
            .update(deliverables)
            .set({
              status: "building",
              evidencePackJson: evidencePack,
              updatedAt: new Date(),
            })
            .where(eq(deliverables.id, row.id));

          await setState({
            ...currentState,
            worktreeHandle,
            verifyAttempts: attemptNumber,
            verifyPassed: false,
            verifyChecks,
            testAuditPassed,
            testAuditViolationsCount,
            lastSecurityScanId: scanId,
            securitySummary,
            verifierVerdict,
            verifierNotes: evidencePack.verifierNotes,
            twoStageVerifierOutput,
            evidencePack,
            tokensInput: totalTokensInput,
            tokensOutput: totalTokensOutput,
            cacheReadTokens: totalCacheTokens,
            estimatedCostUsd: totalCostUsd,
            humanFeedback: `Falha no Verify (${attemptNumber}/${maxAttempts}): ${feedback}`,
            stageHistory: nextHistory,
          });

          return {
            deliverableId: row.id,
            worktreeHandle,
            contractTestFiles: inputData.contractTestFiles,
            cycleDone: false,
            verifyPassed: false,
            approved: false,
            rejected: false,
            failed: false,
            stageHistory: nextHistory,
          };
        }

        // Esgotou tentativas (attemptNumber >= maxAttempts) -> failed (mantém worktree para diagnóstico)
        assertValidTransition(currentStatus, "failed", {
          hasUi: currentState.hasUi,
          verifyAttempts: attemptNumber,
          maxVerifyAttempts: maxAttempts,
        });
        await db
          .update(deliverables)
          .set({
            status: "failed",
            evidencePackJson: evidencePack,
            updatedAt: new Date(),
          })
          .where(eq(deliverables.id, row.id));

        await setState({
          ...currentState,
          worktreeHandle,
          verifyAttempts: attemptNumber,
          verifyPassed: false,
          verifyChecks,
          testAuditPassed,
          testAuditViolationsCount,
          lastSecurityScanId: scanId,
          securitySummary,
          verifierVerdict,
          verifierNotes: evidencePack.verifierNotes,
          evidencePack,
          tokensInput: totalTokensInput,
          tokensOutput: totalTokensOutput,
          cacheReadTokens: totalCacheTokens,
          estimatedCostUsd: totalCostUsd,
          stageHistory: nextHistory,
        });

        return {
          deliverableId: row.id,
          worktreeHandle,
          contractTestFiles: inputData.contractTestFiles,
          cycleDone: true,
          verifyPassed: false,
          approved: false,
          rejected: false,
          failed: true,
          stageHistory: nextHistory,
        };
      }

      // Verify passou -> decision_pending
      assertValidTransition("verifying", "decision_pending", {
        hasUi: currentState.hasUi,
      });
      await db
        .update(deliverables)
        .set({
          status: "decision_pending",
          evidencePackJson: evidencePack,
          updatedAt: new Date(),
        })
        .where(eq(deliverables.id, row.id));

      await setState({
        ...currentState,
        worktreeHandle,
        verifyAttempts: attemptNumber,
        verifyPassed: true,
        verifyChecks,
        testAuditPassed,
        testAuditViolationsCount,
        lastSecurityScanId: scanId,
        securitySummary,
        verifierVerdict,
        verifierNotes: evidencePack.verifierNotes,
        twoStageVerifierOutput,
        evidencePack,
        tokensInput: totalTokensInput,
        tokensOutput: totalTokensOutput,
        cacheReadTokens: totalCacheTokens,
        estimatedCostUsd: totalCostUsd,
        stageHistory: nextHistory,
      });

      return {
        deliverableId: row.id,
        worktreeHandle,
        contractTestFiles: inputData.contractTestFiles,
        cycleDone: false,
        verifyPassed: true,
        approved: false,
        rejected: false,
        failed: false,
        stageHistory: nextHistory,
      };
    },
  });

  const stageDecision = createStep({
    id: "stage_decision",
    description:
      "Publica Pacote de Evidências na Caixa de Decisões HITL e suspende em pr_evidence_approve.",
    inputSchema: DeliveryCycleIOSchema,
    outputSchema: DeliveryCycleIOSchema,
    suspendSchema: z.object({
      gate: WorkflowGateTypeSchema,
      evidencePack: EvidencePackSchema,
    }),
    resumeSchema: WorkflowResumeInputSchema,
    stateSchema: WorkflowRuntimeStateSchema,
    execute: async ({ inputData, resumeData, getState, setState, suspend }) => {
      if (
        inputData.cycleDone ||
        !inputData.verifyPassed ||
        inputData.rejected ||
        inputData.failed
      ) {
        return inputData;
      }

      const currentState = await getState();
      const [row] = await db
        .select()
        .from(deliverables)
        .where(eq(deliverables.id, inputData.deliverableId))
        .limit(1);

      if (!row) {
        throw new WorkflowRuntimeError({
          statusCode: 404,
          code: "DELIVERABLE_NOT_FOUND",
          message: `Entregável '${inputData.deliverableId}' não encontrado.`,
        });
      }

      const evidencePack = currentState.evidencePack;
      if (!evidencePack) {
        failWorkflow(
          new WorkflowRuntimeError({
            statusCode: 500,
            code: "EXECUTION_FAILED",
            message: "EvidencePack ausente ao entrar em stage_decision.",
          })
        );
      }

      if (!resumeData) {
        const nextHistory = appendStageHistory(
          currentState.stageHistory,
          "stage_decision"
        );
        const riskBriefing = computeDecisionRiskBriefing({
          semanticDiffs: evidencePack.diffSummary.fileDiffs,
          rawDiff: evidencePack.diffSummary.preview,
          confidenceScore:
            currentState.twoStageVerifierOutput?.confidenceScore ??
            (evidencePack.verifyPassed ? 85 : 40),
          tokensTotal:
            evidencePack.tokenSummary.totalInputTokens +
            evidencePack.tokenSummary.totalOutputTokens,
          estimatedCostUsd: evidencePack.tokenSummary.estimatedCostUsd,
          securitySummary: evidencePack.securitySummary,
        });
        if (evidencePack.verifyAttempts >= 2) {
          await distillRetrospectiveToQmd(db, {
            organizationId: currentState.organizationId,
            projectId: row.projectId,
            deliverableId: row.id,
            deliverableTitle: row.title,
            verifyAttempts: evidencePack.verifyAttempts,
            verifierNotes: evidencePack.verifierNotes,
            hasSecurityFailure: !evidencePack.securitySummary.gatePassed,
            securityFindingsCount:
              evidencePack.securitySummary.critical +
              evidencePack.securitySummary.high,
          }).catch(() => undefined);
        }
        await setState({
          ...currentState,
          decisionRiskBriefing: riskBriefing,
          stageHistory: nextHistory,
        });

        await upsertPendingDecision(db, {
          deliverableId: row.id,
          mastraStepId: "stage_decision",
          decisionType: "pr_evidence_approve",
          summary: `Pacote de Evidências pronto para aprovação de merge/PR (${row.title})`,
          payloadJson: {
            gate: "pr_evidence_approve",
            evidencePack,
            riskBriefing,
            ...(currentState.twoStageVerifierOutput
              ? { twoStageVerifierOutput: currentState.twoStageVerifierOutput }
              : {}),
          },
        });
        await recordExecutionEvent(db, {
          deliverableId: row.id,
          stage: "stage_decision",
          actorRole: "verifier",
          eventType: "stage_change",
          payload: {
            gate: "pr_evidence_approve",
            verifyAttempts: evidencePack.verifyAttempts,
          },
        });

        return suspend({
          gate: "pr_evidence_approve",
          evidencePack,
        });
      }

      await syncPendingDecisionResolution(db, {
        deliverableId: row.id,
        mastraStepId: "stage_decision",
        decisionType: "pr_evidence_approve",
        status: resumeData.decision,
        humanFeedback: resumeData.feedback ?? null,
      });

      const currentStatus = parseDeliverableStatus(row.status);
      const nextHistory = appendStageHistory(
        currentState.stageHistory,
        "stage_decision"
      );

      if (resumeData.decision === "rejected") {
        const worktreeHandle =
          currentState.worktreeHandle ?? inputData.worktreeHandle;
        if (worktreeHandle) {
          const workspace =
            deps.workspaceFactory?.() ?? new LocalGitWorktreeWorkspace();
          try {
            await workspace.attach(worktreeHandle);
            await safeCleanupWorkspace(workspace, true);
          } catch {
            // Worktree já pode ter sido removido manualmente
          }
        }

        assertValidTransition(currentStatus, "failed", {
          hasUi: currentState.hasUi,
        });
        await db
          .update(deliverables)
          .set({
            status: "failed",
            worktreePath: null,
            branchName: null,
            updatedAt: new Date(),
          })
          .where(eq(deliverables.id, row.id));

        await recordExecutionEvent(db, {
          deliverableId: row.id,
          stage: "stage_decision",
          actorRole: "human",
          eventType: "stage_change",
          payload: {
            decision: "rejected",
            feedback: resumeData.feedback ?? null,
          },
        });

        if (evidencePack.verifyAttempts >= 2 || resumeData.feedback?.trim()) {
          await distillRetrospectiveToQmd(db, {
            organizationId: currentState.organizationId,
            projectId: row.projectId,
            deliverableId: row.id,
            deliverableTitle: row.title,
            verifyAttempts: evidencePack.verifyAttempts,
            decision: "rejected",
            feedback: resumeData.feedback ?? null,
            verifierNotes: evidencePack.verifierNotes,
            hasSecurityFailure: !evidencePack.securitySummary.gatePassed,
            securityFindingsCount:
              evidencePack.securitySummary.critical +
              evidencePack.securitySummary.high,
          }).catch(() => undefined);
        }

        await setState({
          ...currentState,
          worktreeHandle: null,
          rejected: true,
          humanFeedback: resumeData.feedback ?? null,
          stageHistory: nextHistory,
        });

        return {
          deliverableId: row.id,
          worktreeHandle: null,
          contractTestFiles: inputData.contractTestFiles,
          cycleDone: true,
          verifyPassed: false,
          approved: false,
          rejected: true,
          failed: false,
          stageHistory: nextHistory,
        };
      }

      if (resumeData.decision === "changes_requested") {
        assertValidTransition(currentStatus, "building", {
          hasUi: currentState.hasUi,
        });
        const feedback = resumeData.feedback?.trim() || "Ajustes solicitados na revisão.";
        await db
          .update(deliverables)
          .set({
            status: "building",
            verifyAttempts: 0,
            updatedAt: new Date(),
          })
          .where(eq(deliverables.id, row.id));

        await recordExecutionEvent(db, {
          deliverableId: row.id,
          stage: "stage_decision",
          actorRole: "human",
          eventType: "stage_change",
          payload: {
            decision: "changes_requested",
            feedback,
          },
        });

        if (evidencePack.verifyAttempts >= 2 || resumeData.feedback?.trim()) {
          await distillRetrospectiveToQmd(db, {
            organizationId: currentState.organizationId,
            projectId: row.projectId,
            deliverableId: row.id,
            deliverableTitle: row.title,
            verifyAttempts: evidencePack.verifyAttempts,
            decision: "changes_requested",
            feedback,
            verifierNotes: evidencePack.verifierNotes,
            hasSecurityFailure: !evidencePack.securitySummary.gatePassed,
            securityFindingsCount:
              evidencePack.securitySummary.critical +
              evidencePack.securitySummary.high,
          }).catch(() => undefined);
        }

        await setState({
          ...currentState,
          verifyAttempts: 0,
          verifyPassed: false,
          humanFeedback: feedback,
          stageHistory: nextHistory,
        });

        return {
          deliverableId: row.id,
          worktreeHandle: currentState.worktreeHandle ?? inputData.worktreeHandle,
          contractTestFiles: inputData.contractTestFiles,
          cycleDone: false,
          verifyPassed: false,
          approved: false,
          rejected: false,
          failed: false,
          stageHistory: nextHistory,
        };
      }

      // approved -> sai do loop e vai para stage_finalize
      assertValidTransition(currentStatus, "approved", {
        hasUi: currentState.hasUi,
      });
      await db
        .update(deliverables)
        .set({
          status: "approved",
          updatedAt: new Date(),
        })
        .where(eq(deliverables.id, row.id));

      await recordExecutionEvent(db, {
        deliverableId: row.id,
        stage: "stage_decision",
        actorRole: "human",
        eventType: "stage_change",
        payload: { decision: "approved" },
      });

      await setState({
        ...currentState,
        humanFeedback: resumeData.feedback ?? currentState.humanFeedback,
        stageHistory: nextHistory,
      });

      return {
        deliverableId: row.id,
        worktreeHandle: currentState.worktreeHandle ?? inputData.worktreeHandle,
        contractTestFiles: inputData.contractTestFiles,
        cycleDone: true,
        verifyPassed: true,
        approved: true,
        rejected: false,
        failed: false,
        stageHistory: nextHistory,
      };
    },
  });

  const deliveryCycleWorkflow = createWorkflow({
    id: "delivery_cycle",
    inputSchema: DeliveryCycleIOSchema,
    outputSchema: DeliveryCycleIOSchema,
    stateSchema: WorkflowRuntimeStateSchema,
  })
    .then(stageBuild)
    .then(stageVerify)
    .then(stageDecision)
    .commit();

  const stageFinalize = createStep({
    id: "stage_finalize",
    description:
      "Realiza commit padronizado, abre Draft PR ou merge local seguro, transita para merged e limpa o worktree.",
    inputSchema: DeliveryCycleIOSchema,
    outputSchema: DeliverableLifecycleOutputSchema,
    suspendSchema: z.object({
      gate: WorkflowGateTypeSchema,
      stage: z.string().optional(),
      toolClass: z.string().optional(),
    }),
    resumeSchema: WorkflowResumeInputSchema,
    stateSchema: WorkflowRuntimeStateSchema,
    execute: async ({ inputData, resumeData, getState, setState, suspend, abortSignal }) => {
      const currentState = await getState();

      if (inputData.rejected || inputData.failed || !inputData.approved) {
        return {
          rejected: inputData.rejected,
          deliverableId: inputData.deliverableId,
          deliverableStatus: "failed" as const,
          worktreeHandle: inputData.worktreeHandle,
          contractTestFiles: inputData.contractTestFiles,
          stageHistory: currentState.stageHistory,
          evidencePack: currentState.evidencePack,
        };
      }

      const [row] = await db
        .select()
        .from(deliverables)
        .where(eq(deliverables.id, inputData.deliverableId))
        .limit(1);

      if (!row) {
        throw new WorkflowRuntimeError({
          statusCode: 404,
          code: "DELIVERABLE_NOT_FOUND",
          message: `Entregável '${inputData.deliverableId}' não encontrado.`,
        });
      }

      const worktreeHandle =
        currentState.worktreeHandle ?? inputData.worktreeHandle;
      if (!worktreeHandle) {
        failWorkflow(
          new WorkflowRuntimeError({
            statusCode: 500,
            code: "EXECUTION_FAILED",
            message: "WorktreeHandle ausente em stage_finalize.",
          })
        );
      }

      let resumedFinalizeDecisionType: DecisionType | null = null;
      if (resumeData) {
        resumedFinalizeDecisionType = await findPendingDecisionTypeForStep(
          db,
          row.id,
          "stage_finalize"
        );
        await syncPendingDecisionResolution(db, {
          deliverableId: row.id,
          mastraStepId: "stage_finalize",
          decisionType: resumedFinalizeDecisionType ?? "tool_policy_approval",
          status: resumeData.decision,
          humanFeedback: resumeData.feedback ?? null,
        });

        if (resumeData.decision === "rejected") {
          const rejectStatus = parseDeliverableStatus(row.status);
          assertValidTransition(rejectStatus, "failed", {
            hasUi: currentState.hasUi,
          });
          await db
            .update(deliverables)
            .set({
              status: "failed",
              updatedAt: new Date(),
            })
            .where(eq(deliverables.id, row.id));
          const nextHistory = appendStageHistory(
            currentState.stageHistory,
            "stage_finalize"
          );
          await setState({
            ...currentState,
            rejected: true,
            stageHistory: nextHistory,
          });
          return {
            rejected: true,
            deliverableId: row.id,
            deliverableStatus: "failed" as const,
            worktreeHandle,
            contractTestFiles: inputData.contractTestFiles,
            stageHistory: nextHistory,
            evidencePack: currentState.evidencePack,
          };
        }
      }

      const repo = await resolveProjectRepository(db, row.repositoryId);
      const { finalizePolicy } = await resolveProjectAutomationAndBudget(
        db,
        row.projectId
      );
      const workspace = await resolveStageWorkspace(deps, {
        organizationId: currentState.organizationId,
        deliverableId: row.id,
        stage: "stage_finalize",
      });
      await workspace.attach(worktreeHandle);

      const finalizeEngineCfg = await getEngineConfigScoped(db, {
        organizationId: currentState.organizationId,
        includeDockerProbe: false,
      });

      const gitFinalizePolicy = finalizeEngineCfg.config.toolPolicies.gitFinalize;
      if (
        gitFinalizePolicy === "ask" &&
        !(
          resumeData?.decision === "approved" &&
          (resumedFinalizeDecisionType === "tool_policy_approval" ||
            (await hasApprovedToolPolicyForStep(db, row.id, "stage_finalize")))
        )
      ) {
        await upsertPendingDecision(db, {
          deliverableId: row.id,
          mastraStepId: "stage_finalize",
          decisionType: "tool_policy_approval",
          summary: `Aprovar finalização Git ('gitFinalize=ask') para '${row.title}'`,
          payloadJson: {
            gate: "tool_policy_approval",
            stage: "stage_finalize",
            toolClass: "gitFinalize",
          },
        });
        return suspend({
          gate: "tool_policy_approval",
          stage: "stage_finalize",
          toolClass: "gitFinalize",
        });
      }

      const finalizeFn = deps.finalizeRunner ?? defaultFinalizeRunner;
      let outcome: FinalizeOutcome;
      if (gitFinalizePolicy === "deny") {
        const denyReason =
          "Política granular bloqueou finalização Git ('gitFinalize=deny'); branch local preservada.";
        await recordExecutionEvent(db, {
          deliverableId: row.id,
          stage: "stage_finalize",
          actorRole: "builder",
          eventType: "tool_call",
          payload: {
            phase: "result",
            toolName: "git_finalize",
            status: "error",
            summary: denyReason,
          },
        });
        outcome = {
          mode: "local_branch_ready",
          commitSha: null,
          prUrl: null,
          shouldDeleteBranchOnCleanup: false,
          mergeBlockedReason: denyReason,
        };
      } else {
        const githubPat = await resolveOrganizationGitHubPat(db, {
          organizationId: currentState.organizationId,
          masterKey: deps.masterKey,
        });
        try {
          outcome = await finalizeFn({
            deliverableId: row.id,
            workspacePath: worktreeHandle.workspacePath,
            repoPath: repo?.localPath ?? worktreeHandle.repoPath,
            remoteUrl: repo?.remoteUrl ?? null,
            branchName: worktreeHandle.branchName,
            baseBranch: worktreeHandle.baseBranch,
            finalizePolicy,
            commitMessage: `feat(deliverable): ${row.title}`,
            prTitle: `[Uzina] ${row.title}`,
            prBody: renderDraftPrBodyWithRiskBriefing({
              summary: currentState.evidencePack
                ? `Pacote de evidências aprovado (${currentState.evidencePack.verifyAttempts} tentativa(s) de verify).`
                : row.description ?? row.title,
              riskBriefing: currentState.decisionRiskBriefing,
              specMatrix:
                currentState.twoStageVerifierOutput?.stage1SpecCompliance
                  .matrix,
            }),
            githubPat,
            fetchImpl: deps.githubFetchImpl,
            signal: abortSignal ?? new AbortController().signal,
          });
        } catch (error) {
          const currentStatus = parseDeliverableStatus(row.status);
          assertValidTransition(currentStatus, "failed", {
            hasUi: currentState.hasUi,
          });
          await db
            .update(deliverables)
            .set({
              status: "failed",
              updatedAt: new Date(),
            })
            .where(eq(deliverables.id, row.id));

          await recordExecutionEvent(db, {
            deliverableId: row.id,
            stage: "stage_finalize",
            actorRole: "builder",
            eventType: "error",
            payload: {
              message: redactSensitiveText(
                error instanceof Error ? error.message : String(error)
              ),
            },
          });

          failWorkflow(
            new WorkflowRuntimeError({
              statusCode: 500,
              code: "EXECUTION_FAILED",
              message: redactSensitiveText(
                error instanceof Error ? error.message : "Falha na finalização Git."
              ),
              cause: error,
            })
          );
        }
      }

      await safeCleanupWorkspace(workspace, outcome.shouldDeleteBranchOnCleanup);

      const updatedPack: EvidencePack | null = currentState.evidencePack
        ? {
            ...currentState.evidencePack,
            finalizeInfo: {
              mode: outcome.mode,
              commitSha: outcome.commitSha,
              prUrl: outcome.prUrl,
              branchName: worktreeHandle.branchName,
              mergeBlockedReason: outcome.mergeBlockedReason ?? null,
            },
          }
        : null;

      assertValidTransition("approved", "merged", {
        hasUi: currentState.hasUi,
      });

      await db
        .update(deliverables)
        .set({
          status: "merged",
          worktreePath: null,
          branchName: outcome.shouldDeleteBranchOnCleanup
            ? null
            : worktreeHandle.branchName,
          evidencePackJson: updatedPack,
          updatedAt: new Date(),
        })
        .where(eq(deliverables.id, row.id));

      if (currentState.architectBlueprintV2?.openSpecDelta) {
        await syncOpenSpecArchive({
          deliverableId: row.id,
          deliverableTitle: row.title,
          delta: currentState.architectBlueprintV2.openSpecDelta,
          existingSpecMarkdown:
            currentState.specMarkdown ?? row.specMarkdown ?? undefined,
          workspaceRoot:
            repo?.localPath ?? worktreeHandle.repoPath ?? undefined,
          db,
          organizationId: currentState.organizationId,
          projectId: row.projectId,
        }).catch(() => undefined);
      }

      const [insertedMemory] = await db
        .insert(memories)
        .values({
          organizationId: currentState.organizationId,
          scopeType: "project",
          scopeId: row.projectId,
          category: "architecture",
          title: `Entrega concluída: ${row.title}`,
          content: `Finalizada via ${outcome.mode} (${worktreeHandle.branchName}). ${updatedPack?.verifierNotes ?? ""}`.trim(),
          sourceDeliverableId: row.id,
        })
        .returning();

      const [latestApprovedDecision] = await db
        .select({ id: decisions.id })
        .from(decisions)
        .where(
          and(
            eq(decisions.deliverableId, row.id),
            eq(decisions.status, "approved")
          )
        )
        .orderBy(desc(decisions.resolvedAt))
        .limit(1);

      const provenancePaths = [
        ...(inputData.contractTestFiles ?? []),
        ...(updatedPack?.diffSummary?.preview
          ? parseChangedFilesFromDiff(updatedPack.diffSummary.preview)
          : []),
      ];

      await recordDeliverableProvenance(db, {
        organizationId: currentState.organizationId,
        deliverableId: row.id,
        repositoryId: row.repositoryId,
        decisionId: latestApprovedDecision?.id ?? null,
        memoryId: insertedMemory?.id ?? null,
        filePaths:
          provenancePaths.length > 0
            ? provenancePaths
            : [`deliverable:${row.id}`],
      }).catch(() => undefined);

      const nextHistory = appendStageHistory(
        currentState.stageHistory,
        "stage_finalize"
      );

      await recordExecutionEvent(db, {
        deliverableId: row.id,
        stage: "stage_finalize",
        actorRole: "builder",
        eventType: "stage_change",
        payload: {
          status: "merged",
          finalizeMode: outcome.mode,
          commitSha: outcome.commitSha,
          prUrl: outcome.prUrl,
        },
      });

      await setState({
        ...currentState,
        worktreeHandle: null,
        evidencePack: updatedPack,
        stageHistory: nextHistory,
      });

      return {
        rejected: false,
        deliverableId: row.id,
        deliverableStatus: "merged" as const,
        worktreeHandle: null,
        contractTestFiles: inputData.contractTestFiles,
        stageHistory: nextHistory,
        evidencePack: updatedPack,
      };
    },
  });

  return createWorkflow({
    id: "deliverableLifecycle",
    inputSchema: DeliverableLifecycleInputSchema,
    outputSchema: DeliverableLifecycleOutputSchema,
    stateSchema: WorkflowRuntimeStateSchema,
  })
    .then(stageDiscovery)
    .then(stageBlueprint)
    .then(stageVisualStudio)
    .then(stageContractAndTests)
    .dountil(deliveryCycleWorkflow, async ({ inputData }) => inputData.cycleDone)
    .then(stageFinalize)
    .commit();
}
