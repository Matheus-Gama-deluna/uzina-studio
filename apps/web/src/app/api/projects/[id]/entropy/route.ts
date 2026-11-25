import fs from "node:fs";
import { EntropyAuditReportSchema } from "@uzina/contracts";
import { getDb, projectRepositories } from "@uzina/db";
import { runEntropyAudit } from "@uzina/mastra-runtime";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { isUuid, jsonError } from "@/lib/api-utils";
import { READ_ROLES, requireOrgRole } from "@/lib/rbac";
import { findScopedProject } from "@/lib/studio-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireOrgRole(request, READ_ROLES);
  if (!auth.ok) return auth.response;

  const { id: projectId } = await context.params;
  if (!isUuid(projectId)) {
    return jsonError(400, {
      error: "ID de projeto inválido.",
      code: "INVALID_UUID",
    });
  }

  const { db } = await getDb();
  const project = await findScopedProject(
    db,
    projectId,
    auth.actor.organizationId
  );
  if (!project) {
    return jsonError(404, {
      error: "Projeto não encontrado.",
      code: "NOT_FOUND",
    });
  }

  const [repo] = await db
    .select()
    .from(projectRepositories)
    .where(eq(projectRepositories.projectId, projectId))
    .orderBy(desc(projectRepositories.createdAt))
    .limit(1);

  if (!repo || !fs.existsSync(/*turbopackIgnore: true*/ repo.localPath)) {
    return NextResponse.json(
      EntropyAuditReportSchema.parse({
        deadCodeCandidates: [],
        docSpecDrifts: [],
        orphanWorktrees: [],
        unusedDependencies: [],
      }),
      { status: 200 }
    );
  }

  try {
    const stat = fs.lstatSync(/*turbopackIgnore: true*/ repo.localPath);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      return jsonError(422, {
        error: "Caminho do repositório inválido ou symlink não permitido.",
        code: "REPOSITORY_PATH_UNAVAILABLE",
      });
    }
  } catch {
    return jsonError(422, {
      error: "Diretório do repositório indisponível.",
      code: "REPOSITORY_PATH_UNAVAILABLE",
    });
  }

  const report = await runEntropyAudit({
    workspaceRoot: repo.localPath,
    db,
    organizationId: auth.actor.organizationId,
    projectId,
  });

  return NextResponse.json(EntropyAuditReportSchema.parse(report), {
    status: 200,
  });
}
