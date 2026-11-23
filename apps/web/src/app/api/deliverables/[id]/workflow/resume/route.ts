import { WorkflowResumeInputSchema } from "@uzina/contracts";
import { NextResponse } from "next/server";
import { isUuid, jsonError, parseJsonBody } from "@/lib/api-utils";
import {
  VAULT_WRITE_ROLES,
  WORKSPACE_WRITE_ROLES,
  requireOrgRole,
} from "@/lib/rbac";
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

  const parsed = await parseJsonBody(request, WorkflowResumeInputSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const runtimeService = await getWebWorkflowRuntime();
    const currentState = await runtimeService.getWorkflowState({
      deliverableId,
      organizationId: auth.actor.organizationId,
    });

    if (
      (currentState.gate === "pr_evidence_approve" ||
        currentState.gate === "budget_cap_pause" ||
        parsed.data.newBudgetCapUsd !== undefined) &&
      !VAULT_WRITE_ROLES.includes(auth.actor.role)
    ) {
      return jsonError(403, {
        error:
          "Apenas owner ou admin pode aprovar ou ajustar portões de orçamento/evidência.",
        code: "FORBIDDEN",
      });
    }

    const state = await runtimeService.resumeDeliverableWorkflow({
      deliverableId,
      organizationId: auth.actor.organizationId,
      resolvedByUserId: auth.actor.userId,
      actorRole: auth.actor.role,
      input: parsed.data,
    });
    return NextResponse.json(state, { status: 200 });
  } catch (err) {
    return handleWorkflowRouteError(err);
  }
}
