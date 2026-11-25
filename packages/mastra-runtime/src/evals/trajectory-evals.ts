import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  MastraLanguageModelV2Mock,
  simulateReadableStream,
} from "@mastra/core/test-utils/llm-mock";
import { WORKSPACE_TOOLS } from "@mastra/core/workspace";
import {
  AgentTrajectoryEvalCaseSchema,
  AgentTrajectoryEvalReportSchema,
  AgentTrajectoryEvalResultSchema,
  DEFAULT_TOOL_POLICIES,
  type AgencyAgentRole,
  type AgentTrajectoryEvalCase,
  type AgentTrajectoryEvalReport,
  type AgentTrajectoryEvalResult,
} from "@uzina/contracts";
import { CONTROLLER_MODE_TOOLS } from "../controller.js";
import { MastraWorkspaceExecutorAdapter } from "../workspace-adapter.js";

export interface TrajectoryToolInvocation {
  toolName: string;
  phase?: "start" | "result";
  status?: "running" | "ok" | "error";
  targetPath?: string;
  summary?: string;
}

export interface TrajectoryTraceInput {
  invocations: readonly TrajectoryToolInvocation[];
  lockedReadOnlyPaths?: readonly string[];
  specCriteriaCount?: number;
  specCriteriaCovered?: number;
  costUsd?: number;
  durationMs?: number;
}

const WRITE_TOOL_NAMES = new Set<string>([
  WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE,
  WORKSPACE_TOOLS.FILESYSTEM.EDIT_FILE,
  WORKSPACE_TOOLS.FILESYSTEM.AST_EDIT,
  WORKSPACE_TOOLS.FILESYSTEM.DELETE,
  WORKSPACE_TOOLS.FILESYSTEM.APPLY_PATCH,
  "write_file",
  "edit_file",
  "ast_edit",
  "delete_file",
  "apply_patch",
]);

function normalizeEvalPath(rawPath: string): string {
  return rawPath
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+/g, "/")
    .toLowerCase();
}

function isPathCoveredByLocks(
  candidatePath: string,
  lockedPaths: readonly string[]
): boolean {
  const normCandidate = normalizeEvalPath(candidatePath);
  if (!normCandidate) return false;

  for (const rawLock of lockedPaths) {
    const trimmed = rawLock.trim();
    if (!trimmed) continue;
    const isDir = trimmed.endsWith("/") || trimmed.endsWith("\\");
    const normLock = normalizeEvalPath(trimmed).replace(/\/$/, "");
    if (!normLock) continue;
    if (isDir) {
      if (normCandidate === normLock || normCandidate.startsWith(`${normLock}/`)) {
        return true;
      }
    } else if (normCandidate === normLock) {
      return true;
    }
  }
  return false;
}

/**
 * Avalia deterministicamente uma trajetória de execução de agente contra os 7 gates binários
 * do contrato `AgentTrajectoryEvalResultSchema` (sem chamadas LLM externas).
 */
export function evaluateAgentTrajectory(
  evalCaseInput: AgentTrajectoryEvalCase,
  trace: TrajectoryTraceInput
): AgentTrajectoryEvalResult {
  const evalCase = AgentTrajectoryEvalCaseSchema.parse(evalCaseInput);
  const invocations = trace.invocations;
  const failureReasons: string[] = [];

  const invokedToolsOrdered = invocations.map((inv) => inv.toolName);
  const invokedToolSet = new Set(invokedToolsOrdered);

  // 1. Required tools gate
  const calledRequiredTools = evalCase.requiredTools.filter((tool) =>
    invokedToolSet.has(tool)
  );
  const missingRequiredTools = evalCase.requiredTools.filter(
    (tool) => !invokedToolSet.has(tool)
  );
  if (missingRequiredTools.length > 0) {
    failureReasons.push(
      `Tools obrigatórias ausentes: ${missingRequiredTools.join(", ")}.`
    );
  }

  // 2. Forbidden tools gate
  const forbiddenToolsCalled = evalCase.forbiddenTools.filter((tool) =>
    invokedToolSet.has(tool)
  );
  if (forbiddenToolsCalled.length > 0) {
    failureReasons.push(
      `Tools proibidas invocadas: ${forbiddenToolsCalled.join(", ")}.`
    );
  }

  // 3. No tool errors gate
  const errorInvocations = invocations.filter((inv) => inv.status === "error");
  const noToolErrors = errorInvocations.length === 0;
  if (!noToolErrors) {
    const errNames = errorInvocations
      .map((e) => (e.summary ? `${e.toolName} (${e.summary.slice(0, 80)})` : e.toolName))
      .slice(0, 3)
      .join("; ");
    failureReasons.push(`Falhas registradas em chamadas de tool: ${errNames}.`);
  }

  // 4. Tool order gate (every expected tool must appear in strictly increasing first-call index)
  let toolOrderRespected = true;
  if (evalCase.expectedToolOrder.length > 0) {
    let previousIndex = -1;
    for (const expectedTool of evalCase.expectedToolOrder) {
      const idx = invokedToolsOrdered.indexOf(expectedTool);
      if (idx === -1) {
        toolOrderRespected = false;
        failureReasons.push(
          `Ordem esperada violada: '${expectedTool}' não foi chamada.`
        );
        break;
      }
      if (idx <= previousIndex) {
        toolOrderRespected = false;
        failureReasons.push(
          `Ordem esperada violada: '${expectedTool}' executada fora de sequência.`
        );
        break;
      }
      previousIndex = idx;
    }
  }

  // 5. Test Lock gate
  let testLockRespected = true;
  if (evalCase.requireTestLockRespected) {
    const lockedPaths = trace.lockedReadOnlyPaths ?? [];
    for (const inv of invocations) {
      if (
        inv.status === "error" &&
        typeof inv.summary === "string" &&
        /test lock/i.test(inv.summary)
      ) {
        testLockRespected = false;
        failureReasons.push(
          `Violação de Test Lock detectada em '${inv.toolName}': ${inv.summary.slice(0, 120)}.`
        );
        break;
      }
      if (
        WRITE_TOOL_NAMES.has(inv.toolName) &&
        inv.targetPath &&
        lockedPaths.length > 0 &&
        isPathCoveredByLocks(inv.targetPath, lockedPaths)
      ) {
        testLockRespected = false;
        failureReasons.push(
          `Tentativa de mutação em caminho protegido pelo Test Lock: '${inv.targetPath}'.`
        );
        break;
      }
    }
  }

  // 6. Spec traceability gate
  let specTraceabilityComplete = true;
  if (evalCase.requireSpecTraceability) {
    const totalCriteria = Math.max(0, Math.trunc(trace.specCriteriaCount ?? 0));
    const coveredCriteria = Math.max(
      0,
      Math.trunc(trace.specCriteriaCovered ?? 0)
    );
    specTraceabilityComplete =
      totalCriteria > 0 && coveredCriteria >= totalCriteria;
    if (!specTraceabilityComplete) {
      failureReasons.push(
        `Rastreabilidade de Spec incompleta (${coveredCriteria}/${totalCriteria} critérios cobertos).`
      );
    }
  }

  // 7. Budget gate
  let budgetWithinCap = true;
  if (typeof evalCase.maxBudgetUsd === "number") {
    const cost = Math.max(0, trace.costUsd ?? 0);
    budgetWithinCap = cost <= evalCase.maxBudgetUsd;
    if (!budgetWithinCap) {
      failureReasons.push(
        `Custo $${cost.toFixed(4)} excedeu teto de $${evalCase.maxBudgetUsd.toFixed(4)}.`
      );
    }
  }

  const passed =
    missingRequiredTools.length === 0 &&
    forbiddenToolsCalled.length === 0 &&
    noToolErrors &&
    toolOrderRespected &&
    testLockRespected &&
    specTraceabilityComplete &&
    budgetWithinCap;

  return AgentTrajectoryEvalResultSchema.parse({
    caseId: evalCase.caseId,
    agentRole: evalCase.agentRole,
    passed,
    calledRequiredTools,
    forbiddenToolsCalled,
    noToolErrors,
    toolOrderRespected,
    testLockRespected,
    specTraceabilityComplete,
    budgetWithinCap,
    failureReasons: failureReasons.slice(0, 20),
    durationMs: Math.max(0, Math.round(trace.durationMs ?? 0)),
  });
}

const READ_ONLY_FORBIDDEN_IN_REVIEW = [
  WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE,
  WORKSPACE_TOOLS.FILESYSTEM.EDIT_FILE,
  WORKSPACE_TOOLS.FILESYSTEM.APPLY_PATCH,
  WORKSPACE_TOOLS.FILESYSTEM.DELETE,
  "create_qmd_memory",
  "distill_retrospective_memory",
  "submit_plan",
] as const;

function verifyControllerPolicyAlignment(
  mode: keyof typeof CONTROLLER_MODE_TOOLS,
  required: readonly string[],
  forbidden: readonly string[]
): TrajectoryToolInvocation[] {
  const allowedTools = new Set(CONTROLLER_MODE_TOOLS[mode]);
  const violations: TrajectoryToolInvocation[] = [];

  for (const reqTool of required) {
    if (!allowedTools.has(reqTool)) {
      violations.push({
        toolName: reqTool,
        status: "error",
        summary: `Tool '${reqTool}' ausente na matriz CONTROLLER_MODE_TOOLS.${mode}.`,
      });
    }
  }
  for (const badTool of forbidden) {
    if (allowedTools.has(badTool)) {
      violations.push({
        toolName: badTool,
        status: "error",
        summary: `Tool proibida '${badTool}' exposta na matriz CONTROLLER_MODE_TOOLS.${mode}.`,
      });
    }
  }
  return violations;
}

async function runBuilderHarnessGoldenTrajectory(): Promise<{
  evalCase: AgentTrajectoryEvalCase;
  trace: TrajectoryTraceInput;
}> {
  const evalCase: AgentTrajectoryEvalCase = {
    caseId: "builder-harness-read-before-edit-and-test-lock",
    title: "MastraWorkspaceExecutorAdapter lê antes de editar e respeita Test Lock",
    agentRole: "tech_lead",
    requiredTools: [
      WORKSPACE_TOOLS.FILESYSTEM.READ_FILE,
      WORKSPACE_TOOLS.FILESYSTEM.EDIT_FILE,
    ],
    forbiddenTools: [WORKSPACE_TOOLS.FILESYSTEM.DELETE],
    expectedToolOrder: [
      WORKSPACE_TOOLS.FILESYSTEM.READ_FILE,
      WORKSPACE_TOOLS.FILESYSTEM.EDIT_FILE,
    ],
    requireTestLockRespected: true,
    requireSpecTraceability: true,
    maxBudgetUsd: 0.5,
  };

  const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-s32-traj-"));
  const startedAt = Date.now();
  const capturedInvocations: TrajectoryToolInvocation[] = [];
  const lockedRelPath = "tests/contract.test.ts";

  try {
    fs.mkdirSync(path.join(wsDir, "src"), { recursive: true });
    fs.mkdirSync(path.join(wsDir, "tests"), { recursive: true });
    const originalTest =
      'import { expect, test } from "vitest";\ntest("soma", () => expect(2 + 2).toBe(4));\n';
    fs.writeFileSync(path.join(wsDir, lockedRelPath), originalTest, "utf8");
    fs.writeFileSync(
      path.join(wsDir, "src", "feature.ts"),
      "export function add(a: number, b: number): number {\n  return a - b;\n}\n",
      "utf8"
    );

    let step = 0;
    const usage = { inputTokens: 30, outputTokens: 20, totalTokens: 50 };
    const scriptedModel = new MastraLanguageModelV2Mock({
      provider: "mock-trajectory",
      modelId: "mock-trajectory-builder",
      doGenerate: async () => {
        if (step === 0) {
          step += 1;
          capturedInvocations.push({
            toolName: WORKSPACE_TOOLS.FILESYSTEM.READ_FILE,
            phase: "result",
            status: "ok",
            targetPath: "src/feature.ts",
          });
          return {
            content: [
              {
                type: "tool-call" as const,
                toolCallId: "traj-read-1",
                toolName: WORKSPACE_TOOLS.FILESYSTEM.READ_FILE,
                input: JSON.stringify({ path: "src/feature.ts" }),
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
        if (step === 1) {
          step += 1;
          capturedInvocations.push({
            toolName: WORKSPACE_TOOLS.FILESYSTEM.EDIT_FILE,
            phase: "result",
            status: "ok",
            targetPath: "src/feature.ts",
          });
          return {
            content: [
              {
                type: "tool-call" as const,
                toolCallId: "traj-edit-2",
                toolName: WORKSPACE_TOOLS.FILESYSTEM.EDIT_FILE,
                input: JSON.stringify({
                  path: "src/feature.ts",
                  old_string: "return a - b;",
                  new_string: "return a + b;",
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
          content: [
            {
              type: "text" as const,
              text: "Função corrigida após leitura prévia; teste de contrato preservado.",
            },
          ],
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

    const adapter = new MastraWorkspaceExecutorAdapter({
      masterKey: crypto.randomBytes(32),
    });

    const result = await adapter.runSession({
      workspacePath: wsDir,
      mode: "build",
      role: "builder",
      providerConfig: {
        organizationId: "00000000-0000-0000-0000-000000000001",
        providerType: "openai_compatible",
        roleBindings: {},
      },
      prompt: "Leia src/feature.ts e corrija a função add sem alterar tests/contract.test.ts.",
      toolPolicies: DEFAULT_TOOL_POLICIES,
      lockedReadOnlyPaths: [lockedRelPath],
      modelOverride: scriptedModel,
      maxSteps: 6,
    });

    const updatedSource = fs.readFileSync(
      path.join(wsDir, "src", "feature.ts"),
      "utf8"
    );
    const preservedTest = fs.readFileSync(
      path.join(wsDir, lockedRelPath),
      "utf8"
    );

    if (
      result.status !== "completed" ||
      !result.touchedFiles.includes("src/feature.ts") ||
      !updatedSource.includes("return a + b;")
    ) {
      capturedInvocations.push({
        toolName: WORKSPACE_TOOLS.FILESYSTEM.EDIT_FILE,
        status: "error",
        targetPath: "src/feature.ts",
        summary: `Execução do harness não aplicou edição esperada (status=${result.status}).`,
      });
    }

    if (
      preservedTest !== originalTest ||
      result.touchedFiles.includes(lockedRelPath)
    ) {
      capturedInvocations.push({
        toolName: WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE,
        status: "error",
        targetPath: lockedRelPath,
        summary: "Test Lock violado: arquivo de contrato foi modificado.",
      });
    }

    return {
      evalCase,
      trace: {
        invocations: capturedInvocations,
        lockedReadOnlyPaths: [lockedRelPath],
        specCriteriaCount: 1,
        specCriteriaCovered: updatedSource.includes("return a + b;") ? 1 : 0,
        costUsd: 0.01,
        durationMs: Math.max(1, Date.now() - startedAt),
      },
    };
  } finally {
    fs.rmSync(wsDir, { recursive: true, force: true });
  }
}

export function buildGoldenRoleTrajectoryCases(): ReadonlyArray<{
  evalCase: AgentTrajectoryEvalCase;
  trace: TrajectoryTraceInput;
}> {
  // 1. software_architect: consulta grafo e esqueleto antes de submit_plan
  const architectRequired = [
    "inspect_codebase_skeleton",
    "query_codebase_symbols",
    "trace_symbol_call_graph",
    "check_dependency_boundaries",
    "submit_plan",
  ];
  const architectForbidden = [
    WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE,
    WORKSPACE_TOOLS.FILESYSTEM.EDIT_FILE,
    WORKSPACE_TOOLS.FILESYSTEM.APPLY_PATCH,
  ];
  const architectPolicyErrors = verifyControllerPolicyAlignment(
    "architect",
    architectRequired,
    architectForbidden
  );

  // 2. ux_designer: lê entregáveis e contrato visual + valida contraste WCAG antes de propor UI
  const uxRequired = [
    "read_project_deliverables",
    "read_design_system_contract",
    "inspect_prototype_version",
    "validate_color_contrast_and_tokens",
  ];
  const uxForbidden = [
    WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE,
    WORKSPACE_TOOLS.FILESYSTEM.EDIT_FILE,
    "submit_plan",
  ];
  const uxPolicyErrors = verifyControllerPolicyAlignment(
    "visual",
    uxRequired,
    uxForbidden
  );

  // 3. qa_appsec: auditoria estritamente read-only em findings e evidências
  const qaRequired = [
    "read_project_deliverables",
    "read_security_scan_findings",
    "read_deliverable_evidence_and_diff",
    "run_test_anti_pattern_audit",
  ];
  const qaPolicyErrors = verifyControllerPolicyAlignment(
    "review",
    qaRequired,
    READ_ONLY_FORBIDDEN_IN_REVIEW
  );

  return [
    {
      evalCase: {
        caseId: "architect-step0-codebase-intel",
        title: "software_architect consulta esqueleto, grafo e fronteiras antes de planejar",
        agentRole: "software_architect",
        requiredTools: architectRequired,
        forbiddenTools: architectForbidden,
        expectedToolOrder: [
          "inspect_codebase_skeleton",
          "query_codebase_symbols",
          "trace_symbol_call_graph",
          "check_dependency_boundaries",
          "submit_plan",
        ],
        requireTestLockRespected: false,
        requireSpecTraceability: true,
        maxBudgetUsd: 0.25,
      },
      trace: {
        invocations: [
          ...architectRequired.map((toolName) => ({
            toolName,
            phase: "result" as const,
            status: "ok" as const,
          })),
          ...architectPolicyErrors,
        ],
        specCriteriaCount: 3,
        specCriteriaCovered: 3,
        costUsd: 0.04,
        durationMs: 12,
      },
    },
    {
      evalCase: {
        caseId: "ux-designer-design-contract-and-contrast",
        title: "ux_designer consulta read_design_system_contract e valida contraste WCAG",
        agentRole: "ux_designer",
        requiredTools: uxRequired,
        forbiddenTools: uxForbidden,
        expectedToolOrder: [
          "read_project_deliverables",
          "read_design_system_contract",
          "inspect_prototype_version",
          "validate_color_contrast_and_tokens",
        ],
        requireTestLockRespected: false,
        requireSpecTraceability: false,
        maxBudgetUsd: 0.2,
      },
      trace: {
        invocations: [
          ...uxRequired.map((toolName) => ({
            toolName,
            phase: "result" as const,
            status: "ok" as const,
          })),
          ...uxPolicyErrors,
        ],
        costUsd: 0.03,
        durationMs: 9,
      },
    },
    {
      evalCase: {
        caseId: "qa-appsec-readonly-audit",
        title: "qa_appsec audita findings, evidências e testes sem mutações (modo review)",
        agentRole: "qa_appsec",
        requiredTools: qaRequired,
        forbiddenTools: [...READ_ONLY_FORBIDDEN_IN_REVIEW],
        expectedToolOrder: [
          "read_project_deliverables",
          "read_security_scan_findings",
          "read_deliverable_evidence_and_diff",
          "run_test_anti_pattern_audit",
        ],
        requireTestLockRespected: false,
        requireSpecTraceability: true,
        maxBudgetUsd: 0.3,
      },
      trace: {
        invocations: [
          ...qaRequired.map((toolName) => ({
            toolName,
            phase: "result" as const,
            status: "ok" as const,
          })),
          ...qaPolicyErrors,
        ],
        specCriteriaCount: 4,
        specCriteriaCovered: 4,
        costUsd: 0.05,
        durationMs: 15,
      },
    },
  ];
}

/**
 * Executa a suíte determinística (zero-LLM) de Trajectory Evals para os papéis principais
 * (`software_architect`, `ux_designer`, `qa_appsec`) e para o harness `MastraWorkspaceExecutorAdapter`.
 */
export async function runTrajectoryEvalSuite(options?: {
  suiteName?: string;
}): Promise<AgentTrajectoryEvalReport> {
  const goldenCases = buildGoldenRoleTrajectoryCases();
  const builderCase = await runBuilderHarnessGoldenTrajectory();
  const allEntries = [...goldenCases, builderCase];

  const results: AgentTrajectoryEvalResult[] = allEntries.map((entry) =>
    evaluateAgentTrajectory(entry.evalCase, entry.trace)
  );

  const passedCases = results.filter((r) => r.passed).length;
  const failedCases = results.length - passedCases;

  return AgentTrajectoryEvalReportSchema.parse({
    suiteName: options?.suiteName ?? "uzina-core-agent-trajectory-evals",
    executedAt: new Date().toISOString(),
    passed: failedCases === 0,
    totalCases: results.length,
    passedCases,
    failedCases,
    results,
  });
}

export function formatRoleLabelPt(role: AgencyAgentRole): string {
  return role;
}
