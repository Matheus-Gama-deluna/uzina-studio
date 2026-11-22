import { getDb } from "@uzina/db";
import { NextResponse } from "next/server";
import { isUuid, jsonError } from "@/lib/api-utils";
import { getScopedSecurityScan } from "@/lib/operations-queries";
import { READ_ROLES, requireOrgRole } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const guard = await requireOrgRole(request, READ_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  if (!isUuid(id)) {
    return jsonError(400, { error: "ID de scan inválido.", code: "INVALID_UUID" });
  }

  const url = new URL(request.url);
  const includeSarif = url.searchParams.get("includeSarif") === "true";

  try {
    const { db } = await getDb();
    const scan = await getScopedSecurityScan(
      db,
      id,
      guard.actor.organizationId,
      { includeSarif }
    );
    if (!scan) {
      return jsonError(404, {
        error: "Auditoria de segurança não encontrada.",
        code: "NOT_FOUND",
      });
    }
    return NextResponse.json(scan, { status: 200 });
  } catch (error) {
    console.error("[GET /api/security/scans/[id]] falha:", error);
    return jsonError(500, {
      error: "Erro interno ao carregar auditoria de segurança.",
      code: "INTERNAL_ERROR",
    });
  }
}
