import { WorkflowAbortInputSchema } from "@uzina/contracts";
import { NextResponse } from "next/server";
import { isUuid, jsonError } from "@/lib/api-utils";
import { WORKSPACE_WRITE_ROLES, requireOrgRole } from "@/lib/rbac";
import {
  getWebWorkflowRuntime,
  handleWorkflowRouteError,
} from "@/lib/workflow-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const auth = await requireOrgRole(request, WORKSPACE_WRITE_ROLES);
  if (!auth.ok) return auth.response;

  const { id: deliverableId } = await context.params;
  if (!isUuid(deliverableId)) {
    return jsonError(400, {
      error: "ID de entregável inválido.",
      code: "INVALID_UUID",
    });
  }

  let rawBody: unknown = {};
  const rawText = await request.text();
  if (rawText.trim().length > 0) {
    try {
      rawBody = JSON.parse(rawText);
    } catch {
      return jsonError(400, {
        error: "Corpo JSON inválido",
        code: "INVALID_JSON",
      });
    }
  }

  const parsed = WorkflowAbortInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(400, {
      error: parsed.error.issues[0]?.message ?? "Payload inválido",
      code: "VALIDATION_ERROR",
    });
  }

  try {
    const runtimeSvc = await getWebWorkflowRuntime();
    const result = await runtimeSvc.abortDeliverableRun({
      deliverableId,
      organizationId: auth.actor.organizationId,
      reason: parsed.data.reason,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return handleWorkflowRouteError(err);
  }
}
