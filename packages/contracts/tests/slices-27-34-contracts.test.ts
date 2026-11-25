import { describe, expect, test } from "vitest";
import {
  AgentEffectivenessMetricsSchema,
  AgentTrajectoryEvalCaseSchema,
  AgentTrajectoryEvalReportSchema,
  AgentTrajectoryEvalResultSchema,
  AgenticPromptInjectionFindingSchema,
  ArchitectBlueprintV2Schema,
  ChangeImpactInputSchema,
  ChangeImpactOutputSchema,
  ColorContrastValidationInputSchema,
  ColorContrastValidationOutputSchema,
  DastHeaderCheckSchema,
  DastPassiveReportSchema,
  DecisionRiskBriefingSchema,
  DeliverableEvidenceReadInputSchema,
  DeliverableEvidenceReadOutputSchema,
  DependencyBoundaryCheckInputSchema,
  DependencyBoundaryCheckOutputSchema,
  DesignSystemContractInputSchema,
  DesignSystemContractOutputSchema,
  DistillRetrospectiveMemoryInputSchema,
  DistillRetrospectiveMemoryOutputSchema,
  EntropyAuditReportSchema,
  FinopsRiskDigestInputSchema,
  FinopsRiskDigestOutputSchema,
  InspectPrototypeVersionInputSchema,
  InspectPrototypeVersionOutputSchema,
  MigrationSafetyIssueSchema,
  MigrationSafetyReportSchema,
  MutationPbtReportSchema,
  PrototypeComponentManifestSchema,
  ReadSymbolSliceInputSchema,
  ReadSymbolSliceOutputSchema,
  RequirementConflictCheckInputSchema,
  RequirementConflictCheckOutputSchema,
  SbomComponentSchema,
  SbomDocumentSummarySchema,
  ScaReachabilityAnnotationSchema,
  ScopedCheckResultSchema,
  SecurityFindingsQueryInputSchema,
  SecurityFindingsQueryOutputSchema,
  ShapeSpecSchema,
  SkillsLockEntrySchema,
  SkillsLockManifestSchema,
  SpecComplianceRowSchema,
  StuckAlertV2ExtensionSchema,
  SymbolCallGraphInputSchema,
  SymbolCallGraphOutputSchema,
  TestAntiPatternAuditInputSchema,
  TestAntiPatternAuditOutputSchema,
  VerifierTwoStageOutputSchema,
  VerifierVerdictOutputSchema,
  VisualA11yVerifyReportSchema,
  WorktreesAndLocksSnapshotInputSchema,
  WorktreesAndLocksSnapshotOutputSchema,
} from "../src/index.js";

const VALID_UUID = "11111111-1111-4111-8111-111111111111";
const VALID_ISO = "2026-11-25T16:00:00.000Z";
const VALID_SHA256 = "a".repeat(64);

const BASE_DISCOVERY_SUMMARY = {
  objective: "Implementar fila de verificação com feedback estruturado",
  targetUser: "Engenheiro de software",
  criticalFlows: ["Executar verificação em dois estágios"],
  technicalConstraints: ["Zero módulos ee/ do Mastra"],
  hasUi: true,
  acceptanceCriteria: ["Reprovar automaticamente quando faltar teste"],
  outOfScope: ["Suporte a Python"],
  assumptions: [
    {
      key: "db_mode",
      value: "PGlite em memória nos testes",
      source: "pre_read" as const,
    },
  ],
  specMarkdown: "## Especificação\nDetalhes do entregável.",
};

const VALID_BDD_SCENARIO = {
  id: "BDD-01",
  title: "Bloquear saída sem nonGoals",
  given: "um documento de discovery sem nonGoals",
  when: "o agente tentar finalizar a fase",
  then: "o contrato Zod deve rejeitar o payload",
  roleRequired: "developer" as const,
};

const VALID_SHAPE_SPEC = {
  ...BASE_DISCOVERY_SUMMARY,
  appetite: "small_1_slice" as const,
  nonGoals: ["Não alterar pipeline legado da Fase 1"],
  bddScenarios: [VALID_BDD_SCENARIO],
  dataSensitivityFlags: ["pii_none"],
  ambiguityCheck: {
    score: 12,
    unresolvedQuestions: [],
  },
};

const VALID_STRIDE_RISK = {
  category: "tampering" as const,
  threatOrFailure: "Builder edita teste de contrato para passar",
  severity: "high" as const,
  mitigation: "Bloquear escrita em contractTestFiles no stageBuild",
  verifyCheck: "slice30-builder-harness.test.ts",
};

const VALID_BLUEPRINT_V2 = {
  developmentStrategy: "api_contract_first" as const,
  tacticalPattern: "single_agent" as const,
  rationale: "Contratos Zod devem preceder implementações.",
  verticalSlices: [
    {
      name: "slice-29-handoffs",
      objective: "Estruturar handoffs v2",
      allowedPaths: ["packages/contracts/src/handoffs-v2.ts"],
      sequential: false,
    },
  ],
  sharedPathsDetected: [],
  adr: {
    context: "Handoffs via chat livre causavam perda de invariantes.",
    optionsConsidered: ["Markdown livre", "Zod Structured Output"],
    decision: "Adotar Schemas Zod estritos por fase.",
    consequences: "Maior previsibilidade e bloqueio de deriva.",
    reversibility: "moderate",
  },
  strideFmeaRisks: [VALID_STRIDE_RISK],
  storyShards: [
    {
      sliceName: "shard-1",
      objective: "Implementar Test Lock",
      allowedPaths: ["packages/mastra-runtime/src/workspace-adapter.ts"],
      targetSymbols: ["MastraWorkspaceExecutorAdapter"],
      acceptanceScenarioIds: ["BDD-01"],
      verificationCommands: ["pnpm --filter @uzina/mastra-runtime test"],
      sequential: true,
    },
  ],
  openSpecDelta: {
    added: ["ShapeSpecSchema"],
    modified: ["deliverable-lifecycle.ts"],
    removed: [],
  },
};

const VALID_PROTOTYPE_SECTION = {
  sectionName: "DecisionBriefingCard",
  uiComponents: ["Card", "Badge", "Table"],
  dataSlots: ["card", "badge"],
  statesCovered: [
    "loading",
    "empty",
    "error",
    "partial",
    "populated",
  ] as const,
};

const VALID_PROTOTYPE_MANIFEST = {
  prototypeId: VALID_UUID,
  deliverableId: VALID_UUID,
  sections: [VALID_PROTOTYPE_SECTION],
  wcagChecklist: {
    contrastAaPassed: true,
    keyboardNavPassed: true,
    touchTargetsMin44Px: true,
    mobile390PxNoOverflow: true,
    noRbacLeakage: true,
  },
  tokensUsed: ["--color-surface", "--color-ink"],
};

const VALID_VERIFIER_TWO_STAGE = {
  verdict: "approved" as const,
  summary: "Todos os critérios cobertos e verificações de segurança aprovadas.",
  issues: [],
  stage1SpecCompliance: {
    passed: true,
    matrix: [
      {
        criterionId: "AC-01",
        criterionText: "Reprovar critério sem teste correspondente",
        testFile: "packages/contracts/tests/slices-27-34-contracts.test.ts",
        testLine: 120,
        sourceFile: "packages/contracts/src/handoffs-v2.ts",
        sourceLine: 180,
        status: "covered" as const,
      },
    ],
  },
  stage2QualityAndSecurity: {
    passed: true,
    refutingChecksPerformed: ["Validado limite máximo de confidenceScore=100"],
    survivingMutantRisks: [],
  },
  confidenceScore: 94,
};

describe("@uzina/contracts — Slices 28-34 Schemas", () => {
  describe("Slice 28: role-tools.ts (14 tools com bounds e defaults)", () => {
    const validSymbol = {
      id: VALID_UUID,
      fileId: VALID_UUID,
      filePath: "packages/contracts/src/enums.ts",
      kind: "zod_schema" as const,
      name: "RiskLevelSchema",
      signature: "export const RiskLevelSchema = z.enum(...)",
      lineStart: 39,
      lineEnd: 40,
      exported: true,
      citation: "packages/contracts/src/enums.ts#L39-L40",
    };

    const validSecurityFinding = {
      id: VALID_UUID,
      scanId: VALID_UUID,
      projectId: VALID_UUID,
      ruleId: "semgrep.ts.insecure-eval",
      scanner: "semgrep",
      severity: "high" as const,
      filePath: "apps/web/src/lib/eval.ts",
      lineStart: 12,
      title: "Uso perigoso de eval",
      description: "Entrada não sanitizada em eval.",
      fingerprint: VALID_SHA256,
      triageVerdict: "confirmed" as const,
      triageRationale: "Confirmado no diff.",
      suppressedInMemory: false,
      povTestStatus: "failing_confirmed" as const,
      createdAt: VALID_ISO,
      updatedAt: VALID_ISO,
    };

    test.each([
      {
        name: "SymbolCallGraphInput aplica defaults depth=1 e maxResults=20",
        schema: SymbolCallGraphInputSchema,
        input: { projectId: VALID_UUID, symbol: "RiskLevelSchema" },
        valid: true,
        check: (out: unknown) => {
          const parsed = SymbolCallGraphInputSchema.parse(out);
          expect(parsed.depth).toBe(1);
          expect(parsed.maxResults).toBe(20);
        },
      },
      {
        name: "SymbolCallGraphInput rejeita depth > 3",
        schema: SymbolCallGraphInputSchema,
        input: { projectId: VALID_UUID, symbol: "RiskLevelSchema", depth: 4 },
        valid: false,
      },
      {
        name: "SymbolCallGraphOutput aceita grafo válido",
        schema: SymbolCallGraphOutputSchema,
        input: {
          query: "RiskLevelSchema",
          nodes: [validSymbol],
          edges: [],
          tokensEstimated: 140,
        },
        valid: true,
      },
      {
        name: "ChangeImpactInput rejeita changedFiles vazio",
        schema: ChangeImpactInputSchema,
        input: { projectId: VALID_UUID, changedFiles: [] },
        valid: false,
      },
      {
        name: "ChangeImpactOutput aceita impacto válido",
        schema: ChangeImpactOutputSchema,
        input: {
          changedFiles: ["packages/contracts/src/enums.ts"],
          affectedSymbols: [validSymbol],
          affectedRoutes: [],
          tokensEstimated: 90,
        },
        valid: true,
      },
      {
        name: "ReadSymbolSliceInput rejeita maxBytes < 128 e > 16384",
        schema: ReadSymbolSliceInputSchema,
        input: {
          projectId: VALID_UUID,
          path: "packages/contracts/src/enums.ts",
          symbol: "RiskLevelSchema",
          maxBytes: 32768,
        },
        valid: false,
      },
      {
        name: "ReadSymbolSliceOutput aceita slice válido",
        schema: ReadSymbolSliceOutputSchema,
        input: {
          path: "packages/contracts/src/enums.ts",
          symbol: "RiskLevelSchema",
          kind: "zod_schema",
          lineStart: 39,
          lineEnd: 40,
          citation: "packages/contracts/src/enums.ts#L39-L40",
          code: "export const RiskLevelSchema = z.enum(['low', 'medium', 'high']);",
          tokensEstimated: 24,
          baselineFileTokens: 320,
          savingsPercent: 92.5,
        },
        valid: true,
      },
      {
        name: "DependencyBoundaryCheckInput & Output validam violação de fronteira",
        schema: DependencyBoundaryCheckOutputSchema,
        input: {
          passed: false,
          sourcePackage: "@uzina/contracts",
          allowedInternalTargets: [],
          violations: [
            {
              targetImport: "@uzina/core",
              reason: "@uzina/contracts não pode importar pacotes internos",
              severity: "error",
            },
          ],
        },
        valid: true,
      },
      {
        name: "DependencyBoundaryCheckInput rejeita proposedImports vazio",
        schema: DependencyBoundaryCheckInputSchema,
        input: { sourcePackage: "@uzina/contracts", proposedImports: [] },
        valid: false,
      },
      {
        name: "RequirementConflictCheckInput rejeita proposedScope curto demais",
        schema: RequirementConflictCheckInputSchema,
        input: {
          projectId: VALID_UUID,
          proposedTitle: "Auth",
          proposedScope: "abc",
        },
        valid: false,
      },
      {
        name: "RequirementConflictCheckOutput aceita conflito detectado",
        schema: RequirementConflictCheckOutputSchema,
        input: {
          hasConflicts: true,
          conflicts: [
            {
              sourceType: "qmd_memory",
              referenceId: VALID_UUID,
              title: "Regra RBAC",
              overlapSummary: "Conflito com política existente de auditoria",
              severity: "blocking",
            },
          ],
          checkedDeliverablesCount: 3,
          checkedMemoriesCount: 8,
        },
        valid: true,
      },
      {
        name: "FinopsRiskDigestInput & Output validam métricas por projeto",
        schema: FinopsRiskDigestOutputSchema,
        input: {
          projectId: VALID_UUID,
          tokensTotal: 45000,
          estimatedCostUsd: 0.42,
          budgetCapUsd: 10,
          budgetUtilizationPercent: 4.2,
          reworkRatePercent: 12.5,
          averageVerifyAttempts: 1.2,
          openSecurityCounts: { critical: 0, high: 1, medium: 2, low: 4 },
          overallRiskLevel: "medium",
        },
        valid: true,
      },
      {
        name: "FinopsRiskDigestInput rejeita includeRecentCallsLimit > 20",
        schema: FinopsRiskDigestInputSchema,
        input: { projectId: VALID_UUID, includeRecentCallsLimit: 25 },
        valid: false,
      },
      {
        name: "DesignSystemContractInput & Output validam contrato UI",
        schema: DesignSystemContractOutputSchema,
        input: {
          designMdPath: ".uzina/DESIGN.md",
          designMdExcerpt: "# Design Tokens",
          approvedAssetsCount: 2,
          tokensPreview: [
            { category: "color", name: "surface", value: "oklch(0.98 0 0)" },
          ],
          uiComponents: [
            {
              name: "Button",
              dataSlot: "button",
              filePath: "packages/ui/src/button.tsx",
            },
          ],
        },
        valid: true,
      },
      {
        name: "DesignSystemContractInput rejeita maxMarkdownBytes < 512",
        schema: DesignSystemContractInputSchema,
        input: { projectId: VALID_UUID, maxMarkdownBytes: 100 },
        valid: false,
      },
      {
        name: "InspectPrototypeVersionInput & Output validam snapshot v1..vN",
        schema: InspectPrototypeVersionOutputSchema,
        input: {
          projectId: VALID_UUID,
          versions: [
            {
              prototypeId: VALID_UUID,
              versionNumber: 1,
              title: "Cockpit v1",
              level: 3,
              source: "native",
              approved: true,
              domSections: ["header", "decisions-table"],
              sanitizedHtmlSummary: "<main>...</main>",
              createdAt: VALID_ISO,
            },
          ],
          totalVersions: 1,
        },
        valid: true,
      },
      {
        name: "InspectPrototypeVersionInput rejeita versionLimit > 20",
        schema: InspectPrototypeVersionInputSchema,
        input: { projectId: VALID_UUID, versionLimit: 50 },
        valid: false,
      },
      {
        name: "ColorContrastValidationInput & Output validam contraste WCAG",
        schema: ColorContrastValidationOutputSchema,
        input: {
          allPassed: false,
          results: [
            {
              label: "muted-text",
              foreground: "#ffffff",
              background: "#f5f5f4",
              contrastRatio: 1.09,
              requiredRatio: 4.5,
              passed: false,
              formatDetected: "hex",
            },
          ],
          invalidTokens: [],
          hardcodedColorsDetected: ["#ffffff"],
        },
        valid: true,
      },
      {
        name: "ColorContrastValidationInput rejeita pairs vazio",
        schema: ColorContrastValidationInputSchema,
        input: { pairs: [] },
        valid: false,
      },
      {
        name: "SecurityFindingsQueryInput & Output validam paginação e filtros",
        schema: SecurityFindingsQueryOutputSchema,
        input: {
          projectId: VALID_UUID,
          totalMatching: 1,
          hasMore: false,
          findings: [validSecurityFinding],
          scannerStatuses: [
            {
              scanner: "semgrep",
              status: "executed",
              binaryName: "semgrep",
              findingsCount: 1,
              durationMs: 420,
            },
          ],
        },
        valid: true,
      },
      {
        name: "SecurityFindingsQueryInput rejeita limit > 100",
        schema: SecurityFindingsQueryInputSchema,
        input: { projectId: VALID_UUID, limit: 150 },
        valid: false,
      },
      {
        name: "DeliverableEvidenceReadInput & Output validam evidência e diff",
        schema: DeliverableEvidenceReadOutputSchema,
        input: {
          deliverableId: VALID_UUID,
          found: true,
          verifyAttempts: 1,
          verifyPassed: true,
          verifierVerdict: "approved",
          diffSummary: {
            filesChanged: 2,
            diffBytes: 1024,
            preview: "diff --git a/x b/x",
            fileDiffs: [
              {
                filePath: "packages/contracts/src/enums.ts",
                category: "code",
                additions: 5,
                deletions: 0,
                hunkPreview: "+export const X = 1;",
              },
            ],
            truncated: false,
          },
          testCommandOutput: "12 passed",
          redactedSecretsCount: 0,
        },
        valid: true,
      },
      {
        name: "DeliverableEvidenceReadInput rejeita maxDiffBytes < 512",
        schema: DeliverableEvidenceReadInputSchema,
        input: {
          projectId: VALID_UUID,
          deliverableId: VALID_UUID,
          maxDiffBytes: 100,
        },
        valid: false,
      },
      {
        name: "TestAntiPatternAuditInput & Output validam relatório de auditoria",
        schema: TestAntiPatternAuditOutputSchema,
        input: {
          passed: true,
          scannedFiles: 4,
          scannedTests: 22,
          suppressedCount: 0,
          violations: [],
        },
        valid: true,
      },
      {
        name: "TestAntiPatternAuditInput rejeita limit > 200",
        schema: TestAntiPatternAuditInputSchema,
        input: { projectId: VALID_UUID, limit: 500 },
        valid: false,
      },
      {
        name: "WorktreesAndLocksSnapshotInput & Output validam locks e worktrees",
        schema: WorktreesAndLocksSnapshotOutputSchema,
        input: {
          projectId: VALID_UUID,
          worktrees: [
            {
              deliverableId: VALID_UUID,
              branchName: "feat/slice-28",
              workspacePath: ".worktrees/task-1",
              isOrphan: false,
              status: "active",
            },
          ],
          activeSymbolLocks: [
            {
              symbolKey: "packages/core/src/agency.ts#Agency",
              ownerDeliverableId: VALID_UUID,
              acquiredAt: VALID_ISO,
              expiresAt: null,
            },
          ],
          queuedDeliverablesCount: 0,
        },
        valid: true,
      },
      {
        name: "WorktreesAndLocksSnapshotInput aplica defaults",
        schema: WorktreesAndLocksSnapshotInputSchema,
        input: { projectId: VALID_UUID },
        valid: true,
        check: (out: unknown) => {
          const parsed = WorktreesAndLocksSnapshotInputSchema.parse(out);
          expect(parsed.includeOrphansOnly).toBe(false);
          expect(parsed.limit).toBe(50);
        },
      },
      {
        name: "DistillRetrospectiveMemoryInput & Output validam memória destilada",
        schema: DistillRetrospectiveMemoryOutputSchema,
        input: {
          persisted: true,
          memoryId: VALID_UUID,
          scopeType: "project",
          category: "convention",
          title: "Sempre usar test.each em contratos",
          qmdReindexed: true,
        },
        valid: true,
      },
      {
        name: "DistillRetrospectiveMemoryInput rejeita content < 10 chars",
        schema: DistillRetrospectiveMemoryInputSchema,
        input: {
          projectId: VALID_UUID,
          category: "convention",
          title: "Título válido",
          content: "Curto",
        },
        valid: false,
      },
    ])("$name", ({ schema, input, valid, check }) => {
      const res = schema.safeParse(input);
      expect(res.success).toBe(valid);
      if (valid && check && res.success) {
        check(res.data);
      }
    });
  });

  describe("Slices 29, 30 e 31: handoffs-v2.ts", () => {
    test.each([
      {
        name: "ShapeSpecSchema aceita payload completo com nonGoals e BDD",
        schema: ShapeSpecSchema,
        input: VALID_SHAPE_SPEC,
        valid: true,
      },
      {
        name: "ShapeSpecSchema rejeita nonGoals vazio",
        schema: ShapeSpecSchema,
        input: { ...VALID_SHAPE_SPEC, nonGoals: [] },
        valid: false,
      },
      {
        name: "ShapeSpecSchema rejeita bddScenarios vazio",
        schema: ShapeSpecSchema,
        input: { ...VALID_SHAPE_SPEC, bddScenarios: [] },
        valid: false,
      },
      {
        name: "ShapeSpecSchema rejeita roleRequired inválido fora de OrgRoleSchema",
        schema: ShapeSpecSchema,
        input: {
          ...VALID_SHAPE_SPEC,
          bddScenarios: [
            {
              ...VALID_BDD_SCENARIO,
              roleRequired: "super_root",
            },
          ],
        },
        valid: false,
      },
      {
        name: "ArchitectBlueprintV2Schema aceita ADR, STRIDE/FMEA, Shards e OpenSpec",
        schema: ArchitectBlueprintV2Schema,
        input: VALID_BLUEPRINT_V2,
        valid: true,
      },
      {
        name: "ArchitectBlueprintV2Schema rejeita severity inválida em strideFmeaRisks",
        schema: ArchitectBlueprintV2Schema,
        input: {
          ...VALID_BLUEPRINT_V2,
          strideFmeaRisks: [
            {
              ...VALID_STRIDE_RISK,
              severity: "catastrophic",
            },
          ],
        },
        valid: false,
      },
      {
        name: "PrototypeComponentManifestSchema aceita os 5 estados e checklist WCAG",
        schema: PrototypeComponentManifestSchema,
        input: VALID_PROTOTYPE_MANIFEST,
        valid: true,
      },
      {
        name: "PrototypeComponentManifestSchema rejeita quando falta um dos 5 estados (ex: duplicado)",
        schema: PrototypeComponentManifestSchema,
        input: {
          ...VALID_PROTOTYPE_MANIFEST,
          sections: [
            {
              ...VALID_PROTOTYPE_SECTION,
              statesCovered: [
                "loading",
                "loading",
                "error",
                "partial",
                "populated",
              ],
            },
          ],
        },
        valid: false,
      },
      {
        name: "ScopedCheckResultSchema aceita diagnóstico tipado",
        schema: ScopedCheckResultSchema,
        input: {
          passed: false,
          command: "pnpm --filter @uzina/contracts typecheck",
          targetPackage: "@uzina/contracts",
          diagnostics: [
            {
              file: "packages/contracts/src/handoffs-v2.ts",
              line: 10,
              code: "TS2322",
              message: "Type mismatch",
            },
          ],
          durationMs: 850,
          truncatedOutput: "Found 1 error.",
        },
        valid: true,
      },
      {
        name: "MigrationSafetyIssueSchema & ReportSchema validam DDL destrutivo",
        schema: MigrationSafetyReportSchema,
        input: {
          passed: false,
          scannedFiles: ["packages/db/drizzle/0009_drop.sql"],
          issues: [
            MigrationSafetyIssueSchema.parse({
              severity: "blocking",
              rule: "no_drop_table",
              filePath: "packages/db/drizzle/0009_drop.sql",
              line: 2,
              statement: "DROP TABLE projects;",
              recommendation: "Usar Expand-Migrate-Contract antes de remover tabela.",
            }),
          ],
        },
        valid: true,
      },
      {
        name: "StuckAlertV2ExtensionSchema aceita strikeCount=2 com hipótese e escalação",
        schema: StuckAlertV2ExtensionSchema,
        input: {
          detected: true,
          pattern: "repeated_action_error",
          decisionType: "stuck_intervention",
          reason: "Mesmo erro TS2345 após 3 tentativas",
          evidenceTurns: [4, 5, 6],
          rootCauseHypothesis: "Schema Zod diverge do tipo inferido no adapter",
          strikeCount: 3,
          escalatedToArchitect: true,
        },
        valid: true,
      },
      {
        name: "StuckAlertV2ExtensionSchema rejeita strikeCount=0",
        schema: StuckAlertV2ExtensionSchema,
        input: {
          detected: true,
          pattern: "repeated_action_error",
          decisionType: "stuck_intervention",
          reason: "Erro",
          evidenceTurns: [1],
          strikeCount: 0,
          escalatedToArchitect: false,
        },
        valid: false,
      },
      {
        name: "SpecComplianceRowSchema aceita status missing com linhas nulas",
        schema: SpecComplianceRowSchema,
        input: {
          criterionId: "AC-02",
          criterionText: "Validar RBAC",
          testFile: null,
          testLine: null,
          sourceFile: null,
          sourceLine: null,
          status: "missing",
        },
        valid: true,
      },
      {
        name: "VerifierTwoStageOutputSchema aceita veredito completo e é compatível com VerifierVerdictOutputSchema",
        schema: VerifierTwoStageOutputSchema,
        input: VALID_VERIFIER_TWO_STAGE,
        valid: true,
      },
      {
        name: "VerifierTwoStageOutputSchema rejeita confidenceScore > 100",
        schema: VerifierTwoStageOutputSchema,
        input: { ...VALID_VERIFIER_TWO_STAGE, confidenceScore: 101 },
        valid: false,
      },
      {
        name: "DecisionRiskBriefingSchema aceita briefing completo",
        schema: DecisionRiskBriefingSchema,
        input: {
          riskLevel: "high",
          confidenceScore: 88,
          changedSurface: {
            dbMigrations: true,
            authOrRbac: true,
            cryptoOrSecrets: false,
            newDependencies: [],
            newEnvVars: ["NEW_FLAG"],
          },
          rollbackPlan: "Reverter PR e restaurar snapshot da migração.",
          finopsSummary: {
            tokensTotal: 18500,
            estimatedCostUsd: 0.19,
          },
        },
        valid: true,
      },
      {
        name: "DecisionRiskBriefingSchema rejeita riskLevel inválido",
        schema: DecisionRiskBriefingSchema,
        input: {
          riskLevel: "extreme",
          confidenceScore: 88,
          changedSurface: {
            dbMigrations: false,
            authOrRbac: false,
            cryptoOrSecrets: false,
            newDependencies: [],
            newEnvVars: [],
          },
          rollbackPlan: "Reverter commit.",
          finopsSummary: { tokensTotal: 100, estimatedCostUsd: 0.01 },
        },
        valid: false,
      },
    ])("$name", ({ schema, input, valid }) => {
      const res = schema.safeParse(input);
      expect(res.success).toBe(valid);
    });

    test("VerifierTwoStageOutput mantém compatibilidade estrutural com VerifierVerdictOutputSchema", () => {
      const twoStage = VerifierTwoStageOutputSchema.parse(
        VALID_VERIFIER_TWO_STAGE
      );
      const baseVerdict = VerifierVerdictOutputSchema.parse({
        verdict: twoStage.verdict,
        summary: twoStage.summary,
        issues: twoStage.issues,
      });
      expect(baseVerdict.verdict).toBe("approved");
      expect(baseVerdict.issues).toHaveLength(0);
    });
  });

  describe("Slice 32: agent-evals.ts", () => {
    const validByRole = {
      orchestrator: { runs: 4, avgTokens: 1200, avgLatencyMs: 900, failureRate: 0 },
      product_discovery: { runs: 3, avgTokens: 2100, avgLatencyMs: 1400, failureRate: 0 },
      software_architect: { runs: 5, avgTokens: 3200, avgLatencyMs: 2200, failureRate: 0.2 },
      ux_designer: { runs: 2, avgTokens: 1800, avgLatencyMs: 1300, failureRate: 0 },
      tech_lead: { runs: 6, avgTokens: 4500, avgLatencyMs: 3100, failureRate: 0.16 },
      qa_appsec: { runs: 5, avgTokens: 2800, avgLatencyMs: 1700, failureRate: 0 },
    };

    test.each([
      {
        name: "AgentTrajectoryEvalCaseSchema aceita caso válido para software_architect",
        schema: AgentTrajectoryEvalCaseSchema,
        input: {
          caseId: "eval-arch-01",
          title: "Arquiteto consulta grafo antes do plano",
          agentRole: "software_architect",
          requiredTools: ["trace_symbol_call_graph"],
          expectedToolOrder: ["trace_symbol_call_graph"],
        },
        valid: true,
      },
      {
        name: "AgentTrajectoryEvalCaseSchema rejeita agentRole desconhecido",
        schema: AgentTrajectoryEvalCaseSchema,
        input: {
          caseId: "eval-bad-role",
          title: "Papel inexistente",
          agentRole: "database_wizard",
          requiredTools: [],
        },
        valid: false,
      },
      {
        name: "AgentTrajectoryEvalResultSchema & ReportSchema validam execução de suíte",
        schema: AgentTrajectoryEvalReportSchema,
        input: {
          suiteName: "ci-trajectory-gates",
          executedAt: VALID_ISO,
          passed: true,
          totalCases: 1,
          passedCases: 1,
          failedCases: 0,
          results: [
            AgentTrajectoryEvalResultSchema.parse({
              caseId: "eval-arch-01",
              agentRole: "software_architect",
              passed: true,
              calledRequiredTools: ["trace_symbol_call_graph"],
              forbiddenToolsCalled: [],
              noToolErrors: true,
              toolOrderRespected: true,
              testLockRespected: true,
              specTraceabilityComplete: true,
              budgetWithinCap: true,
              durationMs: 42,
            }),
          ],
        },
        valid: true,
      },
      {
        name: "AgentEffectivenessMetricsSchema aceita métricas completas por papel",
        schema: AgentEffectivenessMetricsSchema,
        input: {
          firstPassVerifyRate: 85.5,
          averageVerifyAttempts: 1.15,
          skillAdherenceRate: 96,
          averageConfidenceScore: 91.2,
          reworkCostUsd: 0.45,
          byRole: validByRole,
        },
        valid: true,
      },
      {
        name: "AgentEffectivenessMetricsSchema rejeita byRole incompleto (faltando qa_appsec)",
        schema: AgentEffectivenessMetricsSchema,
        input: {
          firstPassVerifyRate: 85.5,
          averageVerifyAttempts: 1.15,
          skillAdherenceRate: 96,
          averageConfidenceScore: 91.2,
          reworkCostUsd: 0.45,
          byRole: {
            orchestrator: validByRole.orchestrator,
            product_discovery: validByRole.product_discovery,
            software_architect: validByRole.software_architect,
            ux_designer: validByRole.ux_designer,
            tech_lead: validByRole.tech_lead,
          },
        },
        valid: false,
      },
    ])("$name", ({ schema, input, valid }) => {
      expect(schema.safeParse(input).success).toBe(valid);
    });
  });

  describe("Slice 33: security-v2.ts", () => {
    test.each([
      {
        name: "DastHeaderCheckSchema & DastPassiveReportSchema validam headers HTTP",
        schema: DastPassiveReportSchema,
        input: {
          targetUrl: "https://staging.example.com",
          statusCode: 200,
          executed: true,
          status: "executed",
          headers: [
            DastHeaderCheckSchema.parse({
              header: "Content-Security-Policy",
              present: false,
              value: null,
              status: "missing",
              severity: "medium",
              recommendation: "Configurar header Content-Security-Policy.",
            }),
          ],
          corsIssues: ["Access-Control-Allow-Origin: * com credentials"],
          cookieIssues: [],
          nucleiFindingsCount: 0,
          durationMs: 310,
        },
        valid: true,
      },
      {
        name: "DastPassiveReportSchema rejeita targetUrl com protocolo ftp://",
        schema: DastPassiveReportSchema,
        input: {
          targetUrl: "ftp://staging.example.com",
          statusCode: null,
          executed: false,
          status: "failed",
          headers: [],
          durationMs: 10,
        },
        valid: false,
      },
      {
        name: "SbomDocumentSummarySchema & SbomComponentSchema validam CycloneDX 1.5",
        schema: SbomDocumentSummarySchema,
        input: {
          bomFormat: "CycloneDX",
          specVersion: "1.5",
          serialNumber: `urn:uuid:${VALID_UUID}`,
          generatedAt: VALID_ISO,
          generator: "uzina-sbom-native",
          totalComponents: 1,
          componentsSample: [
            SbomComponentSchema.parse({
              name: "zod",
              version: "4.6.7",
              purl: "pkg:npm/zod@4.6.7",
              license: "MIT",
              scope: "required",
            }),
          ],
          sha256: VALID_SHA256,
        },
        valid: true,
      },
      {
        name: "SbomDocumentSummarySchema rejeita sha256 curto",
        schema: SbomDocumentSummarySchema,
        input: {
          bomFormat: "CycloneDX",
          specVersion: "1.5",
          serialNumber: `urn:uuid:${VALID_UUID}`,
          generatedAt: VALID_ISO,
          generator: "uzina-sbom-native",
          totalComponents: 0,
          componentsSample: [],
          sha256: "abc123",
        },
        valid: false,
      },
      {
        name: "ScaReachabilityAnnotationSchema valida reachability + EPSS/KEV",
        schema: ScaReachabilityAnnotationSchema,
        input: {
          findingFingerprint: VALID_SHA256,
          packageName: "lodash",
          reachability: "unreachable",
          importedInFiles: [],
          epssScore: 0.04,
          inCisaKev: false,
          rationale: "Dependência apenas de devDependencies sem import em src/.",
        },
        valid: true,
      },
      {
        name: "ScaReachabilityAnnotationSchema rejeita epssScore > 1",
        schema: ScaReachabilityAnnotationSchema,
        input: {
          findingFingerprint: VALID_SHA256,
          packageName: "lodash",
          reachability: "reachable",
          epssScore: 1.5,
          rationale: "Score inválido",
        },
        valid: false,
      },
      {
        name: "AgenticPromptInjectionFindingSchema valida detecção em workflow CI",
        schema: AgenticPromptInjectionFindingSchema,
        input: {
          ruleId: "uzina.ci.script-injection",
          category: "ci_script_injection",
          severity: "critical",
          filePath: ".github/workflows/ci.yml",
          line: 24,
          matchedSnippet: "echo ${{ github.event.issue.title }}",
          message: "Possível injeção de script via contexto não confiável.",
        },
        valid: true,
      },
    ])("$name", ({ schema, input, valid }) => {
      expect(schema.safeParse(input).success).toBe(valid);
    });
  });

  describe("Slice 34: governance-v2.ts", () => {
    test.each([
      {
        name: "VisualA11yVerifyReportSchema aceita relatório multi-viewport aprovado",
        schema: VisualA11yVerifyReportSchema,
        input: {
          executed: true,
          status: "passed",
          viewports: ["1440x900", "390x844"],
          consoleErrors: [],
          horizontalOverflowPx: 0,
          axeViolations: [],
        },
        valid: true,
      },
      {
        name: "VisualA11yVerifyReportSchema rejeita viewports vazio",
        schema: VisualA11yVerifyReportSchema,
        input: {
          executed: false,
          status: "skipped_missing_binary",
          viewports: [],
          consoleErrors: [],
          horizontalOverflowPx: 0,
          axeViolations: [],
        },
        valid: false,
      },
      {
        name: "SkillsLockManifestSchema & SkillsLockEntrySchema validam lockVersion=1 e SHA-256",
        schema: SkillsLockManifestSchema,
        input: {
          lockVersion: 1,
          skills: [
            SkillsLockEntrySchema.parse({
              name: "discovery-interview",
              source: "packages/skills/discovery-interview",
              version: "2.0.0",
              license: "Apache-2.0",
              sha256: VALID_SHA256,
              verified: true,
              enabled: true,
            }),
          ],
        },
        valid: true,
      },
      {
        name: "SkillsLockManifestSchema rejeita lockVersion != 1 e nome fora de kebab-case",
        schema: SkillsLockManifestSchema,
        input: {
          lockVersion: 2,
          skills: [
            {
              name: "Bad_Skill_Name",
              source: "local",
              version: "2.0.0",
              license: "Apache-2.0",
              sha256: VALID_SHA256,
              verified: true,
              enabled: true,
            },
          ],
        },
        valid: false,
      },
      {
        name: "EntropyAuditReportSchema aceita auditoria de código morto, drift e worktrees órfãos",
        schema: EntropyAuditReportSchema,
        input: {
          deadCodeCandidates: [
            {
              symbol: "legacyHelper",
              filePath: "packages/core/src/legacy.ts",
              line: 14,
            },
          ],
          docSpecDrifts: [
            {
              specPath: "docs/slices/slice-10.md",
              missingTarget: "packages/core/src/old.ts",
              detail: "Arquivo citado na spec não existe mais",
            },
          ],
          orphanWorktrees: [
            {
              workspacePath: ".worktrees/task-99",
              branchName: "feat/old-task",
              deliverableId: null,
            },
          ],
          unusedDependencies: [
            { packageName: "@uzina/core", dependencyName: "unused-pkg" },
          ],
        },
        valid: true,
      },
      {
        name: "MutationPbtReportSchema aceita relatório PBT + Stryker",
        schema: MutationPbtReportSchema,
        input: {
          pbtExecuted: true,
          pbtCasesRun: 100,
          pbtPassed: true,
          mutationStatus: "executed",
          mutationScorePercent: 87.5,
          killedMutants: 35,
          survivedMutants: 5,
          targetFiles: ["packages/core/src/stuck-detector.ts"],
        },
        valid: true,
      },
      {
        name: "MutationPbtReportSchema rejeita mutationScorePercent > 100",
        schema: MutationPbtReportSchema,
        input: {
          pbtExecuted: true,
          pbtCasesRun: 10,
          pbtPassed: true,
          mutationStatus: "executed",
          mutationScorePercent: 120,
        },
        valid: false,
      },
    ])("$name", ({ schema, input, valid }) => {
      expect(schema.safeParse(input).success).toBe(valid);
    });
  });
});
