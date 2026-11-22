import type {
  CodebaseRelation,
  CodebaseSymbolKind,
} from "@uzina/contracts";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations } from "./auth.js";
import { memories } from "./memories.js";
import { decisions } from "./operations.js";
import { deliverables, projectRepositories } from "./workspace.js";

export const codebaseFiles = pgTable(
  "codebase_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => projectRepositories.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    sha256: text("sha256").notNull(),
    language: text("language").notNull(),
    size: integer("size").notNull(),
    indexedAt: timestamp("indexed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("codebase_files_repo_path_idx").on(
      table.repositoryId,
      table.path
    ),
  ]
);

export const codebaseSymbols = pgTable(
  "codebase_symbols",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => codebaseFiles.id, { onDelete: "cascade" }),
    kind: text("kind").$type<CodebaseSymbolKind>().notNull(),
    name: text("name").notNull(),
    signature: text("signature").notNull(),
    lineStart: integer("line_start").notNull(),
    lineEnd: integer("line_end").notNull(),
    exported: boolean("exported").notNull().default(false),
  },
  (table) => [
    index("codebase_symbols_file_idx").on(table.fileId),
    index("codebase_symbols_name_idx").on(table.name),
  ]
);

export const codebaseEdges = pgTable(
  "codebase_edges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromSymbolId: uuid("from_symbol_id")
      .notNull()
      .references(() => codebaseSymbols.id, { onDelete: "cascade" }),
    toSymbolId: uuid("to_symbol_id")
      .notNull()
      .references(() => codebaseSymbols.id, { onDelete: "cascade" }),
    relation: text("relation").$type<CodebaseRelation>().notNull(),
  },
  (table) => [
    index("codebase_edges_from_idx").on(table.fromSymbolId),
    index("codebase_edges_to_relation_idx").on(table.toSymbolId, table.relation),
  ]
);

export const decisionProvenance = pgTable(
  "decision_provenance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    deliverableId: uuid("deliverable_id")
      .notNull()
      .references(() => deliverables.id, { onDelete: "cascade" }),
    decisionId: uuid("decision_id").references(() => decisions.id, {
      onDelete: "set null",
    }),
    memoryId: uuid("memory_id").references(() => memories.id, {
      onDelete: "set null",
    }),
    symbolId: uuid("symbol_id").references(() => codebaseSymbols.id, {
      onDelete: "set null",
    }),
    filePath: text("file_path").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("decision_provenance_org_path_idx").on(
      table.organizationId,
      table.filePath
    ),
  ]
);
