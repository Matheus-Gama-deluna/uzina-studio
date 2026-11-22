import {
  BrownfieldMapSchema,
  ClientListResponseSchema,
  CodebaseReindexResponseSchema,
  CodebaseTreeResponseSchema,
  DecisionListResponseSchema,
  ProvenanceListResponseSchema,
  SymbolGraphResponseSchema,
  SymbolSliceResponseSchema,
  DeliverableListResponseSchema,
  DeliverableWorkflowStateSchema,
  DesignAssetListResponseSchema,
  DesignPrototypeListResponseSchema,
  EngineConfigResponseSchema,
  ExecutionEventListResponseSchema,
  FinopsSummarySchema,
  MemoryListResponseSchema,
  ProjectListResponseSchema,
  ProviderProfileListResponseSchema,
  QmdReindexResponseSchema,
  QmdSearchResponseSchema,
  SecurityScanListResponseSchema,
  SecurityScanResultSchema,
  StitchMcpSyncResponseSchema,
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

export const MOCK_DECISION_ID = "90000000-0000-4000-8000-000000000001";
export const MOCK_SCAN_ID = "91000000-0000-4000-8000-000000000001";
export const MOCK_FINDING_ID = "92000000-0000-4000-8000-000000000001";

export const mockDecisions = DecisionListResponseSchema.parse({
  items: [
    {
      id: MOCK_DECISION_ID,
      deliverableId: MOCK_DELIVERABLE_ID,
      deliverableTitle: "Autenticação Multi-Tenant e Cofre AES",
      projectId: MOCK_PROJECT_ID,
      projectName: "Portal Financeiro",
      mastraStepId: "stage_decision",
      decisionType: "pr_evidence_approve",
      summary: "Pacote de Evidências pronto para aprovação de merge/PR",
      payloadJson: {
        gate: "pr_evidence_approve",
        evidencePack: {
          deliverableId: MOCK_DELIVERABLE_ID,
          branchName: "uzina/auth-vault",
          baseBranch: "main",
          verifyAttempts: 1,
          verifyPassed: true,
          verifyChecks: [
            {
              name: "audit:tests",
              passed: true,
              durationMs: 42,
              summary: "14 testes auditados sem anti-patterns.",
            },
            {
              name: "typecheck + test",
              passed: true,
              durationMs: 850,
              summary: "Todos os checks determinísticos verdes.",
            },
          ],
          testAuditPassed: true,
          testAuditViolationsCount: 0,
          diffSummary: {
            filesChanged: 4,
            diffBytes: 1840,
            preview: "+ export const verified = true;",
          },
          securitySummary: {
            scanId: MOCK_SCAN_ID,
            critical: 0,
            high: 0,
            medium: 1,
            low: 0,
            info: 0,
            scannersRun: ["native_secrets", "native_ddl", "native_slopsquatting", "gitleaks"],
            skippedScanners: ["gitleaks"],
            gatePassed: true,
          },
          tokenSummary: {
            totalInputTokens: 4200,
            totalOutputTokens: 1120,
            totalCacheReadTokens: 1800,
            estimatedCostUsd: 0.029,
          },
          verifierVerdict: "approved",
          verifierNotes: "Verifier independente validou contratos Zod e RBAC.",
          finalizeInfo: null,
        },
      },
      status: "pending",
      humanFeedback: null,
      resolvedBy: null,
      resolvedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
  ],
});

export const mockSecurityScanDetail = SecurityScanResultSchema.parse({
  id: MOCK_SCAN_ID,
  organizationId: MOCK_ORG_ID,
  projectId: MOCK_PROJECT_ID,
  deliverableId: MOCK_DELIVERABLE_ID,
  mode: "embedded",
  targetType: "git_diff",
  targetRef: "uzina/auth-vault",
  scannersRun: [
    "native_secrets",
    "native_ddl",
    "native_slopsquatting",
    "gitleaks",
  ],
  scannerStatuses: [
    {
      scanner: "native_secrets",
      status: "executed",
      binaryName: null,
      installHint: null,
      findingsCount: 0,
      durationMs: 11,
      errorMessage: null,
    },
    {
      scanner: "gitleaks",
      status: "skipped_missing_binary",
      binaryName: "gitleaks",
      installHint: "uzina-sec install-tools",
      findingsCount: 0,
      durationMs: 1,
      errorMessage: "Binário (gitleaks) não encontrado no PATH.",
    },
  ],
  summaryCountsJson: {
    critical: 0,
    high: 0,
    medium: 1,
    low: 0,
    info: 0,
    total: 1,
    confirmedCount: 0,
    suppressedCount: 0,
    skippedScannersCount: 1,
  },
  status: "completed",
  sarifRawJson: {
    version: "2.1.0",
    runs: [
      {
        tool: { driver: { name: "uzina-security-engine", version: "0.1.0" } },
        results: [],
      },
    ],
  },
  findings: [
    {
      id: MOCK_FINDING_ID,
      scanId: MOCK_SCAN_ID,
      projectId: MOCK_PROJECT_ID,
      ruleId: "uzina/unpinned-dependency",
      scanner: "native_slopsquatting",
      severity: "medium",
      filePath: "package.json",
      lineStart: 12,
      title: "Dependência não pinada detectada",
      description: "Pinagem estrita recomendada em produção.",
      fingerprint: "f".repeat(64),
      triageVerdict: "unknown",
      triageRationale: "Severidade moderada aguardando revisão.",
      suppressedInMemory: false,
      povTestStatus: "not_applicable",
      createdAt: NOW,
      updatedAt: NOW,
    },
  ],
  createdAt: NOW,
  updatedAt: NOW,
});

export const mockSecurityScans = SecurityScanListResponseSchema.parse({
  items: [
    {
      ...mockSecurityScanDetail,
      sarifRawJson: undefined,
      findings: undefined,
    },
  ],
});

export const mockExecutionEvents = ExecutionEventListResponseSchema.parse({
  items: [
    {
      id: "93000000-0000-4000-8000-000000000001",
      deliverableId: MOCK_DELIVERABLE_ID,
      stage: "stage_verify",
      actorRole: "verifier",
      eventType: "verify_result",
      tokensInput: 1200,
      tokensOutput: 350,
      cacheReadTokens: 600,
      estimatedCostUsd: 0.0085,
      payloadJson: { verifyPassed: true, attemptNumber: 1 },
      createdAt: NOW,
    },
  ],
});

export const MOCK_MEMORY_ID = "94000000-0000-4000-8000-000000000001";

export const mockMemories = MemoryListResponseSchema.parse({
  items: [
    {
      id: MOCK_MEMORY_ID,
      organizationId: MOCK_ORG_ID,
      scopeType: "org",
      scopeId: MOCK_ORG_ID,
      category: "convention",
      title: "Contratos Zod Strict em Todas as Rotas",
      content:
        "Payloads externos devem sempre usar schemas .strict() de @uzina/contracts.",
      sourceDeliverableId: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: "94000000-0000-4000-8000-000000000002",
      organizationId: MOCK_ORG_ID,
      scopeType: "project",
      scopeId: MOCK_PROJECT_ID,
      category: "architecture",
      title: "Persistência Dual-Mode PGlite + Postgres",
      content: "Usar Drizzle pg-core compatível com PGlite local e Postgres+pgvector.",
      sourceDeliverableId: MOCK_DELIVERABLE_ID,
      createdAt: NOW,
      updatedAt: NOW,
    },
  ],
});

export const mockQmdSearchResponse = QmdSearchResponseSchema.parse({
  query: "Zod strict",
  mode: "hybrid",
  embeddingModel: "deterministic-trigram-384",
  degraded: true,
  totalCandidates: 2,
  contextTree: [
    {
      directory: "memories/org",
      summary: "Contratos Zod Strict em Todas as Rotas",
      chunkCount: 1,
    },
  ],
  hits: [
    {
      id: "95000000-0000-4000-8000-000000000001",
      sourceType: "memory",
      memoryId: MOCK_MEMORY_ID,
      sourcePath: null,
      scopeType: "org",
      scopeId: MOCK_ORG_ID,
      headingPath: "Contratos Zod Strict em Todas as Rotas",
      lineStart: 1,
      lineEnd: 2,
      snippet:
        "Payloads externos devem sempre usar schemas .strict() de @uzina/contracts.",
      scores: { bm25: 2.1, vector: 0.85, rrf: 0.032787 },
    },
  ],
});

export const mockQmdReindexResponse = QmdReindexResponseSchema.parse({
  indexedMemories: 2,
  indexedDocFiles: 4,
  totalChunks: 12,
  embeddingModel: "deterministic-trigram-384",
  degraded: true,
});

export const mockCodebaseTreeResponse = CodebaseTreeResponseSchema.parse({
  projectId: MOCK_PROJECT_ID,
  repositoryId: MOCK_REPO_ID,
  filesCount: 2,
  symbolsCount: 2,
  edgesCount: 1,
  directories: [
    {
      directory: "src/services",
      fileCount: 1,
      summary: "1 arquivo(s) (function) — createDeliverable",
    },
    {
      directory: "src/app",
      fileCount: 1,
      summary: "1 arquivo(s) (route) — POST",
    },
  ],
  skeleton: {
    repositoryId: MOCK_REPO_ID,
    entriesCount: 2,
    skeletonText:
      "# src/services/deliverables.ts\n  [function] export async function createDeliverable(input: unknown) (src/services/deliverables.ts#L1-L20)",
    tokensEstimated: 32,
    baselineTokens: 280,
    savingsPercent: 88.6,
    maxTokensBudget: 2000,
  },
  adapters: [
    {
      adapter: "qmd",
      status: "ok",
      version: "builtin-slice-7",
      detail: "Motor híbrido QMD nativo integrado.",
    },
    {
      adapter: "repomix",
      status: "skipped_missing_binary",
      version: null,
      detail: "Binário 'repomix' ausente; fallback AST nativo ativo.",
    },
    {
      adapter: "ast_grep",
      status: "skipped_missing_binary",
      version: null,
      detail: "Binário 'sg' ausente; fallback AST nativo ativo.",
    },
    {
      adapter: "codebase_memory_mcp",
      status: "skipped_missing_binary",
      version: null,
      detail: "Binário 'codebase-memory-mcp' ausente; fallback AST nativo ativo.",
    },
  ],
});

export const mockCodebaseReindexResponse = CodebaseReindexResponseSchema.parse({
  projectId: MOCK_PROJECT_ID,
  repositoryId: MOCK_REPO_ID,
  indexedFiles: 2,
  skippedUnchangedFiles: 0,
  removedFiles: 0,
  totalSymbols: 2,
  totalEdges: 1,
  tokensBaseline: 280,
  tokensSkeleton: 32,
  savingsPercent: 88.6,
});

export const mockSymbolGraphResponse = SymbolGraphResponseSchema.parse({
  query: "createDeliverable",
  nodes: [
    {
      id: "96000000-0000-4000-8000-000000000001",
      fileId: "97000000-0000-4000-8000-000000000001",
      filePath: "src/services/deliverables.ts",
      kind: "function",
      name: "createDeliverable",
      signature: "export async function createDeliverable(input: unknown)",
      lineStart: 1,
      lineEnd: 20,
      exported: true,
      citation: "src/services/deliverables.ts#L1-L20",
    },
  ],
  edges: [],
  tokensEstimated: 18,
});

export const mockSymbolSliceResponse = SymbolSliceResponseSchema.parse({
  path: "src/services/deliverables.ts",
  symbol: "createDeliverable",
  kind: "function",
  lineStart: 1,
  lineEnd: 20,
  citation: "src/services/deliverables.ts#L1-L20",
  code: "export async function createDeliverable(input: unknown) {\n  return { ok: true };\n}",
  tokensEstimated: 20,
  baselineFileTokens: 200,
  savingsPercent: 90,
});

export const mockProvenanceListResponse = ProvenanceListResponseSchema.parse({
  projectId: MOCK_PROJECT_ID,
  entries: [
    {
      id: "98000000-0000-4000-8000-000000000001",
      organizationId: MOCK_ORG_ID,
      deliverableId: MOCK_DELIVERABLE_ID,
      decisionId: null,
      memoryId: MOCK_MEMORY_ID,
      symbolId: "96000000-0000-4000-8000-000000000001",
      filePath: "src/services/deliverables.ts",
      createdAt: NOW,
    },
  ],
});

export const MOCK_PROTOTYPE_ID = "99000000-0000-4000-8000-000000000001";

export const mockDesignPrototypes = DesignPrototypeListResponseSchema.parse({
  items: [
    {
      id: MOCK_PROTOTYPE_ID,
      projectId: MOCK_PROJECT_ID,
      deliverableId: null,
      level: 3,
      source: "stitch_import",
      title: "Dashboard Stitch v1",
      previewUrl: `/api/prototypes/${MOCK_PROTOTYPE_ID}/preview`,
      tokensJson: {
        color: { primary: { $value: "#38bdf8", $type: "color" } },
        typography: { body: { $value: "Inter, sans-serif", $type: "fontFamily" } },
        spacing: { "space-6": { $value: "1.50rem", $type: "dimension" } },
        radius: { xl: { $value: "0.75rem", $type: "dimension" } },
      },
      wireframeMermaid: null,
      approved: false,
      handoffPath: null,
      createdAt: NOW,
    },
  ],
});

export const mockStitchSyncResponse = StitchMcpSyncResponseSchema.parse({
  status: "unavailable",
  detail: "Binário MCP 'stitch-mcp' não encontrado; use a importação HTML/Tailwind.",
  screens: [],
  importedPrototype: null,
});

export const mockFinopsSummary = FinopsSummarySchema.parse({
  organizationId: MOCK_ORG_ID,
  workspaceKind: "worktree",
  totalEvents: 2,
  totalTokensBaseline: 15000,
  totalTokensActual: 1500,
  totalTokensSaved: 13500,
  overallSavingsPercent: 90,
  cacheHitRate: 90,
  reworkRate: 0,
  estimatedCostSavedUsd: 0.0405,
  byTechnique: [
    {
      technique: "prompt_cache",
      eventsCount: 0,
      tokensBaseline: 0,
      tokensActual: 0,
      tokensSaved: 0,
      savingsPercent: 0,
    },
    {
      technique: "qmd",
      eventsCount: 1,
      tokensBaseline: 5000,
      tokensActual: 500,
      tokensSaved: 4500,
      savingsPercent: 90,
    },
    {
      technique: "ast_graph",
      eventsCount: 0,
      tokensBaseline: 0,
      tokensActual: 0,
      tokensSaved: 0,
      savingsPercent: 0,
    },
    {
      technique: "skeleton",
      eventsCount: 1,
      tokensBaseline: 10000,
      tokensActual: 1000,
      tokensSaved: 9000,
      savingsPercent: 90,
    },
  ],
  recentEvents: [
    {
      id: "9a000000-0000-4000-8000-000000000001",
      organizationId: MOCK_ORG_ID,
      deliverableId: null,
      technique: "skeleton",
      tokensBaseline: 10000,
      tokensActual: 1000,
      tokensSaved: 9000,
      savingsPercent: 90,
      createdAt: NOW,
    },
  ],
});

export const mockEngineConfigResponse = EngineConfigResponseSchema.parse({
  config: {
    organizationId: MOCK_ORG_ID,
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
    updatedAt: NOW,
  },
  catalog: [
    {
      id: "deterministic",
      category: "embedding",
      label: "Trigramas Determinísticos (384d)",
      diskMb: 0,
      ramMb: 5,
      cpuImpact: "< 2 ms / consulta",
      benefitSummary: "100% offline, zero download, ~92% precisão com BM25.",
      recommendedFor: "CI/CD rápido e ambientes leves.",
    },
    {
      id: "onnx_e5_small",
      category: "embedding",
      label: "Semântico Bilíngue E5-Small (384d)",
      diskMb: 118,
      ramMb: 180,
      cpuImpact: "~15-40 ms / consulta",
      benefitSummary: "+35% a +50% Recall@5 em sinônimos e busca PT-BR <-> EN.",
      recommendedFor: "Uso diário local bilíngue.",
    },
    {
      id: "polyglot",
      category: "ast",
      label: "AST Poliglota (TS + Python, Go, Rust, SQL, Java, C#)",
      diskMb: 5,
      ramMb: 50,
      cpuImpact: "~1-3 s / 200 arquivos",
      benefitSummary: "80% a 95% de economia de tokens em backends multi-linguagem.",
      recommendedFor: "Projetos híbridos Full-Stack.",
    },
  ],
  activeEmbeddingProviderId: "deterministic-trigram-384",
  degraded: true,
});
