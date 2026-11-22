import { getDb } from "@uzina/db";
import {
  WorkflowRuntimeError,
  getProjectCodebaseTreeScoped,
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
  const repositoryIdParam = url.searchParams.get("repositoryId") ?? undefined;
  if (repositoryIdParam && !isUuid(repositoryIdParam)) {
    return jsonError(400, {
      error: "repositoryId inválido.",
      code: "INVALID_UUID",
    });
  }

  const { db } = await getDb();
  try {
    const result = await getProjectCodebaseTreeScoped(db, {
      organizationId: auth.actor.organizationId,
      projectId,
      repositoryId: repositoryIdParam,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof WorkflowRuntimeError) {
      return jsonError(err.statusCode, { error: err.message, code: err.code });
    }
    throw err;
  }
}
