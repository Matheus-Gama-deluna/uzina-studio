import type {
  NotificationEnabledEvents,
  NotificationEventType,
  NotificationSurface,
} from "@uzina/contracts";
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations, users } from "./auth.js";
import { decisions } from "./operations.js";
import { deliverables, projects } from "./workspace.js";

const DEFAULT_ENABLED_EVENTS: NotificationEnabledEvents = {
  decision_pending: true,
  deliverable_completed: true,
  deliverable_failed: true,
  security_critical: true,
  budget_cap_pause: true,
  agent_reply_ready: true,
  exec_delivery_ready: true,
};

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    surface: text("surface")
      .$type<NotificationSurface>()
      .default("technical")
      .notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_push_subscriptions_org_user").on(
      table.organizationId,
      table.userId
    ),
    index("idx_push_subscriptions_user_surface").on(
      table.userId,
      table.surface
    ),
  ]
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    deliverableId: uuid("deliverable_id").references(() => deliverables.id, {
      onDelete: "set null",
    }),
    decisionId: uuid("decision_id").references(() => decisions.id, {
      onDelete: "set null",
    }),
    eventType: text("event_type").$type<NotificationEventType>().notNull(),
    surface: text("surface")
      .$type<NotificationSurface>()
      .default("technical")
      .notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    actionUrl: text("action_url").notNull(),
    spokenBriefing: text("spoken_briefing"),
    readAt: timestamp("read_at", { withTimezone: true }),
    pushedAt: timestamp("pushed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_notifications_user_read_created").on(
      table.userId,
      table.readAt,
      table.createdAt
    ),
    index("idx_notifications_org_created").on(
      table.organizationId,
      table.createdAt
    ),
  ]
);

export const notificationPreferences = pgTable("notification_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  pushEnabled: boolean("push_enabled").default(true).notNull(),
  enabledEventsJson: jsonb("enabled_events_json")
    .$type<NotificationEnabledEvents>()
    .default(DEFAULT_ENABLED_EVENTS)
    .notNull(),
  quietHoursEnabled: boolean("quiet_hours_enabled").default(false).notNull(),
  quietHoursStart: text("quiet_hours_start").default("22:00").notNull(),
  quietHoursEnd: text("quiet_hours_end").default("08:00").notNull(),
  timezone: text("timezone").default("America/Sao_Paulo").notNull(),
  allowCriticalDuringQuietHours: boolean("allow_critical_during_quiet_hours")
    .default(false)
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
