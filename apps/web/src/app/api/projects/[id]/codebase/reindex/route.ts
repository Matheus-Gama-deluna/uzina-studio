import { CodebaseReindexRequestSchema } from "@uzina/contracts";
import { getDb } from "@uzina/db";
import {
  WorkflowRuntimeError,
  syncRepositoryCodebase,
} from "@uzina/mastra-runtime";
import { NextResponse } from "next/server";
import { isUuid, jsonError } from "@/lib/api-utils";
import { VAULT_WRITE_ROLES, requireOrgRole } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireOrgRole(request, VAULT_WRITE_ROLES);
  if (!auth.ok) return auth.response;

  const { id: projectId } = await context.params;
  if (!isUuid(projectId)) {
    return jsonError(400, {
      error: "ID de projeto inválido.",
      code: "INVALID_UUID",
    });
  }

  let rawBody: unknown = {};
  const textBody = await request.text();
  if (textBody.trim().length > 0) {
    try {
      rawBody = JSON.parse(textBody);
    } catch {
      return jsonError(400, {
        error: "Corpo JSON inválido.",
        code: "INVALID_JSON",
      });
    }
  }

  const parsed = CodebaseReindexRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(400, {
      error: parsed.error.issues[0]?.message ?? "Payload inválido.",
      code: "VALIDATION_ERROR",
    });
  }

  const { db } = await getDb();
  try {
    const result = await syncRepositoryCodebase(db, {
      organizationId: auth.actor.organizationId,
      projectId,
      repositoryId: parsed.data.repositoryId,
      rebuild: parsed.data.rebuild,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof WorkflowRuntimeError) {
      return jsonError(err.statusCode, { error: err.message, code: err.code });
    }
    throw err;
  }
}
