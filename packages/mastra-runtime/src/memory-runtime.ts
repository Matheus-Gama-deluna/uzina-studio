import { Memory } from "@mastra/memory";
import type { MastraDBMessage } from "@mastra/core/agent";
import type { MastraModelConfig } from "@mastra/core/llm";
import { z } from "zod";
import {
  AgencyActionExecutedSchema,
  AgencyAgentRoleSchema,
  AgencyThreadListResponseSchema,
  AgencyWorkingMemorySchema,
  type AgencyThreadListResponse,
  type AgencyThreadMessageItem,
  type AgencyThreadSummary,
  type ObservationalMemoryStatus,
} from "@uzina/contracts";
import { redactSensitiveText } from "@uzina/core";
import { clients, projects, type UzinaDb } from "@uzina/db";
import { and, eq } from "drizzle-orm";
import { WorkflowRuntimeError } from "./errors.js";
import { recordTokenSavingsEventScoped } from "./finops.js";
import {
  collectOrganizationKnownSecrets,
  createTenantModelResolver,
} from "./model-resolver.js";
import { redactMastraDbMessage } from "./processors.js";
import {
  getMastraStorageSingleton,
  registerMemorySettleHook,
  type UzinaMastraStore,
} from "./storage.js";

export const DEFAULT_OM_MESSAGE_TOKENS = 20_000;
export const DEFAULT_OM_OBSERVATION_TOKENS = 40_000;

export function buildAgencyResourceId(
  organizationId: string,
  projectId?: string | null
): string {
  return `uzina:agency:org:${organizationId}:project:${projectId ?? "global"}`;
}

export function buildCopilotResourceId(
  organizationId: string,
  projectId?: string | null
): string {
  return `uzina:copilot:org:${organizationId}:project:${projectId ?? "global"}`;
}

export async function assertProjectBelongsToOrganization(
  db: UzinaDb,
  projectId: string,
  organizationId: string
): Promise<{ id: string; name: string }> {
  const [row] = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(
      and(
        eq(projects.id, projectId),
        eq(clients.organizationId, organizationId)
      )
    )
    .limit(1);

  if (!row) {
    throw new WorkflowRuntimeError({
      statusCode: 403,
      code: "FORBIDDEN_PROJECT_SCOPE",
      message: "Projeto não encontrado ou não pertence à organização atual.",
    });
  }

  return row;
}

export interface CreateUzinaMemoryOptions {
  storage?: UzinaMastraStore;
  dataDir?: string;
  databaseUrl?: string;
  db: UzinaDb;
  masterKey?: Buffer | string | null;
  observationalMemoryEnabled?: boolean;
  workingMemoryEnabled?: boolean;
  bufferTokens?: number | false;
  observationMessageTokens?: number;
  observationTokens?: number;
  modelOverride?: MastraModelConfig;
}

export async function createUzinaMemory(
  options: CreateUzinaMemoryOptions
): Promise<{
  memory: Memory;
  storage: UzinaMastraStore;
  settle: () => Promise<void>;
}> {
  const storage =
    options.storage ??
    (await getMastraStorageSingleton({
      dataDir: options.dataDir,
      databaseUrl: options.databaseUrl,
    }));

  const resolver = createTenantModelResolver({
    db: options.db,
    masterKey: options.masterKey,
    modelOverride: options.modelOverride,
  });

  const omEnabled = options.observationalMemoryEnabled ?? true;

  const memory = new Memory({
    storage,
    options: {
      lastMessages: 24,
      ...(options.workingMemoryEnabled !== false
        ? {
            workingMemory: {
              enabled: true,
              scope: "resource" as const,
              schema: AgencyWorkingMemorySchema,
            },
          }
        : {}),
      observationalMemory: omEnabled
        ? {
            enabled: true,
            canUseProvider: (providerId, { requestContext }) => {
              const avail = requestContext?.get("availableProviders");
              if (avail instanceof Set) {
                return avail.has(providerId);
              }
              return false;
            },
            resolveModel: async (modelId, { requestContext }) => {
              if (options.modelOverride) {
                return options.modelOverride;
              }
              const actor = requestContext?.get("actor") as
                | { organizationId?: string }
                | undefined;
              const orgId = actor?.organizationId;
              if (!orgId) {
                throw new Error(
                  "OM_ORG_MISSING: organizationId ausente no RequestContext."
                );
              }
              return resolver.resolveOmModel(orgId, modelId);
            },
            observation: {
              messageTokens:
                options.observationMessageTokens ?? DEFAULT_OM_MESSAGE_TOKENS,
              bufferTokens:
                options.bufferTokens === undefined ? 0.25 : options.bufferTokens,
              bufferOnIdle: false,
              observeOnContextOverflow: true,
              threadTitle: true,
              failurePolicy: "continue",
            },
            reflection: {
              observationTokens:
                options.observationTokens ?? DEFAULT_OM_OBSERVATION_TOKENS,
              failurePolicy: "continue",
            },
            hooks: {
              beforeObservation: async ({ messages, resourceId }) => {
                const orgMatch = resourceId?.match(/:org:([^:]+):/);
                const secrets = orgMatch?.[1]
                  ? await collectOrganizationKnownSecrets(options.db, {
                      organizationId: orgMatch[1],
                      masterKey: options.masterKey,
                    })
                  : [];
                return {
                  messages: messages.map((m) =>
                    redactMastraDbMessage(m, secrets)
                  ),
                };
              },
              afterObservation: async ({ observations, resourceId }) => {
                const orgMatch = resourceId?.match(/:org:([^:]+):/);
                const secrets = orgMatch?.[1]
                  ? await collectOrganizationKnownSecrets(options.db, {
                      organizationId: orgMatch[1],
                      masterKey: options.masterKey,
                    })
                  : [];
                return {
                  observations: redactSensitiveText(observations, secrets),
                };
              },
              beforeReflection: async ({ observations, resourceId }) => {
                const orgMatch = resourceId?.match(/:org:([^:]+):/);
                const secrets = orgMatch?.[1]
                  ? await collectOrganizationKnownSecrets(options.db, {
                      organizationId: orgMatch[1],
                      masterKey: options.masterKey,
                    })
                  : [];
                return {
                  observations: redactSensitiveText(observations, secrets),
                };
              },
              afterReflection: async ({ observations, resourceId }) => {
                const orgMatch = resourceId?.match(/:org:([^:]+):/);
                const secrets = orgMatch?.[1]
                  ? await collectOrganizationKnownSecrets(options.db, {
                      organizationId: orgMatch[1],
                      masterKey: options.masterKey,
                    })
                  : [];
                return {
                  observations: redactSensitiveText(observations, secrets),
                };
              },
              onObservationEnd: async ({ resourceId, usage, error }) => {
                if (error || !usage || !resourceId) return;
                const orgMatch = resourceId.match(/:org:([^:]+):/);
                const orgId = orgMatch?.[1];
                if (!orgId) return;
                const inputTokens =
                  typeof usage.inputTokens === "number" ? usage.inputTokens : 0;
                const outputTokens =
                  typeof usage.outputTokens === "number"
                    ? usage.outputTokens
                    : 0;
                if (inputTokens > outputTokens && inputTokens > 0) {
                  await recordTokenSavingsEventScoped(options.db, {
                    organizationId: orgId,
                    input: {
                      technique: "observational_memory",
                      tokensBaseline: inputTokens,
                      tokensActual: Math.max(0, outputTokens),
                    },
                  }).catch(() => undefined);
                }
              },
            },
          }
        : false,
    },
  });

  let unregisterSettle: (() => void) | undefined;
  const settle = async () => {
    try {
      await memory.settled();
    } finally {
      unregisterSettle?.();
    }
  };
  if (omEnabled) {
    unregisterSettle = registerMemorySettleHook(settle);
  }

  return { memory, storage, settle };
}

export function mapDataOmStatusToContract(
  rawData: unknown
): ObservationalMemoryStatus | null {
  if (!rawData || typeof rawData !== "object") return null;
  const data = rawData as {
    windows?: {
      active?: {
        messages?: { tokens?: number; threshold?: number };
        observations?: { tokens?: number; threshold?: number };
      };
      buffered?: {
        observations?: { status?: string };
        reflection?: { status?: string };
      };
    };
    generationCount?: number;
  };

  const obsBuf = data.windows?.buffered?.observations?.status;
  const refBuf = data.windows?.buffered?.reflection?.status;
  let bufferingStatus: "idle" | "running" | "complete" = "idle";
  if (obsBuf === "running" || refBuf === "running") {
    bufferingStatus = "running";
  } else if (obsBuf === "complete" || refBuf === "complete") {
    bufferingStatus = "complete";
  }

  return {
    activeMessageTokens: Math.max(
      0,
      Math.trunc(data.windows?.active?.messages?.tokens ?? 0)
    ),
    messageTokensThreshold: Math.max(
      1,
      Math.trunc(
        data.windows?.active?.messages?.threshold ?? DEFAULT_OM_MESSAGE_TOKENS
      )
    ),
    activeObservationTokens: Math.max(
      0,
      Math.trunc(data.windows?.active?.observations?.tokens ?? 0)
    ),
    observationTokensThreshold: Math.max(
      1,
      Math.trunc(
        data.windows?.active?.observations?.threshold ??
          DEFAULT_OM_OBSERVATION_TOKENS
      )
    ),
    generationCount: Math.max(0, Math.trunc(data.generationCount ?? 0)),
    bufferingStatus,
  };
}

export function extractTextFromMastraMessage(msg: MastraDBMessage): string {
  if (typeof msg.content?.content === "string" && msg.content.content.trim()) {
    return msg.content.content;
  }
  if (Array.isArray(msg.content?.parts)) {
    const joined = msg.content.parts
      .map((p) => (p.type === "text" && typeof p.text === "string" ? p.text : ""))
      .filter(Boolean)
      .join("");
    if (joined.trim()) {
      return joined;
    }
  }
  return "";
}

function safeIsoTimestamp(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return new Date().toISOString();
}

function mapMastraMessageToThreadItem(
  msg: MastraDBMessage,
  knownSecrets: readonly string[] = []
): AgencyThreadMessageItem | null {
  if (msg.role !== "user" && msg.role !== "assistant") {
    return null;
  }
  const text = extractTextFromMastraMessage(msg);
  if (!text) return null;

  const meta = (msg.content?.metadata ?? {}) as Record<string, unknown>;
  const item: AgencyThreadMessageItem = {
    id: msg.id,
    role: msg.role,
    content: redactSensitiveText(text, knownSecrets),
    createdAt: safeIsoTimestamp(msg.createdAt),
  };

  const parsedRole = AgencyAgentRoleSchema.safeParse(meta.agentRole);
  if (parsedRole.success) {
    item.agentRole = parsedRole.data;
  }
  if (typeof meta.agentName === "string" && meta.agentName.trim()) {
    item.agentName = meta.agentName.trim().slice(0, 120);
  }
  if (
    meta.executionMode === "live_llm" ||
    meta.executionMode === "local_assisted"
  ) {
    item.executionMode = meta.executionMode;
  }
  if (typeof meta.boundModelId === "string" && meta.boundModelId.trim()) {
    item.boundModelId = meta.boundModelId.trim().slice(0, 160);
  }
  if (typeof meta.llmLatencyMs === "number" && Number.isFinite(meta.llmLatencyMs) && meta.llmLatencyMs >= 0) {
    item.llmLatencyMs = Math.round(meta.llmLatencyMs);
  }
  if (typeof meta.cycleNumber === "number" && Number.isInteger(meta.cycleNumber) && meta.cycleNumber >= 1) {
    item.cycleNumber = meta.cycleNumber;
  }
  if (Array.isArray(meta.toolsUsed)) {
    item.toolsUsed = meta.toolsUsed.filter(
      (t): t is string => typeof t === "string"
    );
  }
  const parsedActions = z
    .array(AgencyActionExecutedSchema)
    .safeParse(meta.actionsExecuted);
  if (parsedActions.success) {
    item.actionsExecuted = parsedActions.data;
  }

  return item;
}

export async function assertThreadOwnershipOrCreate(params: {
  memory: Memory;
  resourceId: string;
  requestedThreadId?: string;
  title?: string;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  if (params.requestedThreadId) {
    const existing = await params.memory.getThreadById({
      threadId: params.requestedThreadId,
    });
    if (!existing) {
      throw new WorkflowRuntimeError({
        statusCode: 403,
        code: "FORBIDDEN_THREAD_ACCESS",
        message: "Thread informada não existe ou não pertence ao escopo atual.",
      });
    }
    if (existing.resourceId !== params.resourceId) {
      throw new WorkflowRuntimeError({
        statusCode: 403,
        code: "FORBIDDEN_THREAD_ACCESS",
        message:
          "Acesso negado: thread pertence a outra organização ou projeto.",
      });
    }
    return existing.id;
  }

  const created = await params.memory.createThread({
    resourceId: params.resourceId,
    title: params.title ? redactSensitiveText(params.title) : undefined,
    metadata: params.metadata,
  });
  return created.id;
}

export async function listAgencyThreadsScoped(
  db: UzinaDb,
  params: {
    organizationId: string;
    projectId?: string;
    threadId?: string;
    dataDir?: string;
    databaseUrl?: string;
    masterKey?: Buffer | string | null;
  }
): Promise<AgencyThreadListResponse> {
  if (params.projectId) {
    await assertProjectBelongsToOrganization(
      db,
      params.projectId,
      params.organizationId
    );
  }

  const knownSecrets = await collectOrganizationKnownSecrets(db, {
    organizationId: params.organizationId,
    masterKey: params.masterKey,
  }).catch(() => [] as string[]);

  const resourceId = buildAgencyResourceId(
    params.organizationId,
    params.projectId
  );

  const { memory } = await createUzinaMemory({
    db,
    dataDir: params.dataDir,
    databaseUrl: params.databaseUrl,
    observationalMemoryEnabled: false,
  });

  if (params.threadId) {
    const target = await memory.getThreadById({ threadId: params.threadId });
    if (!target || target.resourceId !== resourceId) {
      throw new WorkflowRuntimeError({
        statusCode: 403,
        code: "FORBIDDEN_THREAD_ACCESS",
        message:
          "Acesso negado: thread solicitada não pertence à organização ou projeto.",
      });
    }
  }

  const listed = await memory.listThreads({
    filter: { resourceId },
    perPage: 25,
    page: 0,
    orderBy: { field: "updatedAt", direction: "DESC" },
  });

  const summaries: AgencyThreadSummary[] = [];
  for (const t of listed.threads) {
    const recallRes = await memory
      .recall({ threadId: t.id, perPage: 50, page: 0 })
      .catch(() => ({ messages: [], total: 0 }));
    summaries.push({
      threadId: t.id,
      projectId: params.projectId ?? null,
      title: t.title ? redactSensitiveText(t.title, knownSecrets) : null,
      updatedAt: safeIsoTimestamp(t.updatedAt),
      messageCount: recallRes.total ?? recallRes.messages.length,
    });
  }

  const activeThreadId =
    params.threadId ?? summaries[0]?.threadId ?? null;

  let messages: AgencyThreadMessageItem[] = [];
  if (activeThreadId) {
    const recalled = await memory.recall({
      threadId: activeThreadId,
      perPage: 100,
      page: 0,
      orderBy: { field: "createdAt", direction: "ASC" },
    });
    messages = recalled.messages
      .map((m) => mapMastraMessageToThreadItem(m, knownSecrets))
      .filter((item): item is AgencyThreadMessageItem => item !== null);
  }

  return AgencyThreadListResponseSchema.parse({
    threads: summaries,
    activeThreadId,
    messages,
  });
}

export async function getAgencyThreadMessagesScoped(
  db: UzinaDb,
  params: {
    organizationId: string;
    projectId?: string;
    threadId: string;
    dataDir?: string;
    databaseUrl?: string;
    masterKey?: Buffer | string | null;
  }
): Promise<AgencyThreadMessageItem[]> {
  const res = await listAgencyThreadsScoped(db, params);
  return res.messages;
}
