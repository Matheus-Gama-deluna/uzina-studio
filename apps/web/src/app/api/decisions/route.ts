import {
  DecisionStatusSchema,
  DecisionListResponseSchema,
} from "@uzina/contracts";
import { getDb } from "@uzina/db";
import { NextResponse } from "next/server";
import { isUuid, jsonError } from "@/lib/api-utils";
import { listScopedDecisions } from "@/lib/operations-queries";
import { READ_ROLES, requireOrgRole } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const guard = await requireOrgRole(request, READ_ROLES);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const rawStatus = url.searchParams.get("status");
  const rawProjectId = url.searchParams.get("projectId");
  const rawDeliverableId = url.searchParams.get("deliverableId");
  const rawLimit = url.searchParams.get("limit");

  let statusFilter: ReturnType<typeof DecisionStatusSchema.parse> | undefined;
  if (rawStatus) {
    const parsedStatus = DecisionStatusSchema.safeParse(rawStatus);
    if (!parsedStatus.success) {
      return jsonError(400, {
        error: "Parâmetro 'status' inválido.",
        code: "INVALID_QUERY",
      });
    }
    statusFilter = parsedStatus.data;
  }

  if (rawProjectId && !isUuid(rawProjectId)) {
    return jsonError(400, {
      error: "projectId inválido.",
      code: "INVALID_UUID",
    });
  }
  if (rawDeliverableId && !isUuid(rawDeliverableId)) {
    return jsonError(400, {
      error: "deliverableId inválido.",
      code: "INVALID_UUID",
    });
  }

  const parsedLimit = rawLimit ? Number.parseInt(rawLimit, 10) : 50;
  const limit = Number.isFinite(parsedLimit) ? parsedLimit : 50;

  try {
    const { db } = await getDb();
    const items = await listScopedDecisions(db, guard.actor.organizationId, {
      status: statusFilter,
      projectId: rawProjectId ?? undefined,
      deliverableId: rawDeliverableId ?? undefined,
      limit,
    });
    return NextResponse.json(DecisionListResponseSchema.parse({ items }), {
      status: 200,
    });
  } catch (error) {
    console.error("[GET /api/decisions] falha:", error);
    return jsonError(500, {
      error: "Erro interno ao listar decisões.",
      code: "INTERNAL_ERROR",
    });
  }
}
