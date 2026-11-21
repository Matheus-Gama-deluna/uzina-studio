import type { DesignAssetType, RoleBindings } from "@uzina/contracts";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations } from "./auth.js";

export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    isDefaultInternal: boolean("is_default_internal").default(false).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_clients_organization_id").on(table.organizationId),
    uniqueIndex("uq_clients_org_slug").on(table.organizationId, table.slug),
  ]
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    defaultDevelopmentStrategy: text("default_development_strategy")
      .default("frontend_first_msw")
      .notNull(),
    maturityScore: integer("maturity_score"),
    designMdPath: text("design_md_path"),
    status: text("status").default("active").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_projects_client_id").on(table.clientId),
    uniqueIndex("uq_projects_client_slug").on(table.clientId, table.slug),
  ]
);

export const projectRepositories = pgTable(
  "project_repositories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    localPath: text("local_path").notNull(),
    remoteUrl: text("remote_url"),
    defaultBranch: text("default_branch").default("main").notNull(),
    stackMetadataJson: jsonb("stack_metadata_json")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("idx_project_repos_project_id").on(table.projectId)]
);

export const deliverables = pgTable(
  "deliverables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    repositoryId: uuid("repository_id").references(
      () => projectRepositories.id,
      { onDelete: "set null" }
    ),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").default("discovery").notNull(),
    pausedFromStatus: text("paused_from_status"),
    hasUi: boolean("has_ui").default(false).notNull(),
    developmentStrategy: text("development_strategy")
      .default("frontend_first_msw")
      .notNull(),
    tacticalPattern: text("tactical_pattern")
      .default("single_agent")
      .notNull(),
    riskLevel: text("risk_level").default("low").notNull(),
    worktreePath: text("worktree_path"),
    branchName: text("branch_name"),
    mastraRunId: text("mastra_run_id"),
    lockedBy: text("locked_by"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    verifyAttempts: integer("verify_attempts").default(0).notNull(),
    maxVerifyAttempts: integer("max_verify_attempts").default(3).notNull(),
    specMarkdown: text("spec_markdown"),
    blueprintJson: jsonb("blueprint_json").$type<Record<string, unknown> | null>(),
    evidencePackJson: jsonb("evidence_pack_json").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_deliverables_project_id").on(table.projectId),
    index("idx_deliverables_status").on(table.status),
  ]
);

export const providerProfiles = pgTable(
  "provider_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    providerType: text("provider_type").notNull(),
    baseUrl: text("base_url"),
    encryptedApiKey: text("encrypted_api_key"),
    keyPreview: text("key_preview"),
    roleBindingsJson: jsonb("role_bindings_json")
      .$type<RoleBindings>()
      .default({})
      .notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("idx_provider_profiles_org_id").on(table.organizationId)]
);

export const designAssets = pgTable(
  "design_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    deliverableId: uuid("deliverable_id").references(() => deliverables.id, {
      onDelete: "set null",
    }),
    assetType: text("asset_type").$type<DesignAssetType>().notNull(),
    title: text("title").notNull(),
    sourceUrl: text("source_url"),
    storagePath: text("storage_path"),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    intentionTags: text("intention_tags").array().default([]).notNull(),
    notes: text("notes"),
    approved: boolean("approved").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_design_assets_project_id").on(table.projectId),
    index("idx_design_assets_deliverable_id").on(table.deliverableId),
  ]
);
