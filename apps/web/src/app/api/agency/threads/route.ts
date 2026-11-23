import { AgencyThreadListResponseSchema } from "@uzina/contracts";
import { redactSensitiveText } from "@uzina/core";
import { getDb } from "@uzina/db";
import { listAgencyThreadsScoped } from "@uzina/mastra-runtime/agency";
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-utils";
import { READ_ROLES, requireOrgRole } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request): Promise<Response> {
  const auth = await requireOrgRole(request, READ_ROLES);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const rawProjectId = url.searchParams.get("projectId")?.trim() || undefined;
  const rawThreadId = url.searchParams.get("threadId")?.trim() || undefined;

  if (rawProjectId && !UUID_RE.test(rawProjectId)) {
    return jsonError(400, {
      error: "Parâmetro projectId inválido (UUID esperado).",
      code: "VALIDATION_ERROR",
    });
  }

  try {
    const { db } = await getDb();
    const res = await listAgencyThreadsScoped(db, {
      organizationId: auth.actor.organizationId,
      projectId: rawProjectId,
      threadId: rawThreadId,
    });
    return NextResponse.json(AgencyThreadListResponseSchema.parse(res), {
      status: 200,
    });
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "statusCode" in err &&
      typeof (err as { statusCode?: unknown }).statusCode === "number"
    ) {
      const wfErr = err as {
        statusCode: number;
        message?: string;
        code?: string;
      };
      return jsonError(wfErr.statusCode, {
        error: redactSensitiveText(wfErr.message ?? "Erro de acesso."),
        code: wfErr.code ?? "FORBIDDEN",
      });
    }
    return jsonError(500, {
      error: redactSensitiveText(
        err instanceof Error
          ? err.message
          : "Erro ao listar threads da equipe de agentes."
      ),
      code: "INTERNAL_ERROR",
    });
  }
}
