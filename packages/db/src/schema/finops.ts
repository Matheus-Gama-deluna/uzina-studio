import type { TokenSavingsTechnique } from "@uzina/contracts";
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations } from "./auth.js";
import { deliverables } from "./workspace.js";

export const tokenSavingsEvents = pgTable(
  "token_savings_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    deliverableId: uuid("deliverable_id").references(() => deliverables.id, {
      onDelete: "set null",
    }),
    technique: text("technique").$type<TokenSavingsTechnique>().notNull(),
    tokensBaseline: integer("tokens_baseline").notNull(),
    tokensActual: integer("tokens_actual").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("token_savings_events_org_created_idx").on(
      table.organizationId,
      table.createdAt
    ),
  ]
);
