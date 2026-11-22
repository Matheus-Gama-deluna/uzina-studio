import { UpdateMemorySchema } from "@uzina/contracts";
import { getDb } from "@uzina/db";
import {
  deleteMemoryScoped,
  getMemoryByIdScoped,
  updateMemoryScoped,
} from "@uzina/mastra-runtime";
import { NextResponse } from "next/server";
import { isUuid, jsonError, parseJsonBody } from "@/lib/api-utils";
import {
  VAULT_WRITE_ROLES,
  WORKSPACE_WRITE_ROLES,
  requireOrgRole,
} from "@/lib/rbac";

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
    return jsonError(400, { error: "ID de memória inválido.", code: "INVALID_UUID" });
  }

  const body = await parseJsonBody(request, UpdateMemorySchema);
  if (!body.ok) return body.response;

  const { db } = await getDb();
  const existing = await getMemoryByIdScoped(db, id, guard.actor.organizationId);
  if (!existing) {
    return jsonError(404, { error: "Memória não encontrada.", code: "NOT_FOUND" });
  }

  const isPrivileged =
    existing.scopeType === "org" ||
    existing.category === "security_triage" ||
    body.data.category === "security_triage";
  if (isPrivileged && !VAULT_WRITE_ROLES.includes(guard.actor.role)) {
    return jsonError(403, {
      error:
        "Apenas owner ou admin pode editar memórias globais (org) ou de security_triage.",
      code: "FORBIDDEN",
    });
  }

  try {
    const updated = await updateMemoryScoped(db, {
      id,
      organizationId: guard.actor.organizationId,
      input: body.data,
    });
    if (!updated) {
      return jsonError(404, { error: "Memória não encontrada.", code: "NOT_FOUND" });
    }
    return NextResponse.json(updated, { status: 200 });
  } catch (error) {
    console.error("[PATCH /api/memories/[id]] falha:", error);
    return jsonError(500, {
      error: "Erro interno ao atualizar memória.",
      code: "INTERNAL_ERROR",
    });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const guard = await requireOrgRole(request, WORKSPACE_WRITE_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  if (!isUuid(id)) {
    return jsonError(400, { error: "ID de memória inválido.", code: "INVALID_UUID" });
  }

  const { db } = await getDb();
  const existing = await getMemoryByIdScoped(db, id, guard.actor.organizationId);
  if (!existing) {
    return jsonError(404, { error: "Memória não encontrada.", code: "NOT_FOUND" });
  }

  const isPrivileged =
    existing.scopeType === "org" || existing.category === "security_triage";
  if (isPrivileged && !VAULT_WRITE_ROLES.includes(guard.actor.role)) {
    return jsonError(403, {
      error:
        "Apenas owner ou admin pode remover memórias globais (org) ou de security_triage.",
      code: "FORBIDDEN",
    });
  }

  const deleted = await deleteMemoryScoped(db, {
    id,
    organizationId: guard.actor.organizationId,
  });
  return NextResponse.json({ deleted }, { status: 200 });
}
