import {
  DEFAULT_PROJECT_STAGE_AUTOMATION,
  ProjectStageAutomationSchema,
  UpdateProjectSchema,
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
import {
  VAULT_WRITE_ROLES,
  WORKSPACE_WRITE_ROLES,
  requireOrgRole,
} from "@/lib/rbac";
import { mapProject } from "../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const guard = await requireOrgRole(request, WORKSPACE_WRITE_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  if (!isUuid(id)) {
    return jsonError(400, { error: "ID de projeto inválido", code: "INVALID_ID" });
  }

  const body = await parseJsonBody(request, UpdateProjectSchema);
  if (!body.ok) return body.response;

  if (
    (body.data.budgetCapUsd !== undefined ||
      body.data.budgetCapTokens !== undefined) &&
    !VAULT_WRITE_ROLES.includes(guard.actor.role)
  ) {
    return jsonError(403, {
      error:
        "Apenas owner ou admin podem alterar o teto de orçamento (budgetCapUsd/budgetCapTokens).",
      code: "FORBIDDEN",
    });
  }

  const { db } = await getDb();
  const [existing] = await db
    .select({ project: projects })
    .from(projects)
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(
      and(
        eq(projects.id, id),
        eq(clients.organizationId, guard.actor.organizationId)
      )
    )
    .limit(1);

  if (!existing) {
    return jsonError(404, { error: "Projeto não encontrado", code: "NOT_FOUND" });
  }

  const nextStageAutomation =
    body.data.stageAutomation !== undefined
      ? ProjectStageAutomationSchema.parse({
          ...DEFAULT_PROJECT_STAGE_AUTOMATION,
          ...(existing.project.stageAutomationJson ?? {}),
          ...body.data.stageAutomation,
          decision_pending: "manual" as const,
        })
      : undefined;

  const [updated] = await db
    .update(projects)
    .set({
      ...(body.data.name !== undefined ? { name: body.data.name } : {}),
      ...(body.data.description !== undefined
        ? { description: body.data.description }
        : {}),
      ...(body.data.defaultDevelopmentStrategy !== undefined
        ? { defaultDevelopmentStrategy: body.data.defaultDevelopmentStrategy }
        : {}),
      ...(body.data.maturityScore !== undefined
        ? { maturityScore: body.data.maturityScore }
        : {}),
      ...(body.data.status !== undefined ? { status: body.data.status } : {}),
      ...(nextStageAutomation !== undefined
        ? { stageAutomationJson: nextStageAutomation }
        : {}),
      ...(body.data.budgetCapUsd !== undefined
        ? {
            budgetCapUsd:
              body.data.budgetCapUsd === null
                ? null
                : body.data.budgetCapUsd.toFixed(6),
          }
        : {}),
      ...(body.data.budgetCapTokens !== undefined
        ? { budgetCapTokens: body.data.budgetCapTokens }
        : {}),
      ...(body.data.finalizePolicy !== undefined
        ? { finalizePolicy: body.data.finalizePolicy }
        : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(projects.id, id),
        eq(projects.clientId, existing.project.clientId)
      )
    )
    .returning();

  if (!updated) {
    return jsonError(404, { error: "Projeto não encontrado", code: "NOT_FOUND" });
  }

  const repos = await db
    .select()
    .from(projectRepositories)
    .where(eq(projectRepositories.projectId, updated.id));

  return NextResponse.json(mapProject(updated, repos), { status: 200 });
}
