import { NextResponse } from "next/server";
import { isUuid, jsonError } from "@/lib/api-utils";
import { VAULT_WRITE_ROLES, requireOrgRole } from "@/lib/rbac";
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
  const auth = await requireOrgRole(request, VAULT_WRITE_ROLES);
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
    const outcome = await runtimeService.mergeDeliverableBranch({
      deliverableId,
      organizationId: auth.actor.organizationId,
    });
    return NextResponse.json(outcome, { status: 200 });
  } catch (err) {
    return handleWorkflowRouteError(err);
  }
}
