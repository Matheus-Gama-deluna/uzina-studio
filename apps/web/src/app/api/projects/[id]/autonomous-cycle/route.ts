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

  const { id: projectId } = await context.params;
  if (!isUuid(projectId)) {
    return jsonError(400, {
      error: "ID de projeto inválido.",
      code: "INVALID_UUID",
    });
  }

  try {
    const runtimeService = await getWebWorkflowRuntime();
    const res = await runtimeService.runProjectAutonomousCycle({
      projectId,
      organizationId: auth.actor.organizationId,
    });
    return NextResponse.json(res, { status: 200 });
  } catch (err) {
    return handleWorkflowRouteError(err);
  }
}
