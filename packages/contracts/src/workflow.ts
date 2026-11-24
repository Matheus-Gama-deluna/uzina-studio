import { z } from "zod";
import {
  DeliverableStatusSchema,
  DevelopmentStrategySchema,
  RiskLevelSchema,
  TacticalPatternSchema,
} from "./enums.js";
import { HttpUrlSchema } from "./errors.js";

export const DesignAssetTypeSchema = z.enum([
  "moodboard_image",
  "reference_url",
  "image_mockup",
  "html_prototype",
  "design_md",
]);
export type DesignAssetType = z.infer<typeof DesignAssetTypeSchema>;

export const DesignAssetSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  deliverableId: z.uuid().nullable(),
  assetType: DesignAssetTypeSchema,
  title: z.string().trim().min(1).max(160),
  sourceUrl: HttpUrlSchema.nullable(),
  assetUrl: z.string().trim().min(1).nullable(),
  mimeType: z.string().trim().min(1).max(80).nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  intentionTags: z.array(z.string().trim().min(1).max(60)).max(12),
  notes: z.string().max(4000).nullable(),
  approved: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type DesignAsset = z.infer<typeof DesignAssetSchema>;

export const DesignAssetListResponseSchema = z.object({
  items: z.array(DesignAssetSchema),
});
export type DesignAssetListResponse = z.infer<
  typeof DesignAssetListResponseSchema
>;

export const CreateDesignAssetReferenceSchema = z
  .object({
    assetType: z.enum(["reference_url", "html_prototype", "design_md"]),
    title: z.string().trim().min(2).max(160),
    sourceUrl: HttpUrlSchema.nullable().optional(),
    deliverableId: z.uuid().nullable().optional(),
    intentionTags: z.array(z.string().trim().min(1).max(60)).max(12).default([]),
    notes: z.string().trim().max(4000).nullable().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.assetType === "reference_url" && !val.sourceUrl) {
      ctx.addIssue({
        code: "custom",
        path: ["sourceUrl"],
        message: "sourceUrl é obrigatória para referências externas",
      });
    }
  });
export type CreateDesignAssetReferenceInput = z.input<
  typeof CreateDesignAssetReferenceSchema
>;

export const UpdateDesignAssetSchema = z
  .object({
    title: z.string().trim().min(2).max(160).optional(),
    intentionTags: z.array(z.string().trim().min(1).max(60)).max(12).optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
    approved: z.boolean().optional(),
  })
  .strict();
export type UpdateDesignAssetInput = z.infer<typeof UpdateDesignAssetSchema>;

export const GenerateDesignMdInputSchema = z
  .object({
    deliverableId: z.uuid().nullable().optional(),
    themePreference: z
      .enum(["industrial_dark", "crisp_light", "dual_theme"])
      .default("dual_theme"),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();
export type GenerateDesignMdInput = z.input<typeof GenerateDesignMdInputSchema>;

export const GenerateDesignMdResponseSchema = z.object({
  asset: DesignAssetSchema,
  designMdPath: z.string().trim().min(1),
  markdown: z.string().trim().min(1),
});
export type GenerateDesignMdResponse = z.infer<
  typeof GenerateDesignMdResponseSchema
>;

export const DiscoveryPillarKeySchema = z.enum([
  "objective_and_user",
  "critical_flows_and_exceptions",
  "technical_constraints_and_data",
  "ui_ux_requirement",
  "acceptance_and_out_of_scope",
]);
export type DiscoveryPillarKey = z.infer<typeof DiscoveryPillarKeySchema>;

export const DiscoveryQuestionSchema = z.object({
  id: z.string().trim().min(1).max(64),
  pillar: DiscoveryPillarKeySchema,
  prompt: z.string().trim().min(3).max(400),
  recommendedOption: z.string().trim().min(1).max(200),
  options: z.array(z.string().trim().min(1).max(200)).min(2).max(5),
});
export type DiscoveryQuestion = z.infer<typeof DiscoveryQuestionSchema>;

export const DiscoveryAnswerSchema = z.object({
  questionId: z.string().trim().min(1).max(64),
  pillar: DiscoveryPillarKeySchema,
  answer: z.string().trim().min(1).max(1000),
});
export type DiscoveryAnswer = z.infer<typeof DiscoveryAnswerSchema>;

export const DiscoveryRoundSchema = z.object({
  roundNumber: z.number().int().min(1).max(3),
  questions: z.array(DiscoveryQuestionSchema).min(1).max(4),
  answers: z.array(DiscoveryAnswerSchema),
  coveredPillars: z.array(DiscoveryPillarKeySchema),
});
export type DiscoveryRound = z.infer<typeof DiscoveryRoundSchema>;

export const DiscoveryAssumptionSchema = z.object({
  key: z.string().trim().min(1).max(120),
  value: z.string().trim().min(1).max(500),
  source: z.enum(["pre_read", "user_answer", "recommended_default"]),
});
export type DiscoveryAssumption = z.infer<typeof DiscoveryAssumptionSchema>;

export const DiscoverySummarySchema = z.object({
  objective: z.string().trim().min(1),
  targetUser: z.string().trim().min(1),
  criticalFlows: z.array(z.string().trim().min(1)).min(1),
  technicalConstraints: z.array(z.string().trim().min(1)),
  hasUi: z.boolean(),
  acceptanceCriteria: z.array(z.string().trim().min(1)).min(1),
  outOfScope: z.array(z.string().trim().min(1)),
  assumptions: z.array(DiscoveryAssumptionSchema),
  specMarkdown: z.string().trim().min(1),
});
export type DiscoverySummary = z.infer<typeof DiscoverySummarySchema>;

export const BrownfieldMaturityDimensionsSchema = z.object({
  ciAndVerify: z.number().int().min(0).max(20),
  testQuality: z.number().int().min(0).max(20),
  documentationAndSteering: z.number().int().min(0).max(20),
  securityPosture: z.number().int().min(0).max(20),
  architectureModularity: z.number().int().min(0).max(20),
});
export type BrownfieldMaturityDimensions = z.infer<
  typeof BrownfieldMaturityDimensionsSchema
>;

export const BrownfieldScanRequestSchema = z
  .object({
    repositoryId: z.uuid().optional(),
  })
  .strict();
export type BrownfieldScanRequest = z.infer<typeof BrownfieldScanRequestSchema>;

export const BrownfieldMapSchema = z.object({
  repoPath: z.string().trim().min(1),
  scannedAt: z.iso.datetime(),
  totalFilesScanned: z.number().int().nonnegative(),
  truncated: z.boolean(),
  topLevelEntries: z.array(z.string()),
  manifestsFound: z.array(z.string()),
  detectedStack: z.array(z.string()),
  hasTests: z.boolean(),
  hasCi: z.boolean(),
  hasSteering: z.boolean(),
  dimensions: BrownfieldMaturityDimensionsSchema,
  maturityScore: z.number().int().min(0).max(100),
  recommendedStrategy: DevelopmentStrategySchema,
  riskNotes: z.array(z.string()),
});
export type BrownfieldMap = z.infer<typeof BrownfieldMapSchema>;

export const VerticalSlicePlanSchema = z.object({
  name: z.string().trim().min(1).max(120),
  objective: z.string().trim().min(1).max(400),
  allowedPaths: z.array(z.string().trim().min(1)).min(1),
  sequential: z.boolean(),
});
export type VerticalSlicePlan = z.infer<typeof VerticalSlicePlanSchema>;

export const StrategyRouterInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).nullable().optional(),
  hasUi: z.boolean().default(false),
  riskLevel: RiskLevelSchema.default("low"),
  isBrownfield: z.boolean().default(false),
  maturityScore: z.number().int().min(0).max(100).nullable().optional(),
  hasDatabaseSchemaChanges: z.boolean().default(false),
  hasExternalUnknownIntegration: z.boolean().default(false),
  isPureDomainLogic: z.boolean().default(false),
  isApiIntegration: z.boolean().default(false),
  overrideStrategy: DevelopmentStrategySchema.optional(),
  candidateSlices: z.array(VerticalSlicePlanSchema).optional(),
});
export type StrategyRouterInput = z.input<typeof StrategyRouterInputSchema>;

export const StrategyRouterOutputSchema = z.object({
  developmentStrategy: DevelopmentStrategySchema,
  tacticalPattern: TacticalPatternSchema,
  rationale: z.string().trim().min(1),
  verticalSlices: z.array(VerticalSlicePlanSchema).min(1),
  sharedPathsDetected: z.array(z.string()),
});
export type StrategyRouterOutput = z.infer<typeof StrategyRouterOutputSchema>;

export const WorkflowGateTypeSchema = z.enum([
  "discovery_confirm",
  "blueprint_approve",
  "visual_approve",
  "prototype_approve",
  "pr_evidence_approve",
  "stuck_intervention",
  "stage_gate_approve",
  "budget_cap_pause",
]);
export type WorkflowGateType = z.infer<typeof WorkflowGateTypeSchema>;

export const StageExecutionModeSchema = z.enum(["manual", "auto"]);
export type StageExecutionMode = z.infer<typeof StageExecutionModeSchema>;

export const ProjectStageAutomationSchema = z
  .object({
    discovery: StageExecutionModeSchema.default("manual"),
    spec_review: StageExecutionModeSchema.default("manual"),
    visual_studio: StageExecutionModeSchema.default("manual"),
    contract_tests: StageExecutionModeSchema.default("auto"),
    building: StageExecutionModeSchema.default("auto"),
    verifying: StageExecutionModeSchema.default("auto"),
    decision_pending: z.literal("manual").default("manual"),
  })
  .strict();
export type ProjectStageAutomation = z.infer<
  typeof ProjectStageAutomationSchema
>;

export const DEFAULT_PROJECT_STAGE_AUTOMATION: ProjectStageAutomation = {
  discovery: "manual",
  spec_review: "manual",
  visual_studio: "manual",
  contract_tests: "auto",
  building: "auto",
  verifying: "auto",
  decision_pending: "manual",
};

export const UpdateProjectStageAutomationSchema = z
  .object({
    discovery: StageExecutionModeSchema.optional(),
    spec_review: StageExecutionModeSchema.optional(),
    visual_studio: StageExecutionModeSchema.optional(),
    contract_tests: StageExecutionModeSchema.optional(),
    building: StageExecutionModeSchema.optional(),
    verifying: StageExecutionModeSchema.optional(),
    decision_pending: z.literal("manual").optional(),
  })
  .strict();
export type UpdateProjectStageAutomation = z.infer<
  typeof UpdateProjectStageAutomationSchema
>;

export const VerifierIssueSchema = z
  .object({
    severity: z.enum(["blocker", "major", "minor"]),
    filePath: z.string().trim().min(1).max(500).optional(),
    message: z.string().trim().min(1).max(2000),
  })
  .strict();
export type VerifierIssue = z.infer<typeof VerifierIssueSchema>;

export const VerifierVerdictOutputSchema = z
  .object({
    verdict: z.enum(["approved", "changes_required"]),
    summary: z.string().trim().min(1).max(4000),
    issues: z.array(VerifierIssueSchema).max(50).default([]),
  })
  .strict();
export type VerifierVerdictOutput = z.infer<typeof VerifierVerdictOutputSchema>;

export const WorkflowResumeDecisionSchema = z.enum([
  "approved",
  "changes_requested",
  "rejected",
]);
export type WorkflowResumeDecision = z.infer<
  typeof WorkflowResumeDecisionSchema
>;

export const WorkflowStartInputSchema = z
  .object({
    initialAnswers: z.array(DiscoveryAnswerSchema).optional(),
    overrideStrategy: DevelopmentStrategySchema.optional(),
  })
  .strict();
export type WorkflowStartInput = z.input<typeof WorkflowStartInputSchema>;

export const WorkflowResumeInputSchema = z
  .object({
    decision: WorkflowResumeDecisionSchema,
    feedback: z.string().trim().max(2000).optional(),
    answers: z.array(DiscoveryAnswerSchema).optional(),
    hasUi: z.boolean().optional(),
    overrideStrategy: DevelopmentStrategySchema.optional(),
    approveDesignMd: z.boolean().optional(),
    newBudgetCapUsd: z.number().positive().max(10000).optional(),
  })
  .strict();
export type WorkflowResumeInput = z.input<typeof WorkflowResumeInputSchema>;

export const WorkflowAbortInputSchema = z
  .object({
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type WorkflowAbortInput = z.infer<typeof WorkflowAbortInputSchema>;

export const WorkflowAbortResponseSchema = z
  .object({
    aborted: z.boolean(),
    deliverableId: z.uuid(),
    mastraRunId: z.string().min(1).max(160).nullable(),
    status: DeliverableStatusSchema.optional(),
  })
  .strict();
export type WorkflowAbortResponse = z.infer<typeof WorkflowAbortResponseSchema>;

export const DeliverableWorkflowStatusSchema = z.enum([
  "not_started",
  "running",
  "suspended",
  "completed",
  "failed",
]);
export type DeliverableWorkflowStatus = z.infer<
  typeof DeliverableWorkflowStatusSchema
>;

export const DeliverableWorkflowStateSchema = z.object({
  deliverableId: z.uuid(),
  runId: z.string().trim().min(1).nullable(),
  workflowStatus: DeliverableWorkflowStatusSchema,
  deliverableStatus: DeliverableStatusSchema,
  suspendedStep: z.string().trim().min(1).nullable(),
  gate: WorkflowGateTypeSchema.nullable(),
  suspendPayload: z.record(z.string(), z.unknown()).nullable(),
  specMarkdown: z.string().nullable(),
  blueprint: StrategyRouterOutputSchema.nullable(),
  designMdContent: z.string().nullable(),
  contractTestFiles: z.array(z.string()),
  stageHistory: z.array(z.string()),
  updatedAt: z.iso.datetime(),
});
export type DeliverableWorkflowState = z.infer<
  typeof DeliverableWorkflowStateSchema
>;

export const AutonomousCycleResponseSchema = z
  .object({
    dispatched: z.boolean(),
    alreadyRunning: z.boolean(),
    taskId: z.string().min(1).max(160).nullable(),
    deliverableId: z.uuid().nullable(),
    deliverableTitle: z.string().trim().min(1).max(200).nullable(),
    message: z.string().trim().min(1).max(1000),
  })
  .strict();
export type AutonomousCycleResponse = z.infer<
  typeof AutonomousCycleResponseSchema
>;

export const MergeDeliverableBranchResponseSchema = z
  .object({
    ok: z.boolean(),
    mode: z.enum(["local_merge", "local_branch_ready"]),
    commitSha: z.string().nullable(),
    branchName: z.string().nullable(),
    message: z.string().trim().min(1).max(1000),
  })
  .strict();
export type MergeDeliverableBranchResponse = z.infer<
  typeof MergeDeliverableBranchResponseSchema
>;

export const CleanupDeliverableWorktreeResponseSchema = z
  .object({
    cleaned: z.boolean(),
    deliverableId: z.uuid(),
    message: z.string().trim().min(1).max(1000),
  })
  .strict();
export type CleanupDeliverableWorktreeResponse = z.infer<
  typeof CleanupDeliverableWorktreeResponseSchema
>;
