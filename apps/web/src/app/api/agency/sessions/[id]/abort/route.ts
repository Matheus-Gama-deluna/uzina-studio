import { AgencySessionAbortRequestSchema } from "@uzina/contracts";
import { getDb } from "@uzina/db";
import { abortSessionScoped } from "@uzina/mastra-runtime";
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-utils";
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

  const { id: sessionId } = await context.params;
  if (!sessionId || sessionId.trim().length === 0) {
    return jsonError(400, {
      error: "ID de sessão inválido.",
      code: "VALIDATION_ERROR",
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

  const parsed = AgencySessionAbortRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(400, {
      error: parsed.error.issues[0]?.message ?? "Payload inválido",
      code: "VALIDATION_ERROR",
    });
  }

  try {
    const { db } = await getDb();
    const res = await abortSessionScoped(db, {
      sessionId,
      actor: {
        organizationId: auth.actor.organizationId,
        userId: auth.actor.userId,
        role: auth.actor.role,
      },
      request: parsed.data,
      onAbortDeliverable: async (deliverableId, reason) => {
        const runtimeSvc = await getWebWorkflowRuntime();
        const aborted = await runtimeSvc.abortDeliverableRun({
          deliverableId,
          organizationId: auth.actor.organizationId,
          reason,
        });
        return aborted.aborted;
      },
    });
    return NextResponse.json(res, { status: 200 });
  } catch (err) {
    return handleWorkflowRouteError(err);
  }
}
