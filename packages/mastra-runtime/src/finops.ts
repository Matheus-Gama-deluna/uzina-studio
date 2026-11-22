import {
  FinopsSummaryRequestSchema,
  FinopsSummarySchema,
  RecordTokenSavingsSchema,
  TokenSavingsTechniqueSchema,
  type FinopsSummary,
  type FinopsSummaryRequest,
  type RecordTokenSavings,
  type TokenSavingsEvent,
  type TokenSavingsTechnique,
  type WorkspaceKind,
} from "@uzina/contracts";
import {
  clients,
  deliverables,
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
    workspaceKind: resolveConfiguredWorkspaceKind(params.env),
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
