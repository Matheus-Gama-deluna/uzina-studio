import type {
  DecisionStatus,
  DecisionType,
  ExecutionEventType,
  PovTestStatus,
  SarifLog21,
  ScannerExecutionRecord,
  SecurityScanMode,
  SecurityScanStatus,
  SecurityScanSummaryCounts,
  SecuritySeverity,
  SecurityTargetType,
  TriageVerdict,
} from "@uzina/contracts";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations, users } from "./auth.js";
import { deliverables, projects } from "./workspace.js";

export const decisions = pgTable(
  "decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deliverableId: uuid("deliverable_id")
      .notNull()
      .references(() => deliverables.id, { onDelete: "cascade" }),
    mastraStepId: text("mastra_step_id").notNull(),
    decisionType: text("decision_type").$type<DecisionType>().notNull(),
    summary: text("summary").notNull(),
    payloadJson: jsonb("payload_json")
      .$type<Record<string, unknown>>()
      .notNull(),
    status: text("status")
      .$type<DecisionStatus>()
      .default("pending")
      .notNull(),
    humanFeedback: text("human_feedback"),
    resolvedBy: uuid("resolved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_decisions_deliverable_status").on(
      table.deliverableId,
      table.status
    ),
    index("idx_decisions_status_created").on(table.status, table.createdAt),
  ]
);

export const securityScans = pgTable(
  "security_scans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    deliverableId: uuid("deliverable_id").references(() => deliverables.id, {
      onDelete: "set null",
    }),
    mode: text("mode").$type<SecurityScanMode>().notNull(),
    targetType: text("target_type").$type<SecurityTargetType>().notNull(),
    targetRef: text("target_ref").notNull(),
    scannersRun: text("scanners_run").array().notNull(),
    scannerStatusesJson: jsonb("scanner_statuses_json")
      .$type<ScannerExecutionRecord[]>()
      .notNull()
      .default([]),
    sarifRawJson: jsonb("sarif_raw_json").$type<SarifLog21>().notNull(),
    summaryCountsJson: jsonb("summary_counts_json")
      .$type<SecurityScanSummaryCounts>()
      .notNull(),
    status: text("status")
      .$type<SecurityScanStatus>()
      .default("running")
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_security_scans_org_created").on(
      table.organizationId,
      table.createdAt
    ),
    index("idx_security_scans_deliverable").on(table.deliverableId),
  ]
);

export const securityFindings = pgTable(
  "security_findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scanId: uuid("scan_id")
      .notNull()
      .references(() => securityScans.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    ruleId: text("rule_id").notNull(),
    scanner: text("scanner").notNull(),
    severity: text("severity").$type<SecuritySeverity>().notNull(),
    filePath: text("file_path"),
    lineStart: integer("line_start"),
    title: text("title").notNull(),
    description: text("description").notNull(),
    fingerprint: text("fingerprint").notNull(),
    triageVerdict: text("triage_verdict")
      .$type<TriageVerdict>()
      .default("pending")
      .notNull(),
    triageRationale: text("triage_rationale"),
    suppressedInMemory: boolean("suppressed_in_memory").default(false).notNull(),
    povTestStatus: text("pov_test_status")
      .$type<PovTestStatus>()
      .default("not_applicable")
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_security_findings_scan_severity").on(
      table.scanId,
      table.severity
    ),
    index("idx_security_findings_project_fingerprint").on(
      table.projectId,
      table.fingerprint
    ),
  ]
);

export const executionEvents = pgTable(
  "execution_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deliverableId: uuid("deliverable_id")
      .notNull()
      .references(() => deliverables.id, { onDelete: "cascade" }),
    stage: text("stage").notNull(),
    actorRole: text("actor_role").notNull(),
    eventType: text("event_type").$type<ExecutionEventType>().notNull(),
    tokensInput: integer("tokens_input").default(0).notNull(),
    tokensOutput: integer("tokens_output").default(0).notNull(),
    cacheReadTokens: integer("cache_read_tokens").default(0).notNull(),
    estimatedCostUsd: numeric("estimated_cost_usd", {
      precision: 12,
      scale: 6,
    })
      .default("0")
      .notNull(),
    payloadJson: jsonb("payload_json")
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_execution_events_deliverable_created").on(
      table.deliverableId,
      table.createdAt
    ),
  ]
);
