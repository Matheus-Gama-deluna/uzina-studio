import { z } from "zod";

export const WorkspaceKindSchema = z.enum(["worktree", "docker"]);
export type WorkspaceKind = z.infer<typeof WorkspaceKindSchema>;

export const TokenSavingsTechniqueSchema = z.enum([
  "prompt_cache",
  "qmd",
  "ast_graph",
  "skeleton",
]);
export type TokenSavingsTechnique = z.infer<typeof TokenSavingsTechniqueSchema>;

export const TokenSavingsEventSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    deliverableId: z.uuid().nullable(),
    technique: TokenSavingsTechniqueSchema,
    tokensBaseline: z.number().int().nonnegative(),
    tokensActual: z.number().int().nonnegative(),
    tokensSaved: z.number().int().nonnegative(),
    savingsPercent: z.number().min(0).max(100),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type TokenSavingsEvent = z.infer<typeof TokenSavingsEventSchema>;

export const RecordTokenSavingsSchema = z
  .object({
    deliverableId: z.uuid().nullable().optional(),
    technique: TokenSavingsTechniqueSchema,
    tokensBaseline: z.number().int().nonnegative(),
    tokensActual: z.number().int().nonnegative(),
  })
  .strict();
export type RecordTokenSavings = z.infer<typeof RecordTokenSavingsSchema>;

export const FinopsTechniqueBreakdownSchema = z
  .object({
    technique: TokenSavingsTechniqueSchema,
    eventsCount: z.number().int().nonnegative(),
    tokensBaseline: z.number().int().nonnegative(),
    tokensActual: z.number().int().nonnegative(),
    tokensSaved: z.number().int().nonnegative(),
    savingsPercent: z.number().min(0).max(100),
  })
  .strict();
export type FinopsTechniqueBreakdown = z.infer<
  typeof FinopsTechniqueBreakdownSchema
>;

export const FinopsSummaryRequestSchema = z
  .object({
    projectId: z.uuid().optional(),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
    limit: z.number().int().min(1).max(100).default(25),
  })
  .strict();
export type FinopsSummaryRequest = z.infer<typeof FinopsSummaryRequestSchema>;

export const FinopsSummarySchema = z
  .object({
    organizationId: z.uuid(),
    workspaceKind: WorkspaceKindSchema,
    totalEvents: z.number().int().nonnegative(),
    totalTokensBaseline: z.number().int().nonnegative(),
    totalTokensActual: z.number().int().nonnegative(),
    totalTokensSaved: z.number().int().nonnegative(),
    overallSavingsPercent: z.number().min(0).max(100),
    cacheHitRate: z.number().min(0).max(100),
    reworkRate: z.number().min(0).max(100),
    estimatedCostSavedUsd: z.number().nonnegative(),
    byTechnique: z.array(FinopsTechniqueBreakdownSchema),
    recentEvents: z.array(TokenSavingsEventSchema),
  })
  .strict();
export type FinopsSummary = z.infer<typeof FinopsSummarySchema>;
