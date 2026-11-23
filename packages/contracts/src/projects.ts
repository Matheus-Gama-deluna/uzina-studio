import { z } from "zod";
import { SlugSchema } from "./clients.js";
import {
  DevelopmentStrategySchema,
  ProjectStatusSchema,
} from "./enums.js";
import { HttpUrlSchema } from "./errors.js";
import {
  DEFAULT_PROJECT_STAGE_AUTOMATION,
  ProjectStageAutomationSchema,
  UpdateProjectStageAutomationSchema,
} from "./workflow.js";

export const ProjectRepositorySchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  name: z.string().min(1).max(120),
  localPath: z.string().min(1).max(500),
  remoteUrl: HttpUrlSchema.nullable(),
  defaultBranch: z.string().min(1).max(120),
  stackMetadataJson: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ProjectRepository = z.infer<typeof ProjectRepositorySchema>;

export const CreateProjectRepositorySchema = z.object({
  name: z.string().trim().min(1).max(120),
  localPath: z.string().trim().min(1).max(500),
  remoteUrl: HttpUrlSchema.nullable().optional(),
  defaultBranch: z.string().trim().min(1).max(120).default("main"),
});
export type CreateProjectRepositoryInput = z.infer<
  typeof CreateProjectRepositorySchema
>;

export const ProjectSchema = z.object({
  id: z.uuid(),
  clientId: z.uuid(),
  name: z.string().min(1).max(120),
  slug: SlugSchema,
  description: z.string().max(2000).nullable(),
  defaultDevelopmentStrategy: DevelopmentStrategySchema,
  maturityScore: z.number().int().min(0).max(100).nullable(),
  designMdPath: z.string().max(500).nullable(),
  status: ProjectStatusSchema,
  stageAutomation: ProjectStageAutomationSchema.default(() => ({
    ...DEFAULT_PROJECT_STAGE_AUTOMATION,
  })),
  budgetCapUsd: z.number().positive().max(10000).nullable().default(null),
  repositories: z.array(ProjectRepositorySchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const CreateProjectSchema = z.object({
  clientId: z.uuid(),
  name: z.string().trim().min(2).max(120),
  slug: SlugSchema.optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  defaultDevelopmentStrategy: DevelopmentStrategySchema.default(
    "frontend_first_msw"
  ),
  repository: CreateProjectRepositorySchema.optional(),
});
export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;

export const UpdateProjectSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    defaultDevelopmentStrategy: DevelopmentStrategySchema.optional(),
    maturityScore: z.number().int().min(0).max(100).nullable().optional(),
    status: ProjectStatusSchema.optional(),
    stageAutomation: UpdateProjectStageAutomationSchema.optional(),
    budgetCapUsd: z.number().positive().max(10000).nullable().optional(),
  })
  .strict();
export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;

export const ProjectListResponseSchema = z.object({
  items: z.array(ProjectSchema),
});
export type ProjectListResponse = z.infer<typeof ProjectListResponseSchema>;
