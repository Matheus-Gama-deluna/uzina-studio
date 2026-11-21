import {
  DeliverableStatusSchema,
  UpdateDeliverableSchema,
} from "@uzina/contracts";
import { assertValidTransition } from "@uzina/core";
import {
  clients,
  deliverables,
  getDb,
  projectRepositories,
  projects,
} from "@uzina/db";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { isUuid, jsonError, parseJsonBody } from "@/lib/api-utils";
import { WORKSPACE_WRITE_ROLES, requireOrgRole } from "@/lib/rbac";
import { mapDeliverable } from "../../projects/[id]/deliverables/route";

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
    return jsonError(400, { error: "ID de entrega inválido", code: "INVALID_ID" });
  }

  const body = await parseJsonBody(request, UpdateDeliverableSchema);
  if (!body.ok) return body.response;

  const { db } = await getDb();
  const [found] = await db
    .select({ deliverable: deliverables })
    .from(deliverables)
    .innerJoin(projects, eq(deliverables.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(
      and(
        eq(deliverables.id, id),
        eq(clients.organizationId, guard.actor.organizationId)
      )
    )
    .limit(1);

  if (!found) {
    return jsonError(404, { error: "Entrega não encontrada", code: "NOT_FOUND" });
  }

  const existing = found.deliverable;

  if (body.data.repositoryId) {
    const [repo] = await db
      .select({ id: projectRepositories.id })
      .from(projectRepositories)
      .where(
        and(
          eq(projectRepositories.id, body.data.repositoryId),
          eq(projectRepositories.projectId, existing.projectId)
        )
      )
      .limit(1);

    if (!repo) {
      return jsonError(400, {
        error: "Repositório informado não pertence ao projeto desta entrega.",
        code: "INVALID_REPOSITORY",
      });
    }
  }

  const currentStatus = DeliverableStatusSchema.parse(existing.status);
  const currentPausedFrom = existing.pausedFromStatus
    ? DeliverableStatusSchema.parse(existing.pausedFromStatus)
    : null;
  const nextHasUi = body.data.hasUi ?? existing.hasUi;

  let nextPausedFrom = existing.pausedFromStatus;
  if (body.data.status !== undefined && body.data.status !== currentStatus) {
    try {
      assertValidTransition(currentStatus, body.data.status, {
        hasUi: nextHasUi,
        pausedFromStatus: currentPausedFrom,
        verifyAttempts: existing.verifyAttempts,
        maxVerifyAttempts: existing.maxVerifyAttempts,
      });
    } catch (error: unknown) {
      return jsonError(422, {
        error:
          error instanceof Error
            ? error.message
            : "Transição de estado inválida",
        code: "INVALID_TRANSITION",
      });
    }

    if (body.data.status === "paused") {
      nextPausedFrom = currentStatus;
    } else if (currentStatus === "paused") {
      nextPausedFrom = null;
    }
  }

  const [updated] = await db
    .update(deliverables)
    .set({
      ...(body.data.title !== undefined ? { title: body.data.title } : {}),
      ...(body.data.description !== undefined
        ? { description: body.data.description }
        : {}),
      ...(body.data.repositoryId !== undefined
        ? { repositoryId: body.data.repositoryId }
        : {}),
      ...(body.data.status !== undefined
        ? { status: body.data.status, pausedFromStatus: nextPausedFrom }
        : {}),
      ...(body.data.hasUi !== undefined ? { hasUi: body.data.hasUi } : {}),
      ...(body.data.developmentStrategy !== undefined
        ? { developmentStrategy: body.data.developmentStrategy }
        : {}),
      ...(body.data.tacticalPattern !== undefined
        ? { tacticalPattern: body.data.tacticalPattern }
        : {}),
      ...(body.data.riskLevel !== undefined
        ? { riskLevel: body.data.riskLevel }
        : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(deliverables.id, existing.id),
        eq(deliverables.projectId, existing.projectId)
      )
    )
    .returning();

  if (!updated) {
    return jsonError(404, { error: "Entrega não encontrada", code: "NOT_FOUND" });
  }

  return NextResponse.json(mapDeliverable(updated), { status: 200 });
}
