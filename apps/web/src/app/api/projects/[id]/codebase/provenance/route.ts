import { ProvenanceQuerySchema } from "@uzina/contracts";
import { getDb } from "@uzina/db";
import {
  WorkflowRuntimeError,
  listDecisionProvenanceScoped,
} from "@uzina/mastra-runtime";
import { NextResponse } from "next/server";
import { isUuid, jsonError } from "@/lib/api-utils";
import { READ_ROLES, requireOrgRole } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireOrgRole(request, READ_ROLES);
  if (!auth.ok) return auth.response;

  const { id: projectId } = await context.params;
  if (!isUuid(projectId)) {
    return jsonError(400, {
      error: "ID de projeto inválido.",
      code: "INVALID_UUID",
    });
  }

  const url = new URL(request.url);
  const rawLimit = url.searchParams.get("limit");
  const parsedQuery = ProvenanceQuerySchema.safeParse({
    path: url.searchParams.get("path") ?? undefined,
    deliverableId: url.searchParams.get("deliverableId") ?? undefined,
    limit: rawLimit ? Number(rawLimit) : undefined,
  });

  if (!parsedQuery.success) {
    return jsonError(400, {
      error: parsedQuery.error.issues[0]?.message ?? "Parâmetros inválidos.",
      code: "VALIDATION_ERROR",
    });
  }

  const { db } = await getDb();
  try {
    const result = await listDecisionProvenanceScoped(db, {
      organizationId: auth.actor.organizationId,
      projectId,
      query: parsedQuery.data,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof WorkflowRuntimeError) {
      return jsonError(err.statusCode, { error: err.message, code: err.code });
    }
    throw err;
  }
}
