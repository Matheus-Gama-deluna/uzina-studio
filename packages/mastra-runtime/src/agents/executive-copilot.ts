import crypto from "node:crypto";
import fs from "node:fs";
import { Agent } from "@mastra/core/agent";
import type { MastraModelConfig } from "@mastra/core/llm";
import { RequestContext } from "@mastra/core/request-context";
import { createTool } from "@mastra/core/tools";
import type { Memory } from "@mastra/memory";
import {
  CopilotChatRequestSchema,
  type CopilotCapabilities,
  type CopilotChatRequest,
  type CopilotStreamEvent,
  type OrgRole,
} from "@uzina/contracts";
import {
  clients,
  decisions,
  deliverables,
  projectRepositories,
  projects,
  securityFindings,
  securityScans,
  type UzinaDb,
} from "@uzina/db";
import {
  runSecurityScan,
  type RunSecurityScanDeps,
} from "@uzina/security-engine";
import { redactSensitiveText, redactSensitiveValue } from "@uzina/core";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { WorkflowRuntimeError } from "../errors.js";
import {
  assertProjectBelongsToOrganization,
  assertThreadOwnershipOrCreate,
  buildCopilotResourceId,
  createUzinaMemory,
  mapDataOmStatusToContract,
} from "../memory-runtime.js";
import { resolveHierarchicalMemories } from "../memories.js";
import {
  collectOrganizationKnownSecrets,
  createTenantModelResolver,
  resolveOrganizationModelConfig,
} from "../model-resolver.js";
import {
  createUzinaErrorProcessors,
  createUzinaInputProcessors,
  createUzinaOutputProcessors,
} from "../processors.js";
import type { UzinaMastraStore } from "../storage.js";

export const EXECUTIVE_COPILOT_TOOL_IDS = [
  "read_workspace_overview",
  "draft_deliverable",
  "trigger_security_scan",
] as const;

export const EXECUTIVE_COPILOT_FORBIDDEN_CAPABILITIES = [
  "fs_write",
  "shell_exec",
  "git_commit_or_push",
  "status_merged_without_decision",
] as const;

const WRITE_ROLES = new Set<OrgRole>(["owner", "admin", "developer"]);

export interface ExecutiveCopilotDeps {
  db: UzinaDb;
  securityRunnerDeps?: RunSecurityScanDeps;
  masterKey?: Buffer | string | null;
  memory?: Memory;
  modelOverride?: MastraModelConfig;
  knownSecrets?: readonly string[];
  providerType?: string;
  onTailFlushed?: (flushedTail: string) => void;
}

export interface CopilotExecutionActor {
  organizationId: string;
  userId: string;
  role: OrgRole;
}

export interface WorkspaceOverviewSummary {
  clientsCount: number;
  projectsCount: number;
  deliverablesCount: number;
  pendingDecisionsCount: number;
  scansCount: number;
  memoriesCount: number;
  recentDeliverables: Array<{
    id: string;
    title: string;
    status: string;
    projectId: string;
  }>;
  pendingDecisions: Array<{
    id: string;
    decisionType: string;
    summary: string;
  }>;
  memories: Array<{
    id: string;
    scopeType: string;
    category: string;
    title: string;
  }>;
}

export async function readWorkspaceOverviewScoped(
  db: UzinaDb,
  params: {
    organizationId: string;
    clientId?: string;
    projectId?: string;
  }
): Promise<WorkspaceOverviewSummary> {
  const orgClients = await db
    .select()
    .from(clients)
    .where(eq(clients.organizationId, params.organizationId));

  const filteredClients = params.clientId
    ? orgClients.filter((c) => c.id === params.clientId)
    : orgClients;

  const clientIds = filteredClients.map((c) => c.id);
  const orgProjects =
    clientIds.length > 0
      ? await db
          .select()
          .from(projects)
          .where(inArray(projects.clientId, clientIds))
      : [];

  const filteredProjects = params.projectId
    ? orgProjects.filter((p) => p.id === params.projectId)
    : orgProjects;

  const projectIds = filteredProjects.map((p) => p.id);
  const delivs =
    projectIds.length > 0
      ? await db
          .select()
          .from(deliverables)
          .where(inArray(deliverables.projectId, projectIds))
          .orderBy(desc(deliverables.updatedAt))
          .limit(20)
      : [];

  const delivIds = delivs.map((d) => d.id);
  const pendingDecs =
    delivIds.length > 0
      ? await db
          .select()
          .from(decisions)
          .where(
            and(
              inArray(decisions.deliverableId, delivIds),
              eq(decisions.status, "pending")
            )
          )
          .orderBy(desc(decisions.createdAt))
          .limit(20)
      : [];

  const scans = await db
    .select()
    .from(securityScans)
    .where(eq(securityScans.organizationId, params.organizationId))
    .orderBy(desc(securityScans.createdAt))
    .limit(10);

  const scopedMemories = await resolveHierarchicalMemories(db, {
    organizationId: params.organizationId,
    clientId: params.clientId,
    projectId: params.projectId,
    limit: 20,
  });

  return {
    clientsCount: filteredClients.length,
    projectsCount: filteredProjects.length,
    deliverablesCount: delivs.length,
    pendingDecisionsCount: pendingDecs.length,
    scansCount: scans.length,
    memoriesCount: scopedMemories.length,
    recentDeliverables: delivs.slice(0, 5).map((d) => ({
      id: d.id,
      title: d.title,
      status: d.status,
      projectId: d.projectId,
    })),
    pendingDecisions: pendingDecs.slice(0, 5).map((d) => ({
      id: d.id,
      decisionType: d.decisionType,
      summary: redactSensitiveText(d.summary),
    })),
    memories: scopedMemories.slice(0, 8).map((m) => ({
      id: m.id,
      scopeType: m.scopeType,
      category: m.category,
      title: redactSensitiveText(m.title),
    })),
  };
}

export async function createDraftDeliverableScoped(
  db: UzinaDb,
  params: {
    actor: CopilotExecutionActor;
    projectId: string;
    title: string;
    description?: string;
    hasUi?: boolean;
  }
): Promise<{
  id: string;
  projectId: string;
  title: string;
  status: "discovery";
}> {
  if (!WRITE_ROLES.has(params.actor.role)) {
    throw new Error(
      "Permissão insuficiente: perfil auditor não pode criar rascunho de entrega."
    );
  }

  const [proj] = await db
    .select({ id: projects.id })
    .from(projects)
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(
      and(
        eq(projects.id, params.projectId),
        eq(clients.organizationId, params.actor.organizationId)
      )
    )
    .limit(1);

  if (!proj) {
    throw new Error("Projeto informado não pertence à organização.");
  }

  const [created] = await db
    .insert(deliverables)
    .values({
      projectId: proj.id,
      title: params.title.trim(),
      description: params.description?.trim() ?? null,
      hasUi: params.hasUi ?? false,
      status: "discovery",
    })
    .returning();

  return {
    id: created!.id,
    projectId: created!.projectId,
    title: created!.title,
    status: "discovery",
  };
}

export async function triggerSecurityScanScoped(
  db: UzinaDb,
  params: {
    actor: CopilotExecutionActor;
    projectId: string;
    securityRunnerDeps?: RunSecurityScanDeps;
  }
): Promise<{
  scanId: string;
  totalFindings: number;
  critical: number;
  high: number;
}> {
  if (!WRITE_ROLES.has(params.actor.role)) {
    throw new Error(
      "Permissão insuficiente: perfil auditor não pode disparar scan de segurança."
    );
  }

  const [proj] = await db
    .select({ id: projects.id })
    .from(projects)
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(
      and(
        eq(projects.id, params.projectId),
        eq(clients.organizationId, params.actor.organizationId)
      )
    )
    .limit(1);

  if (!proj) {
    throw new Error("Projeto informado não pertence à organização.");
  }

  const [repo] = await db
    .select()
    .from(projectRepositories)
    .where(eq(projectRepositories.projectId, proj.id))
    .limit(1);

  if (!repo || !fs.existsSync(/*turbopackIgnore: true*/ repo.localPath)) {
    throw new Error(
      "Projeto não possui repositório local válido disponível para scan."
    );
  }

  const output = await runSecurityScan(
    {
      mode: "standalone",
      targetType: "git_repo",
      targetPath: repo.localPath,
      targetRef: repo.defaultBranch || "main",
      triage: true,
    },
    params.securityRunnerDeps
  );

  const [savedScan] = await db
    .insert(securityScans)
    .values({
      organizationId: params.actor.organizationId,
      projectId: proj.id,
      deliverableId: null,
      mode: output.mode,
      targetType: output.targetType,
      targetRef: output.targetRef,
      scannersRun: output.scannersRun,
      scannerStatusesJson: output.scannerStatuses,
      sarifRawJson: output.sarifRawJson,
      summaryCountsJson: output.summaryCountsJson,
      status: output.status,
    })
    .returning();

  if (output.findings.length > 0) {
    await db.insert(securityFindings).values(
      output.findings.map((f) => ({
        scanId: savedScan!.id,
        projectId: proj.id,
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

  return {
    scanId: savedScan!.id,
    totalFindings: output.summaryCountsJson.total,
    critical: output.summaryCountsJson.critical,
    high: output.summaryCountsJson.high,
  };
}

function resolveTrustedCopilotActor(
  context?: { requestContext?: { get?: (key: string) => unknown } }
): CopilotExecutionActor {
  const fromContext = context?.requestContext?.get?.("actor");
  if (
    fromContext &&
    typeof fromContext === "object" &&
    "organizationId" in fromContext &&
    "userId" in fromContext &&
    "role" in fromContext
  ) {
    return fromContext as CopilotExecutionActor;
  }
  throw new Error(
    "COPILOT_ACTOR_REQUIRED: ator autenticado deve ser injetado via RequestContext do servidor."
  );
}

export function createExecutiveCopilotAgent(deps: ExecutiveCopilotDeps) {
  const resolver = createTenantModelResolver({
    db: deps.db,
    masterKey: deps.masterKey,
    modelOverride: deps.modelOverride,
  });

  const readOverviewTool = createTool({
    id: "read_workspace_overview",
    description:
      "Lê clientes, projetos, entregáveis, decisões pendentes, auditorias AppSec e memórias hierárquicas da organização.",
    inputSchema: z.object({
      clientId: z.uuid().optional(),
      projectId: z.uuid().optional(),
    }),
    execute: async (inputData, context) => {
      const actor = resolveTrustedCopilotActor(context);
      return readWorkspaceOverviewScoped(deps.db, {
        organizationId: actor.organizationId,
        clientId: inputData.clientId,
        projectId: inputData.projectId,
      });
    },
  });

  const draftDeliverableTool = createTool({
    id: "draft_deliverable",
    description:
      "Cria exclusivamente um rascunho de entregável no estágio inicial 'discovery'.",
    inputSchema: z.object({
      projectId: z.uuid(),
      title: z.string().trim().min(3).max(200),
      description: z.string().trim().max(4000).optional(),
      hasUi: z.boolean().optional(),
    }),
    execute: async (inputData, context) => {
      const actor = resolveTrustedCopilotActor(context);
      return createDraftDeliverableScoped(deps.db, {
        actor,
        projectId: inputData.projectId,
        title: inputData.title,
        description: inputData.description,
        hasUi: inputData.hasUi,
      });
    },
  });

  const triggerSecurityScanTool = createTool({
    id: "trigger_security_scan",
    description:
      "Dispara uma auditoria de segurança @uzina/security-engine sobre um projeto da organização.",
    inputSchema: z.object({
      projectId: z.uuid(),
    }),
    execute: async (inputData, context) => {
      const actor = resolveTrustedCopilotActor(context);
      return triggerSecurityScanScoped(deps.db, {
        actor,
        projectId: inputData.projectId,
        securityRunnerDeps: deps.securityRunnerDeps,
      });
    },
  });

  const dynamicModel:
    | MastraModelConfig
    | (({
        requestContext,
      }: {
        requestContext: { get: (key: string) => unknown };
      }) => Promise<MastraModelConfig>) = deps.modelOverride
    ? deps.modelOverride
    : async ({ requestContext }) => {
        const actor = requestContext.get("actor") as
          | { organizationId?: string }
          | undefined;
        const orgId = actor?.organizationId;
        if (!orgId) {
          throw new Error(
            "COPILOT_ORG_REQUIRED: organizationId ausente no RequestContext."
          );
        }
        const resolved = await resolver.resolveForRole(orgId, "orchestrator");
        if (!resolved) {
          throw new Error(
            "COPILOT_PROVIDER_UNAVAILABLE: Organização sem provedor LLM ativo."
          );
        }
        return resolved.mastraModel.model;
      };

  const tools = {
    read_workspace_overview: readOverviewTool,
    draft_deliverable: draftDeliverableTool,
    trigger_security_scan: triggerSecurityScanTool,
  };

  return new Agent({
    id: "executive_copilot",
    name: "Co-piloto Executivo Uzina Studio",
    instructions: [
      "Você é o Co-piloto Executivo da Uzina Studio.",
      "Responda sempre em português do Brasil com base objetiva nos dados do workspace.",
      "Você só possui acesso de leitura ao workspace, criação de rascunho de entrega ('discovery') e disparo de scan de segurança.",
      "Você NÃO escreve arquivos em disco, NÃO executa comandos shell/git e NÃO altera status para 'merged'.",
    ].join("\n"),
    model: dynamicModel as MastraModelConfig,
    tools,
    memory: deps.memory,
    inputProcessors: createUzinaInputProcessors({
      knownSecrets: deps.knownSecrets,
      toolsCatalog: tools,
      providerType: deps.providerType,
    }),
    outputProcessors: createUzinaOutputProcessors({
      knownSecrets: deps.knownSecrets,
      onTailFlushed: deps.onTailFlushed,
    }),
    errorProcessors: createUzinaErrorProcessors(),
  });
}

export function getExecutiveCopilotCapabilities(
  actorRole: OrgRole
): CopilotCapabilities {
  return {
    agentId: "executive_copilot",
    allowedTools: [...EXECUTIVE_COPILOT_TOOL_IDS],
    forbiddenCapabilities: [...EXECUTIVE_COPILOT_FORBIDDEN_CAPABILITIES],
    actorRole,
  };
}

export async function* streamExecutiveCopilot(params: {
  db: UzinaDb;
  actor: CopilotExecutionActor;
  request: CopilotChatRequest;
  securityRunnerDeps?: RunSecurityScanDeps;
  signal?: AbortSignal;
  masterKey?: Buffer | string | null;
  dataDir?: string;
  databaseUrl?: string;
  storage?: UzinaMastraStore;
  modelOverride?: MastraModelConfig;
}): AsyncIterable<CopilotStreamEvent> {
  const parsedReq = CopilotChatRequestSchema.parse(params.request);
  const toolsUsed: string[] = [];

  if (params.signal?.aborted) {
    yield {
      type: "done",
      toolsUsed,
      finishReason: "aborted",
    };
    return;
  }

  let settledFn: (() => Promise<void>) | undefined;
  let knownSecrets: string[] = [];

  try {
    const targetProjectId = parsedReq.projectId ?? parsedReq.action?.projectId;
    if (targetProjectId) {
      await assertProjectBelongsToOrganization(
        params.db,
        targetProjectId,
        params.actor.organizationId
      );
    }
    if (
      parsedReq.action?.projectId &&
      parsedReq.action.projectId !== targetProjectId
    ) {
      await assertProjectBelongsToOrganization(
        params.db,
        parsedReq.action.projectId,
        params.actor.organizationId
      );
    }

    const resolvedModel = params.modelOverride
      ? null
      : await resolveOrganizationModelConfig(params.db, {
          organizationId: params.actor.organizationId,
          agentRole: "orchestrator",
          masterKey: params.masterKey,
        });

    const orgSecrets = await collectOrganizationKnownSecrets(params.db, {
      organizationId: params.actor.organizationId,
      masterKey: params.masterKey,
    });
    knownSecrets = Array.from(
      new Set([...orgSecrets, ...(resolvedModel?.knownSecrets ?? [])])
    );
    const canUseLiveLlm = Boolean(params.modelOverride || resolvedModel);

    const { memory, settle } = await createUzinaMemory({
      db: params.db,
      storage: params.storage,
      dataDir: params.dataDir,
      databaseUrl: params.databaseUrl,
      masterKey: params.masterKey,
      observationalMemoryEnabled: canUseLiveLlm,
      modelOverride: params.modelOverride,
    });
    settledFn = settle;

    const resourceId = buildCopilotResourceId(
      params.actor.organizationId,
      targetProjectId
    );
    const lastUserMessage =
      [...parsedReq.messages].reverse().find((m) => m.role === "user")
        ?.content ?? parsedReq.messages[parsedReq.messages.length - 1]!.content;

    const threadId = await assertThreadOwnershipOrCreate({
      memory,
      resourceId,
      requestedThreadId: parsedReq.threadId,
      title: lastUserMessage.slice(0, 80),
    });

    // Ações explícitas estruturadas via botões da UI executam deterministicamente antes
    const actionSummaries: string[] = [];
    if (parsedReq.action?.type === "draft_deliverable") {
      if (!parsedReq.action.projectId || !parsedReq.action.title) {
        yield {
          type: "error",
          code: "INVALID_ACTION",
          message:
            "Informe projectId e title para criar rascunho de entregável.",
        };
        return;
      }

      const draftInput = {
        projectId: parsedReq.action.projectId,
        title: parsedReq.action.title,
        description: parsedReq.action.description,
        hasUi: parsedReq.action.hasUi,
      };
      yield {
        type: "tool_call",
        toolName: "draft_deliverable",
        input: redactSensitiveValue(
          draftInput,
          knownSecrets
        ) as Record<string, unknown>,
      };
      const created = await createDraftDeliverableScoped(params.db, {
        actor: params.actor,
        ...draftInput,
      });
      toolsUsed.push("draft_deliverable");
      yield {
        type: "tool_result",
        toolName: "draft_deliverable",
        output: redactSensitiveValue(
          created,
          knownSecrets
        ) as Record<string, unknown>,
      };
      actionSummaries.push(
        `Rascunho criado em 'discovery': "${created.title}" (ID: ${created.id}).`
      );
    }

    if (parsedReq.action?.type === "trigger_security_scan") {
      const scanProjectId =
        parsedReq.action.projectId ?? parsedReq.projectId;
      if (!scanProjectId) {
        yield {
          type: "error",
          code: "INVALID_ACTION",
          message: "Informe projectId para disparar auditoria de segurança.",
        };
        return;
      }

      yield {
        type: "tool_call",
        toolName: "trigger_security_scan",
        input: { projectId: scanProjectId },
      };
      const scanSummary = await triggerSecurityScanScoped(params.db, {
        actor: params.actor,
        projectId: scanProjectId,
        securityRunnerDeps: params.securityRunnerDeps,
      });
      toolsUsed.push("trigger_security_scan");
      yield {
        type: "tool_result",
        toolName: "trigger_security_scan",
        output: redactSensitiveValue(
          scanSummary,
          knownSecrets
        ) as Record<string, unknown>,
      };
      actionSummaries.push(
        `Auditoria de segurança disparada (Scan ${scanSummary.scanId}): ${scanSummary.totalFindings} achado(s), Críticos: ${scanSummary.critical}, Altos: ${scanSummary.high}.`
      );
    }

    if (canUseLiveLlm) {
      let emittedTextChars = 0;
      let liveStreamAborted = false;
      let fallbackToLocal = false;

      try {
        const resolver = createTenantModelResolver({
          db: params.db,
          masterKey: params.masterKey,
          modelOverride: params.modelOverride,
        });
        const availableProviders = await resolver.preloadOrganizationProviders(
          params.actor.organizationId
        );

        const flushedTails: string[] = [];
        const agent = createExecutiveCopilotAgent({
          db: params.db,
          securityRunnerDeps: params.securityRunnerDeps,
          masterKey: params.masterKey,
          memory,
          modelOverride: params.modelOverride ?? resolvedModel?.mastraModel.model,
          knownSecrets,
          providerType: resolvedModel?.providerType,
          onTailFlushed: (tail) => {
            flushedTails.push(tail);
          },
        });

        const rc = new RequestContext();
        rc.set("actor", params.actor);
        if (targetProjectId) rc.set("projectId", targetProjectId);
        rc.set("availableProviders", availableProviders);

        const promptWithActionContext =
          actionSummaries.length > 0
            ? `${lastUserMessage}\n\n[Ações já executadas nesta chamada]:\n${actionSummaries.join("\n")}`
            : lastUserMessage;

        const streamResult = await agent.stream(promptWithActionContext, {
          memory: { thread: threadId, resource: resourceId },
          requestContext: rc,
          abortSignal: params.signal,
          maxSteps: 4,
        });

        for await (const chunk of streamResult.fullStream) {
          if (params.signal?.aborted) {
            liveStreamAborted = true;
            break;
          }

          if (chunk.type === "tool-call") {
            const toolName = chunk.payload.toolName;
            if (!toolsUsed.includes(toolName)) {
              toolsUsed.push(toolName);
            }
            const rawInput =
              chunk.payload.args && typeof chunk.payload.args === "object"
                ? (chunk.payload.args as Record<string, unknown>)
                : {};
            yield {
              type: "tool_call",
              toolName,
              input: redactSensitiveValue(
                rawInput,
                knownSecrets
              ) as Record<string, unknown>,
            };
          } else if (chunk.type === "tool-result") {
            const outObj =
              chunk.payload.result && typeof chunk.payload.result === "object"
                ? (chunk.payload.result as Record<string, unknown>)
                : { result: chunk.payload.result };
            yield {
              type: "tool_result",
              toolName: chunk.payload.toolName,
              output: redactSensitiveValue(
                outObj,
                knownSecrets
              ) as Record<string, unknown>,
            };
          } else if (chunk.type === "text-delta") {
            const safeDelta = redactSensitiveText(
              chunk.payload.text,
              knownSecrets
            );
            if (safeDelta.length > 0) {
              emittedTextChars += safeDelta.length;
              yield { type: "token", text: safeDelta };
            }
          } else if (chunk.type === "data-om-status") {
            const omStatus = mapDataOmStatusToContract(
              (chunk as { data?: unknown }).data
            );
            if (omStatus) {
              yield { type: "om_status", status: omStatus };
            }
          } else if (chunk.type === "error") {
            if (emittedTextChars === 0 && !params.modelOverride) {
              fallbackToLocal = true;
              break;
            }
            const errText =
              chunk.payload.error instanceof Error
                ? chunk.payload.error.message
                : String(chunk.payload.error ?? "Erro no stream do Co-piloto");
            yield {
              type: "error",
              code: "COPILOT_STREAM_ERROR",
              message: redactSensitiveText(errText, knownSecrets),
            };
            return;
          }
        }

        if (liveStreamAborted) {
          yield {
            type: "done",
            toolsUsed,
            finishReason: "aborted",
            threadId,
            executionMode: "live_llm",
          };
          return;
        }

        for (const tail of flushedTails) {
          if (tail.length > 0) {
            emittedTextChars += tail.length;
            yield { type: "token", text: tail };
          }
        }

        if (!fallbackToLocal) {
          if (emittedTextChars === 0) {
            const finalText = redactSensitiveText(
              await streamResult.text,
              knownSecrets
            );
            if (finalText.trim().length > 0) {
              emittedTextChars += finalText.length;
              yield { type: "token", text: finalText };
            }
          }

          if (emittedTextChars > 0 || params.modelOverride) {
            yield {
              type: "done",
              toolsUsed,
              finishReason: "completed",
              threadId,
              executionMode: "live_llm",
            };
            return;
          }
          fallbackToLocal = true;
        }
      } catch (liveErr) {
        if (emittedTextChars > 0 || params.modelOverride) {
          const msg =
            liveErr instanceof Error
              ? liveErr.message
              : "Erro ao executar stream do Co-piloto.";
          yield {
            type: "error",
            code: "COPILOT_STREAM_ERROR",
            message: redactSensitiveText(msg, knownSecrets),
          };
          return;
        }
        fallbackToLocal = true;
      }

      if (!fallbackToLocal) {
        return;
      }
    }

    // Fallback determinístico offline (`local_assisted`) quando sem provedor configurado
    const overviewInput = {
      organizationId: params.actor.organizationId,
      clientId: parsedReq.clientId,
      projectId: targetProjectId,
    };

    yield {
      type: "tool_call",
      toolName: "read_workspace_overview",
      input: overviewInput,
    };
    const overview = await readWorkspaceOverviewScoped(params.db, overviewInput);
    toolsUsed.push("read_workspace_overview");
    yield {
      type: "tool_result",
      toolName: "read_workspace_overview",
      output: {
        clientsCount: overview.clientsCount,
        projectsCount: overview.projectsCount,
        deliverablesCount: overview.deliverablesCount,
        pendingDecisionsCount: overview.pendingDecisionsCount,
        scansCount: overview.scansCount,
        memoriesCount: overview.memoriesCount,
        recentDeliverables: overview.recentDeliverables,
        pendingDecisions: overview.pendingDecisions,
        memories: overview.memories,
      },
    };

    const chunks: string[] = [
      `Resumo Executivo: ${overview.clientsCount} cliente(s), ${overview.projectsCount} projeto(s), ${overview.deliverablesCount} entrega(s), ${overview.pendingDecisionsCount} decisão(ões) pendente(s), ${overview.scansCount} scan(s) AppSec e ${overview.memoriesCount} memória(s) ativa(s) no escopo.`,
    ];

    if (overview.pendingDecisions.length > 0) {
      chunks.push(
        `\nPendências HITL:\n${overview.pendingDecisions
          .map((d) => `• [${d.decisionType}] ${d.summary}`)
          .join("\n")}`
      );
    }

    if (overview.memories.length > 0) {
      chunks.push(
        `\nMemórias aplicáveis:\n${overview.memories
          .map((m) => `• [${m.scopeType}/${m.category}] ${m.title}`)
          .join("\n")}`
      );
    }

    if (actionSummaries.length > 0) {
      chunks.push(`\n${actionSummaries.join("\n")}`);
    }

    const fullText = redactSensitiveText(chunks.join("\n"), knownSecrets);
    await memory.saveMessages({
      messages: [
        {
          id: crypto.randomUUID(),
          role: "user",
          threadId,
          resourceId,
          createdAt: new Date(),
          content: {
            format: 2,
            parts: [
              {
                type: "text",
                text: redactSensitiveText(lastUserMessage, knownSecrets),
              },
            ],
          },
        },
        {
          id: crypto.randomUUID(),
          role: "assistant",
          threadId,
          resourceId,
          createdAt: new Date(),
          content: {
            format: 2,
            parts: [{ type: "text", text: fullText }],
            metadata: {
              executionMode: "local_assisted",
              toolsUsed,
            },
          },
        },
      ],
    });

    const sentences = fullText.split(/(?<=\.)\s+|\n+/);
    for (const part of sentences) {
      if (params.signal?.aborted) {
        yield {
          type: "done",
          toolsUsed,
          finishReason: "aborted",
          threadId,
          executionMode: "local_assisted",
        };
        return;
      }
      if (part.trim().length > 0) {
        yield { type: "token", text: `${part}\n` };
      }
    }

    yield {
      type: "done",
      toolsUsed,
      finishReason: "completed",
      threadId,
      executionMode: "local_assisted",
    };
  } catch (error) {
    const rawMsg =
      error instanceof Error
        ? error.message
        : "Erro ao executar Co-piloto Executivo.";
    const safeMsg = redactSensitiveText(
      rawMsg.replace(/[A-Za-z]:\\[^\s]+|\/[^\s]+\/[^\s]+/g, "[path]"),
      knownSecrets
    );
    yield {
      type: "error",
      code:
        error instanceof WorkflowRuntimeError
          ? error.code
          : "COPILOT_EXECUTION_ERROR",
      message: safeMsg,
    };
  } finally {
    if (settledFn) {
      void settledFn().catch(() => undefined);
    }
  }
}
