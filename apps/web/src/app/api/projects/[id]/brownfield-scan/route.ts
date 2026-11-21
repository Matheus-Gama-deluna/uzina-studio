import fs from "node:fs";
import {
  BrownfieldMapSchema,
  BrownfieldScanRequestSchema,
} from "@uzina/contracts";
import { scanRepositoryBrownfield } from "@uzina/core";
import { getDb, projectRepositories } from "@uzina/db";
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { isUuid, jsonError } from "@/lib/api-utils";
import { WORKSPACE_WRITE_ROLES, requireOrgRole } from "@/lib/rbac";
import { findScopedProject } from "@/lib/studio-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireOrgRole(request, WORKSPACE_WRITE_ROLES);
  if (!auth.ok) return auth.response;

  const { id: projectId } = await context.params;
  if (!isUuid(projectId)) {
    return jsonError(400, {
      error: "ID de projeto inválido.",
      code: "INVALID_UUID",
    });
  }

  let rawBody: unknown = {};
  const textBody = await request.text();
  if (textBody.trim().length > 0) {
    try {
      rawBody = JSON.parse(textBody);
    } catch {
      return jsonError(400, {
        error: "Corpo JSON inválido.",
        code: "INVALID_JSON",
      });
    }
  }

  const parsed = BrownfieldScanRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(400, {
      error: parsed.error.issues[0]?.message ?? "Payload inválido.",
      code: "VALIDATION_ERROR",
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

  const conditions = [eq(projectRepositories.projectId, projectId)];
  if (parsed.data.repositoryId) {
    conditions.push(eq(projectRepositories.id, parsed.data.repositoryId));
  }

  const [repo] = await db
    .select()
    .from(projectRepositories)
    .where(and(...conditions))
    .orderBy(desc(projectRepositories.createdAt))
    .limit(1);

  if (!repo) {
    return jsonError(422, {
      error:
        "Projeto não possui repositório local vinculado para executar leitura brownfield.",
      code: "MISSING_REPOSITORY",
    });
  }

  if (!fs.existsSync(/*turbopackIgnore: true*/ repo.localPath)) {
    return jsonError(422, {
      error: `Diretório do repositório vinculado não encontrado em disco (${repo.name}).`,
      code: "REPOSITORY_PATH_UNAVAILABLE",
    });
  }

  try {
    const stat = fs.lstatSync(/*turbopackIgnore: true*/ repo.localPath);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      return jsonError(422, {
        error: `Caminho do repositório inválido ou symlink não permitido (${repo.name}).`,
        code: "REPOSITORY_PATH_UNAVAILABLE",
      });
    }
  } catch {
    return jsonError(422, {
      error: `Diretório do repositório indisponível (${repo.name}).`,
      code: "REPOSITORY_PATH_UNAVAILABLE",
    });
  }

  const brownfieldMap = scanRepositoryBrownfield(repo.localPath);
  return NextResponse.json(BrownfieldMapSchema.parse(brownfieldMap), {
    status: 200,
  });
}
