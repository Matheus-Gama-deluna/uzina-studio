import {
  EngineConfigResponseSchema,
  FinopsSummaryRequestSchema,
  FinopsSummarySchema,
  RecordTokenSavingsSchema,
  TokenSavingsTechniqueSchema,
  UpdateEngineConfigSchema,
  type EngineConfig,
  type EngineConfigResponse,
  type FinopsSummary,
  type FinopsSummaryRequest,
  type RecordTokenSavings,
  type TokenSavingsEvent,
  type TokenSavingsTechnique,
  type UpdateEngineConfig,
  type WorkspaceKind,
} from "@uzina/contracts";
import {
  ENGINE_OPTIONS_CATALOG,
  createDeterministicEmbeddingProvider,
  createOllamaEmbeddingProvider,
  createSemanticE5EmbeddingProvider,
  type EmbeddingProvider,
} from "@uzina/core";
import {
  clients,
  deliverables,
  engineConfigs,
  organizations,
  projects,
  tokenSavingsEvents,
  type UzinaDb,
} from "@uzina/db";
import {
  DockerExecutionWorkspace,
  LocalGitWorktreeWorkspace,
  type ExecutionWorkspace,
} from "@uzina/opencode-bridge";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { getProjectCodebaseTreeScoped } from "./codebase.js";
import { searchQmdScoped } from "./qmd.js";

// Preço médio de referência ($3.00 / 1M input tokens) apenas para estimativa FinOps
const USD_PER_MILLION_INPUT_TOKENS = 3.0;

export function resolveConfiguredWorkspaceKind(
  env: Record<string, string | undefined> = process.env
): WorkspaceKind {
  const raw = env.UZINA_WORKSPACE?.trim().toLowerCase();
  return raw === "docker" ? "docker" : "worktree";
}

export function createConfiguredExecutionWorkspace(
  env: Record<string, string | undefined> = process.env
): ExecutionWorkspace {
  return resolveConfiguredWorkspaceKind(env) === "docker"
    ? new DockerExecutionWorkspace()
    : new LocalGitWorktreeWorkspace();
}

function toTokenSavingsEventDto(
  row: typeof tokenSavingsEvents.$inferSelect
): TokenSavingsEvent {
  const baseline = Math.max(0, row.tokensBaseline);
  const actual = Math.max(0, row.tokensActual);
  const saved = Math.max(0, baseline - actual);
  const pct =
    baseline > 0 ? Number(((saved / baseline) * 100).toFixed(1)) : 0;

  return {
    id: row.id,
    organizationId: row.organizationId,
    deliverableId: row.deliverableId ?? null,
    technique: row.technique,
    tokensBaseline: baseline,
    tokensActual: actual,
    tokensSaved: saved,
    savingsPercent: Math.min(100, Math.max(0, pct)),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function recordTokenSavingsEventScoped(
  db: UzinaDb,
  params: {
    organizationId: string;
    input: RecordTokenSavings;
  }
): Promise<TokenSavingsEvent> {
  const parsed = RecordTokenSavingsSchema.parse(params.input);

  const [inserted] = await db
    .insert(tokenSavingsEvents)
    .values({
      organizationId: params.organizationId,
      deliverableId: parsed.deliverableId ?? null,
      technique: parsed.technique,
      tokensBaseline: parsed.tokensBaseline,
      tokensActual: parsed.tokensActual,
    })
    .returning();

  return toTokenSavingsEventDto(inserted!);
}

export async function getFinopsSummaryScoped(
  db: UzinaDb,
  params: {
    organizationId: string;
    query?: Partial<FinopsSummaryRequest>;
    env?: Record<string, string | undefined>;
  }
): Promise<FinopsSummary> {
  const parsed = FinopsSummaryRequestSchema.parse(params.query ?? {});
  const conditions = [
    eq(tokenSavingsEvents.organizationId, params.organizationId),
  ];

  if (parsed.from) {
    conditions.push(gte(tokenSavingsEvents.createdAt, new Date(parsed.from)));
  }
  if (parsed.to) {
    conditions.push(lte(tokenSavingsEvents.createdAt, new Date(parsed.to)));
  }

  let scopedDeliverableIds: string[] | null = null;
  if (parsed.projectId) {
    const projectDelivs = await db
      .select({ id: deliverables.id })
      .from(deliverables)
      .where(eq(deliverables.projectId, parsed.projectId));
    scopedDeliverableIds = projectDelivs.map((d) => d.id);
    if (scopedDeliverableIds.length > 0) {
      conditions.push(
        inArray(tokenSavingsEvents.deliverableId, scopedDeliverableIds)
      );
    }
  }

  const rows =
    parsed.projectId && (!scopedDeliverableIds || scopedDeliverableIds.length === 0)
      ? []
      : await db
          .select()
          .from(tokenSavingsEvents)
          .where(and(...conditions))
          .orderBy(desc(tokenSavingsEvents.createdAt));

  const totalsByTech = new Map<
    TokenSavingsTechnique,
    { events: number; baseline: number; actual: number }
  >();
  for (const tech of TokenSavingsTechniqueSchema.options) {
    totalsByTech.set(tech, { events: 0, baseline: 0, actual: 0 });
  }

  let totalTokensBaseline = 0;
  let totalTokensActual = 0;

  for (const row of rows) {
    const b = Math.max(0, row.tokensBaseline);
    const a = Math.max(0, row.tokensActual);
    totalTokensBaseline += b;
    totalTokensActual += a;

    const bucket = totalsByTech.get(row.technique);
    if (bucket) {
      bucket.events += 1;
      bucket.baseline += b;
      bucket.actual += a;
    }
  }

  const totalTokensSaved = Math.max(0, totalTokensBaseline - totalTokensActual);
  const overallSavingsPercent =
    totalTokensBaseline > 0
      ? Number(
          Math.min(
            100,
            Math.max(0, (totalTokensSaved / totalTokensBaseline) * 100)
          ).toFixed(1)
        )
      : 0;

  // Cache Hit Rate medido a partir dos eventos de prompt_cache + skeleton
  const cacheBucket = totalsByTech.get("prompt_cache")!;
  const skeletonBucket = totalsByTech.get("skeleton")!;
  const cacheBaseline = cacheBucket.baseline + skeletonBucket.baseline;
  const cacheSaved = Math.max(
    0,
    cacheBaseline - (cacheBucket.actual + skeletonBucket.actual)
  );
  const cacheHitRate =
    cacheBaseline > 0
      ? Number(Math.min(100, (cacheSaved / cacheBaseline) * 100).toFixed(1))
      : 0;

  // Rework Rate real das entregas da organização
  const orgDelivs = await db
    .select({
      status: deliverables.status,
      verifyAttempts: deliverables.verifyAttempts,
    })
    .from(deliverables)
    .innerJoin(projects, eq(deliverables.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(eq(clients.organizationId, params.organizationId));

  const reworkedCount = orgDelivs.filter(
    (d) => d.verifyAttempts > 1 || d.status === "failed"
  ).length;
  const reworkRate =
    orgDelivs.length > 0
      ? Number(((reworkedCount / orgDelivs.length) * 100).toFixed(1))
      : 0;

  const estimatedCostSavedUsd = Number(
    ((totalTokensSaved / 1_000_000) * USD_PER_MILLION_INPUT_TOKENS).toFixed(4)
  );

  const byTechnique = TokenSavingsTechniqueSchema.options.map((technique) => {
    const bucket = totalsByTech.get(technique)!;
    const saved = Math.max(0, bucket.baseline - bucket.actual);
    const pct =
      bucket.baseline > 0
        ? Number(Math.min(100, (saved / bucket.baseline) * 100).toFixed(1))
        : 0;
    return {
      technique,
      eventsCount: bucket.events,
      tokensBaseline: bucket.baseline,
      tokensActual: bucket.actual,
      tokensSaved: saved,
      savingsPercent: pct,
    };
  });

  return FinopsSummarySchema.parse({
    organizationId: params.organizationId,
    workspaceKind: (await getEngineConfigScoped(db, { organizationId: params.organizationId, env: params.env })).config.workspaceKind,
    totalEvents: rows.length,
    totalTokensBaseline,
    totalTokensActual,
    totalTokensSaved,
    overallSavingsPercent,
    cacheHitRate,
    reworkRate,
    estimatedCostSavedUsd,
    byTechnique,
    recentEvents: rows.slice(0, parsed.limit).map(toTokenSavingsEventDto),
  });
}

function toEngineConfigDto(
  row: typeof engineConfigs.$inferSelect
): EngineConfig {
  return {
    organizationId: row.organizationId,
    embeddingMode: row.embeddingMode,
    ollamaBaseUrl: row.ollamaBaseUrl,
    ollamaEmbeddingModel: row.ollamaEmbeddingModel,
    astMode: row.astMode,
    workspaceKind: row.workspaceKind,
    skeletonMaxTokens: row.skeletonMaxTokens,
    qmdTopK: row.qmdTopK,
    autoInjectInRunner: row.autoInjectInRunner,
    dockerCpuLimit: row.dockerCpuLimit,
    dockerMemoryLimit: row.dockerMemoryLimit,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function buildProviderFromConfig(config: Pick<EngineConfig, "embeddingMode" | "ollamaBaseUrl" | "ollamaEmbeddingModel">): EmbeddingProvider {
  if (config.embeddingMode === "onnx_e5_small") {
    return createSemanticE5EmbeddingProvider();
  }
  if (config.embeddingMode === "ollama") {
    return createOllamaEmbeddingProvider({
      baseUrl: config.ollamaBaseUrl,
      model: config.ollamaEmbeddingModel,
    });
  }
  return createDeterministicEmbeddingProvider();
}

export async function getEngineConfigScoped(
  db: UzinaDb,
  params: {
    organizationId: string;
    env?: Record<string, string | undefined>;
  }
): Promise<EngineConfigResponse> {
  const env = params.env ?? process.env;
  const [existing] = await db
    .select()
    .from(engineConfigs)
    .where(eq(engineConfigs.organizationId, params.organizationId))
    .limit(1);

  let row = existing;
  let fallbackConfig: EngineConfig | null = null;
  if (!row) {
    const defaultEmbedding =
      env.UZINA_EMBEDDINGS === "e5" || env.UZINA_EMBEDDINGS === "onnx_e5_small"
        ? "onnx_e5_small"
        : env.UZINA_EMBEDDINGS === "ollama"
          ? "ollama"
          : "deterministic";
    const defaultAst =
      env.UZINA_AST_MODE === "ts_native" ? "ts_native" : "polyglot";
    const defaultWorkspace = resolveConfiguredWorkspaceKind(env);

    const [orgExists] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, params.organizationId))
      .limit(1);

    if (!orgExists) {
      fallbackConfig = {
        organizationId: params.organizationId,
        embeddingMode: defaultEmbedding,
        ollamaBaseUrl: "http://127.0.0.1:11434",
        ollamaEmbeddingModel: "bge-m3",
        astMode: defaultAst,
        workspaceKind: defaultWorkspace,
        skeletonMaxTokens: 2000,
        qmdTopK: 5,
        autoInjectInRunner: true,
        dockerCpuLimit: "1.0",
        dockerMemoryLimit: "512m",
        updatedAt: new Date().toISOString(),
      };
    } else {
      const [inserted] = await db
        .insert(engineConfigs)
        .values({
          organizationId: params.organizationId,
          embeddingMode: defaultEmbedding,
          astMode: defaultAst,
          workspaceKind: defaultWorkspace,
        })
        .onConflictDoNothing()
        .returning();

      if (inserted) {
        row = inserted;
      } else {
        const [refetched] = await db
          .select()
          .from(engineConfigs)
          .where(eq(engineConfigs.organizationId, params.organizationId))
          .limit(1);
        row = refetched!;
      }
    }
  }

  const config = fallbackConfig ?? toEngineConfigDto(row!);
  const provider = buildProviderFromConfig(config);

  return EngineConfigResponseSchema.parse({
    config,
    catalog: ENGINE_OPTIONS_CATALOG,
    activeEmbeddingProviderId: provider.id,
    degraded: provider.degraded,
  });
}

export async function updateEngineConfigScoped(
  db: UzinaDb,
  params: {
    organizationId: string;
    input: UpdateEngineConfig;
  }
): Promise<EngineConfigResponse> {
  const parsed = UpdateEngineConfigSchema.parse(params.input);
  await getEngineConfigScoped(db, { organizationId: params.organizationId });

  const [updated] = await db
    .update(engineConfigs)
    .set({
      ...(parsed.embeddingMode !== undefined
        ? { embeddingMode: parsed.embeddingMode }
        : {}),
      ...(parsed.ollamaBaseUrl !== undefined
        ? { ollamaBaseUrl: parsed.ollamaBaseUrl }
        : {}),
      ...(parsed.ollamaEmbeddingModel !== undefined
        ? { ollamaEmbeddingModel: parsed.ollamaEmbeddingModel }
        : {}),
      ...(parsed.astMode !== undefined ? { astMode: parsed.astMode } : {}),
      ...(parsed.workspaceKind !== undefined
        ? { workspaceKind: parsed.workspaceKind }
        : {}),
      ...(parsed.skeletonMaxTokens !== undefined
        ? { skeletonMaxTokens: parsed.skeletonMaxTokens }
        : {}),
      ...(parsed.qmdTopK !== undefined ? { qmdTopK: parsed.qmdTopK } : {}),
      ...(parsed.autoInjectInRunner !== undefined
        ? { autoInjectInRunner: parsed.autoInjectInRunner }
        : {}),
      ...(parsed.dockerCpuLimit !== undefined
        ? { dockerCpuLimit: parsed.dockerCpuLimit }
        : {}),
      ...(parsed.dockerMemoryLimit !== undefined
        ? { dockerMemoryLimit: parsed.dockerMemoryLimit }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(engineConfigs.organizationId, params.organizationId))
    .returning();

  const config = toEngineConfigDto(updated!);
  const provider = buildProviderFromConfig(config);

  return EngineConfigResponseSchema.parse({
    config,
    catalog: ENGINE_OPTIONS_CATALOG,
    activeEmbeddingProviderId: provider.id,
    degraded: provider.degraded,
  });
}

export async function resolveOrganizationEmbeddingProvider(
  db: UzinaDb,
  organizationId: string
): Promise<EmbeddingProvider> {
  const res = await getEngineConfigScoped(db, { organizationId });
  return buildProviderFromConfig(res.config);
}

export async function createOrganizationExecutionWorkspace(
  db: UzinaDb,
  organizationId: string
): Promise<ExecutionWorkspace> {
  const res = await getEngineConfigScoped(db, { organizationId });
  if (res.config.workspaceKind === "docker") {
    return new DockerExecutionWorkspace({
      cpus: res.config.dockerCpuLimit,
      memory: res.config.dockerMemoryLimit,
    });
  }
  return new LocalGitWorktreeWorkspace();
}

export async function buildAutoInjectedCodebaseContext(
  db: UzinaDb,
  params: {
    organizationId: string;
    projectId: string;
    deliverableId?: string | null;
    queryText: string;
    workspaceRoot?: string;
  }
): Promise<{
  enabled: boolean;
  contextMarkdown: string;
  tokensBaseline: number;
  tokensActual: number;
  tokensSaved: number;
}> {
  const cfgRes = await getEngineConfigScoped(db, {
    organizationId: params.organizationId,
  });
  if (!cfgRes.config.autoInjectInRunner) {
    return {
      enabled: false,
      contextMarkdown: "",
      tokensBaseline: 0,
      tokensActual: 0,
      tokensSaved: 0,
    };
  }

  const tree = await getProjectCodebaseTreeScoped(db, {
    organizationId: params.organizationId,
    projectId: params.projectId,
    workspaceRoot: params.workspaceRoot,
  }).catch(() => null);

  const qmd =
    params.queryText.trim().length >= 2
      ? await searchQmdScoped(db, {
          organizationId: params.organizationId,
          request: {
            query: params.queryText.slice(0, 400),
            projectId: params.projectId,
            mode: "hybrid",
            limit: cfgRes.config.qmdTopK,
          },
        }).catch(() => null)
      : null;

  const parts: string[] = [];
  if (tree?.skeleton.skeletonText) {
    parts.push(
      `### Esqueleto AST (${cfgRes.config.astMode})\n\`\`\`\n${tree.skeleton.skeletonText}\n\`\`\``
    );
  }
  if (qmd && qmd.hits.length > 0) {
    const qmdLines = qmd.hits.map(
      (h) => `- [${h.headingPath}] (${h.sourcePath ?? h.scopeType}#L${h.lineStart}-L${h.lineEnd}): ${h.snippet}`
    );
    parts.push(`### Memórias & Docs QMD (${qmd.embeddingModel})\n${qmdLines.join("\n")}`);
  }

  const contextMarkdown = parts.join("\n\n");
  const tokensActual = Math.max(0, Math.ceil(contextMarkdown.length / 4));
  const tokensBaseline = Math.max(
    tokensActual,
    tree?.skeleton.baselineTokens ?? tokensActual
  );
  const tokensSaved = Math.max(0, tokensBaseline - tokensActual);

  if (tokensBaseline > 0 && tokensActual > 0) {
    await recordTokenSavingsEventScoped(db, {
      organizationId: params.organizationId,
      input: {
        deliverableId: params.deliverableId ?? null,
        technique: "prompt_cache",
        tokensBaseline,
        tokensActual,
      },
    }).catch(() => undefined);
  }

  return {
    enabled: true,
    contextMarkdown,
    tokensBaseline,
    tokensActual,
    tokensSaved,
  };
}
