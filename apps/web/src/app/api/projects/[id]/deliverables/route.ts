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
  clients,
  deliverables,
  getDb,
  projectRepositories,
  projects,
} from "@uzina/db";
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { isUuid, jsonError, parseJsonBody } from "@/lib/api-utils";
import { READ_ROLES, WORKSPACE_WRITE_ROLES, requireOrgRole } from "@/lib/rbac";

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
    verifyAttempts: row.verifyAttempts,
    maxVerifyAttempts: row.maxVerifyAttempts,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

async function findOwnedProject(
  projectId: string,
  organizationId: string
) {
  const { db } = await getDb();
  const [found] = await db
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
  return found?.project ?? null;
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

  const project = await findOwnedProject(id, guard.actor.organizationId);
  if (!project) {
    return jsonError(404, { error: "Projeto não encontrado", code: "NOT_FOUND" });
  }

  const { db } = await getDb();
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

  const project = await findOwnedProject(id, guard.actor.organizationId);
  if (!project) {
    return jsonError(404, { error: "Projeto não encontrado", code: "NOT_FOUND" });
  }

  const body = await parseJsonBody(request, CreateDeliverableSchema);
  if (!body.ok) return body.response;

  const { db } = await getDb();
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

  const [created] = await db
    .insert(deliverables)
    .values({
      projectId: project.id,
      repositoryId: body.data.repositoryId ?? null,
      title: body.data.title,
      description: body.data.description ?? null,
      status: "discovery",
      hasUi: body.data.hasUi,
      developmentStrategy:
        body.data.developmentStrategy ?? project.defaultDevelopmentStrategy,
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
