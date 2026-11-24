import { NextResponse } from "next/server";
import { isUuid, jsonError } from "@/lib/api-utils";
import { WORKSPACE_WRITE_ROLES, requireOrgRole } from "@/lib/rbac";
import {
  getWebWorkflowRuntime,
  handleWorkflowRouteError,
} from "@/lib/workflow-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
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

  try {
    const runtimeService = await getWebWorkflowRuntime();
    const res = await runtimeService.cleanupDeliverableWorktree({
      deliverableId,
      organizationId: auth.actor.organizationId,
    });
    return NextResponse.json(res, { status: 200 });
  } catch (err) {
    return handleWorkflowRouteError(err);
  }
}
