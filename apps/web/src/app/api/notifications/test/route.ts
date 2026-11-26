import { getDb } from "@uzina/db";
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-utils";
import { dispatchNotificationEvent } from "@/lib/notifications-service";
import { READ_ROLES, requireOrgRole } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const guard = await requireOrgRole(request, READ_ROLES);
  if (!guard.ok) return guard.response;

  try {
    const { db } = await getDb();
    const summary = await dispatchNotificationEvent(db, {
      organizationId: guard.actor.organizationId,
      targetUserId: guard.actor.userId,
      eventType: "decision_pending",
      surface: "technical",
      title: "Teste de Notificação Uzina Studio",
      body: "Web Push e Central In-App ativos para este dispositivo.",
      actionUrl: "/app/settings",
      spokenBriefing:
        "Notificação de teste recebida com sucesso no Uzina Studio.",
    });

    return NextResponse.json({ ok: true, ...summary }, { status: 200 });
  } catch (err) {
    console.error("[POST /api/notifications/test] falha:", err);
    return jsonError(500, {
      error: "Erro ao disparar notificação de teste.",
      code: "INTERNAL_ERROR",
    });
  }
}
