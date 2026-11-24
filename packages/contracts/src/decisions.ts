import { z } from "zod";
import { DecisionTypeSchema } from "./enums.js";
import { DeliverableWorkflowStateSchema } from "./workflow.js";

export const DecisionStatusSchema = z.enum([
  "pending",
  "approved",
  "changes_requested",
  "rejected",
]);
export type DecisionStatus = z.infer<typeof DecisionStatusSchema>;

export const VerifyCheckSummarySchema = z.object({
  name: z.string().trim().min(1).max(120),
  passed: z.boolean(),
  durationMs: z.number().int().nonnegative(),
  summary: z.string().max(4000),
});
export type VerifyCheckSummary = z.infer<typeof VerifyCheckSummarySchema>;

export const EvidencePackSchema = z.object({
  deliverableId: z.uuid(),
  branchName: z.string().trim().min(1).max(200),
  baseBranch: z.string().trim().min(1).max(200),
  verifyAttempts: z.number().int().nonnegative(),
  verifyPassed: z.boolean(),
  verifyChecks: z.array(VerifyCheckSummarySchema),
  testAuditPassed: z.boolean(),
  testAuditViolationsCount: z.number().int().nonnegative(),
  diffSummary: z.object({
    filesChanged: z.number().int().nonnegative(),
    diffBytes: z.number().int().nonnegative(),
    preview: z.string().max(16384),
  }),
  securitySummary: z.object({
    scanId: z.uuid().nullable(),
    critical: z.number().int().nonnegative(),
    high: z.number().int().nonnegative(),
    medium: z.number().int().nonnegative(),
    low: z.number().int().nonnegative(),
    info: z.number().int().nonnegative(),
    scannersRun: z.array(z.string()),
    skippedScanners: z.array(z.string()),
    gatePassed: z.boolean(),
  }),
  tokenSummary: z.object({
    totalInputTokens: z.number().int().nonnegative(),
    totalOutputTokens: z.number().int().nonnegative(),
    totalCacheReadTokens: z.number().int().nonnegative(),
    estimatedCostUsd: z.number().nonnegative(),
  }),
  verifierVerdict: z.enum(["approved", "changes_required"]),
  verifierNotes: z.string().max(4000),
  finalizeInfo: z
    .object({
      mode: z.enum(["draft_pr", "local_merge", "local_branch_ready"]),
      commitSha: z.string().nullable().optional(),
      prUrl: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});
export type EvidencePack = z.infer<typeof EvidencePackSchema>;

export const DecisionSchema = z.object({
  id: z.uuid(),
  deliverableId: z.uuid(),
  deliverableTitle: z.string().trim().min(1).max(200).optional(),
  projectId: z.uuid().optional(),
  projectName: z.string().trim().min(1).max(200).optional(),
  mastraStepId: z.string().trim().min(1).max(120),
  decisionType: DecisionTypeSchema,
  summary: z.string().trim().min(1).max(4000),
  payloadJson: z.record(z.string(), z.unknown()),
  status: DecisionStatusSchema,
  humanFeedback: z.string().max(4000).nullable(),
  resolvedBy: z.uuid().nullable(),
  resolvedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Decision = z.infer<typeof DecisionSchema>;

export const DecisionListResponseSchema = z.object({
  items: z.array(DecisionSchema),
});
export type DecisionListResponse = z.infer<typeof DecisionListResponseSchema>;

export const ResolveDecisionSchema = z
  .object({
    status: z.enum(["approved", "changes_requested", "rejected"]),
    humanFeedback: z.string().trim().max(4000).optional(),
    newBudgetCapUsd: z.number().positive().max(10000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.status === "changes_requested" &&
      (!value.humanFeedback || value.humanFeedback.trim().length < 3)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["humanFeedback"],
        message:
          "humanFeedback (mínimo 3 caracteres) é obrigatório quando status = changes_requested.",
      });
    }
  });
export type ResolveDecisionInput = z.infer<typeof ResolveDecisionSchema>;

export const ResolveDecisionResponseSchema = z.object({
  decision: DecisionSchema,
  workflowState: DeliverableWorkflowStateSchema.optional(),
});
export type ResolveDecisionResponse = z.infer<
  typeof ResolveDecisionResponseSchema
>;

export const ExecutionEventTypeSchema = z.enum([
  "stage_change",
  "tool_call",
  "stuck_alert",
  "verify_result",
  "token_usage",
  "error",
]);
export type ExecutionEventType = z.infer<typeof ExecutionEventTypeSchema>;

export const ExecutionEventSchema = z.object({
  id: z.uuid(),
  deliverableId: z.uuid(),
  stage: z.string().trim().min(1).max(120),
  actorRole: z.string().trim().min(1).max(80),
  eventType: ExecutionEventTypeSchema,
  tokensInput: z.number().int().nonnegative(),
  tokensOutput: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
  payloadJson: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
});
export type ExecutionEvent = z.infer<typeof ExecutionEventSchema>;

export const ExecutionEventListResponseSchema = z.object({
  items: z.array(ExecutionEventSchema),
});
export type ExecutionEventListResponse = z.infer<
  typeof ExecutionEventListResponseSchema
>;
