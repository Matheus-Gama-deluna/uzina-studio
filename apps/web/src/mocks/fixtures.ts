import {
  BrownfieldMapSchema,
  ClientListResponseSchema,
  DeliverableListResponseSchema,
  DeliverableWorkflowStateSchema,
  DesignAssetListResponseSchema,
  ProjectListResponseSchema,
  ProviderProfileListResponseSchema,
} from "@uzina/contracts";

const NOW = "2026-11-21T17:00:00.000Z";
export const MOCK_ORG_ID = "10000000-0000-4000-8000-000000000001";
export const MOCK_INTERNAL_CLIENT_ID = "20000000-0000-4000-8000-000000000001";
export const MOCK_EXTERNAL_CLIENT_ID = "20000000-0000-4000-8000-000000000002";
export const MOCK_PROJECT_ID = "30000000-0000-4000-8000-000000000001";
export const MOCK_REPO_ID = "40000000-0000-4000-8000-000000000001";

export const mockClients = ClientListResponseSchema.parse({
  items: [
    {
      id: MOCK_INTERNAL_CLIENT_ID,
      organizationId: MOCK_ORG_ID,
      name: "Internos",
      slug: "internos",
      isDefaultInternal: true,
      notes: "Produtos internos da organização",
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: MOCK_EXTERNAL_CLIENT_ID,
      organizationId: MOCK_ORG_ID,
      name: "Fintech Horizonte",
      slug: "fintech-horizonte",
      isDefaultInternal: false,
      notes: "Conta B2B financeira",
      createdAt: NOW,
      updatedAt: NOW,
    },
  ],
});

export const mockProjects = ProjectListResponseSchema.parse({
  items: [
    {
      id: MOCK_PROJECT_ID,
      clientId: MOCK_INTERNAL_CLIENT_ID,
      name: "Uzina Core Cockpit",
      slug: "uzina-core-cockpit",
      description: "Painel principal da fábrica",
      defaultDevelopmentStrategy: "frontend_first_msw",
      maturityScore: 84,
      designMdPath: ".uzina/DESIGN.md",
      status: "active",
      repositories: [
        {
          id: MOCK_REPO_ID,
          projectId: MOCK_PROJECT_ID,
          name: "uzina-studio",
          localPath: "/workspaces/uzina-studio",
          remoteUrl: "https://github.com/Matheus-Gama-deluna/uzina-studio",
          defaultBranch: "main",
          stackMetadataJson: { runtime: "node22", framework: "nextjs" },
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
      createdAt: NOW,
      updatedAt: NOW,
    },
  ],
});

export const mockDeliverables = DeliverableListResponseSchema.parse({
  items: [
    {
      id: "50000000-0000-4000-8000-000000000001",
      projectId: MOCK_PROJECT_ID,
      repositoryId: MOCK_REPO_ID,
      title: "Cofre AES-256-GCM e RBAC multi-tenant",
      description: "Implementar cofre de chaves sem exposição em texto claro.",
      status: "building",
      pausedFromStatus: null,
      hasUi: true,
      developmentStrategy: "frontend_first_msw",
      tacticalPattern: "single_agent",
      riskLevel: "high",
      worktreePath: ".worktrees/task-01",
      branchName: "uzina/slice-01",
      verifyAttempts: 0,
      maxVerifyAttempts: 3,
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: "50000000-0000-4000-8000-000000000002",
      projectId: MOCK_PROJECT_ID,
      repositoryId: MOCK_REPO_ID,
      title: "Visão Kanban e Lista Hierárquica",
      description: "Alternância 1 clique com tokens OKLCH.",
      status: "spec_review",
      pausedFromStatus: null,
      hasUi: true,
      developmentStrategy: "frontend_first_msw",
      tacticalPattern: "single_agent",
      riskLevel: "medium",
      worktreePath: null,
      branchName: null,
      verifyAttempts: 0,
      maxVerifyAttempts: 3,
      createdAt: NOW,
      updatedAt: NOW,
    },
  ],
});

export const mockProviders = ProviderProfileListResponseSchema.parse({
  items: [
    {
      id: "60000000-0000-4000-8000-000000000001",
      organizationId: MOCK_ORG_ID,
      name: "OmniRoute Gateway",
      providerType: "omniroute",
      baseUrl: "http://localhost:8080/v1",
      hasApiKey: true,
      keyPreview: "sk-...9a2f",
      roleBindings: {
        discovery: { modelId: "gemini-2.5-flash" },
        architect: { modelId: "claude-sonnet-4" },
        builder: { modelId: "claude-sonnet-4" },
        verifier: { modelId: "gpt-5" },
      },
      isDefault: true,
      createdAt: NOW,
      updatedAt: NOW,
    },
  ],
});

export const MOCK_DELIVERABLE_ID = "50000000-0000-4000-8000-000000000001";

export const mockDesignAssets = DesignAssetListResponseSchema.parse({
  items: [
    {
      id: "70000000-0000-4000-8000-000000000001",
      projectId: MOCK_PROJECT_ID,
      deliverableId: MOCK_DELIVERABLE_ID,
      assetType: "reference_url",
      title: "Linear Cockpit Reference",
      sourceUrl: "https://linear.app",
      assetUrl: null,
      mimeType: null,
      sizeBytes: null,
      intentionTags: ["copiar:densidade-tabela", "ignorar:gradiente"],
      notes: "Referência para layout técnico com bordas hairline.",
      approved: true,
      createdAt: NOW,
      updatedAt: NOW,
    },
  ],
});

export const mockBrownfieldMap = BrownfieldMapSchema.parse({
  repoPath: "/workspaces/uzina-studio",
  scannedAt: NOW,
  totalFilesScanned: 48,
  truncated: false,
  topLevelEntries: ["apps", "packages", "docs", "package.json", "pnpm-lock.yaml"],
  manifestsFound: ["package.json", "pnpm-lock.yaml"],
  detectedStack: ["typescript", "nextjs", "drizzle"],
  hasTests: true,
  hasCi: true,
  hasSteering: true,
  dimensions: {
    ciAndVerify: 18,
    testQuality: 17,
    documentationAndSteering: 18,
    securityPosture: 16,
    architectureModularity: 15,
  },
  maturityScore: 84,
  recommendedStrategy: "frontend_first_msw",
  riskNotes: [],
});

export const mockWorkflowState = DeliverableWorkflowStateSchema.parse({
  deliverableId: MOCK_DELIVERABLE_ID,
  runId: "80000000-0000-4000-8000-000000000001",
  workflowStatus: "suspended",
  deliverableStatus: "discovery",
  suspendedStep: "stage_discovery",
  gate: "discovery_confirm",
  suspendPayload: {
    gate: "discovery_confirm",
    roundNumber: 1,
    hasUi: true,
    round: {
      roundNumber: 1,
      coveredPillars: [],
      answers: [],
      questions: [
        {
          id: "q-objective-user",
          pillar: "objective_and_user",
          prompt: "Qual persona principal vai operar este entregável?",
          recommendedOption: "Operador técnico interno com fluxo auditável",
          options: [
            "Operador técnico interno com fluxo auditável",
            "Cliente final externo",
          ],
        },
      ],
    },
  },
  specMarkdown: null,
  blueprint: null,
  designMdContent: null,
  contractTestFiles: [],
  stageHistory: ["stage_discovery"],
  updatedAt: NOW,
});
