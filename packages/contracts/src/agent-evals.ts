import { z } from "zod";
import { AgencyAgentRoleSchema } from "./agency.js";

export const AgentTrajectoryEvalCaseSchema = z
  .object({
    caseId: z.string().trim().min(1).max(120),
    title: z.string().trim().min(1).max(240),
    agentRole: AgencyAgentRoleSchema,
    requiredTools: z.array(z.string().trim().min(1).max(120)),
    forbiddenTools: z.array(z.string().trim().min(1).max(120)).default([]),
    expectedToolOrder: z.array(z.string().trim().min(1).max(120)).default([]),
    requireTestLockRespected: z.boolean().default(false),
    requireSpecTraceability: z.boolean().default(false),
    maxBudgetUsd: z.number().positive().optional(),
  })
  .strict();
export type AgentTrajectoryEvalCase = z.input<
  typeof AgentTrajectoryEvalCaseSchema
>;

export const AgentTrajectoryEvalResultSchema = z
  .object({
    caseId: z.string().trim().min(1).max(120),
    agentRole: AgencyAgentRoleSchema,
    passed: z.boolean(),
    calledRequiredTools: z.array(z.string().trim().min(1).max(120)),
    forbiddenToolsCalled: z.array(z.string().trim().min(1).max(120)),
    noToolErrors: z.boolean(),
    toolOrderRespected: z.boolean(),
    testLockRespected: z.boolean(),
    specTraceabilityComplete: z.boolean(),
    budgetWithinCap: z.boolean(),
    failureReasons: z.array(z.string().trim().min(1).max(500)).default([]),
    durationMs: z.number().int().nonnegative(),
  })
  .strict();
export type AgentTrajectoryEvalResult = z.infer<
  typeof AgentTrajectoryEvalResultSchema
>;

export const AgentTrajectoryEvalReportSchema = z
  .object({
    suiteName: z.string().trim().min(1).max(160),
    executedAt: z.iso.datetime(),
    passed: z.boolean(),
    totalCases: z.number().int().nonnegative(),
    passedCases: z.number().int().nonnegative(),
    failedCases: z.number().int().nonnegative(),
    results: z.array(AgentTrajectoryEvalResultSchema),
  })
  .strict();
export type AgentTrajectoryEvalReport = z.infer<
  typeof AgentTrajectoryEvalReportSchema
>;

export const RoleEffectivenessStatsSchema = z
  .object({
    runs: z.number().int().nonnegative(),
    avgTokens: z.number().nonnegative(),
    avgLatencyMs: z.number().nonnegative(),
    failureRate: z.number().min(0).max(1),
  })
  .strict();
export type RoleEffectivenessStats = z.infer<
  typeof RoleEffectivenessStatsSchema
>;

export const AgentEffectivenessMetricsSchema = z
  .object({
    firstPassVerifyRate: z.number().min(0).max(100),
    averageVerifyAttempts: z.number().nonnegative(),
    skillAdherenceRate: z.number().min(0).max(100),
    averageConfidenceScore: z.number().min(0).max(100),
    reworkCostUsd: z.number().nonnegative(),
    byRole: z.record(AgencyAgentRoleSchema, RoleEffectivenessStatsSchema),
  })
  .strict();
export type AgentEffectivenessMetrics = z.infer<
  typeof AgentEffectivenessMetricsSchema
>;
