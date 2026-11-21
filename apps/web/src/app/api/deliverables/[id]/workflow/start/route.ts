import { WorkflowStartInputSchema } from "@uzina/contracts";
import { NextResponse } from "next/server";
import { isUuid, jsonError, parseJsonBody } from "@/lib/api-utils";
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
) {
  const auth = await requireOrgRole(request, WORKSPACE_WRITE_ROLES);
  if (!auth.ok) return auth.response;

  const { id: deliverableId } = await context.params;
  if (!isUuid(deliverableId)) {
    return jsonError(400, {
      error: "ID de entregável inválido.",
      code: "INVALID_UUID",
    });
  }

  const parsed = await parseJsonBody(request, WorkflowStartInputSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const runtimeService = await getWebWorkflowRuntime();
    const state = await runtimeService.startDeliverableWorkflow({
      deliverableId,
      organizationId: auth.actor.organizationId,
      input: parsed.data,
    });
    return NextResponse.json(state, { status: 200 });
  } catch (err) {
    return handleWorkflowRouteError(err);
  }
}
