import type {
  AstEngineMode,
  CodingExecutorMode,
  EmbeddingEngineMode,
  TokenSavingsTechnique,
  ToolPoliciesMap,
  WorkspaceKind,
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

export const engineConfigs = pgTable("engine_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .unique()
    .references(() => organizations.id, { onDelete: "cascade" }),
  embeddingMode: text("embedding_mode")
    .$type<EmbeddingEngineMode>()
    .notNull()
    .default("deterministic"),
  ollamaBaseUrl: text("ollama_base_url")
    .notNull()
    .default("http://127.0.0.1:11434"),
  ollamaEmbeddingModel: text("ollama_embedding_model")
    .notNull()
    .default("bge-m3"),
  astMode: text("ast_mode")
    .$type<AstEngineMode>()
    .notNull()
    .default("polyglot"),
  workspaceKind: text("workspace_kind")
    .$type<WorkspaceKind>()
    .notNull()
    .default("worktree"),
  codingExecutorMode: text("coding_executor_mode")
    .$type<CodingExecutorMode>()
    .notNull()
    .default("opencode"),
  skeletonMaxTokens: integer("skeleton_max_tokens").notNull().default(2000),
  qmdTopK: integer("qmd_top_k").notNull().default(5),
  autoInjectInRunner: boolean("auto_inject_in_runner").notNull().default(true),
  dockerCpuLimit: text("docker_cpu_limit").notNull().default("1.0"),
  dockerMemoryLimit: text("docker_memory_limit").notNull().default("512m"),
  toolPoliciesJson: jsonb("tool_policies_json")
    .$type<ToolPoliciesMap>()
    .default({
      readCode: "allow",
      runTests: "allow",
      writeFiles: "allow",
      gitFinalize: "allow",
    })
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
