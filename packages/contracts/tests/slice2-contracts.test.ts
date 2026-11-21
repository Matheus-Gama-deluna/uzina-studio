import { describe, expect, test } from "vitest";
import {
  AgentTurnObservationSchema,
  ExecOptionsSchema,
  ExecResultSchema,
  HttpUrlSchema,
  OpenCodeModeSchema,
  OpenCodeProviderConfigSchema,
  OpenCodeRunSessionOptionsSchema,
  OpenCodeSessionResultSchema,
  SkillDefinitionSchema,
  StuckAlertSchema,
  StuckPatternSchema,
  WorktreeHandleSchema,
  WorktreePrepareInputSchema,
} from "../src/index.js";

const VALID_ORG_ID = "11111111-1111-4111-8111-111111111111";

describe("Slice 2 contracts — Execution, OpenCode & StuckDetector", () => {
  test.each([
    {
      label: "OpenCodeModeSchema aceita plan",
      schema: OpenCodeModeSchema,
      input: "plan",
      valid: true,
    },
    {
      label: "OpenCodeModeSchema aceita build",
      schema: OpenCodeModeSchema,
      input: "build",
      valid: true,
    },
    {
      label: "OpenCodeModeSchema rejeita execute",
      schema: OpenCodeModeSchema,
      input: "execute",
      valid: false,
    },
    {
      label: "StuckPatternSchema aceita context_window_overflow",
      schema: StuckPatternSchema,
      input: "context_window_overflow",
      valid: true,
    },
    {
      label: "AgentTurnObservationSchema aceita tool_call válido",
      schema: AgentTurnObservationSchema,
      input: {
        turnIndex: 0,
        actionType: "tool_call",
        toolName: "read",
        actionSignature: "read:src/index.ts",
        observationSignature: "ok:120bytes",
      },
      valid: true,
    },
    {
      label: "AgentTurnObservationSchema rejeita turnIndex negativo",
      schema: AgentTurnObservationSchema,
      input: {
        turnIndex: -1,
        actionType: "assistant_text",
      },
      valid: false,
    },
    {
      label: "AgentTurnObservationSchema rejeita tool_call sem toolName",
      schema: AgentTurnObservationSchema,
      input: {
        turnIndex: 1,
        actionType: "tool_call",
        actionSignature: "read:src/index.ts",
      },
      valid: false,
    },
    {
      label: "AgentTurnObservationSchema rejeita error sem errorMessage nem overflow",
      schema: AgentTurnObservationSchema,
      input: {
        turnIndex: 2,
        actionType: "error",
        actionSignature: "bash:test",
      },
      valid: false,
    },
    {
      label: "StuckAlertSchema exige evidenceTurns não vazio",
      schema: StuckAlertSchema,
      input: {
        detected: true,
        pattern: "monologue_no_tool",
        decisionType: "stuck_intervention",
        reason: "3 turnos de monólogo",
        evidenceTurns: [],
      },
      valid: false,
    },
    {
      label: "ExecOptionsSchema rejeita timeoutMs menor que 100ms e maior que 600_000ms",
      schema: ExecOptionsSchema,
      input: { timeoutMs: 50 },
      valid: false,
    },
    {
      label: "ExecOptionsSchema rejeita timeoutMs acima do limite máximo (600_001ms)",
      schema: ExecOptionsSchema,
      input: { timeoutMs: 600_001 },
      valid: false,
    },
    {
      label: "ExecOptionsSchema rejeita maxOutputBytes menor que 1024",
      schema: ExecOptionsSchema,
      input: { maxOutputBytes: 1023 },
      valid: false,
    },
    {
      label: "WorktreePrepareInputSchema rejeita worktreesRootDir UNC",
      schema: WorktreePrepareInputSchema,
      input: {
        repoPath: "/tmp/repo",
        baseBranch: "main",
        deliverableId: "d-1",
        worktreesRootDir: "\\\\evil\\share",
      },
      valid: false,
    },
    {
      label: "SkillDefinitionSchema rejeita nome com maiúsculas",
      schema: SkillDefinitionSchema,
      input: {
        name: "TestQuality",
        description: "Desc",
        appliesToRoles: ["builder"],
        content: "# Skill",
        filePath: "packages/skills/test/SKILL.md",
      },
      valid: false,
    },
    {
      label: "SkillDefinitionSchema rejeita appliesToRoles vazio",
      schema: SkillDefinitionSchema,
      input: {
        name: "test-quality-engineering",
        description: "Desc",
        appliesToRoles: [],
        content: "# Skill",
        filePath: "packages/skills/test/SKILL.md",
      },
      valid: false,
    },
    {
      label: "HttpUrlSchema rejeita endpoint IMDS AWS 169.254.169.254",
      schema: HttpUrlSchema,
      input: "http://169.254.169.254/latest/meta-data/",
      valid: false,
    },
    {
      label: "OpenCodeProviderConfigSchema rejeita javascript: URL",
      schema: OpenCodeProviderConfigSchema,
      input: {
        providerType: "omniroute",
        baseUrl: "javascript:alert(1)",
        organizationId: VALID_ORG_ID,
        roleBindings: { builder: { modelId: "openai/gpt-5" } },
      },
      valid: false,
    },
    {
      label: "OpenCodeProviderConfigSchema aceita ollama sem apiKey em localhost",
      schema: OpenCodeProviderConfigSchema,
      input: {
        providerType: "ollama",
        baseUrl: "http://127.0.0.1:11434",
        encryptedApiKey: null,
        organizationId: VALID_ORG_ID,
        roleBindings: { builder: { modelId: "qwen2.5-coder:14b" } },
      },
      valid: true,
    },
    {
      label: "WorktreeHandleSchema aceita handle válido",
      schema: WorktreeHandleSchema,
      input: {
        deliverableId: "deliv-123",
        repoPath: "/tmp/repo",
        workspacePath: "/tmp/repo/.worktrees/task-deliv-123",
        branchName: "uzina/deliv-123",
        baseBranch: "main",
      },
      valid: true,
    },
    {
      label: "ExecResultSchema aceita saída completa",
      schema: ExecResultSchema,
      input: {
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        durationMs: 12,
        timedOut: false,
        aborted: false,
        truncated: false,
      },
      valid: true,
    },
    {
      label: "OpenCodeRunSessionOptionsSchema rejeita prompt vazio e maxSteps fora dos limites (0 / 201)",
      schema: OpenCodeRunSessionOptionsSchema,
      input: {
        workspacePath: "/tmp/ws",
        mode: "plan",
        role: "architect",
        providerConfig: {
          providerType: "omniroute",
          baseUrl: "http://127.0.0.1:20128/v1",
          organizationId: VALID_ORG_ID,
          roleBindings: { architect: { modelId: "claude-sonnet-4-5" } },
        },
        prompt: "   ",
        maxSteps: 0,
      },
      valid: false,
    },
    {
      label: "OpenCodeRunSessionOptionsSchema rejeita maxSteps acima de 200",
      schema: OpenCodeRunSessionOptionsSchema,
      input: {
        workspacePath: "/tmp/ws",
        mode: "plan",
        role: "architect",
        providerConfig: {
          providerType: "omniroute",
          baseUrl: "http://127.0.0.1:20128/v1",
          organizationId: VALID_ORG_ID,
          roleBindings: { architect: { modelId: "claude-sonnet-4-5" } },
        },
        prompt: "Analise",
        maxSteps: 201,
      },
      valid: false,
    },
    {
      label: "OpenCodeSessionResultSchema aceita resultado stuck",
      schema: OpenCodeSessionResultSchema,
      input: {
        sessionId: "sess-1",
        status: "stuck",
        mode: "build",
        role: "builder",
        lockedModelId: "omniroute/gpt-5",
        finalText: "",
        stuckAlert: {
          detected: true,
          pattern: "repeated_action_error",
          decisionType: "stuck_intervention",
          reason: "3 erros repetidos",
          evidenceTurns: [1, 2, 3],
        },
        touchedFiles: [],
        commandsExecuted: ["pnpm test"],
        tokenUsage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 20 },
        turns: 3,
        durationMs: 420,
      },
      valid: true,
    },
  ])("$label", ({ schema, input, valid }) => {
    const parsed = schema.safeParse(input);
    expect(parsed.success).toBe(valid);
  });

  test("ExecOptionsSchema e OpenCodeRunSessionOptionsSchema aplicam valores default exatos", () => {
    const execDefaults = ExecOptionsSchema.parse({});
    expect(execDefaults).toEqual({
      timeoutMs: 60_000,
      maxOutputBytes: 1_048_576,
    });

    const runnerDefaults = OpenCodeRunSessionOptionsSchema.parse({
      workspacePath: "/tmp/ws",
      mode: "plan",
      role: "architect",
      providerConfig: {
        providerType: "ollama",
        baseUrl: "http://127.0.0.1:11434",
        organizationId: VALID_ORG_ID,
        roleBindings: { architect: { modelId: "llama3" } },
      },
      prompt: "Analise",
    });
    expect(runnerDefaults.maxSteps).toBe(24);
    expect(runnerDefaults.timeoutMs).toBe(300_000);
  });
});
