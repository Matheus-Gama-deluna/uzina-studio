import { describe, expect, test } from "vitest";
import {
  BrownfieldMapSchema,
  BrownfieldScanRequestSchema,
  CreateDesignAssetReferenceSchema,
  DeliverableSchema,
  DeliverableWorkflowStateSchema,
  DesignAssetListResponseSchema,
  DesignAssetSchema,
  DiscoveryRoundSchema,
  GenerateDesignMdInputSchema,
  StrategyRouterInputSchema,
  StrategyRouterOutputSchema,
  UpdateDesignAssetSchema,
  WorkflowResumeInputSchema,
  WorkflowStartInputSchema,
} from "../src/index.js";

const UUID_1 = "11111111-1111-4111-8111-111111111111";
const UUID_2 = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-11-21T18:00:00.000Z";

describe("Slice 3 contracts — Mastra Workflow, Descoberta, Strategy Router & Design Assets", () => {
  test.each([
    {
      label: "DesignAssetSchema aceita upload com assetUrl e sem expor storagePath",
      schema: DesignAssetSchema,
      input: {
        id: UUID_1,
        projectId: UUID_2,
        deliverableId: null,
        assetType: "moodboard_image",
        title: "Referência Linear Dark",
        sourceUrl: null,
        assetUrl: `/api/assets/${UUID_1}`,
        mimeType: "image/png",
        sizeBytes: 24576,
        intentionTags: ["densidade-compacta", "bordas-hairline"],
        notes: "Copiar hierarquia da sidebar",
        approved: false,
        createdAt: NOW,
        updatedAt: NOW,
      },
      valid: true,
    },
    {
      label: "CreateDesignAssetReferenceSchema exige sourceUrl quando assetType=reference_url",
      schema: CreateDesignAssetReferenceSchema,
      input: {
        assetType: "reference_url",
        title: "Raycast",
        intentionTags: ["cmd-k"],
      },
      valid: false,
    },
    {
      label: "CreateDesignAssetReferenceSchema bloqueia IMDS em sourceUrl",
      schema: CreateDesignAssetReferenceSchema,
      input: {
        assetType: "reference_url",
        title: "Evil",
        sourceUrl: "http://169.254.169.254/latest/meta-data",
        intentionTags: ["test"],
      },
      valid: false,
    },
    {
      label: "CreateDesignAssetReferenceSchema bloqueia javascript: em sourceUrl",
      schema: CreateDesignAssetReferenceSchema,
      input: {
        assetType: "reference_url",
        title: "XSS URL",
        sourceUrl: "javascript:alert(1)",
      },
      valid: false,
    },
    {
      label: "CreateDesignAssetReferenceSchema bloqueia file:// em sourceUrl",
      schema: CreateDesignAssetReferenceSchema,
      input: {
        assetType: "reference_url",
        title: "File URL",
        sourceUrl: "file:///etc/passwd",
      },
      valid: false,
    },
    {
      label: "CreateDesignAssetReferenceSchema bloqueia metadata.google.internal",
      schema: CreateDesignAssetReferenceSchema,
      input: {
        assetType: "reference_url",
        title: "GCP IMDS",
        sourceUrl: "http://metadata.google.internal/computeMetadata/v1/",
      },
      valid: false,
    },
    {
      label: "CreateDesignAssetReferenceSchema bloqueia IPv6 link-local [fe80::1]",
      schema: CreateDesignAssetReferenceSchema,
      input: {
        assetType: "reference_url",
        title: "IPv6 Link-Local",
        sourceUrl: "http://[fe80::1]/meta",
      },
      valid: false,
    },
    {
      label: "WorkflowResumeInputSchema rejeita decisão inválida e campo extra (.strict)",
      schema: WorkflowResumeInputSchema,
      input: {
        decision: "maybe",
        extraField: true,
      },
      valid: false,
    },
    {
      label: "CreateDesignAssetReferenceSchema aceita reference_url válida",
      schema: CreateDesignAssetReferenceSchema,
      input: {
        assetType: "reference_url",
        title: "Linear App",
        sourceUrl: "https://linear.app",
        intentionTags: ["sidebar", "contraste-alto"],
      },
      valid: true,
    },
    {
      label: "UpdateDesignAssetSchema rejeita campos desconhecidos (.strict)",
      schema: UpdateDesignAssetSchema,
      input: { approved: true, storagePath: "/etc/passwd" },
      valid: false,
    },
    {
      label: "DiscoveryRoundSchema rejeita roundNumber > 3",
      schema: DiscoveryRoundSchema,
      input: {
        roundNumber: 4,
        questions: [
          {
            id: "q1",
            pillar: "objective_and_user",
            prompt: "Quem usa?",
            recommendedOption: "Time interno",
            options: ["Time interno", "Clientes externos"],
          },
        ],
        answers: [],
        coveredPillars: ["objective_and_user"],
      },
      valid: false,
    },
    {
      label: "DiscoveryRoundSchema rejeita > 4 perguntas por rodada",
      schema: DiscoveryRoundSchema,
      input: {
        roundNumber: 1,
        questions: [1, 2, 3, 4, 5].map((i) => ({
          id: `q${i}`,
          pillar: "objective_and_user",
          prompt: `Pergunta ${i}?`,
          recommendedOption: "A",
          options: ["A", "B"],
        })),
        answers: [],
        coveredPillars: [],
      },
      valid: false,
    },
    {
      label: "BrownfieldMapSchema rejeita maturityScore > 100",
      schema: BrownfieldMapSchema,
      input: {
        repoPath: "/tmp/repo",
        scannedAt: NOW,
        totalFilesScanned: 12,
        truncated: false,
        topLevelEntries: ["package.json", "src"],
        manifestsFound: ["package.json"],
        detectedStack: ["typescript", "nextjs"],
        hasTests: true,
        hasCi: true,
        hasSteering: false,
        dimensions: {
          ciAndVerify: 20,
          testQuality: 20,
          documentationAndSteering: 20,
          securityPosture: 20,
          architectureModularity: 20,
        },
        maturityScore: 101,
        recommendedStrategy: "frontend_first_msw",
        riskNotes: [],
      },
      valid: false,
    },
    {
      label: "BrownfieldScanRequestSchema aceita vazio e rejeita repoPath externo",
      schema: BrownfieldScanRequestSchema,
      input: { repoPath: "/etc" },
      valid: false,
    },
    {
      label: "WorkflowStartInputSchema rejeita propriedades arbitrárias (strict, sem skipWorktreeExecution)",
      schema: WorkflowStartInputSchema,
      input: { skipWorktreeExecution: true },
      valid: false,
    },
    {
      label: "WorkflowResumeInputSchema aceita decision approved",
      schema: WorkflowResumeInputSchema,
      input: { decision: "approved", feedback: "Pode seguir" },
      valid: true,
    },
    {
      label: "DeliverableSchema aceita campos Slice 3 nulos ou preenchidos",
      schema: DeliverableSchema,
      input: {
        id: UUID_1,
        projectId: UUID_2,
        repositoryId: null,
        title: "Entrega Teste",
        description: null,
        status: "discovery",
        pausedFromStatus: null,
        hasUi: true,
        developmentStrategy: "frontend_first_msw",
        tacticalPattern: "single_agent",
        riskLevel: "low",
        worktreePath: null,
        branchName: null,
        mastraRunId: UUID_1,
        specMarkdown: "# Spec",
        blueprintJson: null,
        verifyAttempts: 0,
        maxVerifyAttempts: 3,
        createdAt: NOW,
        updatedAt: NOW,
      },
      valid: true,
    },
    {
      label: "DeliverableWorkflowStateSchema valida payload completo",
      schema: DeliverableWorkflowStateSchema,
      input: {
        deliverableId: UUID_1,
        runId: UUID_2,
        workflowStatus: "suspended",
        deliverableStatus: "discovery",
        suspendedStep: "stage_discovery",
        gate: "discovery_confirm",
        suspendPayload: { roundNumber: 1 },
        specMarkdown: null,
        blueprint: null,
        designMdContent: null,
        contractTestFiles: [],
        stageHistory: ["stage_discovery"],
        updatedAt: NOW,
      },
      valid: true,
    },
    {
      label: "GenerateDesignMdInputSchema aceita payload vazio aplicando defaults",
      schema: GenerateDesignMdInputSchema,
      input: {},
      valid: true,
    },
    {
      label: "DesignAssetListResponseSchema aceita lista vazia",
      schema: DesignAssetListResponseSchema,
      input: { items: [] },
      valid: true,
    },
    {
      label: "StrategyRouterInputSchema aceita entrada mínima",
      schema: StrategyRouterInputSchema,
      input: {
        title: "Painel Kanban",
        hasUi: true,
        riskLevel: "low",
        isBrownfield: false,
      },
      valid: true,
    },
    {
      label: "StrategyRouterOutputSchema valida saída completa com fatias",
      schema: StrategyRouterOutputSchema,
      input: {
        developmentStrategy: "frontend_first_msw",
        tacticalPattern: "single_agent",
        rationale: "UI com MSW",
        verticalSlices: [
          {
            name: "Cockpit UI",
            objective: "Construir painel",
            allowedPaths: ["apps/web/src"],
            sequential: true,
          },
        ],
        sharedPathsDetected: [],
      },
      valid: true,
    },
    {
      label: "StrategyRouterOutputSchema rejeita fatias vazias",
      schema: StrategyRouterOutputSchema,
      input: {
        developmentStrategy: "frontend_first_msw",
        tacticalPattern: "single_agent",
        rationale: "UI com MSW",
        verticalSlices: [],
        sharedPathsDetected: [],
      },
      valid: false,
    },
  ])("$label", ({ schema, input, valid }) => {
    const parsed = schema.safeParse(input);
    expect(parsed.success).toBe(valid);
  });

  test("GenerateDesignMdInputSchema aplica themePreference default dual_theme", () => {
    const parsed = GenerateDesignMdInputSchema.parse({});
    expect(parsed.themePreference).toBe("dual_theme");
  });
});
