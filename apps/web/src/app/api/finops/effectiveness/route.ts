import { AgentEffectivenessMetricsSchema } from "@uzina/contracts";
import { getDb } from "@uzina/db";
import { computeAgentEffectivenessMetricsScoped } from "@uzina/mastra-runtime";
import { NextResponse } from "next/server";
import { isUuid, jsonError } from "@/lib/api-utils";
import { READ_ROLES, requireOrgRole } from "@/lib/rbac";
import { findScopedProject } from "@/lib/studio-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireOrgRole(request, READ_ROLES);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const rawProjectId = url.searchParams.get("projectId");
  if (rawProjectId && !isUuid(rawProjectId)) {
    return jsonError(400, {
      error: "projectId inválido.",
      code: "INVALID_UUID",
    });
  }

  const { db } = await getDb();
  if (rawProjectId) {
    const scopedProject = await findScopedProject(
      db,
      rawProjectId,
      auth.actor.organizationId
    );
    if (!scopedProject) {
      return jsonError(404, {
        error: "Projeto não encontrado.",
        code: "NOT_FOUND",
      });
    }
  }

  const metrics = await computeAgentEffectivenessMetricsScoped(db, {
    organizationId: auth.actor.organizationId,
    ...(rawProjectId ? { projectId: rawProjectId } : {}),
  });

  return NextResponse.json(AgentEffectivenessMetricsSchema.parse(metrics), {
    status: 200,
  });
}
