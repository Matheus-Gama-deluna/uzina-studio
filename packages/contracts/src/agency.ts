import { z } from "zod";
import {
  DeliverableStatusSchema,
  DevelopmentStrategySchema,
  RiskLevelSchema,
} from "./enums.js";
import { HttpUrlSchema } from "./errors.js";
import {
  AstEngineModeSchema,
  EmbeddingEngineModeSchema,
  WorkspaceKindSchema,
} from "./finops.js";

export const AgencyAgentRoleSchema = z.enum([
  "orchestrator",
  "product_discovery",
  "software_architect",
  "ux_designer",
  "tech_lead",
  "qa_appsec",
]);
export type AgencyAgentRole = z.infer<typeof AgencyAgentRoleSchema>;

export const TeamTopologyModeSchema = z.enum(["lean_mvp", "full_enterprise"]);
export type TeamTopologyMode = z.infer<typeof TeamTopologyModeSchema>;

export const ModelTierLevelSchema = z.enum([
  "tier1_context_local",
  "tier2_fast_execution",
  "tier3_deep_reasoning",
]);
export type ModelTierLevel = z.infer<typeof ModelTierLevelSchema>;

export const ProjectLifecyclePhaseSchema = z.enum([
  "onboarding",
  "discovery_greenfield",
  "architecture_brownfield",
  "visual_design",
  "engineering_execution",
  "quality_review",
  "evolution_cycle",
]);
export type ProjectLifecyclePhase = z.infer<typeof ProjectLifecyclePhaseSchema>;

export const AutonomyModeSchema = z.enum([
  "guided",
  "semi_autonomous",
  "full_autonomous",
]);
export type AutonomyMode = z.infer<typeof AutonomyModeSchema>;

export const OnboardingChecklistStepSchema = z.object({
  id: z.enum(["llm_vault", "context_engines", "first_project_chat"]),
  title: z.string().min(1).max(160),
  description: z.string().min(1).max(600),
  completed: z.boolean(),
  requiredForFullAutonomy: z.boolean(),
  statusBadge: z.string().min(1).max(120),
  actionHref: z.string().min(1).max(200),
  actionLabel: z.string().min(1).max(120),
});
export type OnboardingChecklistStep = z.infer<
  typeof OnboardingChecklistStepSchema
>;

export const SystemReadinessStatusSchema = z.object({
  readinessPercent: z.number().int().min(0).max(100),
  llmProviderConfigured: z.boolean(),
  activeProvidersCount: z.number().int().min(0),
  activeProviderNames: z.array(z.string()),
  embeddingMode: EmbeddingEngineModeSchema,
  astMode: AstEngineModeSchema,
  workspaceMode: WorkspaceKindSchema,
  autoInjectInRunner: z.boolean(),
  clientsCount: z.number().int().min(0),
  projectsCount: z.number().int().min(0),
  deliverablesCount: z.number().int().min(0),
  recommendedNextAction: z.string().min(1).max(400),
  steps: z.array(OnboardingChecklistStepSchema).length(3),
});
export type SystemReadinessStatus = z.infer<typeof SystemReadinessStatusSchema>;

export const AgencyAgentProfileSchema = z.object({
  role: AgencyAgentRoleSchema,
  name: z.string().min(1).max(120),
  title: z.string().min(1).max(160),
  responsibility: z.string().min(1).max(500),
  primaryPhases: z.array(ProjectLifecyclePhaseSchema).min(1),
  canBeReinvokedInCycle: z.boolean(),
  recommendedTier: ModelTierLevelSchema,
  tierLabel: z.string().min(1).max(120),
  boundModelId: z.string().min(1).max(160),
  artifactsOwned: z.array(z.string()).min(1),
  includedInLeanTeam: z.boolean().default(true),
  leanDisplayName: z.string().min(1).max(120).optional(),
});
export type AgencyAgentProfile = z.infer<typeof AgencyAgentProfileSchema>;

export const ArchitectStrategyDecisionSchema = z.object({
  chosenStrategy: DevelopmentStrategySchema,
  strategyLabel: z.string().min(1).max(120),
  rationale: z.string().min(1).max(700),
  recommendedTeamTopology: TeamTopologyModeSchema,
  requiresVisualPrototypeFirst: z.boolean(),
});
export type ArchitectStrategyDecision = z.infer<
  typeof ArchitectStrategyDecisionSchema
>;

export const ProjectVisualFlowSummarySchema = z.object({
  hasUiDeliverables: z.boolean(),
  latestPrototypeId: z.uuid().nullable(),
  latestPrototypeTitle: z.string().nullable(),
  fidelityLevel: z.string().nullable(),
  approvedForCodeHandoff: z.boolean(),
  previewUrl: z.string().nullable(),
  screensFlow: z.array(z.string()),
  tokensPreview: z.array(
    z.object({
      name: z.string(),
      value: z.string(),
    })
  ),
  studioHref: z.string().min(1),
});
export type ProjectVisualFlowSummary = z.infer<
  typeof ProjectVisualFlowSummarySchema
>;

export const LongTermArtifactKindSchema = z.enum([
  "prd_vision",
  "architecture_adr",
  "design_system",
  "codebase_ast",
]);
export type LongTermArtifactKind = z.infer<typeof LongTermArtifactKindSchema>;

export const LongTermArtifactSummarySchema = z.object({
  id: z.string().min(1).max(160),
  kind: LongTermArtifactKindSchema,
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(500),
  contentMarkdown: z.string().min(1),
  ownerAgentRole: AgencyAgentRoleSchema,
  ownerAgentName: z.string().min(1).max(120),
  cycleNumber: z.number().int().min(1),
  updatedAt: z.iso.datetime(),
});
export type LongTermArtifactSummary = z.infer<
  typeof LongTermArtifactSummarySchema
>;

export const SliceArtifactDetailSchema = z.object({
  deliverableId: z.uuid(),
  title: z.string().min(1).max(200),
  description: z.string().nullable(),
  status: DeliverableStatusSchema,
  statusLabel: z.string().min(1).max(80),
  strategy: DevelopmentStrategySchema,
  riskLevel: RiskLevelSchema,
  hasUi: z.boolean(),
  ownerAgentRole: AgencyAgentRoleSchema,
  ownerAgentName: z.string().min(1).max(120),
  cycleNumber: z.number().int().min(1),
  specMarkdown: z.string().min(1),
  blueprintJson: z.record(z.string(), z.unknown()),
  evidenceSummary: z.string().min(1),
  pendingDecisionId: z.uuid().nullable(),
  pendingDecisionSummary: z.string().nullable(),
  verifyAttempts: z.number().int().min(0),
  maxVerifyAttempts: z.number().int().min(1),
  updatedAt: z.iso.datetime(),
});
export type SliceArtifactDetail = z.infer<typeof SliceArtifactDetailSchema>;

export const AgencyStageProgressItemSchema = z.object({
  status: DeliverableStatusSchema,
  label: z.string().min(1).max(80),
  count: z.number().int().min(0),
});
export type AgencyStageProgressItem = z.infer<
  typeof AgencyStageProgressItemSchema
>;

export const AgencyProjectStateSchema = z.object({
  projectId: z.uuid(),
  projectName: z.string().min(1).max(160),
  clientId: z.uuid(),
  clientName: z.string().min(1).max(160),
  originKind: z.enum(["greenfield", "brownfield"]),
  repositoryUrl: z.string().nullable(),
  repositoryPath: z.string().nullable(),
  defaultStrategy: DevelopmentStrategySchema,
  architectDecision: ArchitectStrategyDecisionSchema.optional(),
  visualFlow: ProjectVisualFlowSummarySchema.optional(),
  currentPhase: ProjectLifecyclePhaseSchema,
  phaseLabel: z.string().min(1).max(120),
  activeAgentRole: AgencyAgentRoleSchema,
  activeAgentName: z.string().min(1).max(120),
  cycleNumber: z.number().int().min(1),
  totalDeliverables: z.number().int().min(0),
  completedDeliverables: z.number().int().min(0),
  pendingDecisionsCount: z.number().int().min(0),
  canAutoAdvance: z.boolean(),
  pausedAtGateReason: z.string().nullable(),
  recommendedPrompt: z.string().min(1).max(400),
  stageBreakdown: z.array(AgencyStageProgressItemSchema),
  longTermArtifacts: z.array(LongTermArtifactSummarySchema),
  sliceArtifacts: z.array(SliceArtifactDetailSchema),
});
export type AgencyProjectState = z.infer<typeof AgencyProjectStateSchema>;

export const AgencyOverviewResponseSchema = z.object({
  readiness: SystemReadinessStatusSchema,
  agents: z.array(AgencyAgentProfileSchema).min(1),
  activeProjectState: AgencyProjectStateSchema.nullable(),
  allProjectStates: z.array(AgencyProjectStateSchema),
});
export type AgencyOverviewResponse = z.infer<
  typeof AgencyOverviewResponseSchema
>;

export const AgencyChatIntentSchema = z.enum([
  "general_chat",
  "start_greenfield",
  "import_git_or_repo",
  "plan_deliverables",
  "advance_cycle",
  "revisit_architecture",
  "approve_slice_artifact",
  "request_slice_revision",
  "approve_visual_flow",
  "revise_visual_flow",
]);
export type AgencyChatIntent = z.infer<typeof AgencyChatIntentSchema>;

export const AgencyChatMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(6000),
    agentRole: AgencyAgentRoleSchema.optional(),
  })
  .strict();
export type AgencyChatMessage = z.infer<typeof AgencyChatMessageSchema>;

export const AgencyChatRequestSchema = z
  .object({
    message: z.string().trim().min(2).max(6000),
    threadId: z.string().trim().min(1).max(160).optional(),
    history: z.array(AgencyChatMessageSchema).max(20).optional(),
    clientId: z.uuid().optional(),
    projectId: z.uuid().optional(),
    deliverableId: z.uuid().optional(),
    targetAgentRole: AgencyAgentRoleSchema.optional(),
    teamTopology: TeamTopologyModeSchema.default("lean_mvp"),
    autonomyMode: AutonomyModeSchema.default("semi_autonomous"),
    intent: AgencyChatIntentSchema.default("general_chat"),
    projectName: z.string().trim().min(2).max(120).optional(),
    gitUrl: HttpUrlSchema.optional(),
    localPath: z.string().trim().min(1).max(500).optional(),
    preferredStrategy: DevelopmentStrategySchema.optional(),
    defaultRiskLevel: RiskLevelSchema.optional(),
  })
  .strict();
export type AgencyChatRequest = z.infer<typeof AgencyChatRequestSchema>;

export const AgencyActionExecutedSchema = z.object({
  type: z.enum([
    "invoked_live_llm",
    "created_project",
    "decided_ai_strategy",
    "linked_git_repository",
    "executed_brownfield_scan",
    "indexed_polyglot_ast",
    "saved_qmd_memory",
    "generated_visual_prototype",
    "approved_visual_flow",
    "paused_at_visual_gate",
    "created_deliverables_wave",
    "advanced_deliverable_stage",
    "paused_at_mandatory_gate",
    "cycled_back_to_architect",
    "approved_slice_artifact",
    "revised_slice_artifact",
    "updated_design_brief",
  ]),
  label: z.string().min(1).max(240),
  targetId: z.string().optional(),
});
export type AgencyActionExecuted = z.infer<typeof AgencyActionExecutedSchema>;

export const LlmExecutionModeSchema = z.enum(["live_llm", "local_assisted"]);
export type LlmExecutionMode = z.infer<typeof LlmExecutionModeSchema>;

export const ObservationalMemoryStatusSchema = z
  .object({
    activeMessageTokens: z.number().int().nonnegative(),
    messageTokensThreshold: z.number().int().positive(),
    activeObservationTokens: z.number().int().nonnegative(),
    observationTokensThreshold: z.number().int().positive(),
    generationCount: z.number().int().nonnegative(),
    bufferingStatus: z.enum(["idle", "running", "complete"]),
  })
  .strict();
export type ObservationalMemoryStatus = z.infer<
  typeof ObservationalMemoryStatusSchema
>;

export const AgencyThreadSummarySchema = z
  .object({
    threadId: z.string().min(1).max(160),
    projectId: z.uuid().nullable(),
    title: z.string().max(240).nullable(),
    updatedAt: z.iso.datetime(),
    messageCount: z.number().int().nonnegative(),
  })
  .strict();
export type AgencyThreadSummary = z.infer<typeof AgencyThreadSummarySchema>;

export const AgencyThreadMessageItemSchema = z
  .object({
    id: z.string().min(1).max(160),
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1),
    createdAt: z.iso.datetime(),
    agentRole: AgencyAgentRoleSchema.optional(),
    agentName: z.string().min(1).max(120).optional(),
    executionMode: LlmExecutionModeSchema.optional(),
    boundModelId: z.string().min(1).max(160).optional(),
    toolsUsed: z.array(z.string()).optional(),
    actionsExecuted: z.array(AgencyActionExecutedSchema).optional(),
  })
  .strict();
export type AgencyThreadMessageItem = z.infer<
  typeof AgencyThreadMessageItemSchema
>;

export const AgencyThreadListResponseSchema = z
  .object({
    threads: z.array(AgencyThreadSummarySchema),
    activeThreadId: z.string().min(1).max(160).nullable(),
    messages: z.array(AgencyThreadMessageItemSchema),
  })
  .strict();
export type AgencyThreadListResponse = z.infer<
  typeof AgencyThreadListResponseSchema
>;

export const AgencyChatResponseSchema = z.object({
  activeAgent: AgencyAgentProfileSchema,
  handedOffFrom: AgencyAgentRoleSchema.nullable(),
  lifecyclePhase: ProjectLifecyclePhaseSchema,
  cycleNumber: z.number().int().min(1),
  teamTopology: TeamTopologyModeSchema.default("lean_mvp"),
  autonomyMode: AutonomyModeSchema,
  executionMode: LlmExecutionModeSchema.default("local_assisted"),
  llmLatencyMs: z.number().int().min(0).nullable().optional(),
  threadId: z.string().min(1).max(160).nullable().optional(),
  toolsUsed: z.array(z.string()).optional(),
  omStatus: ObservationalMemoryStatusSchema.nullable().optional(),
  reply: z.string().min(1),
  actionsExecuted: z.array(AgencyActionExecutedSchema),
  projectState: AgencyProjectStateSchema.nullable(),
  readiness: SystemReadinessStatusSchema,
});
export type AgencyChatResponse = z.infer<typeof AgencyChatResponseSchema>;

export const AgencyStreamEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("thread_ready"),
      threadId: z.string().min(1).max(160),
      executionMode: LlmExecutionModeSchema,
      activeAgent: AgencyAgentProfileSchema,
      handedOffFrom: AgencyAgentRoleSchema.nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal("action_executed"),
      action: AgencyActionExecutedSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("tool_call"),
      toolName: z.string().min(1),
      input: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z
    .object({
      type: z.literal("tool_result"),
      toolName: z.string().min(1),
      output: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z
    .object({
      type: z.literal("token"),
      text: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("om_status"),
      status: ObservationalMemoryStatusSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("done"),
      response: AgencyChatResponseSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("error"),
      code: z.string().min(1),
      message: z.string().min(1),
    })
    .strict(),
]);
export type AgencyStreamEvent = z.infer<typeof AgencyStreamEventSchema>;
