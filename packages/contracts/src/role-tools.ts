import { z } from "zod";
import {
  CodebaseEdgeSchema,
  CodebaseRelationSchema,
  CodebaseSymbolKindSchema,
  CodebaseSymbolSchema,
} from "./codebase.js";
import { SemanticDiffFileSchema } from "./decisions.js";
import { MemoryCategorySchema } from "./memories.js";
import {
  DesignTokensW3CSchema,
  PrototypeLevelSchema,
  PrototypeSourceSchema,
} from "./prototypes.js";
import {
  MemoryScopeSchema,
  RiskLevelSchema,
  SecuritySeveritySchema,
  TriageVerdictSchema,
} from "./enums.js";
import {
  ScannerExecutionRecordSchema,
  SecurityFindingDTOSchema,
  TestAuditFindingSchema,
} from "./security.js";

// 1. trace_symbol_call_graph
export const SymbolCallGraphInputSchema = z
  .object({
    projectId: z.uuid(),
    repositoryId: z.uuid().optional(),
    symbol: z.string().trim().min(1).max(200),
    relation: CodebaseRelationSchema.optional(),
    depth: z.number().int().min(1).max(3).default(1),
    maxResults: z.number().int().min(1).max(50).default(20),
  })
  .strict();
export type SymbolCallGraphInput = z.input<typeof SymbolCallGraphInputSchema>;

export const SymbolCallGraphOutputSchema = z
  .object({
    query: z.string().min(1),
    nodes: z.array(CodebaseSymbolSchema).max(100),
    edges: z.array(CodebaseEdgeSchema).max(200),
    tokensEstimated: z.number().int().nonnegative(),
    truncated: z.boolean().default(false),
  })
  .strict();
export type SymbolCallGraphOutput = z.infer<typeof SymbolCallGraphOutputSchema>;

// 2. analyze_change_impact
export const ChangeImpactInputSchema = z
  .object({
    projectId: z.uuid(),
    repositoryId: z.uuid().optional(),
    changedFiles: z.array(z.string().trim().min(1).max(500)).min(1).max(100),
    maxResults: z.number().int().min(1).max(100).default(40),
  })
  .strict();
export type ChangeImpactInput = z.input<typeof ChangeImpactInputSchema>;

export const ChangeImpactOutputSchema = z
  .object({
    changedFiles: z.array(z.string()),
    affectedSymbols: z.array(CodebaseSymbolSchema).max(200),
    affectedRoutes: z.array(CodebaseSymbolSchema).max(100),
    tokensEstimated: z.number().int().nonnegative(),
    truncated: z.boolean().default(false),
  })
  .strict();
export type ChangeImpactOutput = z.infer<typeof ChangeImpactOutputSchema>;

// 3. read_symbol_source_slice
export const ReadSymbolSliceInputSchema = z
  .object({
    projectId: z.uuid(),
    repositoryId: z.uuid().optional(),
    path: z.string().trim().min(1).max(500),
    symbol: z.string().trim().min(1).max(200),
    maxBytes: z.number().int().min(128).max(16384).default(4096),
  })
  .strict();
export type ReadSymbolSliceInput = z.input<typeof ReadSymbolSliceInputSchema>;

export const ReadSymbolSliceOutputSchema = z
  .object({
    path: z.string().min(1),
    symbol: z.string().min(1),
    kind: CodebaseSymbolKindSchema,
    lineStart: z.number().int().positive(),
    lineEnd: z.number().int().positive(),
    citation: z.string().min(1),
    code: z.string().max(16384),
    redactedSecretsCount: z.number().int().nonnegative().default(0),
    tokensEstimated: z.number().int().nonnegative(),
    baselineFileTokens: z.number().int().nonnegative(),
    savingsPercent: z.number().min(0).max(100),
    truncated: z.boolean().default(false),
  })
  .strict();
export type ReadSymbolSliceOutput = z.infer<typeof ReadSymbolSliceOutputSchema>;

// 4. check_dependency_boundaries
export const DependencyBoundaryCheckInputSchema = z
  .object({
    sourcePackage: z.string().trim().min(1).max(120),
    proposedImports: z.array(z.string().trim().min(1).max(200)).min(1).max(100),
    filePath: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type DependencyBoundaryCheckInput = z.infer<
  typeof DependencyBoundaryCheckInputSchema
>;

export const DependencyBoundaryViolationSchema = z
  .object({
    targetImport: z.string().min(1),
    reason: z.string().min(1).max(500),
    severity: z.enum(["error", "warning"]),
  })
  .strict();
export type DependencyBoundaryViolation = z.infer<
  typeof DependencyBoundaryViolationSchema
>;

export const DependencyBoundaryCheckOutputSchema = z
  .object({
    passed: z.boolean(),
    sourcePackage: z.string().min(1),
    allowedInternalTargets: z.array(z.string()),
    violations: z.array(DependencyBoundaryViolationSchema).max(100),
  })
  .strict();
export type DependencyBoundaryCheckOutput = z.infer<
  typeof DependencyBoundaryCheckOutputSchema
>;

// 5. check_requirement_conflicts
export const RequirementConflictCheckInputSchema = z
  .object({
    projectId: z.uuid(),
    proposedTitle: z.string().trim().min(2).max(200),
    proposedScope: z.string().trim().min(5).max(4000),
    limit: z.number().int().min(1).max(25).default(10),
  })
  .strict();
export type RequirementConflictCheckInput = z.input<
  typeof RequirementConflictCheckInputSchema
>;

export const RequirementConflictItemSchema = z
  .object({
    sourceType: z.enum(["qmd_memory", "deliverable", "spec_doc"]),
    referenceId: z.string().min(1).max(200),
    title: z.string().min(1).max(240),
    overlapSummary: z.string().min(1).max(600),
    severity: z.enum(["blocking", "advisory"]),
  })
  .strict();
export type RequirementConflictItem = z.infer<
  typeof RequirementConflictItemSchema
>;

export const RequirementConflictCheckOutputSchema = z
  .object({
    hasConflicts: z.boolean(),
    conflicts: z.array(RequirementConflictItemSchema).max(25),
    checkedDeliverablesCount: z.number().int().nonnegative(),
    checkedMemoriesCount: z.number().int().nonnegative(),
  })
  .strict();
export type RequirementConflictCheckOutput = z.infer<
  typeof RequirementConflictCheckOutputSchema
>;

// 6. read_finops_and_risk_digest
export const FinopsRiskDigestInputSchema = z
  .object({
    projectId: z.uuid(),
    deliverableId: z.uuid().optional(),
    includeRecentCallsLimit: z.number().int().min(0).max(20).default(5),
  })
  .strict();
export type FinopsRiskDigestInput = z.input<typeof FinopsRiskDigestInputSchema>;

export const FinopsRiskDigestOutputSchema = z
  .object({
    projectId: z.uuid(),
    tokensTotal: z.number().int().nonnegative(),
    estimatedCostUsd: z.number().nonnegative(),
    budgetCapUsd: z.number().positive().nullable(),
    budgetUtilizationPercent: z.number().min(0).max(1000).nullable(),
    reworkRatePercent: z.number().min(0).max(100),
    averageVerifyAttempts: z.number().nonnegative(),
    openSecurityCounts: z
      .object({
        critical: z.number().int().nonnegative(),
        high: z.number().int().nonnegative(),
        medium: z.number().int().nonnegative(),
        low: z.number().int().nonnegative(),
      })
      .strict(),
    overallRiskLevel: RiskLevelSchema,
  })
  .strict();
export type FinopsRiskDigestOutput = z.infer<
  typeof FinopsRiskDigestOutputSchema
>;

// 7. read_design_system_contract
export const DesignSystemContractInputSchema = z
  .object({
    projectId: z.uuid(),
    maxMarkdownBytes: z.number().int().min(512).max(32768).default(12288),
    componentsLimit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export type DesignSystemContractInput = z.input<
  typeof DesignSystemContractInputSchema
>;

export const DesignSystemContractOutputSchema = z
  .object({
    designMdPath: z.string().min(1).nullable(),
    designMdExcerpt: z.string().max(32768),
    approvedAssetsCount: z.number().int().nonnegative(),
    tokensPreview: z
      .array(
        z
          .object({
            category: z.string().min(1),
            name: z.string().min(1),
            value: z.string().min(1),
          })
          .strict()
      )
      .max(100),
    uiComponents: z
      .array(
        z
          .object({
            name: z.string().min(1),
            dataSlot: z.string().min(1),
            filePath: z.string().min(1),
          })
          .strict()
      )
      .max(100),
    truncated: z.boolean().default(false),
  })
  .strict();
export type DesignSystemContractOutput = z.infer<
  typeof DesignSystemContractOutputSchema
>;

// 8. inspect_prototype_version
export const InspectPrototypeVersionInputSchema = z
  .object({
    projectId: z.uuid(),
    prototypeId: z.uuid().optional(),
    deliverableId: z.uuid().optional(),
    versionLimit: z.number().int().min(1).max(20).default(5),
    maxSummaryBytes: z.number().int().min(256).max(16384).default(4096),
  })
  .strict();
export type InspectPrototypeVersionInput = z.input<
  typeof InspectPrototypeVersionInputSchema
>;

export const PrototypeVersionSnapshotSchema = z
  .object({
    prototypeId: z.uuid(),
    versionNumber: z.number().int().min(1),
    title: z.string().min(1),
    level: PrototypeLevelSchema,
    source: PrototypeSourceSchema,
    approved: z.boolean(),
    domSections: z.array(z.string().min(1)).max(50),
    sanitizedHtmlSummary: z.string().max(16384),
    tokensJson: DesignTokensW3CSchema.optional(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type PrototypeVersionSnapshot = z.infer<
  typeof PrototypeVersionSnapshotSchema
>;

export const InspectPrototypeVersionOutputSchema = z
  .object({
    projectId: z.uuid(),
    versions: z.array(PrototypeVersionSnapshotSchema).max(20),
    totalVersions: z.number().int().nonnegative(),
    truncated: z.boolean().default(false),
  })
  .strict();
export type InspectPrototypeVersionOutput = z.infer<
  typeof InspectPrototypeVersionOutputSchema
>;

// 9. validate_color_contrast_and_tokens
export const ColorContrastPairInputSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    foreground: z.string().trim().min(3).max(80),
    background: z.string().trim().min(3).max(80),
    level: z.enum(["aa_normal", "aa_large", "aaa_normal"]).default("aa_normal"),
  })
  .strict();
export type ColorContrastPairInput = z.input<
  typeof ColorContrastPairInputSchema
>;

export const ColorContrastValidationInputSchema = z
  .object({
    pairs: z.array(ColorContrastPairInputSchema).min(1).max(50),
    rawTokens: z.record(z.string(), z.string()).optional(),
  })
  .strict();
export type ColorContrastValidationInput = z.input<
  typeof ColorContrastValidationInputSchema
>;

export const ColorContrastPairResultSchema = z
  .object({
    label: z.string().min(1),
    foreground: z.string().min(1),
    background: z.string().min(1),
    contrastRatio: z.number().nonnegative(),
    requiredRatio: z.number().positive(),
    passed: z.boolean(),
    formatDetected: z.enum(["hex", "oklch", "rgb", "invalid"]),
  })
  .strict();
export type ColorContrastPairResult = z.infer<
  typeof ColorContrastPairResultSchema
>;

export const ColorContrastValidationOutputSchema = z
  .object({
    allPassed: z.boolean(),
    results: z.array(ColorContrastPairResultSchema).max(50),
    invalidTokens: z
      .array(
        z
          .object({
            token: z.string().min(1),
            value: z.string(),
            reason: z.string().min(1),
          })
          .strict()
      )
      .max(50),
    hardcodedColorsDetected: z.array(z.string()).max(50),
  })
  .strict();
export type ColorContrastValidationOutput = z.infer<
  typeof ColorContrastValidationOutputSchema
>;

// 10. read_security_scan_findings
export const SecurityFindingsQueryInputSchema = z
  .object({
    projectId: z.uuid(),
    deliverableId: z.uuid().optional(),
    scanId: z.uuid().optional(),
    severities: z.array(SecuritySeveritySchema).max(5).optional(),
    scanner: z.string().trim().min(1).max(80).optional(),
    verdict: TriageVerdictSchema.optional(),
    limit: z.number().int().min(1).max(100).default(25),
    offset: z.number().int().nonnegative().default(0),
  })
  .strict();
export type SecurityFindingsQueryInput = z.input<
  typeof SecurityFindingsQueryInputSchema
>;

export const SecurityFindingsQueryOutputSchema = z
  .object({
    projectId: z.uuid(),
    totalMatching: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    findings: z.array(SecurityFindingDTOSchema).max(100),
    scannerStatuses: z.array(ScannerExecutionRecordSchema).max(20),
  })
  .strict();
export type SecurityFindingsQueryOutput = z.infer<
  typeof SecurityFindingsQueryOutputSchema
>;

// 11. read_deliverable_evidence_and_diff
export const DeliverableEvidenceReadInputSchema = z
  .object({
    projectId: z.uuid(),
    deliverableId: z.uuid(),
    maxDiffBytes: z.number().int().min(512).max(32768).default(8192),
    maxTestOutputBytes: z.number().int().min(256).max(16384).default(4096),
    fileDiffsLimit: z.number().int().min(1).max(100).default(30),
  })
  .strict();
export type DeliverableEvidenceReadInput = z.input<
  typeof DeliverableEvidenceReadInputSchema
>;

export const DeliverableEvidenceReadOutputSchema = z
  .object({
    deliverableId: z.uuid(),
    found: z.boolean(),
    verifyAttempts: z.number().int().nonnegative(),
    verifyPassed: z.boolean(),
    verifierVerdict: z.enum(["approved", "changes_required"]).nullable(),
    diffSummary: z
      .object({
        filesChanged: z.number().int().nonnegative(),
        diffBytes: z.number().int().nonnegative(),
        preview: z.string().max(32768),
        fileDiffs: z.array(SemanticDiffFileSchema).max(100),
        truncated: z.boolean(),
      })
      .strict()
      .nullable(),
    testCommandOutput: z.string().max(16384).nullable(),
    redactedSecretsCount: z.number().int().nonnegative().default(0),
  })
  .strict();
export type DeliverableEvidenceReadOutput = z.infer<
  typeof DeliverableEvidenceReadOutputSchema
>;

// 12. run_test_anti_pattern_audit
export const TestAntiPatternAuditInputSchema = z
  .object({
    projectId: z.uuid(),
    deliverableId: z.uuid().optional(),
    relativePaths: z.array(z.string().trim().min(1).max(300)).max(50).optional(),
    limit: z.number().int().min(1).max(200).default(50),
  })
  .strict();
export type TestAntiPatternAuditInput = z.input<
  typeof TestAntiPatternAuditInputSchema
>;

export const TestAntiPatternAuditOutputSchema = z
  .object({
    passed: z.boolean(),
    scannedFiles: z.number().int().nonnegative(),
    scannedTests: z.number().int().nonnegative(),
    suppressedCount: z.number().int().nonnegative(),
    violations: z.array(TestAuditFindingSchema).max(200),
    truncated: z.boolean().default(false),
  })
  .strict();
export type TestAntiPatternAuditOutput = z.infer<
  typeof TestAntiPatternAuditOutputSchema
>;

// 13. inspect_worktrees_and_locks
export const WorktreesAndLocksSnapshotInputSchema = z
  .object({
    projectId: z.uuid(),
    includeOrphansOnly: z.boolean().default(false),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export type WorktreesAndLocksSnapshotInput = z.input<
  typeof WorktreesAndLocksSnapshotInputSchema
>;

export const WorktreesAndLocksSnapshotOutputSchema = z
  .object({
    projectId: z.uuid(),
    worktrees: z
      .array(
        z
          .object({
            deliverableId: z.string().min(1),
            branchName: z.string().min(1),
            workspacePath: z.string().min(1),
            isOrphan: z.boolean(),
            status: z.string().min(1),
          })
          .strict()
      )
      .max(100),
    activeSymbolLocks: z
      .array(
        z
          .object({
            symbolKey: z.string().min(1),
            ownerDeliverableId: z.string().min(1),
            acquiredAt: z.iso.datetime(),
            expiresAt: z.iso.datetime().nullable(),
          })
          .strict()
      )
      .max(200),
    queuedDeliverablesCount: z.number().int().nonnegative(),
  })
  .strict();
export type WorktreesAndLocksSnapshotOutput = z.infer<
  typeof WorktreesAndLocksSnapshotOutputSchema
>;

// 14. distill_retrospective_memory
export const DistillRetrospectiveMemoryInputSchema = z
  .object({
    projectId: z.uuid(),
    deliverableId: z.uuid().optional(),
    category: MemoryCategorySchema,
    title: z.string().trim().min(3).max(200),
    content: z.string().trim().min(10).max(8000),
    sourceTrigger: z
      .enum([
        "verify_retry",
        "human_rejection",
        "stuck_escalation",
        "manual_retro",
      ])
      .default("manual_retro"),
  })
  .strict();
export type DistillRetrospectiveMemoryInput = z.input<
  typeof DistillRetrospectiveMemoryInputSchema
>;

export const DistillRetrospectiveMemoryOutputSchema = z
  .object({
    persisted: z.boolean(),
    memoryId: z.uuid(),
    scopeType: MemoryScopeSchema,
    category: MemoryCategorySchema,
    title: z.string().min(1),
    qmdReindexed: z.boolean(),
  })
  .strict();
export type DistillRetrospectiveMemoryOutput = z.infer<
  typeof DistillRetrospectiveMemoryOutputSchema
>;
