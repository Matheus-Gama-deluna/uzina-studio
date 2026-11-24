import {
  CreateDeliverableSchema,
  DeliverableListResponseSchema,
  DeliverableSchema,
  DeliverableStatusSchema,
  DevelopmentStrategySchema,
  RiskLevelSchema,
  TacticalPatternSchema,
  type Deliverable,
} from "@uzina/contracts";
import {
  deliverables,
  getDb,
  projectRepositories,
} from "@uzina/db";
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { isUuid, jsonError, parseJsonBody } from "@/lib/api-utils";
import { READ_ROLES, WORKSPACE_WRITE_ROLES, requireOrgRole } from "@/lib/rbac";
import { findScopedProject } from "@/lib/studio-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function mapDeliverable(
  row: typeof deliverables.$inferSelect
): Deliverable {
  return DeliverableSchema.parse({
    id: row.id,
    projectId: row.projectId,
    repositoryId: row.repositoryId,
    title: row.title,
    description: row.description,
    status: DeliverableStatusSchema.parse(row.status),
    pausedFromStatus: row.pausedFromStatus
      ? DeliverableStatusSchema.parse(row.pausedFromStatus)
      : null,
    hasUi: row.hasUi,
    developmentStrategy: DevelopmentStrategySchema.parse(
      row.developmentStrategy
    ),
    tacticalPattern: TacticalPatternSchema.parse(row.tacticalPattern),
    riskLevel: RiskLevelSchema.parse(row.riskLevel),
    worktreePath: row.worktreePath,
    branchName: row.branchName,
    mastraRunId: row.mastraRunId ?? null,
    specMarkdown: row.specMarkdown ?? null,
    blueprintJson: row.blueprintJson ?? null,
    verifyAttempts: row.verifyAttempts,
    maxVerifyAttempts: row.maxVerifyAttempts,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const guard = await requireOrgRole(request, READ_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  if (!isUuid(id)) {
    return jsonError(400, { error: "ID de projeto inválido", code: "INVALID_ID" });
  }

  const { db } = await getDb();
  const project = await findScopedProject(db, id, guard.actor.organizationId);
  if (!project) {
    return jsonError(404, { error: "Projeto não encontrado", code: "NOT_FOUND" });
  }

  const rows = await db
    .select()
    .from(deliverables)
    .where(eq(deliverables.projectId, project.id))
    .orderBy(desc(deliverables.createdAt));

  return NextResponse.json(
    DeliverableListResponseSchema.parse({ items: rows.map(mapDeliverable) }),
    { status: 200 }
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const guard = await requireOrgRole(request, WORKSPACE_WRITE_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  if (!isUuid(id)) {
    return jsonError(400, { error: "ID de projeto inválido", code: "INVALID_ID" });
  }

  const { db } = await getDb();
  const project = await findScopedProject(db, id, guard.actor.organizationId);
  if (!project) {
    return jsonError(404, { error: "Projeto não encontrado", code: "NOT_FOUND" });
  }

  const body = await parseJsonBody(request, CreateDeliverableSchema);
  if (!body.ok) return body.response;

  if (body.data.repositoryId) {
    const [repo] = await db
      .select({ id: projectRepositories.id })
      .from(projectRepositories)
      .where(
        and(
          eq(projectRepositories.id, body.data.repositoryId),
          eq(projectRepositories.projectId, project.id)
        )
      )
      .limit(1);

    if (!repo) {
      return jsonError(400, {
        error: "Repositório informado não pertence a este projeto.",
        code: "INVALID_REPOSITORY",
      });
    }
  }

  const resolvedStrategy =
    body.data.developmentStrategy ??
    (!body.data.hasUi &&
    project.defaultDevelopmentStrategy === "frontend_first_msw"
      ? "api_contract_first"
      : project.defaultDevelopmentStrategy);

  const [created] = await db
    .insert(deliverables)
    .values({
      projectId: project.id,
      repositoryId: body.data.repositoryId ?? null,
      title: body.data.title,
      description: body.data.description ?? null,
      status: "discovery",
      hasUi: body.data.hasUi,
      developmentStrategy: resolvedStrategy,
      tacticalPattern: body.data.tacticalPattern,
      riskLevel: body.data.riskLevel,
    })
    .returning();

  if (!created) {
    return jsonError(500, {
      error: "Falha ao criar entrega",
      code: "CREATE_FAILED",
    });
  }

  return NextResponse.json(mapDeliverable(created), { status: 201 });
}
