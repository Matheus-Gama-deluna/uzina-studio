import { z } from "zod";
import { HttpUrlSchema } from "./errors.js";

export const WorkspaceKindSchema = z.enum(["worktree", "docker"]);
export type WorkspaceKind = z.infer<typeof WorkspaceKindSchema>;

export const CodingExecutorModeSchema = z.enum([
  "opencode",
  "mastra_coding_agent",
]);
export type CodingExecutorMode = z.infer<typeof CodingExecutorModeSchema>;

export const TokenSavingsTechniqueSchema = z.enum([
  "prompt_cache",
  "qmd",
  "ast_graph",
  "skeleton",
  "observational_memory",
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

export const LlmUsageCallEventSchema = z
  .object({
    id: z.uuid(),
    deliverableId: z.uuid().nullable(),
    stage: z.string().trim().min(1).max(120),
    actorRole: z.string().trim().min(1).max(80),
    modelId: z.string().trim().min(1).max(160).nullable(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cacheReadTokens: z.number().int().nonnegative(),
    estimatedCostUsd: z.number().nonnegative(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type LlmUsageCallEvent = z.infer<typeof LlmUsageCallEventSchema>;

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
    totalLlmTokens: z.number().int().nonnegative().default(0),
    totalLlmCostUsd: z.number().nonnegative().default(0),
    recentLlmCalls: z.array(LlmUsageCallEventSchema).default([]),
  })
  .strict();
export type FinopsSummary = z.infer<typeof FinopsSummarySchema>;

export const EmbeddingEngineModeSchema = z.enum([
  "deterministic",
  "onnx_e5_small",
  "ollama",
]);
export type EmbeddingEngineMode = z.infer<typeof EmbeddingEngineModeSchema>;

export const AstEngineModeSchema = z.enum(["ts_native", "polyglot"]);
export type AstEngineMode = z.infer<typeof AstEngineModeSchema>;

export const EngineOptionTelemetrySchema = z
  .object({
    id: z.string().min(1),
    category: z.enum(["embedding", "ast", "workspace", "executor"]),
    label: z.string().min(1),
    diskMb: z.number().nonnegative(),
    ramMb: z.number().nonnegative(),
    cpuImpact: z.string().min(1),
    benefitSummary: z.string().min(1),
    recommendedFor: z.string().min(1),
  })
  .strict();
export type EngineOptionTelemetry = z.infer<typeof EngineOptionTelemetrySchema>;

export const EngineConfigSchema = z
  .object({
    organizationId: z.uuid(),
    embeddingMode: EmbeddingEngineModeSchema,
    ollamaBaseUrl: HttpUrlSchema,
    ollamaEmbeddingModel: z.string().trim().min(1).max(120),
    astMode: AstEngineModeSchema,
    workspaceKind: WorkspaceKindSchema,
    codingExecutorMode: CodingExecutorModeSchema.default("opencode"),
    skeletonMaxTokens: z.number().int().min(200).max(8000),
    qmdTopK: z.number().int().min(1).max(10),
    autoInjectInRunner: z.boolean(),
    dockerCpuLimit: z.string().trim().min(1).max(16),
    dockerMemoryLimit: z.string().trim().min(2).max(16),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type EngineConfig = z.infer<typeof EngineConfigSchema>;

export const UpdateEngineConfigSchema = z
  .object({
    embeddingMode: EmbeddingEngineModeSchema.optional(),
    ollamaBaseUrl: HttpUrlSchema.optional(),
    ollamaEmbeddingModel: z.string().trim().min(1).max(120).optional(),
    astMode: AstEngineModeSchema.optional(),
    workspaceKind: WorkspaceKindSchema.optional(),
    codingExecutorMode: CodingExecutorModeSchema.optional(),
    skeletonMaxTokens: z.number().int().min(200).max(8000).optional(),
    qmdTopK: z.number().int().min(1).max(10).optional(),
    autoInjectInRunner: z.boolean().optional(),
    dockerCpuLimit: z.string().trim().min(1).max(16).optional(),
    dockerMemoryLimit: z.string().trim().min(2).max(16).optional(),
  })
  .strict();
export type UpdateEngineConfig = z.infer<typeof UpdateEngineConfigSchema>;

export const EngineConfigResponseSchema = z
  .object({
    config: EngineConfigSchema,
    catalog: z.array(EngineOptionTelemetrySchema),
    activeEmbeddingProviderId: z.string().min(1),
    degraded: z.boolean(),
  })
  .strict();
export type EngineConfigResponse = z.infer<typeof EngineConfigResponseSchema>;
