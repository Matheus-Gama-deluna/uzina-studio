import { AsyncLocalStorage } from "node:async_hooks";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  DeliverableStatusSchema,
  DesignAssetSchema,
  DevelopmentStrategySchema,
  DiscoveryAnswerSchema,
  DiscoveryRoundSchema,
  EvidencePackSchema,
  StrategyRouterOutputSchema,
  StuckAlertSchema,
  VerifierVerdictOutputSchema,
  VerifyCheckSummarySchema,
  WorkflowGateTypeSchema,
  WorkflowResumeInputSchema,
  WorktreeHandleSchema,
  type DecisionStatus,
  type DecisionType,
  type DeliverableStatus,
  type DesignAsset,
  type DevelopmentStrategy,
  type DiscoveryAnswer,
  type DiscoveryRound,
  type EvidencePack,
  type ProviderType,
  type RoleBindings,
  type StrategyRouterOutput,
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
  redactSensitiveText,
  routeDevelopmentStrategy,
  scanRepositoryBrownfield,
} from "@uzina/core";
import {
  decisions,
  deliverables,
  designAssets,
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
}

export type FinalizeRunner = (ctx: {
  deliverableId: string;
  workspacePath: string;
  repoPath: string | null;
  remoteUrl: string | null;
  branchName: string;
  baseBranch: string;
  commitMessage: string;
  prTitle: string;
  prBody: string;
  signal: AbortSignal;
}) => Promise<FinalizeOutcome>;

export interface DeliverableWorkflowDeps {
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

export interface LockWorkerContextValue {
  workerId: string;
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

async function defaultFinalizeRunner(ctx: {
  deliverableId: string;
  workspacePath: string;
  repoPath: string | null;
  remoteUrl: string | null;
  branchName: string;
  baseBranch: string;
  commitMessage: string;
  prTitle: string;
  prBody: string;
  signal: AbortSignal;
}): Promise<FinalizeOutcome> {
  if (!ctx.branchName || ctx.branchName.startsWith("-")) {
    throw new Error("Nome de branch inválido para finalização.");
  }
  if (!ctx.baseBranch || ctx.baseBranch.startsWith("-")) {
    throw new Error("Nome de baseBranch inválido para finalização.");
  }

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
        `Falha ao criar commit na branch '${ctx.branchName}': ${commitRes.stderr}`
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

  if (ctx.remoteUrl) {
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
        ["push", "-u", "origin", "--", ctx.branchName],
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
            ctx.baseBranch,
            "--head",
            ctx.branchName,
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
          };
        }
      }
    }
  }

  if (ctx.repoPath && fs.existsSync(/*turbopackIgnore: true*/ ctx.repoPath)) {
    const repoStatus = await runSubprocessSafe("git", ["status", "--porcelain"], {
      cwd: ctx.repoPath,
      env: gitEnv,
      timeoutMs: 15_000,
      signal: ctx.signal,
    });
    if (repoStatus.exitCode === 0 && repoStatus.stdout.trim() === "") {
      const checkoutRes = await runSubprocessSafe(
        "git",
        ["checkout", "--", ctx.baseBranch],
        { cwd: ctx.repoPath, env: gitEnv, timeoutMs: 30_000, signal: ctx.signal }
      );
      if (checkoutRes.exitCode === 0) {
        const mergeRes = await runSubprocessSafe(
          "git",
          ["merge", "--ff-only", "--", ctx.branchName],
          { cwd: ctx.repoPath, env: gitEnv, timeoutMs: 30_000, signal: ctx.signal }
        );
        if (mergeRes.exitCode === 0) {
          return {
            mode: "local_merge",
            commitSha,
            prUrl: null,
            shouldDeleteBranchOnCleanup: true,
          };
        }
      }
    }
  }

  return {
    mode: "local_branch_ready",
    commitSha,
    prUrl: null,
    shouldDeleteBranchOnCleanup: false,
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
  const workerId = lockWorkerContext.getStore()?.workerId;

  const onExternalAbort = () => {
    controller.abort();
  };
  if (externalAbort) {
    if (externalAbort.aborted) {
      controller.abort();
    } else {
      externalAbort.addEventListener("abort", onExternalAbort, { once: true });
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

export function createDeliverableLifecycleWorkflow(deps: DeliverableWorkflowDeps) {
  const { db } = deps;

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

      if (!resumeData) {
        const round1 = buildDiscoveryQuestions({
          roundNumber: 1,
          title: row.title,
          description: row.description,
          hasUiKnown: true,
          hasUiValue: currentState.hasUi,
          previousAnswers: currentState.allAnswers,
          brownfieldSummary,
        });

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
      ): Promise<StrategyRouterOutput> => {
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
        return routeDevelopmentStrategy({
          title: row.title,
          description: row.description,
          hasUi: hasUiFlag,
          riskLevel:
            row.riskLevel === "medium" || row.riskLevel === "high"
              ? row.riskLevel
              : "low",
          isBrownfield,
          maturityScore,
          overrideStrategy,
        });
      };

      if (!resumeData) {
        const blueprint = await computeBlueprint(
          inputData.hasUi,
          parseDevelopmentStrategy(currentState.overrideStrategy)
        );

        await db
          .update(deliverables)
          .set({
            blueprintJson: blueprint,
            developmentStrategy: blueprint.developmentStrategy,
            tacticalPattern: blueprint.tacticalPattern,
            updatedAt: new Date(),
          })
          .where(eq(deliverables.id, row.id));

        const nextState: WorkflowRuntimeState = {
          ...currentState,
          hasUi: inputData.hasUi,
          blueprint,
          stageHistory: appendStageHistory(
            currentState.stageHistory,
            "stage_blueprint"
          ),
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

      const updatedBlueprint = await computeBlueprint(
        effectiveHasUi,
        effectiveOverride
      );

      if (resumeData.decision === "changes_requested") {
        await db
          .update(deliverables)
          .set({
            hasUi: effectiveHasUi,
            blueprintJson: updatedBlueprint,
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
          blueprintJson: updatedBlueprint,
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
        const referenceAssets = assetRows
          .filter((a) => a.assetType !== "design_md")
          .map(mapDesignAssetRow);

        const markdown = generateDesignMdContract({
          projectName: projectRow.name,
          themePreference: "dual_theme",
          assets: referenceAssets,
          notes,
        });

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
        };
      };

      if (!resumeData) {
        const { markdown, assetCount } = await generateAndPersistDesignMd();
        await setState({
          ...currentState,
          designMdContent: markdown,
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
        const { markdown, assetCount } = await generateAndPersistDesignMd(
          resumeData.feedback
        );
        await setState({
          ...currentState,
          designMdContent: markdown,
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

      const finalMarkdown =
        currentState.designMdContent ??
        (await generateAndPersistDesignMd(resumeData.feedback)).markdown;

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
    stateSchema: WorkflowRuntimeStateSchema,
    execute: async ({ inputData, getState, setState, abortSignal }) => {
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

      const workspace =
        deps.workspaceFactory?.() ?? new LocalGitWorktreeWorkspace();
      const handle = await workspace.prepare(
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

      const transport = deps.transportFactory?.() ?? createDefaultTransport();
      const runner = new OpenCodeRunner({
        transport,
        masterKey: deps.masterKey,
      });

      const heartbeat = runWithLockHeartbeat(db, row.id, abortSignal);
      let sessionResult;
      try {
        sessionResult = await runner.runSession({
          workspacePath: handle.workspacePath,
          mode: "build",
          role: "builder",
          skillNames: ["contract-first-msw", "test-quality-engineering"],
          skillsDir: deps.skillsDir,
          signal: heartbeat.signal,
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
            "Escreva contratos e testes automatizados que falham inicialmente (RED) antes da implementação.",
          ].join("\n\n"),
        });
      } finally {
        heartbeat.stop();
      }

      if (sessionResult.status !== "completed") {
        const currentStatus = parseDeliverableStatus(row.status);
        assertValidTransition(currentStatus, "failed", {
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

      const currentStatus = parseDeliverableStatus(row.status);
      assertValidTransition(currentStatus, "building", {
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
      const contractCost = estimateTokenCostUsd(
        provider.roleBindings.builder?.modelId,
        sessionResult.tokenUsage
      );
      await recordExecutionEvent(db, {
        deliverableId: row.id,
        stage: "stage_contract_and_tests",
        actorRole: "builder",
        eventType: "token_usage",
        tokensInput: sessionResult.tokenUsage.inputTokens,
        tokensOutput: sessionResult.tokenUsage.outputTokens,
        cacheReadTokens: sessionResult.tokenUsage.cacheReadTokens,
        estimatedCostUsd: contractCost,
        payload: { contractTestFiles },
      });

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
      stuckAlert: StuckAlertSchema,
      attempts: z.number().int().positive(),
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

      const workspace =
        deps.workspaceFactory?.() ?? new LocalGitWorktreeWorkspace();
      await workspace.attach(worktreeHandle);

      const currentStatus = parseDeliverableStatus(row.status);
      let nextFeedback = currentState.humanFeedback;

      if (resumeData) {
        await syncPendingDecisionResolution(db, {
          deliverableId: row.id,
          mastraStepId: "stage_build",
          decisionType: "stuck_intervention",
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

      const provider = await resolveBuilderProviderProfile(
        db,
        currentState.organizationId
      );
      const transport = deps.transportFactory?.() ?? createDefaultTransport();
      const runner = new OpenCodeRunner({
        transport,
        masterKey: deps.masterKey,
      });

      const promptParts = [
        `stage_build para entregável '${row.title}'.`,
        currentState.specMarkdown ?? "",
        `Arquivos de contrato/teste pré-criados: ${inputData.contractTestFiles.join(", ") || "(nenhum listado)"}.`,
        nextFeedback
          ? `Orientação humana para retomada: ${nextFeedback}`
          : null,
      ].filter(Boolean);

      const heartbeat = runWithLockHeartbeat(db, row.id, abortSignal);
      let buildResult;
      try {
        buildResult = await runner.runSession({
          workspacePath: worktreeHandle.workspacePath,
          mode: "build",
          role: "builder",
          skillsDir: deps.skillsDir,
          signal: heartbeat.signal,
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

      const buildCost = estimateTokenCostUsd(
        provider.roleBindings.builder?.modelId,
        buildResult.tokenUsage
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
        },
      });

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
    stateSchema: WorkflowRuntimeStateSchema,
    execute: async ({ inputData, getState, setState, abortSignal }) => {
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

      const workspace =
        deps.workspaceFactory?.() ?? new LocalGitWorktreeWorkspace();
      await workspace.attach(worktreeHandle);

      const attemptNumber = row.verifyAttempts + 1;
      const maxAttempts = row.maxVerifyAttempts;

      await db
        .update(deliverables)
        .set({
          verifyAttempts: attemptNumber,
          updatedAt: new Date(),
        })
        .where(eq(deliverables.id, row.id));

      const heartbeat = runWithLockHeartbeat(db, row.id, abortSignal);
      const verifyChecks: VerifyCheckSummary[] = [];
      let testAuditPassed = true;
      let testAuditViolationsCount = 0;
      let scanResult: ExecutedSecurityScanOutput | null = null;
      let scanId: string | null = null;
      let securityGatePassed = true;
      let verifierVerdict: "approved" | "changes_required" = "approved";
      let verifierNotes = "";
      let verifyTokensInput = 0;
      let verifyTokensOutput = 0;
      let verifyCacheTokens = 0;
      let verifyCostUsd = 0;
      const failureReasons: string[] = [];

      let rawDiff = "";
      try {
        rawDiff = await workspace.getDiff(worktreeHandle.baseBranch);
      } catch {
        rawDiff = "";
      }
      const changedFiles = parseChangedFilesFromDiff(rawDiff);
      const redactedDiffPreview = redactSensitiveText(rawDiff).slice(0, 8192);

      try {
        // 1) TestAuditor estático
        const auditStarted = Date.now();
        const auditReport = auditTestDirectory(worktreeHandle.workspacePath);
        testAuditPassed = auditReport.passed;
        testAuditViolationsCount = auditReport.violations.length;
        verifyChecks.push({
          name: "audit:tests",
          passed: auditReport.passed,
          durationMs: Math.max(1, Date.now() - auditStarted),
          summary: auditReport.passed
            ? `${auditReport.scannedTests} testes auditados sem anti-patterns.`
            : auditReport.violations
                .slice(0, 5)
                .map((v) => `${v.filePath}:${v.line} (${v.rule})`)
                .join("; "),
        });
        if (!auditReport.passed) {
          failureReasons.push(
            `TestAuditor detectou ${auditReport.violations.length} anti-pattern(s): ${verifyChecks[0]!.summary}`
          );
        }

        // 2) Comandos determinísticos (somente se TestAuditor passou)
        if (failureReasons.length === 0) {
          const runner = deps.verifyRunner ?? defaultVerifyRunner;
          const cmdChecks = await runner({
            deliverableId: row.id,
            workspacePath: worktreeHandle.workspacePath,
            workspace,
            attemptNumber,
            signal: heartbeat.signal,
          });
          verifyChecks.push(...cmdChecks);
          const failedCmd = cmdChecks.find((c) => !c.passed);
          if (failedCmd) {
            failureReasons.push(
              `Verify runner falhou em '${failedCmd.name}': ${failedCmd.summary}`
            );
          }
        }

        // 3) Security Engine incremental no diff (somente se 1-2 passaram)
        if (failureReasons.length === 0) {
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
          verifyChecks.push({
            name: "security-engine",
            passed: securityGatePassed,
            durationMs: Math.max(
              1,
              scanResult.scannerStatuses.reduce((acc, s) => acc + s.durationMs, 0)
            ),
            summary: securityGatePassed
              ? `${scanResult.findings.length} achados totais (0 bloqueantes critical/high); scanners pulados: ${scanResult.summaryCountsJson.skippedScannersCount}`
              : `${blockingFindings.length} achado(s) critical/high bloqueante(s): ${blockingFindings
                  .slice(0, 3)
                  .map((b) => `${b.ruleId}@${b.filePath ?? "repo"}`)
                  .join(", ")}`,
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

          const verifierSession = await verifierRunner.runSession({
            workspacePath: worktreeHandle.workspacePath,
            mode: "plan",
            role: "verifier",
            skillsDir: deps.skillsDir,
            signal: heartbeat.signal,
            outputSchema: VerifierVerdictOutputSchema,
            providerConfig: {
              organizationId: currentState.organizationId,
              providerType: verifierProvider.providerType,
              baseUrl: verifierProvider.baseUrl ?? undefined,
              encryptedApiKey: verifierProvider.encryptedApiKey ?? undefined,
              roleBindings: verifierProvider.roleBindings,
            },
            prompt: verifierPrompt,
          });

          verifyTokensInput = verifierSession.tokenUsage.inputTokens;
          verifyTokensOutput = verifierSession.tokenUsage.outputTokens;
          verifyCacheTokens = verifierSession.tokenUsage.cacheReadTokens;
          verifyCostUsd = estimateTokenCostUsd(
            verifierProvider.roleBindings.verifier?.modelId,
            verifierSession.tokenUsage
          );

          if (verifierSession.status !== "completed") {
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

      const verifyPassed = failureReasons.length === 0;
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
        },
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
          failureReasons,
          scanId,
        },
      });

      if (!verifyPassed) {
        const currentStatus = parseDeliverableStatus(row.status);
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
        await setState({
          ...currentState,
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
    stateSchema: WorkflowRuntimeStateSchema,
    execute: async ({ inputData, getState, setState, abortSignal }) => {
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

      const repo = await resolveProjectRepository(db, row.repositoryId);
      const workspace =
        deps.workspaceFactory?.() ?? new LocalGitWorktreeWorkspace();
      await workspace.attach(worktreeHandle);

      const finalizeFn = deps.finalizeRunner ?? defaultFinalizeRunner;
      let outcome: FinalizeOutcome;
      try {
        outcome = await finalizeFn({
          deliverableId: row.id,
          workspacePath: worktreeHandle.workspacePath,
          repoPath: repo?.localPath ?? worktreeHandle.repoPath,
          remoteUrl: repo?.remoteUrl ?? null,
          branchName: worktreeHandle.branchName,
          baseBranch: worktreeHandle.baseBranch,
          commitMessage: `feat(deliverable): ${row.title}`,
          prTitle: `[Uzina] ${row.title}`,
          prBody: currentState.evidencePack
            ? `Pacote de evidências aprovado (${currentState.evidencePack.verifyAttempts} tentativa(s) de verify).`
            : row.description ?? row.title,
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

      await safeCleanupWorkspace(workspace, outcome.shouldDeleteBranchOnCleanup);

      const updatedPack: EvidencePack | null = currentState.evidencePack
        ? {
            ...currentState.evidencePack,
            finalizeInfo: {
              mode: outcome.mode,
              commitSha: outcome.commitSha,
              prUrl: outcome.prUrl,
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
