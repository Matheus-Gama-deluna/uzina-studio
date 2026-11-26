import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DecisionRiskBriefingSchema,
  VerifierTwoStageOutputSchema,
  type SemanticDiffFile,
} from "@uzina/contracts";
import {
  clients,
  closeDb,
  deliverables,
  ensureDefaultOrgAndInternalClient,
  getDb,
  memories,
  memoryChunks,
  projects,
  type UzinaDb,
} from "@uzina/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  createGitHubDraftPrViaApi,
  renderDraftPrBodyWithRiskBriefing,
} from "../src/github-pr.js";
import { searchQmdScoped } from "../src/qmd.js";
import {
  computeDecisionRiskBriefing,
  distillRetrospectiveToQmd,
  evaluateTwoStageVerifier,
  syncOpenSpecArchive,
} from "../src/stages/two-stage-verifier.js";

describe("@uzina/mastra-runtime — Slice 31 (Two-Stage Verifier, Risk Briefing, Retro QMD & OpenSpec Sync)", () => {
  let db: UzinaDb;
  let organizationId: string;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    await closeDb();
    const ctx = await getDb({ dataDir: ":memory:" });
    db = ctx.db;
    const seeded = await ensureDefaultOrgAndInternalClient(db);
    organizationId = seeded.organizationId;
  });

  afterAll(async () => {
    await closeDb();
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  async function seedProjectAndDeliverable(title: string) {
    const suffix = crypto.randomUUID().slice(0, 8);
    const [client] = await db
      .insert(clients)
      .values({
        organizationId,
        name: `Client ${suffix}`,
        slug: `client-${suffix}`,
      })
      .returning();

    const [proj] = await db
      .insert(projects)
      .values({
        clientId: client!.id,
        name: `Proj ${suffix}`,
        slug: `proj-${suffix}`,
      })
      .returning();

    const [deliv] = await db
      .insert(deliverables)
      .values({
        projectId: proj!.id,
        title,
        description: "Entrega de teste Slice 31",
      })
      .returning();

    return { projectId: proj!.id, deliverableId: deliv!.id };
  }

  test("evaluateTwoStageVerifier reprova com short-circuit imediato quando Estágio 1 detecta critério missing", async () => {
    let stage2Called = false;

    const output = await evaluateTwoStageVerifier({
      deliverableTitle: "Exportação CSV com RBAC",
      specMarkdown: [
        "## Critérios de Aceite",
        "- Gerar relatório CSV paginado",
        "- Bloquear acesso para role auditor sem permissão",
      ].join("\n"),
      semanticDiffs: [],
      verifyChecks: [],
      evaluator: {
        async evaluateStage2() {
          stage2Called = true;
          return { passed: true };
        },
      },
    });

    expect(VerifierTwoStageOutputSchema.safeParse(output).success).toBe(true);
    expect(stage2Called).toBe(false);
    expect(output.verdict).toBe("changes_required");
    expect(output.stage1SpecCompliance.passed).toBe(false);
    expect(output.stage1SpecCompliance.matrix.some((r) => r.status === "missing")).toBe(
      true
    );
    expect(output.stage2QualityAndSecurity.passed).toBe(false);
    expect(output.confidenceScore).toBeLessThanOrEqual(45);
    expect(output.issues.some((i) => i.severity === "blocker")).toBe(true);
  });

  test("evaluateTwoStageVerifier executa Estágio 2 quando Estágio 1 passa, detectando bloqueio AppSec e aprovando entrega limpa", async () => {
    const diffs: SemanticDiffFile[] = [
      {
        filePath: "src/billing/invoice.ts",
        category: "code",
        additions: 12,
        deletions: 1,
        hunkPreview:
          "@@ -1,3 +1,12 @@\n+export function calcTotal(amount: number) {\n+  if (amount >= 0) return amount;\n+  return 0;\n+}",
      },
      {
        filePath: "tests/invoice.test.ts",
        category: "test",
        additions: 10,
        deletions: 0,
        hunkPreview:
          "@@ -1,1 +1,10 @@\n+test('calcTotal calcula valor', () => { expect(calcTotal(10)).toBe(10); });",
      },
    ];

    const cleanResult = await evaluateTwoStageVerifier({
      deliverableTitle: "Cálculo de Fatura",
      specMarkdown: "## Critérios\n- Calcular total da fatura corretamente",
      semanticDiffs: diffs,
      verifyChecks: [
        { name: "vitest", passed: true, durationMs: 120, summary: "2/2 passed" },
      ],
      testAuditReport: {
        passed: true,
        scannedFiles: 1,
        scannedTests: 2,
        suppressedCount: 0,
        violations: [],
      },
      securitySummary: {
        scanId: null,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
        scannersRun: ["native_secrets"],
        skippedScanners: [],
        gatePassed: true,
      },
    });

    expect(VerifierTwoStageOutputSchema.safeParse(cleanResult).success).toBe(
      true
    );
    expect(cleanResult.verdict).toBe("approved");
    expect(cleanResult.stage1SpecCompliance.passed).toBe(true);
    expect(cleanResult.stage2QualityAndSecurity.passed).toBe(true);
    expect(cleanResult.confidenceScore).toBeGreaterThanOrEqual(85);
    expect(
      cleanResult.stage2QualityAndSecurity.refutingChecksPerformed.length
    ).toBeGreaterThanOrEqual(2);

    const blockedResult = await evaluateTwoStageVerifier({
      deliverableTitle: "Cálculo de Fatura",
      specMarkdown: "## Critérios\n- Calcular total da fatura corretamente",
      semanticDiffs: diffs,
      verifyChecks: [
        { name: "vitest", passed: true, durationMs: 120, summary: "2/2 passed" },
      ],
      sarifFindings: [
        {
          ruleId: "uzina/native-secret-api-key",
          severity: "high",
          title: "Chave exposta",
          filePath: "src/billing/invoice.ts",
          triageVerdict: "confirmed",
          suppressedInMemory: false,
        },
      ],
    });

    expect(blockedResult.verdict).toBe("changes_required");
    expect(blockedResult.stage2QualityAndSecurity.passed).toBe(false);
    expect(
      blockedResult.issues.some((i) => i.message.includes("uzina/native-secret-api-key"))
    ).toBe(true);
  });

  test.each([
    {
      name: "detecta migração SQL Drizzle como risco alto",
      diffs: [
        {
          filePath: "packages/db/drizzle/0012_audit_log.sql",
          category: "code" as const,
          additions: 8,
          deletions: 0,
          hunkPreview:
            "@@ -0,0 +1,4 @@\n+ALTER TABLE deliverables ADD COLUMN risk_score integer DEFAULT 0;",
        },
      ],
      confidenceScore: 90,
      expectedRisk: "high" as const,
      expectedDb: true,
      expectedAuth: false,
      expectedCrypto: false,
      expectedDeps: [] as string[],
      expectedEnvs: [] as string[],
    },
    {
      name: "detecta alteração em auth/RBAC e cofre AES-256-GCM como risco alto",
      diffs: [
        {
          filePath: "packages/core/src/vault.ts",
          category: "code" as const,
          additions: 6,
          deletions: 2,
          hunkPreview:
            "@@ -10,2 +10,6 @@\n+const cipher = createCipheriv('aes-256-gcm', key, iv);",
        },
        {
          filePath: "apps/web/src/lib/auth-guard.ts",
          category: "code" as const,
          additions: 4,
          deletions: 0,
          hunkPreview:
            "@@ -1,1 +1,4 @@\n+export function requireRole(role: OrgRole) { return role; }",
        },
      ],
      confidenceScore: 88,
      expectedRisk: "high" as const,
      expectedDb: false,
      expectedAuth: true,
      expectedCrypto: true,
      expectedDeps: [] as string[],
      expectedEnvs: [] as string[],
    },
    {
      name: "detecta nova dependência em package.json e nova variável de ambiente como risco médio",
      diffs: [
        {
          filePath: "apps/web/package.json",
          category: "config" as const,
          additions: 1,
          deletions: 0,
          hunkPreview: '@@ -10,0 +10,1 @@\n+    "stripe": "17.0.0",',
        },
        {
          filePath: "apps/web/src/lib/billing.ts",
          category: "code" as const,
          additions: 2,
          deletions: 0,
          hunkPreview:
            "@@ -1,0 +1,2 @@\n+const wh = process.env.STRIPE_WEBHOOK_SECRET;",
        },
      ],
      confidenceScore: 92,
      expectedRisk: "medium" as const,
      expectedDb: false,
      expectedAuth: false,
      expectedCrypto: false,
      expectedDeps: ["stripe"],
      expectedEnvs: ["STRIPE_WEBHOOK_SECRET"],
    },
    {
      name: "classifica alteração isolada de UI/docs com alta confiança como risco baixo",
      diffs: [
        {
          filePath: "docs/guides/onboarding.md",
          category: "docs" as const,
          additions: 5,
          deletions: 1,
          hunkPreview: "@@ -1,1 +1,5 @@\n+## Guia atualizado",
        },
      ],
      confidenceScore: 95,
      expectedRisk: "low" as const,
      expectedDb: false,
      expectedAuth: false,
      expectedCrypto: false,
      expectedDeps: [] as string[],
      expectedEnvs: [] as string[],
    },
  ])(
    "computeDecisionRiskBriefing: $name",
    ({
      diffs,
      confidenceScore,
      expectedRisk,
      expectedDb,
      expectedAuth,
      expectedCrypto,
      expectedDeps,
      expectedEnvs,
    }) => {
      const briefing = computeDecisionRiskBriefing({
        semanticDiffs: diffs,
        confidenceScore,
        tokensTotal: 4200,
        estimatedCostUsd: 0.0145,
      });

      expect(DecisionRiskBriefingSchema.safeParse(briefing).success).toBe(true);
      expect(briefing.riskLevel).toBe(expectedRisk);
      expect(briefing.changedSurface.dbMigrations).toBe(expectedDb);
      expect(briefing.changedSurface.authOrRbac).toBe(expectedAuth);
      expect(briefing.changedSurface.cryptoOrSecrets).toBe(expectedCrypto);
      expect(briefing.changedSurface.newDependencies).toEqual(expectedDeps);
      expect(briefing.changedSurface.newEnvVars).toEqual(expectedEnvs);
      expect(briefing.finopsSummary.tokensTotal).toBe(4200);
      expect(briefing.rollbackPlan.length).toBeGreaterThan(10);
    }
  );

  test("distillRetrospectiveToQmd grava memória QMD após rejeição humana com feedback e após verifyAttempts >= 2", async () => {
    const { projectId, deliverableId } = await seedProjectAndDeliverable(
      "Endpoint de Download Seguro"
    );

    const skipped = await distillRetrospectiveToQmd(db, {
      organizationId,
      projectId,
      deliverableId,
      deliverableTitle: "Endpoint de Download Seguro",
      verifyAttempts: 1,
      decision: "approved",
    });
    expect(skipped.distilled).toBe(false);
    expect(skipped.reason).toBe("trigger_not_met");

    const securityRetro = await distillRetrospectiveToQmd(db, {
      organizationId,
      projectId,
      deliverableId,
      deliverableTitle: "Endpoint de Download Seguro",
      verifyAttempts: 1,
      decision: "rejected",
      feedback: "Faltou validar RBAC de tenant e proteção contra SSRF no download.",
    });

    expect(securityRetro.distilled).toBe(true);
    expect(securityRetro.category).toBe("security_triage");
    expect(securityRetro.memory?.scopeId).toBe(projectId);

    const reworkRetro = await distillRetrospectiveToQmd(db, {
      organizationId,
      projectId,
      deliverableId,
      deliverableTitle: "Endpoint de Download Seguro",
      verifyAttempts: 2,
      failureReasons: ["Teste unitário de paginação falhou na tentativa 1"],
    });

    expect(reworkRetro.distilled).toBe(true);
    expect(reworkRetro.category).toBe("convention");

    const savedMemories = await db
      .select()
      .from(memories)
      .where(eq(memories.scopeId, projectId));
    expect(savedMemories).toHaveLength(2);

    const savedChunks = await db
      .select()
      .from(memoryChunks)
      .where(eq(memoryChunks.scopeId, projectId));
    expect(savedChunks.length).toBeGreaterThanOrEqual(2);

    const qmdRes = await searchQmdScoped(db, {
      organizationId,
      request: {
        projectId,
        query: "SSRF RBAC paginação",
        mode: "hybrid",
        limit: 5,
      },
    });
    expect(qmdRes.hits.length).toBeGreaterThanOrEqual(1);
  });

  test("syncOpenSpecArchive aplica delta ADDED/MODIFIED/REMOVED no OPENSPEC.md e indexa em QMD pós-merge", async () => {
    const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-openspec-"));
    tempDirs.push(tmpWorkspace);
    const { projectId, deliverableId } = await seedProjectAndDeliverable(
      "Autenticação MFA"
    );

    const specDir = path.join(tmpWorkspace, ".uzina");
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(
      path.join(specDir, "OPENSPEC.md"),
      [
        "# OpenSpec Vivo do Projeto",
        "",
        "## Capacidades Ativas (Live Spec)",
        "- Login por email e senha legado",
        "- Sessão HTTP-only com cookie seguro",
        "",
        "## Capacidades Removidas / Depreciadas",
        "- (Nenhuma remoção registrada)",
      ].join("\n"),
      "utf8"
    );

    const syncRes = await syncOpenSpecArchive({
      deliverableId,
      deliverableTitle: "Autenticação MFA",
      workspaceRoot: tmpWorkspace,
      delta: {
        added: ["Suporte a TOTP MFA no login"],
        modified: ["Sessão HTTP-only com expiração deslizante de 7 dias"],
        removed: ["Login por email e senha legado"],
      },
      mergedAt: new Date("2026-11-25T15:00:00.000Z"),
      db,
      organizationId,
      projectId,
    });

    expect(syncRes.updated).toBe(true);
    expect(syncRes.appliedCounts).toEqual({
      added: 1,
      modified: 1,
      removed: 1,
    });
    expect(syncRes.memoryId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );

    const written = fs.readFileSync(
      path.join(tmpWorkspace, ".uzina", "OPENSPEC.md"),
      "utf8"
    );
    expect(written).toContain("Suporte a TOTP MFA no login");
    expect(written).toContain("Sessão HTTP-only com expiração deslizante de 7 dias");
    expect(written).toContain("## Capacidades Removidas / Depreciadas\n- Login por email e senha legado");
    expect(written).toContain("## Histórico de Deltas Arquivados");
  });

  test("github-pr renderiza Risk Briefing, Confidence Score e plano de rollback no Draft PR sem vazar PAT", async () => {
    const briefing = computeDecisionRiskBriefing({
      semanticDiffs: [
        {
          filePath: "packages/db/drizzle/0013_idx.sql",
          category: "code",
          additions: 2,
          deletions: 0,
          hunkPreview: "+CREATE INDEX CONCURRENTLY idx_test ON deliverables(id);",
        },
      ],
      confidenceScore: 91,
      tokensTotal: 1500,
      estimatedCostUsd: 0.0042,
    });

    const rendered = renderDraftPrBodyWithRiskBriefing({
      deliverableTitle: "Índice de performance",
      verifyAttempts: 1,
      riskBriefing: briefing,
      specMatrix: [
        {
          criterionId: "AC-1",
          criterionText: "Criar índice sem lock",
          testFile: "tests/idx.test.ts",
          testLine: 12,
          sourceFile: "packages/db/drizzle/0013_idx.sql",
          sourceLine: 1,
          status: "covered",
        },
      ],
    });

    expect(rendered).toContain("Confidence Score:** **91/100**");
    expect(rendered).toContain("[x] Migrações de Banco de Dados");
    expect(rendered).toContain("Plano de Rollback");
    expect(rendered).toContain("AC-1");

    const fakePat = "ghp_secretpat1234567890abcdefghijklmnop";
    let capturedBody = "";
    const prRes = await createGitHubDraftPrViaApi({
      owner: "uzina-org",
      repo: "uzina-app",
      head: "feat/idx",
      base: "main",
      title: "[Uzina] Índice",
      body: `Resumo da entrega com segredo ${fakePat}`,
      pat: fakePat,
      riskBriefing: briefing,
      fetchImpl: async (_url, init) => {
        const payload = JSON.parse(String(init?.body ?? "{}")) as {
          body?: string;
        };
        capturedBody = payload.body ?? "";
        return new Response(
          JSON.stringify({
            html_url: "https://github.com/uzina-org/uzina-app/pull/42",
            number: 42,
          }),
          { status: 201, headers: { "content-type": "application/json" } }
        );
      },
    });

    expect(prRes.ok).toBe(true);
    expect(prRes.number).toBe(42);
    expect(capturedBody).not.toContain(fakePat);
    expect(capturedBody).toContain("Confidence Score:** **91/100**");
    expect(capturedBody).toContain("Plano de Rollback");
  });
});
