import { describe, expect, test } from "vitest";
import {
  AgencyActionExecutedSchema,
  AgencySessionAbortRequestSchema,
  AgencySessionControlResponseSchema,
  AgencySessionPlanDecisionRequestSchema,
  AgencySessionSteerRequestSchema,
  AgencyStreamEventSchema,
  BackgroundTaskListResponseSchema,
  BackgroundTaskSummarySchema,
  CodingExecutorModeSchema,
  DEFAULT_PROJECT_STAGE_AUTOMATION,
  DecisionTypeSchema,
  EngineConfigSchema,
  ProjectSchema,
  ProjectStageAutomationSchema,
  ResolveDecisionSchema,
  UpdateEngineConfigSchema,
  UpdateProjectSchema,
  UpdateProjectStageAutomationSchema,
  WorkflowAbortInputSchema,
  WorkflowGateTypeSchema,
  WorkflowResumeInputSchema,
} from "../src/index.js";

const VALID_UUID = "11111111-1111-4111-8111-111111111111";
const VALID_ISO = "2026-11-23T16:00:00.000Z";

describe("@uzina/contracts — Slice 19 (AgentController, Kanban Manual/Auto & Orçamento)", () => {
  test("ProjectStageAutomationSchema aplica defaults seguros e impede decision_pending=auto", () => {
    const parsed = ProjectStageAutomationSchema.parse({});
    expect(parsed).toEqual(DEFAULT_PROJECT_STAGE_AUTOMATION);
    expect(parsed.decision_pending).toBe("manual");

    expect(() =>
      ProjectStageAutomationSchema.parse({ decision_pending: "auto" })
    ).toThrow();
    expect(() =>
      UpdateProjectStageAutomationSchema.parse({ decision_pending: "auto" })
    ).toThrow();
    expect(() =>
      ProjectStageAutomationSchema.parse({ extraField: "x" })
    ).toThrow();
  });

  test.each([
    {
      name: "alterar somente building para manual",
      input: { stageAutomation: { building: "manual" } },
      valid: true,
    },
    {
      name: "definir budgetCapUsd positivo",
      input: { budgetCapUsd: 25.5 },
      valid: true,
    },
    {
      name: "remover budgetCapUsd com null",
      input: { budgetCapUsd: null },
      valid: true,
    },
    {
      name: "rejeitar decision_pending = auto em UpdateProjectSchema",
      input: { stageAutomation: { decision_pending: "auto" } },
      valid: false,
    },
    {
      name: "rejeitar budgetCapUsd <= 0",
      input: { budgetCapUsd: 0 },
      valid: false,
    },
    {
      name: "rejeitar campo desconhecido (.strict)",
      input: { unknownProp: true },
      valid: false,
    },
  ])("UpdateProjectSchema: $name", ({ input, valid }) => {
    const res = UpdateProjectSchema.safeParse(input);
    expect(res.success).toBe(valid);
  });

  test("ProjectSchema mantém retrocompatibilidade com payloads sem stageAutomation/budgetCapUsd", () => {
    const parsed = ProjectSchema.parse({
      id: VALID_UUID,
      clientId: VALID_UUID,
      name: "Projeto Legado",
      slug: "projeto-legado",
      description: null,
      defaultDevelopmentStrategy: "frontend_first_msw",
      maturityScore: 80,
      designMdPath: null,
      status: "active",
      repositories: [],
      createdAt: VALID_ISO,
      updatedAt: VALID_ISO,
    });
    expect(parsed.stageAutomation).toEqual(DEFAULT_PROJECT_STAGE_AUTOMATION);
    expect(parsed.budgetCapUsd).toBeNull();
  });

  test.each([
    { schema: "DecisionType", parser: DecisionTypeSchema, value: "stage_gate_approve", valid: true },
    { schema: "DecisionType", parser: DecisionTypeSchema, value: "budget_cap_pause", valid: true },
    { schema: "WorkflowGateType", parser: WorkflowGateTypeSchema, value: "stage_gate_approve", valid: true },
    { schema: "WorkflowGateType", parser: WorkflowGateTypeSchema, value: "budget_cap_pause", valid: true },
    { schema: "CodingExecutorMode", parser: CodingExecutorModeSchema, value: "opencode", valid: true },
    { schema: "CodingExecutorMode", parser: CodingExecutorModeSchema, value: "mastra_coding_agent", valid: true },
    { schema: "CodingExecutorMode", parser: CodingExecutorModeSchema, value: "acp_invalid", valid: false },
  ])("$schema valida $value -> $valid", ({ parser, value, valid }) => {
    expect(parser.safeParse(value).success).toBe(valid);
  });

  test("ResolveDecisionSchema e WorkflowResumeInputSchema aceitam newBudgetCapUsd válido e rejeitam inválidos", () => {
    expect(
      ResolveDecisionSchema.parse({ status: "approved", newBudgetCapUsd: 50 })
        .newBudgetCapUsd
    ).toBe(50);
    expect(
      ResolveDecisionSchema.safeParse({ status: "approved", newBudgetCapUsd: -1 })
        .success
    ).toBe(false);
    expect(
      WorkflowResumeInputSchema.parse({
        decision: "approved",
        newBudgetCapUsd: 100,
      }).newBudgetCapUsd
    ).toBe(100);
    expect(WorkflowAbortInputSchema.parse({ reason: "Cancelado" }).reason).toBe(
      "Cancelado"
    );
  });

  test("EngineConfigSchema e UpdateEngineConfigSchema suportam codingExecutorMode", () => {
    const cfg = EngineConfigSchema.parse({
      organizationId: VALID_UUID,
      embeddingMode: "deterministic",
      ollamaBaseUrl: "http://127.0.0.1:11434",
      ollamaEmbeddingModel: "bge-m3",
      astMode: "polyglot",
      workspaceKind: "worktree",
      skeletonMaxTokens: 2000,
      qmdTopK: 5,
      autoInjectInRunner: true,
      dockerCpuLimit: "1.0",
      dockerMemoryLimit: "512m",
      updatedAt: VALID_ISO,
    });
    expect(cfg.codingExecutorMode).toBe("opencode");
    expect(
      UpdateEngineConfigSchema.parse({
        codingExecutorMode: "mastra_coding_agent",
      }).codingExecutorMode
    ).toBe("mastra_coding_agent");
  });

  test.each([
    {
      label: "steer válido",
      schema: AgencySessionSteerRequestSchema,
      payload: {
        projectId: VALID_UUID,
        message: "Priorize validação Zod antes do componente",
        targetMode: "architect",
      },
      valid: true,
    },
    {
      label: "steer com mensagem vazia",
      schema: AgencySessionSteerRequestSchema,
      payload: { message: "   " },
      valid: false,
    },
    {
      label: "abort válido",
      schema: AgencySessionAbortRequestSchema,
      payload: { projectId: VALID_UUID, deliverableId: VALID_UUID, reason: "Parar execução" },
      valid: true,
    },
    {
      label: "plan decision válida",
      schema: AgencySessionPlanDecisionRequestSchema,
      payload: { toolCallId: "tc-plan-1", approved: true },
      valid: true,
    },
    {
      label: "control response válida",
      schema: AgencySessionControlResponseSchema,
      payload: {
        ok: true,
        sessionId: "sess-123",
        action: "steered",
        status: "accepted",
        mode: "architect",
      },
      valid: true,
    },
  ])("Sessão Controller ($label)", ({ schema, payload, valid }) => {
    expect(schema.safeParse(payload).success).toBe(valid);
  });

  test("BackgroundTaskSummarySchema e novos AgencyStreamEventSchema passam em parse estrito", () => {
    const task = BackgroundTaskSummarySchema.parse({
      id: "task-wf-1",
      organizationId: VALID_UUID,
      projectId: VALID_UUID,
      deliverableId: VALID_UUID,
      kind: "workflow_cycle",
      status: "running",
      summary: "Workflow em execução no worktree",
      mastraRunId: "run-123",
      startedAt: VALID_ISO,
      updatedAt: VALID_ISO,
    });

    BackgroundTaskListResponseSchema.parse({
      projectId: VALID_UUID,
      items: [task],
    });

    const events = [
      { type: "controller_mode", mode: "discovery", sessionId: "sess-1" },
      {
        type: "workflow_started",
        deliverableId: VALID_UUID,
        runId: "run-123",
        backgroundTaskId: task.id,
      },
      { type: "background_task", task },
      {
        type: "plan_approval_required",
        sessionId: "sess-1",
        toolCallId: "tc-plan-1",
        planSummary: "Plano aprovado em 2 etapas.",
        transitionModeId: "architect",
      },
    ];
    for (const ev of events) {
      expect(() => AgencyStreamEventSchema.parse(ev)).not.toThrow();
    }

    expect(
      AgencyActionExecutedSchema.parse({
        type: "started_workflow",
        label: "Workflow iniciado",
        targetId: VALID_UUID,
      }).type
    ).toBe("started_workflow");
    expect(
      AgencyActionExecutedSchema.parse({
        type: "budget_cap_paused",
        label: "Orçamento atingido",
      }).type
    ).toBe("budget_cap_paused");
  });
});
