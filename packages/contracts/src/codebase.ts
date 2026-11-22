import { z } from "zod";

export const CodebaseSymbolKindSchema = z.enum([
  "function",
  "class",
  "route",
  "zod_schema",
  "db_table",
  "component",
]);
export type CodebaseSymbolKind = z.infer<typeof CodebaseSymbolKindSchema>;

export const CodebaseRelationSchema = z.enum([
  "imports",
  "calls",
  "validates_with",
  "queries_table",
  "renders",
]);
export type CodebaseRelation = z.infer<typeof CodebaseRelationSchema>;

export const CodebaseAdapterIdSchema = z.enum([
  "repomix",
  "ast_grep",
  "codebase_memory_mcp",
  "qmd",
]);
export type CodebaseAdapterId = z.infer<typeof CodebaseAdapterIdSchema>;

export const CodebaseAdapterStatusSchema = z.enum([
  "ok",
  "skipped_missing_binary",
  "error",
]);
export type CodebaseAdapterStatus = z.infer<typeof CodebaseAdapterStatusSchema>;

export const CodebaseAdapterReportSchema = z
  .object({
    adapter: CodebaseAdapterIdSchema,
    status: CodebaseAdapterStatusSchema,
    version: z.string().nullable(),
    detail: z.string(),
  })
  .strict();
export type CodebaseAdapterReport = z.infer<typeof CodebaseAdapterReportSchema>;

export const CodebaseFileEntrySchema = z
  .object({
    id: z.uuid(),
    repositoryId: z.uuid(),
    path: z.string().min(1),
    sha256: z.string().min(16),
    language: z.string().min(1),
    size: z.number().int().nonnegative(),
    indexedAt: z.string().min(1),
  })
  .strict();
export type CodebaseFileEntry = z.infer<typeof CodebaseFileEntrySchema>;

export const CodebaseSymbolSchema = z
  .object({
    id: z.uuid(),
    fileId: z.uuid(),
    filePath: z.string().min(1),
    kind: CodebaseSymbolKindSchema,
    name: z.string().min(1),
    signature: z.string().min(1),
    lineStart: z.number().int().positive(),
    lineEnd: z.number().int().positive(),
    exported: z.boolean(),
    citation: z.string().min(1),
  })
  .strict();
export type CodebaseSymbol = z.infer<typeof CodebaseSymbolSchema>;

export const CodebaseEdgeSchema = z
  .object({
    id: z.uuid(),
    fromSymbolId: z.uuid(),
    toSymbolId: z.uuid(),
    fromSymbolName: z.string().min(1),
    toSymbolName: z.string().min(1),
    relation: CodebaseRelationSchema,
  })
  .strict();
export type CodebaseEdge = z.infer<typeof CodebaseEdgeSchema>;

export const SymbolGraphQuerySchema = z
  .object({
    repositoryId: z.uuid().optional(),
    symbol: z.string().trim().min(1).max(200),
    relation: CodebaseRelationSchema.optional(),
    depth: z.number().int().min(1).max(3).default(1),
    maxResults: z.number().int().min(1).max(50).default(20),
  })
  .strict();
export type SymbolGraphQuery = z.infer<typeof SymbolGraphQuerySchema>;

export const SymbolGraphResponseSchema = z
  .object({
    query: z.string().min(1),
    nodes: z.array(CodebaseSymbolSchema),
    edges: z.array(CodebaseEdgeSchema),
    tokensEstimated: z.number().int().nonnegative(),
  })
  .strict();
export type SymbolGraphResponse = z.infer<typeof SymbolGraphResponseSchema>;

export const SymbolSliceRequestSchema = z
  .object({
    repositoryId: z.uuid().optional(),
    path: z.string().trim().min(1).max(500),
    symbol: z.string().trim().min(1).max(200),
    maxBytes: z.number().int().min(128).max(16384).default(4096),
  })
  .strict();
export type SymbolSliceRequest = z.infer<typeof SymbolSliceRequestSchema>;

export const SymbolSliceResponseSchema = z
  .object({
    path: z.string().min(1),
    symbol: z.string().min(1),
    kind: CodebaseSymbolKindSchema,
    lineStart: z.number().int().positive(),
    lineEnd: z.number().int().positive(),
    citation: z.string().min(1),
    code: z.string(),
    tokensEstimated: z.number().int().nonnegative(),
    baselineFileTokens: z.number().int().nonnegative(),
    savingsPercent: z.number().min(0).max(100),
  })
  .strict();
export type SymbolSliceResponse = z.infer<typeof SymbolSliceResponseSchema>;

export const ProvenanceEntrySchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    deliverableId: z.uuid(),
    decisionId: z.uuid().nullable(),
    memoryId: z.uuid().nullable(),
    symbolId: z.uuid().nullable(),
    filePath: z.string().min(1),
    createdAt: z.string().min(1),
  })
  .strict();
export type ProvenanceEntry = z.infer<typeof ProvenanceEntrySchema>;

export const ProvenanceQuerySchema = z
  .object({
    path: z.string().trim().min(1).max(500).optional(),
    deliverableId: z.uuid().optional(),
    limit: z.number().int().min(1).max(100).default(30),
  })
  .strict();
export type ProvenanceQuery = z.infer<typeof ProvenanceQuerySchema>;

export const ProvenanceListResponseSchema = z
  .object({
    projectId: z.uuid(),
    entries: z.array(ProvenanceEntrySchema),
  })
  .strict();
export type ProvenanceListResponse = z.infer<typeof ProvenanceListResponseSchema>;

export const ChangeImpactRequestSchema = z
  .object({
    repositoryId: z.uuid().optional(),
    changedFiles: z.array(z.string().trim().min(1).max(500)).min(1).max(100),
  })
  .strict();
export type ChangeImpactRequest = z.infer<typeof ChangeImpactRequestSchema>;

export const ChangeImpactResponseSchema = z
  .object({
    changedFiles: z.array(z.string()),
    affectedSymbols: z.array(CodebaseSymbolSchema),
    affectedRoutes: z.array(CodebaseSymbolSchema),
    tokensEstimated: z.number().int().nonnegative(),
  })
  .strict();
export type ChangeImpactResponse = z.infer<typeof ChangeImpactResponseSchema>;

export const SkeletonResponseSchema = z
  .object({
    repositoryId: z.uuid().nullable(),
    entriesCount: z.number().int().nonnegative(),
    skeletonText: z.string(),
    tokensEstimated: z.number().int().nonnegative(),
    baselineTokens: z.number().int().nonnegative(),
    savingsPercent: z.number().min(0).max(100),
    maxTokensBudget: z.number().int().positive(),
  })
  .strict();
export type SkeletonResponse = z.infer<typeof SkeletonResponseSchema>;

export const CodebaseDirectorySummarySchema = z
  .object({
    directory: z.string().min(1),
    fileCount: z.number().int().nonnegative(),
    summary: z.string().min(1),
  })
  .strict();
export type CodebaseDirectorySummary = z.infer<
  typeof CodebaseDirectorySummarySchema
>;

export const CodebaseTreeResponseSchema = z
  .object({
    projectId: z.uuid(),
    repositoryId: z.uuid().nullable(),
    filesCount: z.number().int().nonnegative(),
    symbolsCount: z.number().int().nonnegative(),
    edgesCount: z.number().int().nonnegative(),
    directories: z.array(CodebaseDirectorySummarySchema),
    skeleton: SkeletonResponseSchema,
    adapters: z.array(CodebaseAdapterReportSchema),
  })
  .strict();
export type CodebaseTreeResponse = z.infer<typeof CodebaseTreeResponseSchema>;

export const CodebaseReindexRequestSchema = z
  .object({
    repositoryId: z.uuid().optional(),
    rebuild: z.boolean().default(false),
  })
  .strict();
export type CodebaseReindexRequest = z.infer<
  typeof CodebaseReindexRequestSchema
>;

export const CodebaseReindexResponseSchema = z
  .object({
    projectId: z.uuid(),
    repositoryId: z.uuid().nullable(),
    indexedFiles: z.number().int().nonnegative(),
    skippedUnchangedFiles: z.number().int().nonnegative(),
    removedFiles: z.number().int().nonnegative(),
    totalSymbols: z.number().int().nonnegative(),
    totalEdges: z.number().int().nonnegative(),
    tokensBaseline: z.number().int().nonnegative(),
    tokensSkeleton: z.number().int().nonnegative(),
    savingsPercent: z.number().min(0).max(100),
  })
  .strict();
export type CodebaseReindexResponse = z.infer<
  typeof CodebaseReindexResponseSchema
>;
