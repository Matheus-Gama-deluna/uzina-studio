import {
  NotificationItemSchema,
  NotificationPreferencesSchema,
  type NotificationEnabledEvents,
  type NotificationEventType,
  type NotificationItem,
  type NotificationPreferences,
  type NotificationSurface,
} from "@uzina/contracts";
import {
  notificationPreferences,
  notifications,
  pushSubscriptions,
  users,
  type UzinaDb,
} from "@uzina/db";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import * as webpushNs from "web-push";
import { resolveVapidKeys, type VapidKeyPair } from "./vapid";

type WebPushApi = typeof import("web-push");
const webpush: WebPushApi =
  "default" in webpushNs && webpushNs.default
    ? (webpushNs.default as WebPushApi)
    : (webpushNs as WebPushApi);

export const DEFAULT_NOTIFICATION_EVENTS: NotificationEnabledEvents = {
  decision_pending: true,
  deliverable_completed: true,
  deliverable_failed: true,
  security_critical: true,
  budget_cap_pause: true,
  agent_reply_ready: true,
  exec_delivery_ready: true,
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  pushEnabled: true,
  enabledEvents: { ...DEFAULT_NOTIFICATION_EVENTS },
  quietHoursEnabled: false,
  quietHoursStart: "22:00",
  quietHoursEnd: "08:00",
  timezone: "America/Sao_Paulo",
  allowCriticalDuringQuietHours: false,
};

const CRITICAL_EVENTS: ReadonlySet<NotificationEventType> = new Set([
  "security_critical",
  "budget_cap_pause",
]);

function parseTimeToMinutes(hhmm: string): number {
  const [hStr, mStr] = hhmm.split(":");
  const h = Number.parseInt(hStr ?? "0", 10);
  const m = Number.parseInt(mStr ?? "0", 10);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

export function isWithinQuietHours(
  now: Date,
  prefs: Pick<
    NotificationPreferences,
    "quietHoursEnabled" | "quietHoursStart" | "quietHoursEnd" | "timezone"
  >
): boolean {
  if (!prefs.quietHoursEnabled) {
    return false;
  }

  let currentMinutes: number;
  try {
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: prefs.timezone || "UTC",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const hourVal = Number.parseInt(
      parts.find((p) => p.type === "hour")?.value ?? "0",
      10
    );
    const minVal = Number.parseInt(
      parts.find((p) => p.type === "minute")?.value ?? "0",
      10
    );
    currentMinutes = (hourVal % 24) * 60 + minVal;
  } catch {
    currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  }

  const start = parseTimeToMinutes(prefs.quietHoursStart);
  const end = parseTimeToMinutes(prefs.quietHoursEnd);

  if (start === end) {
    return false;
  }
  if (start < end) {
    return currentMinutes >= start && currentMinutes < end;
  }
  // Janela atravessando meia-noite (ex.: 22:00 -> 08:00)
  return currentMinutes >= start || currentMinutes < end;
}

export function toNotificationItem(
  row: typeof notifications.$inferSelect
): NotificationItem {
  return NotificationItemSchema.parse({
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    projectId: row.projectId,
    deliverableId: row.deliverableId,
    decisionId: row.decisionId,
    eventType: row.eventType,
    surface: row.surface,
    title: row.title,
    body: row.body,
    actionUrl: row.actionUrl,
    spokenBriefing: row.spokenBriefing,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    pushedAt: row.pushedAt ? row.pushedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  });
}

export async function getOrDefaultNotificationPreferences(
  db: UzinaDb,
  params: { userId: string }
): Promise<NotificationPreferences> {
  const [row] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, params.userId))
    .limit(1);

  if (!row) {
    return {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      enabledEvents: { ...DEFAULT_NOTIFICATION_EVENTS },
    };
  }

  return NotificationPreferencesSchema.parse({
    pushEnabled: row.pushEnabled,
    enabledEvents: {
      ...DEFAULT_NOTIFICATION_EVENTS,
      ...(row.enabledEventsJson ?? {}),
    },
    quietHoursEnabled: row.quietHoursEnabled,
    quietHoursStart: row.quietHoursStart,
    quietHoursEnd: row.quietHoursEnd,
    timezone: row.timezone,
    allowCriticalDuringQuietHours: row.allowCriticalDuringQuietHours,
  });
}

export type SendWebPushFn = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  vapid: VapidKeyPair
) => Promise<void>;

const defaultSendWebPush: SendWebPushFn = async (sub, payload, vapid) => {
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  await webpush.sendNotification(sub, payload);
};

export interface DispatchNotificationInput {
  organizationId: string;
  targetUserId?: string;
  projectId?: string | null;
  deliverableId?: string | null;
  decisionId?: string | null;
  eventType: NotificationEventType;
  surface?: NotificationSurface;
  title: string;
  body: string;
  actionUrl: string;
  spokenBriefing?: string | null;
}

export async function dispatchNotificationEvent(
  db: UzinaDb,
  input: DispatchNotificationInput,
  deps?: {
    now?: Date;
    vapidKeys?: VapidKeyPair;
    sendPushImpl?: SendWebPushFn;
  }
): Promise<{
  createdCount: number;
  pushedCount: number;
  suppressedByQuietHours: number;
  purgedSubscriptions: number;
}> {
  const surface: NotificationSurface = input.surface ?? "technical";
  const now = deps?.now ?? new Date();

  let recipientIds: string[];
  if (input.targetUserId) {
    const [scopedUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, input.targetUserId),
          eq(users.organizationId, input.organizationId)
        )
      )
      .limit(1);
    recipientIds = scopedUser ? [scopedUser.id] : [];
  } else {
    const orgUsers = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.organizationId, input.organizationId));
    const allowedTechnicalRoles = new Set([
      "owner",
      "admin",
      "developer",
      "auditor",
    ]);
    recipientIds = orgUsers
      .filter((u) =>
        surface === "technical" ? allowedTechnicalRoles.has(u.role) : true
      )
      .map((u) => u.id);
  }

  if (recipientIds.length === 0) {
    return {
      createdCount: 0,
      pushedCount: 0,
      suppressedByQuietHours: 0,
      purgedSubscriptions: 0,
    };
  }

  const insertedRows = await db
    .insert(notifications)
    .values(
      recipientIds.map((userId) => ({
        organizationId: input.organizationId,
        userId,
        projectId: input.projectId ?? null,
        deliverableId: input.deliverableId ?? null,
        decisionId: input.decisionId ?? null,
        eventType: input.eventType,
        surface,
        title: input.title.slice(0, 240),
        body: input.body.slice(0, 1000),
        actionUrl: input.actionUrl.slice(0, 500),
        spokenBriefing: input.spokenBriefing
          ? input.spokenBriefing.slice(0, 600)
          : null,
      }))
    )
    .returning();

  const subscriptions = await db
    .select()
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.organizationId, input.organizationId),
        inArray(pushSubscriptions.userId, recipientIds),
        eq(pushSubscriptions.surface, surface)
      )
    );

  if (subscriptions.length === 0) {
    return {
      createdCount: insertedRows.length,
      pushedCount: 0,
      suppressedByQuietHours: 0,
      purgedSubscriptions: 0,
    };
  }

  const vapid = deps?.vapidKeys ?? resolveVapidKeys();
  const sendPush = deps?.sendPushImpl ?? defaultSendWebPush;

  let pushedCount = 0;
  let suppressedByQuietHours = 0;
  let purgedSubscriptions = 0;

  const subsByUser = new Map<string, typeof subscriptions>();
  for (const sub of subscriptions) {
    const list = subsByUser.get(sub.userId) ?? [];
    list.push(sub);
    subsByUser.set(sub.userId, list);
  }

  for (const row of insertedRows) {
    const userSubs = subsByUser.get(row.userId) ?? [];
    if (userSubs.length === 0) continue;

    const prefs = await getOrDefaultNotificationPreferences(db, {
      userId: row.userId,
    });
    const eventEnabled = prefs.enabledEvents[input.eventType] !== false;
    if (!prefs.pushEnabled || !eventEnabled) {
      continue;
    }

    const inQuiet = isWithinQuietHours(now, prefs);
    const criticalBypass =
      prefs.allowCriticalDuringQuietHours &&
      CRITICAL_EVENTS.has(input.eventType);
    if (inQuiet && !criticalBypass) {
      suppressedByQuietHours += userSubs.length;
      continue;
    }

    const [unreadAgg] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, row.userId),
          isNull(notifications.readAt)
        )
      );
    const badgeCount = Number(unreadAgg?.count ?? 1);

    const payload = JSON.stringify({
      title: row.title,
      body: row.body,
      url: row.actionUrl,
      tag: `${row.eventType}:${row.id}`,
      badgeCount,
      actions: [{ action: "open", title: "Abrir" }],
    });

    let sentForRow = false;
    for (const sub of userSubs) {
      try {
        await sendPush(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload,
          vapid
        );
        pushedCount += 1;
        sentForRow = true;
        await db
          .update(pushSubscriptions)
          .set({ lastUsedAt: now })
          .where(eq(pushSubscriptions.id, sub.id));
      } catch (err: unknown) {
        const statusCode =
          err && typeof err === "object" && "statusCode" in err
            ? (err as { statusCode?: number }).statusCode
            : undefined;
        if (statusCode === 404 || statusCode === 410) {
          await db
            .delete(pushSubscriptions)
            .where(eq(pushSubscriptions.id, sub.id));
          purgedSubscriptions += 1;
        }
      }
    }

    if (sentForRow) {
      await db
        .update(notifications)
        .set({ pushedAt: now })
        .where(eq(notifications.id, row.id));
    }
  }

  return {
    createdCount: insertedRows.length,
    pushedCount,
    suppressedByQuietHours,
    purgedSubscriptions,
  };
}

export async function listUserNotifications(
  db: UzinaDb,
  params: { organizationId: string; userId: string; limit?: number }
): Promise<{ items: NotificationItem[]; unreadCount: number }> {
  const limit = Math.min(100, Math.max(1, params.limit ?? 50));
  const rows = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.organizationId, params.organizationId),
        eq(notifications.userId, params.userId)
      )
    )
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  const [unreadAgg] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      and(
        eq(notifications.organizationId, params.organizationId),
        eq(notifications.userId, params.userId),
        isNull(notifications.readAt)
      )
    );

  return {
    items: rows.map(toNotificationItem),
    unreadCount: Number(unreadAgg?.count ?? 0),
  };
}

export async function notifyFromWorkflowState(
  db: UzinaDb,
  params: {
    organizationId: string;
    deliverableId: string;
    workflowStatus: string;
    deliverableStatus: string;
    gate?: string | null;
  }
): Promise<void> {
  if (params.workflowStatus === "suspended") {
    const isBudgetCap = params.gate === "budget_cap_pause";
    await dispatchNotificationEvent(db, {
      organizationId: params.organizationId,
      deliverableId: params.deliverableId,
      eventType: isBudgetCap ? "budget_cap_pause" : "decision_pending",
      surface: "technical",
      title: isBudgetCap
        ? "Execução pausada por teto de orçamento"
        : "Nova decisão aguardando aprovação (HITL)",
      body: isBudgetCap
        ? `A entrega ${params.deliverableId.slice(0, 8)} atingiu o teto de orçamento e aguarda revisão.`
        : `Portão ${params.gate ?? "HITL"} aberto na entrega ${params.deliverableId.slice(0, 8)}.`,
      actionUrl: "/app/decisions",
      spokenBriefing: isBudgetCap
        ? "Atenção: uma entrega foi pausada por atingir o teto de orçamento e aguarda sua decisão."
        : "Uma entrega pausou na Caixa de Decisões e aguarda sua aprovação.",
    });
    return;
  }

  if (params.workflowStatus === "completed") {
    await dispatchNotificationEvent(db, {
      organizationId: params.organizationId,
      deliverableId: params.deliverableId,
      eventType: "deliverable_completed",
      surface: "technical",
      title: "Entrega concluída com evidências verdes",
      body: `A entrega ${params.deliverableId.slice(0, 8)} concluiu o pipeline de verificação.`,
      actionUrl: "/app/deliverables",
      spokenBriefing:
        "Boa notícia: uma entrega concluiu o pipeline de verificação.",
    });
    return;
  }

  if (params.workflowStatus === "failed") {
    await dispatchNotificationEvent(db, {
      organizationId: params.organizationId,
      deliverableId: params.deliverableId,
      eventType: "deliverable_failed",
      surface: "technical",
      title: "Falha em etapa de entrega",
      body: `A entrega ${params.deliverableId.slice(0, 8)} falhou no status ${params.deliverableStatus}.`,
      actionUrl: "/app/deliverables",
      spokenBriefing:
        "Alerta: uma entrega falhou durante o pipeline e precisa de atenção.",
    });
  }
}

export async function notifyFromSecurityScan(
  db: UzinaDb,
  params: {
    organizationId: string;
    projectId?: string | null;
    deliverableId?: string | null;
    criticalCount: number;
    highCount: number;
  }
): Promise<void> {
  if (params.criticalCount <= 0) return;
  await dispatchNotificationEvent(db, {
    organizationId: params.organizationId,
    projectId: params.projectId ?? null,
    deliverableId: params.deliverableId ?? null,
    eventType: "security_critical",
    surface: "technical",
    title: `Alerta AppSec: ${params.criticalCount} achado(s) crítico(s)`,
    body: `Scan de segurança detectou ${params.criticalCount} vulnerabilidade(s) crítica(s) e ${params.highCount} alta(s).`,
    actionUrl: "/app/security",
    spokenBriefing: `Alerta crítico de segurança: foram encontrados ${params.criticalCount} problemas críticos no scan AppSec.`,
  });
}
