import { AgencyChatRequestSchema } from "@uzina/contracts";
import { redactSensitiveText } from "@uzina/core";
import { getDb } from "@uzina/db";
import { handleAgencyChatScoped } from "@uzina/mastra-runtime/agency";
import { buildSpokenSummary } from "@uzina/mastra-runtime";
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-utils";
import { READ_ROLES, requireOrgRole } from "@/lib/rbac";
import { tryGetServerMasterKey } from "@/lib/vault";
import { getWebWorkflowRuntime } from "@/lib/workflow-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireOrgRole(request, READ_ROLES);
  if (!auth.ok) return auth.response;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonError(400, {
      error: "Corpo JSON inválido.",
      code: "INVALID_JSON",
    });
  }

  const parsed = AgencyChatRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(400, {
      error:
        parsed.error.issues[0]?.message ??
        "Requisição de chat da equipe de agentes inválida.",
      code: "VALIDATION_ERROR",
    });
  }

  try {
    const { db } = await getDb();
    const workflowService = await getWebWorkflowRuntime().catch(() => undefined);
    const res = await handleAgencyChatScoped(db, {
      actor: {
        organizationId: auth.actor.organizationId,
        userId: auth.actor.userId,
        role: auth.actor.role,
      },
      masterKey: tryGetServerMasterKey(),
      workflowService,
      request: parsed.data,
    });
    const spokenSummary = buildSpokenSummary(res.reply);
    return NextResponse.json({ ...res, spokenSummary }, { status: 200 });
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "statusCode" in err &&
      typeof (err as { statusCode?: unknown }).statusCode === "number"
    ) {
      const wfErr = err as { statusCode: number; message?: string; code?: string };
      return jsonError(wfErr.statusCode, {
        error: redactSensitiveText(wfErr.message ?? "Erro de permissão."),
        code: wfErr.code ?? "FORBIDDEN",
      });
    }
    return jsonError(500, {
      error: "Erro ao processar orquestração de agentes.",
      code: "INTERNAL_ERROR",
    });
  }
}
