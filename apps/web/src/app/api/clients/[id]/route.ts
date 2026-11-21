import { ClientSchema, UpdateClientSchema } from "@uzina/contracts";
import { clients, getDb } from "@uzina/db";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { isUuid, jsonError, parseJsonBody } from "@/lib/api-utils";
import { WORKSPACE_WRITE_ROLES, requireOrgRole } from "@/lib/rbac";

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
    return jsonError(400, { error: "ID de cliente inválido", code: "INVALID_ID" });
  }

  const body = await parseJsonBody(request, UpdateClientSchema);
  if (!body.ok) return body.response;

  const { db } = await getDb();
  const [existing] = await db
    .select()
    .from(clients)
    .where(
      and(
        eq(clients.id, id),
        eq(clients.organizationId, guard.actor.organizationId)
      )
    )
    .limit(1);

  if (!existing) {
    return jsonError(404, { error: "Cliente não encontrado", code: "NOT_FOUND" });
  }

  if (existing.isDefaultInternal && body.data.name && body.data.name !== "Internos") {
    return jsonError(400, {
      error: "O cliente padrão 'Internos' não pode ser renomeado.",
      code: "IMMUTABLE_DEFAULT_CLIENT",
    });
  }

  const [updated] = await db
    .update(clients)
    .set({
      ...(body.data.name !== undefined ? { name: body.data.name } : {}),
      ...(body.data.notes !== undefined ? { notes: body.data.notes } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(clients.id, id),
        eq(clients.organizationId, guard.actor.organizationId)
      )
    )
    .returning();

  if (!updated) {
    return jsonError(404, { error: "Cliente não encontrado", code: "NOT_FOUND" });
  }

  return NextResponse.json(
    ClientSchema.parse({
      id: updated.id,
      organizationId: updated.organizationId,
      name: updated.name,
      slug: updated.slug,
      isDefaultInternal: updated.isDefaultInternal,
      notes: updated.notes,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    }),
    { status: 200 }
  );
}
