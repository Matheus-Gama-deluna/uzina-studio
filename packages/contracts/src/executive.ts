import { z } from "zod";
import { DecisionTypeSchema, ProjectStatusSchema } from "./enums.js";

export const ExecutiveStageSchema = z.enum([
  "ideacao",
  "design_visual",
  "construcao",
  "validacao_qualidade",
  "aguardando_aprovacao",
  "entregue",
  "pausado",
  "atencao",
]);
export type ExecutiveStage = z.infer<typeof ExecutiveStageSchema>;

export const ExecutiveProjectSummarySchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(120),
    clientName: z.string().min(1).max(120),
    description: z.string().max(2000).nullable(),
    status: ProjectStatusSchema,
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type ExecutiveProjectSummary = z.infer<
  typeof ExecutiveProjectSummarySchema
>;

export const ExecutiveProjectSelectorItemSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(120),
    clientName: z.string().min(1).max(120),
  })
  .strict();
export type ExecutiveProjectSelectorItem = z.infer<
  typeof ExecutiveProjectSelectorItemSchema
>;

export const ExecutiveDeliverableItemSchema = z
  .object({
    id: z.uuid(),
    title: z.string().min(1).max(200),
    description: z.string().max(2000).nullable(),
    executiveStage: ExecutiveStageSchema,
    stageLabel: z.string().min(1).max(80),
    hasUi: z.boolean(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type ExecutiveDeliverableItem = z.infer<
  typeof ExecutiveDeliverableItemSchema
>;

export const ExecutivePendingApprovalSchema = z
  .object({
    decisionId: z.uuid(),
    deliverableId: z.uuid(),
    deliverableTitle: z.string().min(1).max(200),
    decisionType: DecisionTypeSchema,
    summary: z.string().min(1).max(1000),
    confidenceScore: z.number().min(0).max(1).nullable(),
    spokenSummary: z.string().max(500),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type ExecutivePendingApproval = z.infer<
  typeof ExecutivePendingApprovalSchema
>;

export const ExecutivePrototypePreviewSchema = z
  .object({
    id: z.uuid(),
    title: z.string().min(1).max(160),
    version: z.number().int().min(1),
    approved: z.boolean(),
    previewUrl: z.string().min(1).max(300),
  })
  .strict();
export type ExecutivePrototypePreview = z.infer<
  typeof ExecutivePrototypePreviewSchema
>;

export const ExecutiveOverviewCountsSchema = z
  .object({
    total: z.number().int().nonnegative(),
    delivered: z.number().int().nonnegative(),
    inProgress: z.number().int().nonnegative(),
    awaitingApproval: z.number().int().nonnegative(),
  })
  .strict();
export type ExecutiveOverviewCounts = z.infer<
  typeof ExecutiveOverviewCountsSchema
>;

export const ExecutiveProjectOverviewSchema = z
  .object({
    project: ExecutiveProjectSummarySchema.nullable(),
    projects: z.array(ExecutiveProjectSelectorItemSchema),
    prdExcerptMarkdown: z.string().max(8000).nullable(),
    progressPercent: z.number().int().min(0).max(100),
    counts: ExecutiveOverviewCountsSchema,
    latestPrototype: ExecutivePrototypePreviewSchema.nullable(),
    pendingApprovals: z.array(ExecutivePendingApprovalSchema),
    timeline: z.array(ExecutiveDeliverableItemSchema),
  })
  .strict();
export type ExecutiveProjectOverview = z.infer<
  typeof ExecutiveProjectOverviewSchema
>;
