import { z } from "zod";
import { isPrivateOrLoopbackUrl } from "./errors.js";

const TRUSTED_WEB_PUSH_HOST_RE =
  /^(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|push\.services\.mozilla\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)$/i;

const PushEndpointSchema = z
  .url()
  .max(2048)
  .refine((raw) => {
    try {
      const parsed = new URL(raw);
      return (
        parsed.protocol === "https:" &&
        !isPrivateOrLoopbackUrl(raw) &&
        TRUSTED_WEB_PUSH_HOST_RE.test(parsed.hostname)
      );
    } catch {
      return false;
    }
  }, "Endpoint Web Push deve usar https:// em provedor Web Push confiável (FCM, APNs, Mozilla, Windows)");

export const NotificationEventTypeSchema = z.enum([
  "decision_pending",
  "deliverable_completed",
  "deliverable_failed",
  "security_critical",
  "budget_cap_pause",
  "agent_reply_ready",
  "exec_delivery_ready",
]);
export type NotificationEventType = z.infer<typeof NotificationEventTypeSchema>;

export const NotificationSurfaceSchema = z.enum(["technical", "executive"]);
export type NotificationSurface = z.infer<typeof NotificationSurfaceSchema>;

export const NotificationEnabledEventsSchema = z.record(
  NotificationEventTypeSchema,
  z.boolean()
);
export type NotificationEnabledEvents = z.infer<
  typeof NotificationEnabledEventsSchema
>;

export const PushSubscriptionInputSchema = z
  .object({
    endpoint: PushEndpointSchema,
    keys: z
      .object({
        p256dh: z.string().min(10).max(512),
        auth: z.string().min(8).max(256),
      })
      .strict(),
    surface: NotificationSurfaceSchema.default("technical"),
    userAgent: z.string().max(512).optional(),
  })
  .strict();
export type PushSubscriptionInput = z.infer<typeof PushSubscriptionInputSchema>;

export const PushSubscriptionDeleteSchema = z
  .object({
    endpoint: PushEndpointSchema,
  })
  .strict();
export type PushSubscriptionDelete = z.infer<
  typeof PushSubscriptionDeleteSchema
>;

export const NotificationPreferencesSchema = z
  .object({
    pushEnabled: z.boolean(),
    enabledEvents: NotificationEnabledEventsSchema,
    quietHoursEnabled: z.boolean(),
    quietHoursStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    quietHoursEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    timezone: z.string().trim().min(1).max(64),
    allowCriticalDuringQuietHours: z.boolean().default(false),
  })
  .strict();
export type NotificationPreferences = z.infer<
  typeof NotificationPreferencesSchema
>;

export const UpdateNotificationPreferencesRequestSchema =
  NotificationPreferencesSchema;
export type UpdateNotificationPreferencesRequest = z.infer<
  typeof UpdateNotificationPreferencesRequestSchema
>;

export const NotificationItemSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    userId: z.uuid(),
    projectId: z.uuid().nullable(),
    deliverableId: z.uuid().nullable(),
    decisionId: z.uuid().nullable(),
    eventType: NotificationEventTypeSchema,
    surface: NotificationSurfaceSchema,
    title: z.string().min(1).max(240),
    body: z.string().min(1).max(1000),
    actionUrl: z.string().min(1).max(500),
    spokenBriefing: z.string().max(600).nullable(),
    readAt: z.iso.datetime().nullable(),
    pushedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type NotificationItem = z.infer<typeof NotificationItemSchema>;

export const NotificationListResponseSchema = z
  .object({
    items: z.array(NotificationItemSchema),
    unreadCount: z.number().int().min(0),
  })
  .strict();
export type NotificationListResponse = z.infer<
  typeof NotificationListResponseSchema
>;

export const MarkNotificationsReadRequestSchema = z
  .object({
    ids: z.array(z.uuid()).max(100).optional(),
    all: z.boolean().optional(),
  })
  .strict();
export type MarkNotificationsReadRequest = z.infer<
  typeof MarkNotificationsReadRequestSchema
>;

export const VapidPublicKeyResponseSchema = z
  .object({
    publicKey: z.string().min(10),
    configured: z.boolean(),
  })
  .strict();
export type VapidPublicKeyResponse = z.infer<
  typeof VapidPublicKeyResponseSchema
>;
