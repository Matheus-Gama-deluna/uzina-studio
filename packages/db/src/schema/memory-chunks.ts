import type { MemoryScope, QmdSourceType } from "@uzina/contracts";
import {
  index,
  integer,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations } from "./auth.js";
import { memories } from "./memories.js";

export const memoryChunks = pgTable(
  "memory_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sourceType: text("source_type").$type<QmdSourceType>().notNull(),
    memoryId: uuid("memory_id").references(() => memories.id, {
      onDelete: "cascade",
    }),
    sourcePath: text("source_path"),
    scopeType: text("scope_type").$type<MemoryScope>().notNull(),
    scopeId: uuid("scope_id").notNull(),
    headingPath: text("heading_path").notNull(),
    lineStart: integer("line_start").notNull(),
    lineEnd: integer("line_end").notNull(),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    embedding: real("embedding").array().notNull(),
    embeddingModel: text("embedding_model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_memory_chunks_org_scope").on(
      table.organizationId,
      table.scopeType,
      table.scopeId
    ),
    index("idx_memory_chunks_memory_id").on(table.memoryId),
    index("idx_memory_chunks_source_path").on(
      table.organizationId,
      table.sourcePath
    ),
  ]
);
