import { z } from "zod";
import { AgentRoleSchema, ProviderTypeSchema } from "./enums.js";
import { HttpUrlSchema } from "./errors.js";
import { RoleBindingsSchema } from "./providers.js";

export const OpenCodeModeSchema = z.enum(["plan", "build"]);
export type OpenCodeMode = z.infer<typeof OpenCodeModeSchema>;

export const StuckPatternSchema = z.enum([
  "repeated_action_observation",
  "repeated_action_error",
  "monologue_no_tool",
  "alternating_ping_pong",
  "context_window_overflow",
]);
export type StuckPattern = z.infer<typeof StuckPatternSchema>;

export const OpenCodeSessionStatusSchema = z.enum([
  "completed",
  "stuck",
  "aborted",
  "timed_out",
  "error",
]);
export type OpenCodeSessionStatus = z.infer<typeof OpenCodeSessionStatusSchema>;

export const AgentTurnActionTypeSchema = z.enum([
  "tool_call",
  "assistant_text",
  "error",
]);
export type AgentTurnActionType = z.infer<typeof AgentTurnActionTypeSchema>;

export const AgentTurnObservationSchema = z
  .object({
    turnIndex: z.number().int().nonnegative(),
    actionType: AgentTurnActionTypeSchema,
    toolName: z.string().trim().min(1).optional(),
    actionSignature: z.string().trim().min(1).optional(),
    observationSignature: z.string().trim().min(1).optional(),
    errorMessage: z.string().trim().min(1).optional(),
    isContextOverflow: z.boolean().default(false),
  })
  .superRefine((val, ctx) => {
    if (val.actionType === "tool_call" && !val.toolName) {
      ctx.addIssue({
        code: "custom",
        path: ["toolName"],
        message: "toolName é obrigatório quando actionType é tool_call",
      });
    }
    if (
      val.actionType === "error" &&
      !val.errorMessage &&
      !val.isContextOverflow
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["errorMessage"],
        message:
          "errorMessage ou isContextOverflow=true é obrigatório quando actionType é error",
      });
    }
  });
export type AgentTurnObservation = z.infer<typeof AgentTurnObservationSchema>;
export type AgentTurnObservationInput = z.input<typeof AgentTurnObservationSchema>;

export const StuckAlertSchema = z.object({
  detected: z.literal(true),
  pattern: StuckPatternSchema,
  decisionType: z.literal("stuck_intervention"),
  reason: z.string().trim().min(1),
  evidenceTurns: z.array(z.number().int().nonnegative()).min(1),
});
export type StuckAlert = z.infer<typeof StuckAlertSchema>;

export const WorktreePrepareInputSchema = z.object({
  repoPath: z.string().trim().min(1),
  baseBranch: z.string().trim().min(1),
  deliverableId: z.string().trim().min(1),
  worktreesRootDir: z
    .string()
    .trim()
    .min(1)
    .refine(
      (v) => !v.includes("\0") && !/^[\\/]{2}/.test(v),
      "worktreesRootDir inválido (null byte ou caminho UNC proibido)"
    )
    .optional(),
});
export type WorktreePrepareInput = z.infer<typeof WorktreePrepareInputSchema>;

export const WorktreeHandleSchema = z.object({
  deliverableId: z.string().trim().min(1),
  repoPath: z.string().trim().min(1),
  workspacePath: z.string().trim().min(1),
  branchName: z.string().trim().min(1),
  baseBranch: z.string().trim().min(1),
});
export type WorktreeHandle = z.infer<typeof WorktreeHandleSchema>;

export const ExecOptionsSchema = z.object({
  cwd: z.string().trim().min(1).optional(),
  timeoutMs: z.number().int().min(100).max(600_000).default(60_000),
  env: z.record(z.string(), z.string()).optional(),
  maxOutputBytes: z.number().int().min(1024).max(10_485_760).default(1_048_576),
});
export type ExecOptions = z.input<typeof ExecOptionsSchema>;
export type ExecOptionsResolved = z.infer<typeof ExecOptionsSchema>;

export const ExecResultSchema = z.object({
  exitCode: z.number().int().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  durationMs: z.number().nonnegative(),
  timedOut: z.boolean(),
  aborted: z.boolean(),
  truncated: z.boolean(),
});
export type ExecResult = z.infer<typeof ExecResultSchema>;

export const SkillDefinitionSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/, "Nome da skill deve ser kebab-case"),
  description: z.string().trim().min(1),
  appliesToRoles: z.array(AgentRoleSchema).min(1),
  content: z.string().trim().min(1),
  filePath: z.string().trim().min(1),
});
export type SkillDefinition = z.infer<typeof SkillDefinitionSchema>;

/**
 * Contrato interno exclusivamente server-side (contém chave cifrada do Cofre AES-256-GCM).
 * Nunca deve ser serializado em endpoints HTTP públicos ou fixtures MSW.
 */
export const OpenCodeProviderConfigSchema = z.object({
  providerType: ProviderTypeSchema,
  baseUrl: HttpUrlSchema.nullable().optional(),
  encryptedApiKey: z.string().min(1).nullable().optional(),
  organizationId: z.uuid(),
  roleBindings: RoleBindingsSchema,
});
export type OpenCodeProviderConfig = z.infer<
  typeof OpenCodeProviderConfigSchema
>;

export const TokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
  cacheReadTokens: z.number().int().nonnegative().default(0),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export const OpenCodeRunSessionOptionsSchema = z.object({
  workspacePath: z.string().trim().min(1),
  mode: OpenCodeModeSchema,
  role: AgentRoleSchema,
  providerConfig: OpenCodeProviderConfigSchema,
  prompt: z.string().trim().min(1),
  systemPromptPrefix: z.string().optional(),
  skillNames: z.array(z.string().trim().min(1)).optional(),
  skillsDir: z.string().trim().min(1).optional(),
  maxSteps: z.number().int().min(1).max(200).default(24),
  timeoutMs: z.number().int().min(1000).max(3_600_000).default(300_000),
});
export type OpenCodeRunSessionOptionsInput = z.input<
  typeof OpenCodeRunSessionOptionsSchema
>;

export const OpenCodeSessionResultSchema = z.object({
  sessionId: z.string().min(1).nullable(),
  status: OpenCodeSessionStatusSchema,
  mode: OpenCodeModeSchema,
  role: AgentRoleSchema,
  lockedModelId: z.string().trim().min(1),
  finalText: z.string(),
  structuredOutput: z.unknown().optional(),
  stuckAlert: StuckAlertSchema.nullable(),
  touchedFiles: z.array(z.string()),
  commandsExecuted: z.array(z.string()).default([]),
  tokenUsage: TokenUsageSchema,
  turns: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
  errorMessage: z.string().optional(),
});
export type OpenCodeSessionResult = z.infer<typeof OpenCodeSessionResultSchema>;
