import { z } from "zod";
import { MemoryScopeSchema } from "./enums.js";

export const QmdSourceTypeSchema = z.enum(["memory", "markdown"]);
export type QmdSourceType = z.infer<typeof QmdSourceTypeSchema>;

export const QmdSearchModeSchema = z.enum(["hybrid", "lexical", "vector"]);
export type QmdSearchMode = z.infer<typeof QmdSearchModeSchema>;

export const QmdScoresSchema = z.object({
  bm25: z.number().nonnegative(),
  vector: z.number(),
  rrf: z.number().nonnegative(),
});
export type QmdScores = z.infer<typeof QmdScoresSchema>;

export const QmdContextTreeNodeSchema = z.object({
  directory: z.string().min(1),
  summary: z.string().min(1),
  chunkCount: z.number().int().nonnegative(),
});
export type QmdContextTreeNode = z.infer<typeof QmdContextTreeNodeSchema>;

export const QmdSearchHitSchema = z.object({
  id: z.uuid(),
  sourceType: QmdSourceTypeSchema,
  memoryId: z.uuid().nullable(),
  sourcePath: z.string().nullable(),
  scopeType: MemoryScopeSchema,
  scopeId: z.uuid(),
  headingPath: z.string().min(1),
  lineStart: z.number().int().min(1),
  lineEnd: z.number().int().min(1),
  snippet: z.string().max(700),
  scores: QmdScoresSchema,
});
export type QmdSearchHit = z.infer<typeof QmdSearchHitSchema>;

export const QmdSearchRequestSchema = z
  .object({
    query: z.string().trim().min(2).max(500),
    mode: QmdSearchModeSchema.default("hybrid"),
    scopeType: MemoryScopeSchema.optional(),
    clientId: z.uuid().optional(),
    projectId: z.uuid().optional(),
    limit: z.number().int().min(1).max(10).default(5),
  })
  .strict();
export type QmdSearchRequest = z.input<typeof QmdSearchRequestSchema>;

export const QmdSearchResponseSchema = z.object({
  query: z.string(),
  mode: QmdSearchModeSchema,
  embeddingModel: z.string().min(1),
  degraded: z.boolean(),
  totalCandidates: z.number().int().nonnegative(),
  contextTree: z.array(QmdContextTreeNodeSchema),
  hits: z.array(QmdSearchHitSchema),
});
export type QmdSearchResponse = z.infer<typeof QmdSearchResponseSchema>;

export const QmdReindexRequestSchema = z
  .object({
    includeDocs: z.boolean().default(true),
    force: z.boolean().default(false),
  })
  .strict();
export type QmdReindexRequest = z.input<typeof QmdReindexRequestSchema>;

export const QmdReindexResponseSchema = z.object({
  indexedMemories: z.number().int().nonnegative(),
  indexedDocFiles: z.number().int().nonnegative(),
  totalChunks: z.number().int().nonnegative(),
  embeddingModel: z.string().min(1),
  degraded: z.boolean(),
});
export type QmdReindexResponse = z.infer<typeof QmdReindexResponseSchema>;
