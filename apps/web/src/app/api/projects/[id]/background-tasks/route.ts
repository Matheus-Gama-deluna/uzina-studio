import { BackgroundTaskListResponseSchema } from "@uzina/contracts";
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
): Promise<Response> {
  const auth = await requireOrgRole(request, READ_ROLES);
  if (!auth.ok) return auth.response;

  const { id: projectId } = await context.params;
  if (!isUuid(projectId)) {
    return jsonError(400, {
      error: "ID de projeto inválido.",
      code: "INVALID_UUID",
    });
  }

  try {
    const runtimeSvc = await getWebWorkflowRuntime();
    const items = await runtimeSvc.listProjectBackgroundTasks({
      organizationId: auth.actor.organizationId,
      projectId,
    });
    return NextResponse.json(
      BackgroundTaskListResponseSchema.parse({ items }),
      { status: 200 }
    );
  } catch (err) {
    return handleWorkflowRouteError(err);
  }
}
