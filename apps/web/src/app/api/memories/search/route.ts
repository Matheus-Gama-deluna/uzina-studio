import { QmdSearchRequestSchema } from "@uzina/contracts";
import { getDb } from "@uzina/db";
import { searchQmdScoped } from "@uzina/mastra-runtime";
import { NextResponse } from "next/server";
import { jsonError, parseJsonBody } from "@/lib/api-utils";
import { READ_ROLES, requireOrgRole } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const guard = await requireOrgRole(request, READ_ROLES);
  if (!guard.ok) return guard.response;

  const parsed = await parseJsonBody(request, QmdSearchRequestSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const { db } = await getDb();
    const result = await searchQmdScoped(db, {
      organizationId: guard.actor.organizationId,
      request: parsed.data,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[POST /api/memories/search] falha:", error);
    return jsonError(500, {
      error: "Erro interno ao executar busca híbrida QMD.",
      code: "INTERNAL_ERROR",
    });
  }
}
