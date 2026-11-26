import { MarkNotificationsReadRequestSchema } from "@uzina/contracts";
import { getDb, notifications } from "@uzina/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { jsonError, parseJsonBody } from "@/lib/api-utils";
import { READ_ROLES, requireOrgRole } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const guard = await requireOrgRole(request, READ_ROLES);
  if (!guard.ok) return guard.response;

  const body = await parseJsonBody(request, MarkNotificationsReadRequestSchema);
  if (!body.ok) return body.response;

  try {
    const { db } = await getDb();
    const now = new Date();
    if (body.data.all) {
      await db
        .update(notifications)
        .set({ readAt: now })
        .where(
          and(
            eq(notifications.organizationId, guard.actor.organizationId),
            eq(notifications.userId, guard.actor.userId),
            isNull(notifications.readAt)
          )
        );
    } else if (body.data.ids && body.data.ids.length > 0) {
      await db
        .update(notifications)
        .set({ readAt: now })
        .where(
          and(
            eq(notifications.organizationId, guard.actor.organizationId),
            eq(notifications.userId, guard.actor.userId),
            inArray(notifications.id, body.data.ids),
            isNull(notifications.readAt)
          )
        );
    }

    const [unreadAgg] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.organizationId, guard.actor.organizationId),
          eq(notifications.userId, guard.actor.userId),
          isNull(notifications.readAt)
        )
      );

    return NextResponse.json(
      { ok: true, unreadCount: Number(unreadAgg?.count ?? 0) },
      { status: 200 }
    );
  } catch (err) {
    console.error("[POST /api/notifications/read] falha:", err);
    return jsonError(500, {
      error: "Erro ao marcar notificações como lidas.",
      code: "INTERNAL_ERROR",
    });
  }
}
