import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MastraLanguageModelV2Mock,
  simulateReadableStream,
} from "@mastra/core/test-utils/llm-mock";
import {
  ArchitectBlueprintV2Schema,
  PrototypeComponentManifestSchema,
  ShapeSpecSchema,
  type BddScenario,
  type DiscoverySummary,
} from "@uzina/contracts";
import { parseMasterKeyBuffer } from "@uzina/core";
import {
  closeDb,
  codebaseFiles,
  codebaseSymbols,
  deliverables,
  designAssets,
  ensureDefaultOrgAndInternalClient,
  getDb,
  organizations,
  projectRepositories,
  projects,
  clients,
  type UzinaDb,
} from "@uzina/db";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  buildVisualPrototypeBlueprintWithAgent,
  decideOptimalAiStrategyWithAgent,
} from "../src/agency.js";
import {
  generateArchitectBlueprintV2,
  runVisualStudioThreeStagePipeline,
  validateAndBuildShapeSpec,
} from "../src/stages/structured-handoffs.js";
import { SymbolLockManager } from "../src/symbol-locks.js";

function createJsonMockModel(payload: unknown, shouldThrow = false) {
  const usage = { inputTokens: 30, outputTokens: 25, totalTokens: 55 };
  const textPayload = JSON.stringify(payload);

  return new MastraLanguageModelV2Mock({
    provider: "mock-s29",
    modelId: "mock-s29-structured",
    doGenerate: async () => {
      if (shouldThrow) {
        throw new Error("Simulated transient provider failure.");
      }
      return {
        content: [{ type: "text", text: textPayload }],
        finishReason: "stop",
        usage,
        warnings: [],
        rawCall: { rawPrompt: null, rawSettings: {} },
        request: { body: {} },
        response: { headers: {} },
        stream: simulateReadableStream({ chunks: [] }),
      };
    },
    doStream: async () => {
      if (shouldThrow) {
        throw new Error("Simulated transient stream failure.");
      }
      return {
        rawCall: { rawPrompt: null, rawSettings: {} },
        warnings: [],
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t-s29" },
            { type: "text-delta", id: "t-s29", delta: textPayload },
            { type: "text-end", id: "t-s29" },
            { type: "finish", finishReason: "stop", usage },
          ],
        }),
      };
    },
  });
}

function makeBaseSummary(
  overrides: Partial<DiscoverySummary> = {}
): DiscoverySummary {
  return {
    objective: "Implementar fluxo de faturamento multi-tenant auditável.",
    targetUser: "Operador financeiro autenticado.",
    criticalFlows: ["Emitir fatura com Idempotency-Key e validar RBAC."],
    technicalConstraints: ["Drizzle ORM com PGlite/Postgres e validação Zod."],
    hasUi: true,
    acceptanceCriteria: ["Todos os endpoints rejeitam acesso cross-tenant."],
    outOfScope: ["Integração bancária legada."],
    assumptions: [
      {
        key: "Autenticação",
        value: "Sessão Better Auth obrigatória.",
        source: "pre_read",
      },
    ],
    specMarkdown: "# Spec Faturamento\nFluxo validado.",
    ...overrides,
  };
}

const VALID_BDD_SCENARIOS: BddScenario[] = [
  {
    id: "BDD-1",
    title: "Developer emite fatura válida.",
    given: "Ator autenticado como developer na organização.",
    when: "Envia payload válido de faturamento.",
    then: "Fatura é persistida com isolamento multi-tenant.",
    roleRequired: "developer",
  },
];

describe("Slice 29 — Immutable Handoffs (ShapeSpec, ArchitectBlueprintV2, Visual 3-Stage & Agency Fallbacks)", () => {
  let db: UzinaDb;
  let orgAId: string;
  let orgBId: string;
  let projectAId: string;
  let projectBId: string;
  let deliverableAId: string;
  let otherDeliverableId: string;
  let tempWorkspace: string;
  let masterKey: Buffer;
  const symbolLockManager = new SymbolLockManager();

  beforeAll(async () => {
    await closeDb();
    const ctx = await getDb({ dataDir: ":memory:" });
    db = ctx.db;

    const seeded = await ensureDefaultOrgAndInternalClient(db);
    orgAId = seeded.organizationId;
    masterKey = parseMasterKeyBuffer(crypto.randomBytes(32).toString("hex"));

    tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-s29-ws-"));
    fs.mkdirSync(path.join(tempWorkspace, "packages", "ui", "src"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tempWorkspace, "packages", "ui", "src", "data-table.tsx"),
      'export function DataTable() { return <div data-slot="data-table" />; }\n',
      "utf8"
    );

    const [projA] = await db
      .insert(projects)
      .values({
        clientId: seeded.internalClientId,
        name: "Faturamento Cloud S29",
        slug: `fat-s29-${Date.now()}`,
      })
      .returning();
    projectAId = projA!.id;

    const [repoA] = await db
      .insert(projectRepositories)
      .values({
        projectId: projectAId,
        name: "repo-s29",
        localPath: tempWorkspace,
        defaultBranch: "main",
      })
      .returning();

    const [fileA] = await db
      .insert(codebaseFiles)
      .values({
        repositoryId: repoA!.id,
        path: "src/billing/invoice.ts",
        sha256: "c".repeat(64),
        language: "typescript",
        size: 320,
      })
      .returning();

    await db.insert(codebaseSymbols).values({
      fileId: fileA!.id,
      kind: "function",
      name: "issueInvoice",
      signature: "export function issueInvoice(input: InvoiceInput)",
      lineStart: 1,
      lineEnd: 20,
      exported: true,
    });

    const [delivA] = await db
      .insert(deliverables)
      .values({
        projectId: projectAId,
        repositoryId: repoA!.id,
        title: "Emissão de Faturas",
        status: "discovery",
        hasUi: true,
      })
      .returning();
    deliverableAId = delivA!.id;

    const [delivOther] = await db
      .insert(deliverables)
      .values({
        projectId: projectAId,
        repositoryId: repoA!.id,
        title: "Entrega Concorrente",
        status: "building",
        hasUi: false,
      })
      .returning();
    otherDeliverableId = delivOther!.id;

    // Simula lock ativo de outro entregável no símbolo alvo
    symbolLockManager.tryAcquire({
      projectId: projectAId,
      deliverableId: otherDeliverableId,
      symbols: ["src/billing/invoice.ts::issueInvoice"],
    });

    await db.insert(designAssets).values({
      projectId: projectAId,
      assetType: "reference_url",
      title: "Ref Industrial",
      sourceUrl: "https://example.com/ref",
      intentionTags: ["copiar:densidade-compacta"],
      approved: true,
    });

    // Org B para isolamento multi-tenant
    const [orgB] = await db
      .insert(organizations)
      .values({
        name: "Org B S29",
        slug: `org-b-s29-${Date.now()}`,
      })
      .returning();
    orgBId = orgB!.id;

    const [clientB] = await db
      .insert(clients)
      .values({
        organizationId: orgBId,
        name: "Cliente B",
        slug: `cli-b-s29-${Date.now()}`,
      })
      .returning();

    const [projB] = await db
      .insert(projects)
      .values({
        clientId: clientB!.id,
        name: "Projeto B S29",
        slug: `proj-b-s29-${Date.now()}`,
      })
      .returning();
    projectBId = projB!.id;
  });

  afterAll(async () => {
    symbolLockManager.clearAll();
    if (tempWorkspace && fs.existsSync(tempWorkspace)) {
      fs.rmSync(tempWorkspace, { recursive: true, force: true });
    }
    await closeDb();
  });

  // --------------------------------------------------------------------------
  // 1. Fase 1: validateAndBuildShapeSpec + Ambiguity Gate
  // --------------------------------------------------------------------------
  test.each([
    {
      label: "especificação válida com nonGoals, BDD e score 0 passa no gate",
      summary: makeBaseSummary(),
      nonGoals: ["Não suportar emissão em lote nesta fatia."],
      bddScenarios: VALID_BDD_SCENARIOS,
      ambiguityCheck: { score: 0, unresolvedQuestions: [] },
      expectErrorPattern: null as RegExp | null,
    },
    {
      label: "ausência de nonGoals é bloqueada pelo gate",
      summary: makeBaseSummary(),
      nonGoals: [] as string[],
      bddScenarios: VALID_BDD_SCENARIOS,
      ambiguityCheck: { score: 0, unresolvedQuestions: [] },
      expectErrorPattern: /SHAPE_SPEC_GATE_BLOCKED.*nonGoals/i,
    },
    {
      label: "ausência de cenários BDD/RBAC é bloqueada pelo gate",
      summary: makeBaseSummary(),
      nonGoals: ["Fora de escopo: relatórios PDF."],
      bddScenarios: [] as BddScenario[],
      ambiguityCheck: { score: 0, unresolvedQuestions: [] },
      expectErrorPattern: /SHAPE_SPEC_GATE_BLOCKED.*bddScenarios/i,
    },
    {
      label: "ambiguidade alta (score > 30 ou pergunta pendente) é bloqueada",
      summary: makeBaseSummary({
        objective: "Qual provedor fiscal será usado?",
      }),
      nonGoals: ["Fora de escopo: ERP externo."],
      bddScenarios: VALID_BDD_SCENARIOS,
      ambiguityCheck: undefined,
      expectErrorPattern: /AMBIGUITY_GATE_BLOCKED/i,
    },
  ])(
    "Fase 1 validateAndBuildShapeSpec: $label",
    ({
      summary,
      nonGoals,
      bddScenarios,
      ambiguityCheck,
      expectErrorPattern,
    }) => {
      if (expectErrorPattern) {
        expect(() =>
          validateAndBuildShapeSpec({
            summary,
            appetite: "small_1_slice",
            nonGoals,
            bddScenarios,
            ambiguityCheck,
          })
        ).toThrowError(expectErrorPattern);
        return;
      }

      const spec = validateAndBuildShapeSpec({
        summary,
        appetite: "small_1_slice",
        nonGoals,
        bddScenarios,
        dataSensitivityFlags: ["pii", "billing"],
        ambiguityCheck,
      });

      const parsed = ShapeSpecSchema.safeParse(spec);
      expect(parsed.success).toBe(true);
      expect(spec.nonGoals).toHaveLength(1);
      expect(spec.bddScenarios[0]?.roleRequired).toBe("developer");
    }
  );

  // --------------------------------------------------------------------------
  // 2. Fase 2: generateArchitectBlueprintV2
  // --------------------------------------------------------------------------
  test("Fase 2 generateArchitectBlueprintV2 força sequential=true em colisão de SymbolLock e gera openSpecDelta em brownfield", async () => {
    const shapeSpec = validateAndBuildShapeSpec({
      summary: makeBaseSummary(),
      appetite: "medium_2_3_slices",
      nonGoals: ["Sem emissão offline nesta fase."],
      bddScenarios: VALID_BDD_SCENARIOS,
      dataSensitivityFlags: ["payment_token"],
      ambiguityCheck: { score: 0, unresolvedQuestions: [] },
    });

    const brownfieldBp = await generateArchitectBlueprintV2({
      db,
      organizationId: orgAId,
      projectId: projectAId,
      deliverableId: deliverableAId,
      title: "Atualizar issueInvoice para emissão fiscal.",
      description: "Usa `issueInvoice` com validação Zod.",
      shapeSpec,
      originKind: "brownfield",
      hasUi: true,
      riskLevel: "high",
      maturityScore: 68,
      symbolLockManager,
      masterKey,
    });

    expect(ArchitectBlueprintV2Schema.safeParse(brownfieldBp).success).toBe(true);
    expect(brownfieldBp.tacticalPattern).toBe("single_agent");
    expect(brownfieldBp.storyShards.every((s) => s.sequential)).toBe(true);
    expect(brownfieldBp.openSpecDelta?.added.length).toBeGreaterThanOrEqual(1);
    expect(brownfieldBp.strideFmeaRisks.length).toBeGreaterThanOrEqual(2);

    // Greenfield não exige openSpecDelta
    const greenfieldBp = await generateArchitectBlueprintV2({
      db,
      organizationId: orgAId,
      projectId: projectAId,
      deliverableId: otherDeliverableId,
      title: "Novo painel greenfield.",
      shapeSpec,
      originKind: "greenfield",
      hasUi: false,
      masterKey,
    });
    expect(ArchitectBlueprintV2Schema.safeParse(greenfieldBp).success).toBe(true);
    expect(greenfieldBp.openSpecDelta).toBeUndefined();

    // Multi-tenant: projeto de outra org deve falhar
    await expect(
      generateArchitectBlueprintV2({
        db,
        organizationId: orgAId,
        projectId: projectBId,
        title: "Acesso indevido.",
        originKind: "greenfield",
        hasUi: false,
      })
    ).rejects.toThrowError(/não encontrado/i);
  });

  test("Fase 2 generateArchitectBlueprintV2 aceita structuredOutput de MastraLanguageModelV2Mock e aplica fallback em falha", async () => {
    const shapeSpec = validateAndBuildShapeSpec({
      summary: makeBaseSummary(),
      nonGoals: ["Fora de escopo: exportação XML."],
      bddScenarios: VALID_BDD_SCENARIOS,
      ambiguityCheck: { score: 0, unresolvedQuestions: [] },
    });

    const mockBlueprintPayload = {
      developmentStrategy: "api_contract_first",
      tacticalPattern: "split_lanes",
      rationale: "Estratégia definida pelo arquiteto via mock estruturado.",
      verticalSlices: [
        {
          name: "Contratos & Emissão",
          objective: "Definir schema de fatura e serviço issueInvoice.",
          allowedPaths: ["packages/contracts/src", "src/billing/invoice.ts"],
          sequential: false,
        },
      ],
      sharedPathsDetected: [],
      adr: {
        context: "Arquitetura modular para emissão de faturas.",
        optionsConsidered: ["Contract-first com Zod.", "Acoplamento direto."],
        decision: "Adotar Contract-first com Zod e locks de símbolo.",
        consequences: "Maior previsibilidade entre backend e UI.",
        reversibility: "Reversível antes do merge.",
      },
      strideFmeaRisks: [
        {
          category: "tampering",
          threatOrFailure: "Alteração indevida de valor de fatura.",
          severity: "high",
          mitigation: "Validar payload com Zod no servidor.",
          verifyCheck: "Teste negativo de payload adulterado.",
        },
      ],
      storyShards: [
        {
          sliceName: "Contratos & Emissão",
          objective: "Implementar issueInvoice com Zod.",
          allowedPaths: ["src/billing/invoice.ts"],
          targetSymbols: ["src/billing/invoice.ts::issueInvoice"],
          acceptanceScenarioIds: ["BDD-1"],
          verificationCommands: ["pnpm typecheck"],
          sequential: false,
        },
      ],
    };

    const mockBp = await generateArchitectBlueprintV2({
      db,
      organizationId: orgAId,
      projectId: projectAId,
      deliverableId: deliverableAId,
      title: "Refatorar issueInvoice.",
      shapeSpec,
      originKind: "brownfield",
      hasUi: true,
      symbolLockManager,
      modelOverride: createJsonMockModel(mockBlueprintPayload),
    });

    // Mesmo que o LLM tenha retornado sequential: false, a colisão em SymbolLockManager força true
    expect(mockBp.storyShards[0]?.sequential).toBe(true);
    expect(mockBp.tacticalPattern).toBe("single_agent");
    expect(mockBp.openSpecDelta).not.toBeUndefined();

    // Em falha transitória do provedor, faz fallback determinístico sem quebrar
    const fallbackBp = await generateArchitectBlueprintV2({
      db,
      organizationId: orgAId,
      projectId: projectAId,
      deliverableId: deliverableAId,
      title: "Refatorar issueInvoice.",
      shapeSpec,
      originKind: "brownfield",
      hasUi: true,
      symbolLockManager,
      modelOverride: createJsonMockModel({}, true),
    });
    expect(ArchitectBlueprintV2Schema.safeParse(fallbackBp).success).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 3. Fase 2.5: runVisualStudioThreeStagePipeline
  // --------------------------------------------------------------------------
  test("Fase 2.5 runVisualStudioThreeStagePipeline executa 3 estágios, detecta 5 estados, WCAG e componentes packages/ui", async () => {
    const okResult = await runVisualStudioThreeStagePipeline({
      db,
      organizationId: orgAId,
      projectId: projectAId,
      deliverableId: deliverableAId,
      title: "Console de Faturamento",
      workspaceRoot: tempWorkspace,
      masterKey,
    });

    expect(okResult.stagesExecuted).toEqual([
      "lead_visual_design_md",
      "reference_ui_tokens",
      "fresh_context_critique",
    ]);
    expect(okResult.critiquePassed).toBe(true);
    expect(okResult.wcagContrastReport.allPassed).toBe(true);
    expect(
      PrototypeComponentManifestSchema.safeParse(okResult.manifest).success
    ).toBe(true);
    expect(okResult.manifest.sections[0]?.statesCovered).toHaveLength(5);
    expect(okResult.manifest.sections[0]?.dataSlots).toContain("data-table");

    // HTML sem os 5 estados obrigatórios deve ser bloqueado
    await expect(
      runVisualStudioThreeStagePipeline({
        db,
        organizationId: orgAId,
        projectId: projectAId,
        title: "Tela Incompleta",
        html: "<main><h1>Somente título</h1></main>",
        workspaceRoot: tempWorkspace,
      })
    ).rejects.toThrowError(/VISUAL_STATES_MISSING/);

    // HTML com os 5 estados mas baixo contraste + <div onclick> + width > 390px falha na crítica
    const badHtml = [
      `<main style="background: #f5f5f4; color: #ffffff; width: 640px;">`,
      `  <div onclick="doSomething()">Ação</div>`,
      `  <div data-state="loading">Carregando</div>`,
      `  <div data-state="empty">Vazio</div>`,
      `  <div data-state="error">Erro</div>`,
      `  <div data-state="partial">Parcial</div>`,
      `  <div data-state="populated">Dados</div>`,
      `</main>`,
    ].join("\n");

    const badCritiqueResult = await runVisualStudioThreeStagePipeline({
      db,
      organizationId: orgAId,
      projectId: projectAId,
      title: "Tela Com Problemas A11y",
      html: badHtml,
      workspaceRoot: tempWorkspace,
      critiqueModelOverride: createJsonMockModel({
        passed: false,
        findings: ["Botão interativo precisa de foco visível."],
      }),
    });

    expect(badCritiqueResult.critiquePassed).toBe(false);
    expect(badCritiqueResult.manifest.wcagChecklist.contrastAaPassed).toBe(false);
    expect(badCritiqueResult.manifest.wcagChecklist.keyboardNavPassed).toBe(false);
    expect(badCritiqueResult.manifest.wcagChecklist.mobile390PxNoOverflow).toBe(
      false
    );
    expect(badCritiqueResult.critiqueFindings.length).toBeGreaterThanOrEqual(3);
  });

  // --------------------------------------------------------------------------
  // 4. Agency helpers: decideOptimalAiStrategyWithAgent & buildVisualPrototypeBlueprintWithAgent
  // --------------------------------------------------------------------------
  test("agency.ts: decideOptimalAiStrategyWithAgent e buildVisualPrototypeBlueprintWithAgent usam agente e fazem fallback seguro", async () => {
    const strategyFromAgent = await decideOptimalAiStrategyWithAgent(db, {
      organizationId: orgAId,
      message: "API de conciliação financeira multi-tenant.",
      originKind: "greenfield",
      hasGitUrl: false,
      modelOverride: createJsonMockModel({
        chosenStrategy: "api_contract_first",
        strategyLabel: "API Contract-First Estrito.",
        rationale: "Decisão do Arquiteto com contratos Zod primeiro.",
        recommendedTeamTopology: "lean_mvp",
        requiresVisualPrototypeFirst: true,
      }),
    });
    expect(strategyFromAgent.chosenStrategy).toBe("api_contract_first");
    expect(strategyFromAgent.strategyLabel).toContain("API Contract-First");

    const strategyFallback = await decideOptimalAiStrategyWithAgent(db, {
      organizationId: orgAId,
      message: "Sistema brownfield legado.",
      originKind: "brownfield",
      hasGitUrl: true,
      modelOverride: createJsonMockModel({}, true),
    });
    expect(strategyFallback.chosenStrategy).toBe("characterization_strangler");

    const visualFromAgent = await buildVisualPrototypeBlueprintWithAgent(db, {
      organizationId: orgAId,
      projectName: "Clínica Alpha",
      text: "Prontuário odontológico e agenda inteligente.",
      modelOverride: createJsonMockModel({
        domainBadge: "HealthTech · Odontologia.",
        navTabs: ["Agenda.", "Prontuário."],
        kpis: [{ label: "Consultas.", value: "28", delta: "+12%." }],
        screens: [{ step: "1. Triagem.", title: "Recepção Digital." }],
        tableTitle: "Pacientes de Hoje.",
        tableRows: [
          { col1: "Ana Paula.", col2: "Avaliação.", status: "Confirmado." },
        ],
      }),
    });
    expect(visualFromAgent.domainBadge).toContain("HealthTech");

    const visualFallback = await buildVisualPrototypeBlueprintWithAgent(db, {
      organizationId: orgAId,
      projectName: "Finanças Pro",
      text: "Gestão financeira e conciliação Pix.",
      modelOverride: createJsonMockModel({}, true),
    });
    expect(visualFallback.domainBadge).toContain("FinTech");
  });
});
