import {
  PushSubscriptionDeleteSchema,
  PushSubscriptionInputSchema,
} from "@uzina/contracts";
import { getDb, pushSubscriptions } from "@uzina/db";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { jsonError, parseJsonBody } from "@/lib/api-utils";
import { READ_ROLES, requireOrgRole } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const guard = await requireOrgRole(request, READ_ROLES);
  if (!guard.ok) return guard.response;

  const body = await parseJsonBody(request, PushSubscriptionInputSchema);
  if (!body.ok) return body.response;

  try {
    const { db } = await getDb();
    const [existing] = await db
      .select({
        id: pushSubscriptions.id,
        organizationId: pushSubscriptions.organizationId,
        userId: pushSubscriptions.userId,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, body.data.endpoint))
      .limit(1);

    if (
      existing &&
      (existing.organizationId !== guard.actor.organizationId ||
        existing.userId !== guard.actor.userId)
    ) {
      return jsonError(409, {
        error: "Este endpoint Push já está vinculado a outro usuário.",
        code: "ENDPOINT_CONFLICT",
      });
    }

    await db
      .insert(pushSubscriptions)
      .values({
        organizationId: guard.actor.organizationId,
        userId: guard.actor.userId,
        endpoint: body.data.endpoint,
        p256dh: body.data.keys.p256dh,
        auth: body.data.keys.auth,
        surface: body.data.surface,
        userAgent: body.data.userAgent ?? request.headers.get("user-agent") ?? null,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          p256dh: body.data.keys.p256dh,
          auth: body.data.keys.auth,
          surface: body.data.surface,
          userAgent:
            body.data.userAgent ?? request.headers.get("user-agent") ?? null,
        },
        setWhere: and(
          eq(pushSubscriptions.organizationId, guard.actor.organizationId),
          eq(pushSubscriptions.userId, guard.actor.userId)
        ),
      });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/notifications/subscriptions] falha:", err);
    return jsonError(500, {
      error: "Erro ao registrar inscrição de Push.",
      code: "INTERNAL_ERROR",
    });
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const guard = await requireOrgRole(request, READ_ROLES);
  if (!guard.ok) return guard.response;

  const body = await parseJsonBody(request, PushSubscriptionDeleteSchema);
  if (!body.ok) return body.response;

  try {
    const { db } = await getDb();
    await db
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.organizationId, guard.actor.organizationId),
          eq(pushSubscriptions.userId, guard.actor.userId),
          eq(pushSubscriptions.endpoint, body.data.endpoint)
        )
      );

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("[DELETE /api/notifications/subscriptions] falha:", err);
    return jsonError(500, {
      error: "Erro ao remover inscrição de Push.",
      code: "INTERNAL_ERROR",
    });
  }
}
