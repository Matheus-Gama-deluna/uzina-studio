import { z } from "zod";
import { OrgRoleSchema, RiskLevelSchema } from "./enums.js";
import { StuckAlertSchema } from "./execution.js";
import {
  DiscoverySummarySchema,
  StrategyRouterOutputSchema,
  VerifierVerdictOutputSchema,
} from "./workflow.js";

// --- Slice 29: Immutable Upstream -> Downstream Handoffs ---

export const ShapeAppetiteSchema = z.enum([
  "small_1_slice",
  "medium_2_3_slices",
  "large_epic",
]);
export type ShapeAppetite = z.infer<typeof ShapeAppetiteSchema>;

export const BddScenarioSchema = z
  .object({
    id: z.string().trim().min(1).max(64).optional(),
    title: z.string().trim().min(1).max(200),
    given: z.string().trim().min(1).max(500),
    when: z.string().trim().min(1).max(500),
    then: z.string().trim().min(1).max(500),
    roleRequired: OrgRoleSchema,
  })
  .strict();
export type BddScenario = z.infer<typeof BddScenarioSchema>;

export const AmbiguityCheckSchema = z
  .object({
    score: z.number().int().min(0).max(100),
    unresolvedQuestions: z.array(z.string().trim().min(1).max(400)).max(20),
  })
  .strict();
export type AmbiguityCheck = z.infer<typeof AmbiguityCheckSchema>;

export const ShapeSpecSchema = z
  .object({
    ...DiscoverySummarySchema.shape,
    appetite: ShapeAppetiteSchema,
    nonGoals: z.array(z.string().trim().min(1).max(400)).min(1),
    bddScenarios: z.array(BddScenarioSchema).min(1),
    dataSensitivityFlags: z.array(z.string().trim().min(1).max(120)).default([]),
    ambiguityCheck: AmbiguityCheckSchema,
  })
  .strict();
export type ShapeSpec = z.infer<typeof ShapeSpecSchema>;

export const ArchitectAdrSchema = z
  .object({
    context: z.string().trim().min(1).max(4000),
    optionsConsidered: z.array(z.string().trim().min(1).max(500)).min(1),
    decision: z.string().trim().min(1).max(2000),
    consequences: z.string().trim().min(1).max(2000),
    reversibility: z.string().trim().min(1).max(500),
  })
  .strict();
export type ArchitectAdr = z.infer<typeof ArchitectAdrSchema>;

export const StrideCategorySchema = z.enum([
  "spoofing",
  "tampering",
  "repudiation",
  "information_disclosure",
  "denial_of_service",
  "elevation_of_privilege",
]);
export type StrideCategory = z.infer<typeof StrideCategorySchema>;

export const StrideFmeaRiskSchema = z
  .object({
    category: StrideCategorySchema,
    threatOrFailure: z.string().trim().min(1).max(500),
    severity: RiskLevelSchema,
    mitigation: z.string().trim().min(1).max(1000),
    verifyCheck: z.string().trim().min(1).max(500),
  })
  .strict();
export type StrideFmeaRisk = z.infer<typeof StrideFmeaRiskSchema>;

export const StoryShardSchema = z
  .object({
    sliceName: z.string().trim().min(1).max(120),
    objective: z.string().trim().min(1).max(500),
    allowedPaths: z.array(z.string().trim().min(1).max(500)).min(1),
    targetSymbols: z.array(z.string().trim().min(1).max(200)),
    acceptanceScenarioIds: z.array(z.string().trim().min(1).max(120)),
    verificationCommands: z.array(z.string().trim().min(1).max(300)).min(1),
    sequential: z.boolean().default(false),
  })
  .strict();
export type StoryShard = z.infer<typeof StoryShardSchema>;

export const OpenSpecDeltaSchema = z
  .object({
    added: z.array(z.string().trim().min(1).max(500)).default([]),
    modified: z.array(z.string().trim().min(1).max(500)).default([]),
    removed: z.array(z.string().trim().min(1).max(500)).default([]),
  })
  .strict();
export type OpenSpecDelta = z.infer<typeof OpenSpecDeltaSchema>;

export const ArchitectBlueprintV2Schema = z
  .object({
    ...StrategyRouterOutputSchema.shape,
    adr: ArchitectAdrSchema,
    strideFmeaRisks: z.array(StrideFmeaRiskSchema),
    storyShards: z.array(StoryShardSchema).min(1),
    openSpecDelta: OpenSpecDeltaSchema.optional(),
  })
  .strict();
export type ArchitectBlueprintV2 = z.infer<typeof ArchitectBlueprintV2Schema>;

export const PrototypeUiStateSchema = z.enum([
  "loading",
  "empty",
  "error",
  "partial",
  "populated",
]);
export type PrototypeUiState = z.infer<typeof PrototypeUiStateSchema>;

export const PrototypeSectionManifestSchema = z
  .object({
    sectionName: z.string().trim().min(1).max(160),
    uiComponents: z.array(z.string().trim().min(1).max(120)).min(1),
    dataSlots: z.array(z.string().trim().min(1).max(120)).default([]),
    statesCovered: z
      .array(PrototypeUiStateSchema)
      .min(5)
      .refine(
        (states) => new Set(states).size === 5,
        "Todos os 5 estados de UI (loading, empty, error, partial, populated) são obrigatórios"
      ),
  })
  .strict();
export type PrototypeSectionManifest = z.infer<
  typeof PrototypeSectionManifestSchema
>;

export const PrototypeComponentManifestSchema = z
  .object({
    prototypeId: z.uuid().optional(),
    deliverableId: z.uuid().optional(),
    sections: z.array(PrototypeSectionManifestSchema).min(1),
    wcagChecklist: z
      .object({
        contrastAaPassed: z.boolean(),
        keyboardNavPassed: z.boolean(),
        touchTargetsMin44Px: z.boolean(),
        mobile390PxNoOverflow: z.boolean(),
        noRbacLeakage: z.boolean(),
      })
      .strict(),
    tokensUsed: z.array(z.string().trim().min(1).max(120)).default([]),
  })
  .strict();
export type PrototypeComponentManifest = z.infer<
  typeof PrototypeComponentManifestSchema
>;

// --- Slice 30: Builder Harness, Test Lock, Micro-Loop & 3-Strikes ---

export const ScopedCheckDiagnosticSchema = z
  .object({
    file: z.string().trim().min(1).max(500),
    line: z.number().int().min(1).nullable().optional(),
    code: z.string().trim().min(1).max(80).optional(),
    message: z.string().trim().min(1).max(1000),
  })
  .strict();
export type ScopedCheckDiagnostic = z.infer<
  typeof ScopedCheckDiagnosticSchema
>;

export const ScopedCheckResultSchema = z
  .object({
    passed: z.boolean(),
    command: z.string().trim().min(1).max(200),
    targetPackage: z.string().trim().min(1).max(120),
    diagnostics: z.array(ScopedCheckDiagnosticSchema).max(200),
    durationMs: z.number().int().nonnegative(),
    truncatedOutput: z.string().max(16384),
  })
  .strict();
export type ScopedCheckResult = z.infer<typeof ScopedCheckResultSchema>;

export const MigrationSafetyIssueSchema = z
  .object({
    severity: z.enum(["blocking", "warning"]),
    rule: z.string().trim().min(1).max(120),
    filePath: z.string().trim().min(1).max(500),
    line: z.number().int().min(1).nullable().optional(),
    statement: z.string().trim().min(1).max(500),
    recommendation: z.string().trim().min(1).max(500),
  })
  .strict();
export type MigrationSafetyIssue = z.infer<typeof MigrationSafetyIssueSchema>;

export const MigrationSafetyReportSchema = z
  .object({
    passed: z.boolean(),
    scannedFiles: z.array(z.string().trim().min(1).max(500)),
    issues: z.array(MigrationSafetyIssueSchema).max(200),
  })
  .strict();
export type MigrationSafetyReport = z.infer<
  typeof MigrationSafetyReportSchema
>;

export const StuckAlertV2ExtensionSchema = z
  .object({
    ...StuckAlertSchema.shape,
    rootCauseHypothesis: z.string().trim().min(1).max(2000).optional(),
    strikeCount: z.number().int().min(1).max(10),
    escalatedToArchitect: z.boolean(),
  })
  .strict();
export type StuckAlertV2Extension = z.infer<
  typeof StuckAlertV2ExtensionSchema
>;

// --- Slice 31: Two-Stage Verifier & Risk-Ranked Decision Briefing ---

export const SpecComplianceStatusSchema = z.enum([
  "covered",
  "missing",
  "divergent",
]);
export type SpecComplianceStatus = z.infer<typeof SpecComplianceStatusSchema>;

export const SpecComplianceRowSchema = z
  .object({
    criterionId: z.string().trim().min(1).max(120),
    criterionText: z.string().trim().min(1).max(1000),
    testFile: z.string().trim().min(1).max(500).nullable(),
    testLine: z.number().int().min(1).nullable(),
    sourceFile: z.string().trim().min(1).max(500).nullable(),
    sourceLine: z.number().int().min(1).nullable(),
    status: SpecComplianceStatusSchema,
  })
  .strict();
export type SpecComplianceRow = z.infer<typeof SpecComplianceRowSchema>;

export const VerifierTwoStageOutputSchema = z
  .object({
    ...VerifierVerdictOutputSchema.shape,
    stage1SpecCompliance: z
      .object({
        passed: z.boolean(),
        matrix: z.array(SpecComplianceRowSchema).max(200),
      })
      .strict(),
    stage2QualityAndSecurity: z
      .object({
        passed: z.boolean(),
        refutingChecksPerformed: z.array(z.string().trim().min(1).max(500)),
        survivingMutantRisks: z.array(z.string().trim().min(1).max(500)),
      })
      .strict(),
    confidenceScore: z.number().int().min(0).max(100),
  })
  .strict();
export type VerifierTwoStageOutput = z.infer<
  typeof VerifierTwoStageOutputSchema
>;

export const DecisionRiskBriefingSchema = z
  .object({
    riskLevel: RiskLevelSchema,
    confidenceScore: z.number().int().min(0).max(100),
    changedSurface: z
      .object({
        dbMigrations: z.boolean(),
        authOrRbac: z.boolean(),
        cryptoOrSecrets: z.boolean(),
        newDependencies: z.array(z.string().trim().min(1).max(160)),
        newEnvVars: z.array(z.string().trim().min(1).max(160)),
      })
      .strict(),
    rollbackPlan: z.string().trim().min(1).max(2000),
    finopsSummary: z
      .object({
        tokensTotal: z.number().int().nonnegative(),
        estimatedCostUsd: z.number().nonnegative(),
      })
      .strict(),
  })
  .strict();
export type DecisionRiskBriefing = z.infer<typeof DecisionRiskBriefingSchema>;
