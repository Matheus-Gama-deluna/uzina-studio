import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MastraLanguageModelV2Mock,
  simulateReadableStream,
} from "@mastra/core/test-utils/llm-mock";
import { WORKSPACE_TOOLS } from "@mastra/core/workspace";
import {
  AgentEffectivenessMetricsSchema,
  AgentTrajectoryEvalReportSchema,
  DEFAULT_TOOL_POLICIES,
  type AgentTrajectoryEvalCase,
} from "@uzina/contracts";
import {
  clients,
  closeDb,
  deliverables,
  ensureDefaultOrgAndInternalClient,
  executionEvents,
  getDb,
  organizations,
  projects,
  type UzinaDb,
} from "@uzina/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  evaluateAgentTrajectory,
  runTrajectoryEvalSuite,
  type TrajectoryTraceInput,
} from "../src/evals/trajectory-evals.js";
import { computeAgentEffectivenessMetricsScoped } from "../src/finops.js";
import { MastraWorkspaceExecutorAdapter } from "../src/workspace-adapter.js";

const tempDirs: string[] = [];

function createTempWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-s32-ws-"));
  tempDirs.push(dir);
  return dir;
}

describe("Slice 32 — Agent Trajectory Evals & Effectiveness Metrics", () => {
  let db: UzinaDb;
  let orgAId: string;
  let internalClientAId: string;
  let orgBId: string;
  let clientBId: string;

  beforeAll(async () => {
    const ctx = await getDb({ dataDir: ":memory:" });
    db = ctx.db;
    const seeded = await ensureDefaultOrgAndInternalClient(db);
    orgAId = seeded.organizationId;
    internalClientAId = seeded.internalClientId;

    const [orgB] = await db
      .insert(organizations)
      .values({
        name: "Org B Isolation",
        slug: `org-b-${crypto.randomUUID().slice(0, 8)}`,
      })
      .returning();
    orgBId = orgB!.id;

    const [clientB] = await db
      .insert(clients)
      .values({
        organizationId: orgBId,
        name: "Client B",
        slug: `client-b-${crypto.randomUUID().slice(0, 8)}`,
      })
      .returning();
    clientBId = clientB!.id;
  });

  afterAll(async () => {
    await closeDb();
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("runTrajectoryEvalSuite executa suíte determinística completa (architect, ux, qa, builder harness) sem LLM", async () => {
    const report = await runTrajectoryEvalSuite();
    const parsed = AgentTrajectoryEvalReportSchema.parse(report);

    expect(parsed.passed).toBe(true);
    expect(parsed.totalCases).toBe(4);
    expect(parsed.passedCases).toBe(4);
    expect(parsed.failedCases).toBe(0);

    const caseIds = parsed.results.map((r) => r.caseId);
    expect(caseIds).toEqual([
      "architect-step0-codebase-intel",
      "ux-designer-design-contract-and-contrast",
      "qa-appsec-readonly-audit",
      "builder-harness-read-before-edit-and-test-lock",
    ]);

    for (const res of parsed.results) {
      expect(res.passed).toBe(true);
      expect(res.forbiddenToolsCalled).toHaveLength(0);
      expect(res.noToolErrors).toBe(true);
      expect(res.toolOrderRespected).toBe(true);
      expect(res.testLockRespected).toBe(true);
      expect(res.specTraceabilityComplete).toBe(true);
      expect(res.budgetWithinCap).toBe(true);
    }
  });

  test.each<{
    label: string;
    evalCase: AgentTrajectoryEvalCase;
    trace: TrajectoryTraceInput;
    expectedFailureFlag:
      | "missingRequired"
      | "forbiddenTools"
      | "toolOrder"
      | "testLock"
      | "specTraceability"
      | "budget";
  }>([
    {
      label: "software_architect pula Step 0 (inspect_codebase_skeleton omitida)",
      evalCase: {
        caseId: "fail-architect-skip-step0",
        title: "Arquiteto pula Step 0",
        agentRole: "software_architect",
        requiredTools: ["inspect_codebase_skeleton", "submit_plan"],
        forbiddenTools: [],
        expectedToolOrder: ["inspect_codebase_skeleton", "submit_plan"],
      },
      trace: {
        invocations: [{ toolName: "submit_plan", status: "ok" }],
      },
      expectedFailureFlag: "missingRequired",
    },
    {
      label: "software_architect executa submit_plan antes de consultar o grafo",
      evalCase: {
        caseId: "fail-architect-wrong-order",
        title: "Arquiteto planeja antes de ler o grafo",
        agentRole: "software_architect",
        requiredTools: ["inspect_codebase_skeleton", "submit_plan"],
        forbiddenTools: [],
        expectedToolOrder: ["inspect_codebase_skeleton", "submit_plan"],
      },
      trace: {
        invocations: [
          { toolName: "submit_plan", status: "ok" },
          { toolName: "inspect_codebase_skeleton", status: "ok" },
        ],
      },
      expectedFailureFlag: "toolOrder",
    },
    {
      label: "tech_lead tenta mutar caminho protegido em lockedReadOnlyPaths (Test Lock violado)",
      evalCase: {
        caseId: "fail-builder-test-lock",
        title: "Builder viola Test Lock",
        agentRole: "tech_lead",
        requiredTools: [WORKSPACE_TOOLS.FILESYSTEM.READ_FILE],
        forbiddenTools: [],
        expectedToolOrder: [],
        requireTestLockRespected: true,
      },
      trace: {
        invocations: [
          {
            toolName: WORKSPACE_TOOLS.FILESYSTEM.READ_FILE,
            status: "ok",
            targetPath: "src/feature.ts",
          },
          {
            toolName: WORKSPACE_TOOLS.FILESYSTEM.EDIT_FILE,
            status: "error",
            targetPath: "tests/contract.test.ts",
            summary:
              "Test Lock ativo: 'tests/contract.test.ts' está protegido somente-leitura.",
          },
        ],
        lockedReadOnlyPaths: ["tests/contract.test.ts"],
      },
      expectedFailureFlag: "testLock",
    },
    {
      label: "qa_appsec chama tool de mutação proibida em revisão",
      evalCase: {
        caseId: "fail-qa-forbidden-write",
        title: "QA chama write_file",
        agentRole: "qa_appsec",
        requiredTools: ["read_security_scan_findings"],
        forbiddenTools: [WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE],
        expectedToolOrder: [],
      },
      trace: {
        invocations: [
          { toolName: "read_security_scan_findings", status: "ok" },
          {
            toolName: WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE,
            status: "ok",
            targetPath: "src/hack.ts",
          },
        ],
      },
      expectedFailureFlag: "forbiddenTools",
    },
    {
      label: "qa_appsec com rastreabilidade de spec incompleta falha no gate",
      evalCase: {
        caseId: "fail-qa-spec-traceability",
        title: "Rastreabilidade incompleta",
        agentRole: "qa_appsec",
        requiredTools: ["read_deliverable_evidence_and_diff"],
        forbiddenTools: [],
        expectedToolOrder: [],
        requireSpecTraceability: true,
      },
      trace: {
        invocations: [
          { toolName: "read_deliverable_evidence_and_diff", status: "ok" },
        ],
        specCriteriaCount: 4,
        specCriteriaCovered: 2,
      },
      expectedFailureFlag: "specTraceability",
    },
    {
      label: "ux_designer estoura teto de orçamento maxBudgetUsd",
      evalCase: {
        caseId: "fail-ux-budget-cap",
        title: "Estouro de orçamento UX",
        agentRole: "ux_designer",
        requiredTools: ["read_design_system_contract"],
        forbiddenTools: [],
        expectedToolOrder: [],
        maxBudgetUsd: 0.1,
      },
      trace: {
        invocations: [{ toolName: "read_design_system_contract", status: "ok" }],
        costUsd: 0.28,
      },
      expectedFailureFlag: "budget",
    },
  ])(
    "reprova trajetória inválida quando $label",
    ({ evalCase, trace, expectedFailureFlag }) => {
      const result = evaluateAgentTrajectory(evalCase, trace);

      expect(result.passed).toBe(false);
      expect(result.failureReasons.length).toBeGreaterThan(0);

      if (expectedFailureFlag === "missingRequired") {
        expect(result.calledRequiredTools.length).toBeLessThan(
          evalCase.requiredTools.length
        );
      } else if (expectedFailureFlag === "forbiddenTools") {
        expect(result.forbiddenToolsCalled.length).toBeGreaterThan(0);
      } else if (expectedFailureFlag === "toolOrder") {
        expect(result.toolOrderRespected).toBe(false);
      } else if (expectedFailureFlag === "testLock") {
        expect(result.testLockRespected).toBe(false);
        expect(result.noToolErrors).toBe(false);
      } else if (expectedFailureFlag === "specTraceability") {
        expect(result.specTraceabilityComplete).toBe(false);
      } else if (expectedFailureFlag === "budget") {
        expect(result.budgetWithinCap).toBe(false);
      }
    }
  );

  test("MastraWorkspaceExecutorAdapter bloqueia edição sem leitura prévia e falha no avaliador de trajetória", async () => {
    const ws = createTempWorkspace();
    fs.mkdirSync(path.join(ws, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(ws, "src", "target.ts"),
      "export const flag = false;\n",
      "utf8"
    );

    let step = 0;
    const usage = { inputTokens: 12, outputTokens: 10, totalTokens: 22 };
    const captured: Array<{ toolName: string; status: "ok" | "error"; targetPath?: string; summary?: string }> = [];

    const mockModel = new MastraLanguageModelV2Mock({
      provider: "mock-s32-neg",
      modelId: "mock-s32-neg-model",
      doGenerate: async () => {
        if (step === 0) {
          step += 1;
          return {
            content: [
              {
                type: "tool-call" as const,
                toolCallId: "neg-edit-1",
                toolName: WORKSPACE_TOOLS.FILESYSTEM.EDIT_FILE,
                input: JSON.stringify({
                  path: "src/target.ts",
                  old_string: "false",
                  new_string: "true",
                  replace_all: false,
                }),
              },
            ],
            finishReason: "tool-calls" as const,
            usage,
            warnings: [],
            rawCall: { rawPrompt: null, rawSettings: {} },
            request: { body: {} },
            response: { headers: {} },
            stream: simulateReadableStream({ chunks: [] }),
          };
        }
        return {
          content: [{ type: "text" as const, text: "Falhou ao editar sem ler." }],
          finishReason: "stop" as const,
          usage,
          warnings: [],
          rawCall: { rawPrompt: null, rawSettings: {} },
          request: { body: {} },
          response: { headers: {} },
          stream: simulateReadableStream({ chunks: [] }),
        };
      },
    });

    const [proj] = await db
      .insert(projects)
      .values({
        clientId: internalClientAId,
        name: "Proj S32 Harness",
        slug: `proj-s32-harness-${crypto.randomUUID().slice(0, 8)}`,
      })
      .returning();

    const [deliv] = await db
      .insert(deliverables)
      .values({
        projectId: proj!.id,
        title: "Harness Negativo",
        status: "building",
        hasUi: false,
      })
      .returning();

    const adapter = new MastraWorkspaceExecutorAdapter({
      masterKey: crypto.randomBytes(32),
    });

    await adapter.runSession({
      workspacePath: ws,
      mode: "build",
      role: "builder",
      db,
      projectId: proj!.id,
      deliverableId: deliv!.id,
      stage: "stage_build",
      providerConfig: {
        organizationId: orgAId,
        providerType: "openai_compatible",
        roleBindings: {},
      },
      prompt: "Edite src/target.ts diretamente.",
      toolPolicies: DEFAULT_TOOL_POLICIES,
      modelOverride: mockModel,
    });

    // Arquivo permanece intacto porque requireReadBeforeWrite bloqueou
    expect(fs.readFileSync(path.join(ws, "src", "target.ts"), "utf8")).toBe(
      "export const flag = false;\n"
    );

    const events = await db
      .select()
      .from(executionEvents)
      .where(eq(executionEvents.deliverableId, deliv!.id));

    for (const ev of events) {
      if (ev.eventType === "tool_call") {
        const p = ev.payloadJson as {
          toolName?: string;
          status?: string;
          targetPath?: string;
          summary?: string;
        };
        if (p.toolName && p.status && p.status !== "running") {
          captured.push({
            toolName: p.toolName,
            status: p.status === "error" ? "error" : "ok",
            ...(p.targetPath ? { targetPath: p.targetPath } : {}),
            ...(p.summary ? { summary: p.summary } : {}),
          });
        }
      }
    }

    const evalRes = evaluateAgentTrajectory(
      {
        caseId: "neg-read-before-edit",
        title: "Exige READ_FILE antes de EDIT_FILE",
        agentRole: "tech_lead",
        requiredTools: [
          WORKSPACE_TOOLS.FILESYSTEM.READ_FILE,
          WORKSPACE_TOOLS.FILESYSTEM.EDIT_FILE,
        ],
        forbiddenTools: [],
        expectedToolOrder: [
          WORKSPACE_TOOLS.FILESYSTEM.READ_FILE,
          WORKSPACE_TOOLS.FILESYSTEM.EDIT_FILE,
        ],
      },
      { invocations: captured }
    );

    expect(evalRes.passed).toBe(false);
    expect(evalRes.toolOrderRespected).toBe(false);
    expect(evalRes.calledRequiredTools).toHaveLength(0);
  });

  test("computeAgentEffectivenessMetricsScoped agrega métricas reais no PGlite com isolamento multi-tenant e filtro por projeto", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const [proj1] = await db
      .insert(projects)
      .values({
        clientId: internalClientAId,
        name: `Proj Metrics 1 ${suffix}`,
        slug: `proj-metrics-1-${suffix}`,
      })
      .returning();
    const [proj2] = await db
      .insert(projects)
      .values({
        clientId: internalClientAId,
        name: `Proj Metrics 2 ${suffix}`,
        slug: `proj-metrics-2-${suffix}`,
      })
      .returning();
    const [projB] = await db
      .insert(projects)
      .values({
        clientId: clientBId,
        name: `Proj Org B ${suffix}`,
        slug: `proj-org-b-${suffix}`,
      })
      .returning();

    // Proj 1 - Deliv 1: passou de primeira (verifyAttempts = 1, merged)
    const [d1] = await db
      .insert(deliverables)
      .values({
        projectId: proj1!.id,
        title: "Entrega Primeira Passada",
        status: "merged",
        verifyAttempts: 1,
        hasUi: false,
        evidencePackJson: { verifyPassed: true },
      })
      .returning();

    // Proj 1 - Deliv 2: retrabalho (verifyAttempts = 2, decision_pending)
    const [d2] = await db
      .insert(deliverables)
      .values({
        projectId: proj1!.id,
        title: "Entrega Retrabalho",
        status: "decision_pending",
        verifyAttempts: 2,
        hasUi: false,
        evidencePackJson: { verifyPassed: true },
      })
      .returning();

    // Proj 2 - Deliv 3: falhou após 3 tentativas
    const [d3] = await db
      .insert(deliverables)
      .values({
        projectId: proj2!.id,
        title: "Entrega Falha P2",
        status: "failed",
        verifyAttempts: 3,
        hasUi: false,
      })
      .returning();

    // Org B - Deliv B: não pode vazar para Org A
    const [dB] = await db
      .insert(deliverables)
      .values({
        projectId: projB!.id,
        title: "Entrega Org B",
        status: "merged",
        verifyAttempts: 1,
        hasUi: false,
      })
      .returning();

    await db.insert(executionEvents).values([
      // d1: architect + tech_lead + load_uzina_skill ok + verify_result (confidence 92)
      {
        deliverableId: d1!.id,
        stage: "stage_blueprint",
        actorRole: "software_architect",
        eventType: "token_usage",
        tokensInput: 200,
        tokensOutput: 100,
        cacheReadTokens: 0,
        estimatedCostUsd: "0.020000",
        payloadJson: { durationMs: 400 },
      },
      {
        deliverableId: d1!.id,
        stage: "stage_build",
        actorRole: "builder",
        eventType: "tool_call",
        tokensInput: 0,
        tokensOutput: 0,
        cacheReadTokens: 0,
        estimatedCostUsd: "0.000000",
        payloadJson: {
          phase: "result",
          toolName: "load_uzina_skill",
          status: "ok",
          durationMs: 50,
        },
      },
      {
        deliverableId: d1!.id,
        stage: "stage_build",
        actorRole: "tech_lead",
        eventType: "token_usage",
        tokensInput: 500,
        tokensOutput: 300,
        cacheReadTokens: 0,
        estimatedCostUsd: "0.050000",
        payloadJson: { attemptNumber: 1, durationMs: 1200 },
      },
      {
        deliverableId: d1!.id,
        stage: "stage_verify",
        actorRole: "verifier",
        eventType: "verify_result",
        tokensInput: 150,
        tokensOutput: 50,
        cacheReadTokens: 0,
        estimatedCostUsd: "0.010000",
        payloadJson: {
          attemptNumber: 1,
          verifyPassed: true,
          confidenceScore: 92,
          durationMs: 800,
        },
      },
      // d2: tentativa 1 falha + tentativa 2 retrabalho ($0.12 + $0.03 = $0.15)
      {
        deliverableId: d2!.id,
        stage: "stage_verify",
        actorRole: "qa_appsec",
        eventType: "verify_result",
        tokensInput: 100,
        tokensOutput: 100,
        cacheReadTokens: 0,
        estimatedCostUsd: "0.015000",
        payloadJson: {
          attemptNumber: 1,
          verifyPassed: false,
          confidenceScore: 54,
          durationMs: 600,
        },
      },
      {
        deliverableId: d2!.id,
        stage: "stage_build",
        actorRole: "tech_lead",
        eventType: "token_usage",
        tokensInput: 800,
        tokensOutput: 400,
        cacheReadTokens: 0,
        estimatedCostUsd: "0.120000",
        payloadJson: { attemptNumber: 2, durationMs: 1600 },
      },
      {
        deliverableId: d2!.id,
        stage: "stage_verify",
        actorRole: "qa_appsec",
        eventType: "verify_result",
        tokensInput: 120,
        tokensOutput: 80,
        cacheReadTokens: 0,
        estimatedCostUsd: "0.030000",
        payloadJson: {
          attemptNumber: 2,
          verifyPassed: true,
          confidenceScore: 84,
          durationMs: 700,
        },
      },
      // d3 em proj2: verify_result com confidence 40 + rework $0.25
      {
        deliverableId: d3!.id,
        stage: "stage_verify",
        actorRole: "qa_appsec",
        eventType: "verify_result",
        tokensInput: 300,
        tokensOutput: 100,
        cacheReadTokens: 0,
        estimatedCostUsd: "0.250000",
        payloadJson: {
          attemptNumber: 2,
          verifyPassed: false,
          confidenceScore: 40,
          durationMs: 900,
        },
      },
      // dB em orgB: custo altíssimo $99 que NÃO pode vazar para orgA
      {
        deliverableId: dB!.id,
        stage: "stage_verify",
        actorRole: "qa_appsec",
        eventType: "verify_result",
        tokensInput: 9000,
        tokensOutput: 9000,
        cacheReadTokens: 0,
        estimatedCostUsd: "99.000000",
        payloadJson: {
          attemptNumber: 2,
          verifyPassed: false,
          confidenceScore: 10,
        },
      },
    ]);

    // 1. Filtro estrito por proj1: 2 entregáveis (1 primeira passada, 1 retrabalho)
    const proj1Metrics = AgentEffectivenessMetricsSchema.parse(
      await computeAgentEffectivenessMetricsScoped(db, {
        organizationId: orgAId,
        projectId: proj1!.id,
      })
    );

    expect(proj1Metrics.firstPassVerifyRate).toBe(50);
    expect(proj1Metrics.averageVerifyAttempts).toBe(1.5);
    // (92 + 54 + 84) / 3 = 76.7
    expect(proj1Metrics.averageConfidenceScore).toBeCloseTo(76.7, 1);
    // rework = 0.12 + 0.03 = 0.15
    expect(proj1Metrics.reworkCostUsd).toBeCloseTo(0.15, 5);
    // 1 skill load ok (100% pass) em 1 de 2 entregáveis ativos (50% coverage) => média 75%
    expect(proj1Metrics.skillAdherenceRate).toBe(75);
    expect(proj1Metrics.byRole.software_architect.runs).toBe(1);
    expect(proj1Metrics.byRole.software_architect.avgTokens).toBe(300);
    expect(proj1Metrics.byRole.tech_lead.runs).toBe(2);
    expect(proj1Metrics.byRole.tech_lead.avgTokens).toBe(1000);
    expect(proj1Metrics.byRole.qa_appsec.runs).toBe(3);
    expect(proj1Metrics.byRole.qa_appsec.failureRate).toBeCloseTo(1 / 3, 3);

    // 2. Filtro cross-tenant: projB pertence a orgB, logo consultado com orgAId retorna tudo zerado
    const crossTenantMetrics = AgentEffectivenessMetricsSchema.parse(
      await computeAgentEffectivenessMetricsScoped(db, {
        organizationId: orgAId,
        projectId: projB!.id,
      })
    );
    expect(crossTenantMetrics.firstPassVerifyRate).toBe(0);
    expect(crossTenantMetrics.reworkCostUsd).toBe(0);
    expect(crossTenantMetrics.byRole.qa_appsec.runs).toBe(0);

    // 3. Visão da organização inteira (proj1 + proj2, sem orgB):
    const orgAMetrics = AgentEffectivenessMetricsSchema.parse(
      await computeAgentEffectivenessMetricsScoped(db, {
        organizationId: orgAId,
      })
    );
    // d1, d2, d3 => 1/3 = 33.3%
    expect(orgAMetrics.firstPassVerifyRate).toBeCloseTo(33.3, 1);
    // rework = 0.15 + 0.25 = 0.40 (sem os 99 de orgB)
    expect(orgAMetrics.reworkCostUsd).toBeCloseTo(0.4, 5);
  });
});
