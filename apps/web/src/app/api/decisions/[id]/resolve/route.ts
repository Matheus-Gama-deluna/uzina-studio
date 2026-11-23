import {
  ResolveDecisionResponseSchema,
  ResolveDecisionSchema,
} from "@uzina/contracts";
import { getDb } from "@uzina/db";
import { NextResponse } from "next/server";
import { isUuid, jsonError, parseJsonBody } from "@/lib/api-utils";
import { getScopedDecisionGate } from "@/lib/operations-queries";
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
): Promise<Response> {
  const guard = await requireOrgRole(request, WORKSPACE_WRITE_ROLES);
  if (!guard.ok) return guard.response;

  const { id: decisionId } = await context.params;
  if (!isUuid(decisionId)) {
    return jsonError(400, {
      error: "ID de decisão inválido.",
      code: "INVALID_UUID",
    });
  }

  const body = await parseJsonBody(request, ResolveDecisionSchema);
  if (!body.ok) return body.response;

  const { db } = await getDb();
  const scopedDecision = await getScopedDecisionGate(
    db,
    decisionId,
    guard.actor.organizationId
  );

  if (!scopedDecision) {
    return jsonError(404, {
      error: "Decisão não encontrada.",
      code: "DECISION_NOT_FOUND",
    });
  }

  if (
    (scopedDecision.decisionType === "pr_evidence_approve" ||
      scopedDecision.decisionType === "budget_cap_pause" ||
      body.data.newBudgetCapUsd !== undefined) &&
    !VAULT_WRITE_ROLES.includes(guard.actor.role)
  ) {
    return jsonError(403, {
      error:
        "Apenas owner ou admin pode resolver este portão ou alterar o teto de orçamento.",
      code: "FORBIDDEN",
    });
  }

  try {
    const runtimeService = await getWebWorkflowRuntime();
    const resolved = await runtimeService.resolveDecision({
      decisionId,
      organizationId: guard.actor.organizationId,
      resolvedByUserId: guard.actor.userId,
      actorRole: guard.actor.role,
      input: body.data,
    });
    return NextResponse.json(ResolveDecisionResponseSchema.parse(resolved), {
      status: 200,
    });
  } catch (err) {
    return handleWorkflowRouteError(err);
  }
}
