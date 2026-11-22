import { UpdatePrototypeApprovalSchema } from "@uzina/contracts";
import { getDb } from "@uzina/db";
import {
  WorkflowRuntimeError,
  approvePrototypeScoped,
} from "@uzina/mastra-runtime";
import { NextResponse } from "next/server";
import { isUuid, jsonError } from "@/lib/api-utils";
import { WORKSPACE_WRITE_ROLES, requireOrgRole } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; prototypeId: string }> }
) {
  const auth = await requireOrgRole(request, WORKSPACE_WRITE_ROLES);
  if (!auth.ok) return auth.response;

  const { id: projectId, prototypeId } = await context.params;
  if (!isUuid(projectId) || !isUuid(prototypeId)) {
    return jsonError(400, {
      error: "ID de projeto ou protótipo inválido.",
      code: "INVALID_UUID",
    });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonError(400, {
      error: "Corpo JSON inválido.",
      code: "INVALID_JSON",
    });
  }

  const parsed = UpdatePrototypeApprovalSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(400, {
      error: parsed.error.issues[0]?.message ?? "Payload inválido.",
      code: "VALIDATION_ERROR",
    });
  }

  const { db } = await getDb();
  try {
    const updated = await approvePrototypeScoped(db, {
      organizationId: auth.actor.organizationId,
      projectId,
      prototypeId,
      input: parsed.data,
    });
    return NextResponse.json(updated, { status: 200 });
  } catch (err) {
    if (err instanceof WorkflowRuntimeError) {
      return jsonError(err.statusCode, { error: err.message, code: err.code });
    }
    throw err;
  }
}
