import { NextResponse } from "next/server";
import { isUuid, jsonError } from "@/lib/api-utils";
import { READ_ROLES, requireOrgRole } from "@/lib/rbac";
import {
  getWebWorkflowRuntime,
  handleWorkflowRouteError,
} from "@/lib/workflow-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireOrgRole(request, READ_ROLES);
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
    const state = await runtimeService.getWorkflowState({
      deliverableId,
      organizationId: auth.actor.organizationId,
    });
    return NextResponse.json(state, { status: 200 });
  } catch (err) {
    return handleWorkflowRouteError(err);
  }
}
