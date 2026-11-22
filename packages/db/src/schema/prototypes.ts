import type {
  DesignTokensW3C,
  PrototypeLevel,
  PrototypeSource,
} from "@uzina/contracts";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { deliverables, projects } from "./workspace.js";

export const designPrototypes = pgTable(
  "design_prototypes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    deliverableId: uuid("deliverable_id").references(() => deliverables.id, {
      onDelete: "set null",
    }),
    level: integer("level").$type<PrototypeLevel>().notNull(),
    source: text("source").$type<PrototypeSource>().notNull(),
    title: text("title").notNull(),
    htmlStoragePath: text("html_storage_path").notNull(),
    tokensJson: jsonb("tokens_json").$type<DesignTokensW3C>().notNull(),
    wireframeMermaid: text("wireframe_mermaid"),
    approved: boolean("approved").notNull().default(false),
    handoffPath: text("handoff_path"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("design_prototypes_project_idx").on(table.projectId)]
);
