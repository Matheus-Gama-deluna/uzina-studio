import {
  CreateProjectRepositorySchema,
  ProjectRepositorySchema,
} from "@uzina/contracts";
import {
  clients,
  getDb,
  projectRepositories,
  projects,
} from "@uzina/db";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { isUuid, jsonError, parseJsonBody } from "@/lib/api-utils";
import { WORKSPACE_WRITE_ROLES, requireOrgRole } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const body = await parseJsonBody(request, CreateProjectRepositorySchema);
  if (!body.ok) return body.response;

  const { db } = await getDb();
  const [ownerProject] = await db
    .select({ id: projects.id })
    .from(projects)
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(
      and(
        eq(projects.id, id),
        eq(clients.organizationId, guard.actor.organizationId)
      )
    )
    .limit(1);

  if (!ownerProject) {
    return jsonError(404, { error: "Projeto não encontrado", code: "NOT_FOUND" });
  }

  const [created] = await db
    .insert(projectRepositories)
    .values({
      projectId: ownerProject.id,
      name: body.data.name,
      localPath: body.data.localPath,
      remoteUrl: body.data.remoteUrl ?? null,
      defaultBranch: body.data.defaultBranch,
    })
    .returning();

  if (!created) {
    return jsonError(500, {
      error: "Falha ao adicionar repositório",
      code: "CREATE_FAILED",
    });
  }

  return NextResponse.json(
    ProjectRepositorySchema.parse({
      id: created.id,
      projectId: created.projectId,
      name: created.name,
      localPath: created.localPath,
      remoteUrl: created.remoteUrl,
      defaultBranch: created.defaultBranch,
      stackMetadataJson: created.stackMetadataJson ?? {},
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    }),
    { status: 201 }
  );
}
