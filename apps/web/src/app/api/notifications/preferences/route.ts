import {
  NotificationPreferencesSchema,
  UpdateNotificationPreferencesRequestSchema,
} from "@uzina/contracts";
import { getDb, notificationPreferences } from "@uzina/db";
import { NextResponse } from "next/server";
import { jsonError, parseJsonBody } from "@/lib/api-utils";
import { getOrDefaultNotificationPreferences } from "@/lib/notifications-service";
import { READ_ROLES, requireOrgRole } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const guard = await requireOrgRole(request, READ_ROLES);
  if (!guard.ok) return guard.response;

  try {
    const { db } = await getDb();
    const prefs = await getOrDefaultNotificationPreferences(db, {
      userId: guard.actor.userId,
    });
    return NextResponse.json(NotificationPreferencesSchema.parse(prefs), {
      status: 200,
    });
  } catch (err) {
    console.error("[GET /api/notifications/preferences] falha:", err);
    return jsonError(500, {
      error: "Erro ao carregar preferências de notificação.",
      code: "INTERNAL_ERROR",
    });
  }
}

export async function PUT(request: Request): Promise<Response> {
  const guard = await requireOrgRole(request, READ_ROLES);
  if (!guard.ok) return guard.response;

  const body = await parseJsonBody(
    request,
    UpdateNotificationPreferencesRequestSchema
  );
  if (!body.ok) return body.response;

  try {
    const { db } = await getDb();
    const now = new Date();
    const data = body.data;
    await db
      .insert(notificationPreferences)
      .values({
        userId: guard.actor.userId,
        organizationId: guard.actor.organizationId,
        pushEnabled: data.pushEnabled,
        enabledEventsJson: data.enabledEvents,
        quietHoursEnabled: data.quietHoursEnabled,
        quietHoursStart: data.quietHoursStart,
        quietHoursEnd: data.quietHoursEnd,
        timezone: data.timezone,
        allowCriticalDuringQuietHours: data.allowCriticalDuringQuietHours,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: notificationPreferences.userId,
        set: {
          organizationId: guard.actor.organizationId,
          pushEnabled: data.pushEnabled,
          enabledEventsJson: data.enabledEvents,
          quietHoursEnabled: data.quietHoursEnabled,
          quietHoursStart: data.quietHoursStart,
          quietHoursEnd: data.quietHoursEnd,
          timezone: data.timezone,
          allowCriticalDuringQuietHours: data.allowCriticalDuringQuietHours,
          updatedAt: now,
        },
      });

    return NextResponse.json(NotificationPreferencesSchema.parse(data), {
      status: 200,
    });
  } catch (err) {
    console.error("[PUT /api/notifications/preferences] falha:", err);
    return jsonError(500, {
      error: "Erro ao salvar preferências de notificação.",
      code: "INTERNAL_ERROR",
    });
  }
}
