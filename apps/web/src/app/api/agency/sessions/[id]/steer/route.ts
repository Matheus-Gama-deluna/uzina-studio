import { AgencySessionSteerRequestSchema } from "@uzina/contracts";
import { getDb } from "@uzina/db";
import { steerSessionScoped } from "@uzina/mastra-runtime";
import { NextResponse } from "next/server";
import { jsonError, parseJsonBody } from "@/lib/api-utils";
import { WORKSPACE_WRITE_ROLES, requireOrgRole } from "@/lib/rbac";
import { handleWorkflowRouteError } from "@/lib/workflow-runtime";

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

  const parsed = await parseJsonBody(request, AgencySessionSteerRequestSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const { db } = await getDb();
    const res = await steerSessionScoped(db, {
      sessionId,
      actor: {
        organizationId: auth.actor.organizationId,
        userId: auth.actor.userId,
        role: auth.actor.role,
      },
      request: parsed.data,
    });
    return NextResponse.json(res, { status: 200 });
  } catch (err) {
    return handleWorkflowRouteError(err);
  }
}
