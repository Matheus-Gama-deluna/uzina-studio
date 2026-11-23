import { z } from "zod";
import { LlmExecutionModeSchema, ObservationalMemoryStatusSchema } from "./agency.js";
import { OrgRoleSchema } from "./enums.js";

export const CopilotRoleSchema = z.enum(["user", "assistant", "system"]);
export type CopilotRole = z.infer<typeof CopilotRoleSchema>;

export const CopilotMessageSchema = z
  .object({
    role: CopilotRoleSchema,
    content: z.string().trim().min(1).max(8000),
  })
  .strict();
export type CopilotMessage = z.infer<typeof CopilotMessageSchema>;

export const CopilotActionRequestSchema = z
  .object({
    type: z.enum(["overview", "draft_deliverable", "trigger_security_scan"]),
    projectId: z.uuid().optional(),
    title: z.string().trim().min(3).max(200).optional(),
    description: z.string().trim().max(4000).optional(),
    hasUi: z.boolean().optional(),
  })
  .strict();
export type CopilotActionRequest = z.infer<typeof CopilotActionRequestSchema>;

export const CopilotChatRequestSchema = z
  .object({
    messages: z.array(CopilotMessageSchema).min(1).max(30),
    threadId: z.string().trim().min(1).max(160).optional(),
    clientId: z.uuid().optional(),
    projectId: z.uuid().optional(),
    action: CopilotActionRequestSchema.optional(),
  })
  .strict();
export type CopilotChatRequest = z.infer<typeof CopilotChatRequestSchema>;

export const CopilotStreamEventSchema = z.discriminatedUnion("type", [
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
      toolsUsed: z.array(z.string()),
      finishReason: z.enum(["completed", "aborted"]),
      threadId: z.string().min(1).max(160).optional(),
      executionMode: LlmExecutionModeSchema.optional(),
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
export type CopilotStreamEvent = z.infer<typeof CopilotStreamEventSchema>;

export const CopilotCapabilitiesSchema = z.object({
  agentId: z.literal("executive_copilot"),
  allowedTools: z.array(
    z.enum([
      "read_workspace_overview",
      "draft_deliverable",
      "trigger_security_scan",
    ])
  ),
  forbiddenCapabilities: z.array(z.string()),
  actorRole: OrgRoleSchema,
});
export type CopilotCapabilities = z.infer<typeof CopilotCapabilitiesSchema>;
