import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import {
  DeliverableStatusSchema,
  DesignAssetSchema,
  DevelopmentStrategySchema,
  DiscoveryAnswerSchema,
  DiscoveryRoundSchema,
  StrategyRouterOutputSchema,
  StuckAlertSchema,
  WorkflowGateTypeSchema,
  WorkflowResumeInputSchema,
  WorktreeHandleSchema,
  type DeliverableStatus,
  type DesignAsset,
  type DevelopmentStrategy,
  type DiscoveryAnswer,
  type DiscoveryRound,
  type ProviderType,
  type RoleBindings,
  type StrategyRouterOutput,
  type WorktreeHandle,
} from "@uzina/contracts";
import {
  assertPathInsideWorkspace,
  assertValidTransition,
  buildDiscoveryQuestions,
  consolidateDiscoverySummary,
  generateDesignMdContract,
  routeDevelopmentStrategy,
  scanRepositoryBrownfield,
} from "@uzina/core";
import {
  deliverables,
  designAssets,
  projectRepositories,
  projects,
  providerProfiles,
  renewDeliverableLock,
  type UzinaDb,
} from "@uzina/db";
import {
  LocalGitWorktreeWorkspace,
  OpenCodeRunner,
  SdkOpenCodeTransport,
  type ExecutionWorkspace,
  type OpenCodeTransport,
} from "@uzina/opencode-bridge";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { WorkflowRuntimeError } from "../errors.js";

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

export const DeliverableLifecycleOutputSchema = z.object({
  rejected: z.boolean().default(false),
  deliverableId: z.string(),
  deliverableStatus: DeliverableStatusSchema,
  worktreeHandle: WorktreeHandleSchema.nullable().optional(),
  contractTestFiles: z.array(z.string()).default([]),
  stageHistory: z.array(z.string()).default([]),
});

export interface DeliverableWorkflowDeps {
  db: UzinaDb;
  masterKey?: Buffer;
  workspaceFactory?: () => ExecutionWorkspace;
  transportFactory?: () => OpenCodeTransport;
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
): Promise<{ id: string; localPath: string; defaultBranch: string } | null> {
  if (!repositoryId) return null;
  const [repo] = await db
    .select({
      id: projectRepositories.id,
      localPath: projectRepositories.localPath,
      defaultBranch: projectRepositories.defaultBranch,
    })
    .from(projectRepositories)
    .where(eq(projectRepositories.id, repositoryId))
    .limit(1);
  return repo ?? null;
}

async function resolveBuilderProviderProfile(
  db: UzinaDb,
  organizationId: string
): Promise<{
  id: string;
  providerType: ProviderType;
  baseUrl: string | null;
  encryptedApiKey: string | null;
  roleBindings: RoleBindings;
}> {
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

        return suspend({
          gate: "discovery_confirm",
          roundNumber: 1,
          round: round1,
          hasUi: nextState.hasUi,
        });
      }

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

        return suspend({
          gate: "blueprint_approve",
          blueprint,
          hasUi: inputData.hasUi,
        });
      }

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

        return suspend({
          gate: "visual_approve",
          designMdContent: markdown,
          assetCount,
        });
      }

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
    outputSchema: z.object({
      deliverableId: z.string(),
      worktreeHandle: WorktreeHandleSchema,
      contractTestFiles: z.array(z.string()),
    }),
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

      await setState({
        ...currentState,
        worktreeHandle: handle,
        contractTestFiles,
        stageHistory: appendStageHistory(
          currentState.stageHistory,
          "stage_contract_and_tests"
        ),
      });

      return {
        deliverableId: row.id,
        worktreeHandle: handle,
        contractTestFiles,
      };
    },
  });

  const stageBuild = createStep({
    id: "stage_build",
    description:
      "Implementa o entregável no mesmo worktree (via attach()) com intervenção humana em loop caso StuckDetector dispare.",
    inputSchema: z.object({
      deliverableId: z.string(),
      worktreeHandle: WorktreeHandleSchema,
      contractTestFiles: z.array(z.string()),
    }),
    outputSchema: DeliverableLifecycleOutputSchema,
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

      const worktreeHandle: WorktreeHandle =
        currentState.worktreeHandle ?? inputData.worktreeHandle;
      const workspace =
        deps.workspaceFactory?.() ?? new LocalGitWorktreeWorkspace();
      await workspace.attach(worktreeHandle);

      const currentStatus = parseDeliverableStatus(row.status);
      let nextFeedback = currentState.humanFeedback;

      if (resumeData) {
        if (resumeData.decision === "rejected") {
          await workspace.cleanup({ deleteBranch: true });
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
              updatedAt: new Date(),
            })
            .where(eq(deliverables.id, row.id));

          const nextHistory = appendStageHistory(
            currentState.stageHistory,
            "stage_build"
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
            worktreeHandle: null,
            contractTestFiles: inputData.contractTestFiles,
            stageHistory: nextHistory,
          });
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
          stageHistory: nextHistory,
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
        stageHistory: nextHistory,
      });

      return {
        rejected: false,
        deliverableId: row.id,
        deliverableStatus: "verifying" as const,
        worktreeHandle,
        contractTestFiles: inputData.contractTestFiles,
        stageHistory: nextHistory,
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
    .then(stageBuild)
    .commit();
}
