import { z } from "zod";

export const DatabaseModeSchema = z.enum(["pglite", "postgres"]);
export type DatabaseMode = z.infer<typeof DatabaseModeSchema>;

export const DevelopmentStrategySchema = z.enum([
  "frontend_first_msw",
  "api_contract_first",
  "domain_first",
  "data_schema_first",
  "characterization_strangler",
  "spike_first",
]);
export type DevelopmentStrategy = z.infer<typeof DevelopmentStrategySchema>;

export const DeliverableStatusSchema = z.enum([
  "discovery",
  "spec_review",
  "visual_studio",
  "contract_tests",
  "building",
  "verifying",
  "decision_pending",
  "approved",
  "merged",
  "failed",
  "paused",
]);
export type DeliverableStatus = z.infer<typeof DeliverableStatusSchema>;

export const TacticalPatternSchema = z.enum([
  "single_agent",
  "split_lanes",
  "best_of_n",
  "council",
]);
export type TacticalPattern = z.infer<typeof TacticalPatternSchema>;

export const RiskLevelSchema = z.enum(["low", "medium", "high"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const ProviderTypeSchema = z.enum([
  "omniroute",
  "openai_compatible",
  "anthropic",
  "google",
  "ollama",
]);
export type ProviderType = z.infer<typeof ProviderTypeSchema>;

export const MemoryScopeSchema = z.enum(["org", "client", "project"]);
export type MemoryScope = z.infer<typeof MemoryScopeSchema>;

export const DecisionTypeSchema = z.enum([
  "discovery_confirm",
  "blueprint_approve",
  "visual_approve",
  "pr_evidence_approve",
  "stuck_intervention",
]);
export type DecisionType = z.infer<typeof DecisionTypeSchema>;

export const SecuritySeveritySchema = z.enum([
  "critical",
  "high",
  "medium",
  "low",
  "info",
]);
export type SecuritySeverity = z.infer<typeof SecuritySeveritySchema>;

export const TriageVerdictSchema = z.enum([
  "pending",
  "confirmed",
  "false_positive",
  "unknown",
]);
export type TriageVerdict = z.infer<typeof TriageVerdictSchema>;

export const OrgRoleSchema = z.enum(["owner", "admin", "developer", "auditor"]);
export type OrgRole = z.infer<typeof OrgRoleSchema>;
