import { z } from "zod";
import {
  DeliverableStatusSchema,
  DevelopmentStrategySchema,
  RiskLevelSchema,
  TacticalPatternSchema,
} from "./enums.js";
import { EvidencePackSchema } from "./decisions.js";

export const DeliverableSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  repositoryId: z.uuid().nullable(),
  title: z.string().min(1).max(200),
  description: z.string().max(4000).nullable(),
  status: DeliverableStatusSchema,
  pausedFromStatus: DeliverableStatusSchema.nullable(),
  hasUi: z.boolean(),
  developmentStrategy: DevelopmentStrategySchema,
  tacticalPattern: TacticalPatternSchema,
  riskLevel: RiskLevelSchema,
  worktreePath: z.string().nullable(),
  branchName: z.string().nullable(),
  mastraRunId: z.string().nullable().optional(),
  specMarkdown: z.string().nullable().optional(),
  blueprintJson: z.record(z.string(), z.unknown()).nullable().optional(),
  evidencePackJson: EvidencePackSchema.nullable().optional(),
  verifyAttempts: z.number().int().min(0),
  maxVerifyAttempts: z.number().int().min(1).max(10),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Deliverable = z.infer<typeof DeliverableSchema>;

export const CreateDeliverableSchema = z.object({
  repositoryId: z.uuid().nullable().optional(),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(4000).nullable().optional(),
  hasUi: z.boolean().default(false),
  developmentStrategy: DevelopmentStrategySchema.optional(),
  tacticalPattern: TacticalPatternSchema.default("single_agent"),
  riskLevel: RiskLevelSchema.default("low"),
});
export type CreateDeliverableInput = z.infer<typeof CreateDeliverableSchema>;

export const UpdateDeliverableSchema = z
  .object({
    title: z.string().trim().min(3).max(200).optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    repositoryId: z.uuid().nullable().optional(),
    status: DeliverableStatusSchema.optional(),
    hasUi: z.boolean().optional(),
    developmentStrategy: DevelopmentStrategySchema.optional(),
    tacticalPattern: TacticalPatternSchema.optional(),
    riskLevel: RiskLevelSchema.optional(),
  })
  .strict();
export type UpdateDeliverableInput = z.infer<typeof UpdateDeliverableSchema>;

export const DeliverableListResponseSchema = z.object({
  items: z.array(DeliverableSchema),
});
export type DeliverableListResponse = z.infer<
  typeof DeliverableListResponseSchema
>;
