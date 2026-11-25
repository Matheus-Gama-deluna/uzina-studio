import { CleanupProjectWorktreesRequestSchema } from "@uzina/contracts";
import { NextResponse } from "next/server";
import { isUuid, jsonError } from "@/lib/api-utils";
import { READ_ROLES, WORKSPACE_WRITE_ROLES, requireOrgRole } from "@/lib/rbac";
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
    const runtimeService = await getWebWorkflowRuntime();
    const result = await runtimeService.listProjectWorktrees({
      projectId,
      organizationId: auth.actor.organizationId,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return handleWorkflowRouteError(err);
  }
}

export async function DELETE(
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

  let rawBody: unknown = { pruneAllOrphans: true };
  const rawText = await request.text();
  if (rawText.trim().length > 0) {
    try {
      rawBody = JSON.parse(rawText);
    } catch {
      return jsonError(400, {
        error: "JSON inválido no corpo da requisição.",
        code: "INVALID_JSON",
      });
    }
  }

  const parsed = CleanupProjectWorktreesRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(400, {
      error: parsed.error.issues[0]?.message ?? "Payload inválido.",
      code: "VALIDATION_ERROR",
    });
  }

  try {
    const runtimeService = await getWebWorkflowRuntime();
    const result = await runtimeService.cleanupProjectWorktrees({
      projectId,
      organizationId: auth.actor.organizationId,
      input: parsed.data,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return handleWorkflowRouteError(err);
  }
}
