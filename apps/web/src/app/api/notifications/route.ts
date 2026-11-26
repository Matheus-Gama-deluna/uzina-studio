import { NotificationListResponseSchema } from "@uzina/contracts";
import { getDb } from "@uzina/db";
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-utils";
import { listUserNotifications } from "@/lib/notifications-service";
import { READ_ROLES, requireOrgRole } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const guard = await requireOrgRole(request, READ_ROLES);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit ? Number.parseInt(rawLimit, 10) : 50;

  try {
    const { db } = await getDb();
    const result = await listUserNotifications(db, {
      organizationId: guard.actor.organizationId,
      userId: guard.actor.userId,
      limit: Number.isFinite(limit) ? limit : 50,
    });
    return NextResponse.json(NotificationListResponseSchema.parse(result), {
      status: 200,
    });
  } catch (err) {
    console.error("[GET /api/notifications] falha:", err);
    return jsonError(500, {
      error: "Erro ao carregar notificações.",
      code: "INTERNAL_ERROR",
    });
  }
}
