import fs from "node:fs";
import path from "node:path";
import { QmdReindexRequestSchema } from "@uzina/contracts";
import { getDb } from "@uzina/db";
import { WorkflowRuntimeError, reindexWorkspaceQmd } from "@uzina/mastra-runtime";
import { NextResponse } from "next/server";
import { jsonError, parseJsonBody } from "@/lib/api-utils";
import { VAULT_WRITE_ROLES, requireOrgRole } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function resolveDocsWorkspaceRoot(): string {
  const candidates = [
    process.cwd(),
    path.resolve(process.cwd(), "..", ".."),
  ];
  for (const candidate of candidates) {
    if (
      fs.existsSync(path.join(candidate, "docs")) ||
      fs.existsSync(path.join(candidate, ".uzina"))
    ) {
      return candidate;
    }
  }
  return process.cwd();
}

export async function POST(request: Request): Promise<Response> {
  const guard = await requireOrgRole(request, VAULT_WRITE_ROLES);
  if (!guard.ok) return guard.response;

  const parsed = await parseJsonBody(request, QmdReindexRequestSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const { db } = await getDb();
    const result = await reindexWorkspaceQmd(db, {
      organizationId: guard.actor.organizationId,
      allowDirectRootDocs: false,
      rootDir: parsed.data.includePlatformDocs
        ? resolveDocsWorkspaceRoot()
        : undefined,
      request: parsed.data,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof WorkflowRuntimeError) {
      return jsonError(error.statusCode, {
        error: error.message,
        code: error.code,
      });
    }
    console.error("[POST /api/qmd/reindex] falha:", error);
    return jsonError(500, {
      error: "Erro interno ao reindexar memórias e documentos QMD.",
      code: "INTERNAL_ERROR",
    });
  }
}
