import type { MemoryCategory, MemoryScope } from "@uzina/contracts";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./auth.js";
import { deliverables } from "./workspace.js";

export const memories = pgTable(
  "memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    scopeType: text("scope_type").$type<MemoryScope>().notNull(),
    scopeId: uuid("scope_id").notNull(),
    category: text("category").$type<MemoryCategory>().notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    sourceDeliverableId: uuid("source_deliverable_id").references(
      () => deliverables.id,
      { onDelete: "set null" }
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_memories_scope_category").on(
      table.scopeType,
      table.scopeId,
      table.category
    ),
    index("idx_memories_organization_id").on(table.organizationId),
  ]
);
