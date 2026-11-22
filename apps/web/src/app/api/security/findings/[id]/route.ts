import { UpdateFindingTriageSchema } from "@uzina/contracts";
import { getDb } from "@uzina/db";
import { NextResponse } from "next/server";
import { isUuid, jsonError, parseJsonBody } from "@/lib/api-utils";
import {
  getScopedSecurityFinding,
  updateScopedFindingTriage,
} from "@/lib/operations-queries";
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

  const { id: findingId } = await context.params;
  if (!isUuid(findingId)) {
    return jsonError(400, {
      error: "ID de achado inválido.",
      code: "INVALID_UUID",
    });
  }

  const body = await parseJsonBody(request, UpdateFindingTriageSchema);
  if (!body.ok) return body.response;

  const { db } = await getDb();
  const scoped = await getScopedSecurityFinding(
    db,
    findingId,
    guard.actor.organizationId
  );

  if (!scoped) {
    return jsonError(404, {
      error: "Achado de segurança não encontrado.",
      code: "NOT_FOUND",
    });
  }

  const isPrivilegedAction =
    body.data.suppressedInMemory === true ||
    (body.data.triageVerdict === "false_positive" &&
      (scoped.finding.severity === "critical" ||
        scoped.finding.severity === "high"));

  if (isPrivilegedAction && !VAULT_WRITE_ROLES.includes(guard.actor.role)) {
    return jsonError(403, {
      error:
        "Apenas owner ou admin pode suprimir achados em memória ou marcar critical/high como false_positive.",
      code: "FORBIDDEN",
    });
  }

  try {
    const updated = await updateScopedFindingTriage(db, {
      findingId,
      organizationId: guard.actor.organizationId,
      input: body.data,
    });
    if (!updated) {
      return jsonError(404, {
        error: "Achado de segurança não encontrado.",
        code: "NOT_FOUND",
      });
    }
    return NextResponse.json(updated, { status: 200 });
  } catch (error) {
    console.error("[PATCH /api/security/findings/[id]] falha:", error);
    return jsonError(500, {
      error: "Erro interno ao atualizar triagem do achado.",
      code: "INTERNAL_ERROR",
    });
  }
}
