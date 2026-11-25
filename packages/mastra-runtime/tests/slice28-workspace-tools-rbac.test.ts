import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MessageList } from "@mastra/core/agent";
import { RequestContext } from "@mastra/core/request-context";
import { MastraLanguageModelV2Mock, simulateReadableStream } from "@mastra/core/test-utils/llm-mock";
import {
  EvidencePackSchema,
  type AgencyAgentRole,
  type OrgRole,
} from "@uzina/contracts";
import { encryptSecret, parseMasterKeyBuffer } from "@uzina/core";
import {
  clients,
  closeDb,
  codebaseEdges,
  codebaseFiles,
  codebaseSymbols,
  deliverables,
  designAssets,
  designPrototypes,
  ensureDefaultOrgAndInternalClient,
  executionEvents,
  getDb,
  organizations,
  projectRepositories,
  projects,
  providerProfiles,
  securityFindings,
  securityScans,
  users,
  type UzinaDb,
} from "@uzina/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  CONTROLLER_MODE_TOOLS,
  SymbolLockManager,
  createEngineeringSpecialistAgent,
  createExecutiveCopilotAgent,
  createMemoryScoped,
  createRoleSpecializedToolsMap,
  createUzinaSkillsCatalogProcessor,
  createWorkspaceToolsForRole,
  getControllerBackingAgent,
  getOrCreateUzinaAgentController,
  resetAgentControllerForTests,
  resetMastraStorageForTests,
} from "../src/index.js";

function createMockModel() {
  const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
  return new MastraLanguageModelV2Mock({
    provider: "mock-s28",
    modelId: "mock-s28-model",
    doGenerate: async () => ({
      content: [{ type: "text", text: "OK" }],
      finishReason: "stop",
      usage,
      warnings: [],
      rawCall: { rawPrompt: null, rawSettings: {} },
      request: { body: {} },
      response: { headers: {} },
      stream: simulateReadableStream({ chunks: [] }),
    }),
    doStream: async () => ({
      rawCall: { rawPrompt: null, rawSettings: {} },
      warnings: [],
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "OK" },
          { type: "text-end", id: "t1" },
          { type: "finish", finishReason: "stop", usage },
        ],
      }),
    }),
  });
}

function makeRc(actor: {
  organizationId: string;
  userId: string;
  role: OrgRole;
}) {
  const rc = new RequestContext();
  rc.set("actor", actor);
  return rc;
}

function hasToolSearchProcessor(
  procs: ReadonlyArray<{ id?: string; steps?: unknown }>
): boolean {
  return procs.some(
    (p) =>
      p.id === "tool-search" ||
      (p.steps !== null &&
        typeof p.steps === "object" &&
        "processor:tool-search" in p.steps)
  );
}

describe("Slice 28 — 14 Tools Especializadas, RBAC, Controller Least-Privilege & Skills", () => {
  let db: UzinaDb;
  let orgAId: string;
  let orgBId: string;
  let userAId: string;
  let userBId: string;
  let projectAId: string;
  let projectBId: string;
  let deliverableAId: string;
  let deliverableBId: string;
  let repoAId: string;
  let prototypeAId: string;
  let scanAId: string;
  let masterKey: Buffer;
  let tempWorkspaceA: string;
  let tempSkillsDir: string;
  let dataDirA: string;
  const rawSecretA = "sk-orgA-slice28-super-secret-value-98765";
  const symbolLockManager = new SymbolLockManager();

  beforeAll(async () => {
    await resetAgentControllerForTests();
    await resetMastraStorageForTests();
    await closeDb();

    const ctx = await getDb({ dataDir: ":memory:" });
    db = ctx.db;
    const seeded = await ensureDefaultOrgAndInternalClient(db);
    orgAId = seeded.organizationId;
    masterKey = parseMasterKeyBuffer(crypto.randomBytes(32).toString("hex"));

    const [userA] = await db
      .insert(users)
      .values({
        name: "Dev A S28",
        email: `dev-a-s28-${crypto.randomUUID().slice(0, 6)}@uzina.local`,
        organizationId: orgAId,
        role: "developer",
      })
      .returning();
    userAId = userA!.id;

    const encA = encryptSecret({
      plaintext: rawSecretA,
      masterKey,
      organizationId: orgAId,
      providerType: "openai_compatible",
    });
    await db.insert(providerProfiles).values({
      organizationId: orgAId,
      name: "Provider A S28",
      providerType: "openai_compatible",
      baseUrl: "https://api.example.test/v1",
      encryptedApiKey: encA,
      isDefault: true,
      roleBindingsJson: {
        architect: { modelId: "openai/gpt-4o" },
      },
    });

    tempWorkspaceA = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-s28-ws-"));
    dataDirA = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-s28-data-"));
    tempSkillsDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-s28-skills-"));

    // Estrutura de workspace A (código, .env, .master-key, DESIGN.md, packages/ui e testes)
    fs.mkdirSync(path.join(tempWorkspaceA, "src"), { recursive: true });
    fs.mkdirSync(path.join(tempWorkspaceA, ".uzina"), { recursive: true });
    fs.mkdirSync(path.join(tempWorkspaceA, "packages", "ui", "src"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(tempWorkspaceA, "tests"), { recursive: true });

    fs.writeFileSync(
      path.join(tempWorkspaceA, ".env"),
      `API_KEY=${rawSecretA}\n`,
      "utf8"
    );
    fs.writeFileSync(
      path.join(tempWorkspaceA, ".master-key"),
      "0".repeat(64),
      "utf8"
    );
    fs.writeFileSync(
      path.join(tempWorkspaceA, "src", "billing.ts"),
      [
        "export function calculateInvoiceTotal(amount: number): number {",
        `  const debugToken = "${rawSecretA}";`,
        "  if (debugToken.length === 0) return 0;",
        "  return Math.round(amount * 100) / 100;",
        "}",
        "export function helperUnused(): string {",
        '  return "ok";',
        "}",
      ].join("\n"),
      "utf8"
    );
    fs.writeFileSync(
      path.join(tempWorkspaceA, ".uzina", "DESIGN.md"),
      [
        "# DESIGN.md — Projeto A",
        "| `--bg-canvas` | `oklch(0.13 0.006 260)` |",
        "| `--fg-primary` | `oklch(0.96 0.004 260)` |",
      ].join("\n"),
      "utf8"
    );
    fs.writeFileSync(
      path.join(tempWorkspaceA, "packages", "ui", "src", "button.tsx"),
      'export function Button() { return <button data-slot="button" type="button" />; }\n',
      "utf8"
    );
    fs.writeFileSync(
      path.join(tempWorkspaceA, "tests", "bad.test.ts"),
      [
        'import { describe, test, expect } from "vitest";',
        'describe("bad", () => {',
        '  test("empty test without assertions", () => {',
        "    const x = 1 + 1;",
        "  });",
        "});",
      ].join("\n"),
      "utf8"
    );

    const [projA] = await db
      .insert(projects)
      .values({
        clientId: seeded.internalClientId,
        name: "Projeto Alpha S28",
        slug: `proj-a-s28-${Date.now()}`,
        budgetCapUsd: "100.000000",
        designMdPath: ".uzina/DESIGN.md",
      })
      .returning();
    projectAId = projA!.id;

    const [repoA] = await db
      .insert(projectRepositories)
      .values({
        projectId: projectAId,
        name: "repo-a",
        localPath: tempWorkspaceA,
        defaultBranch: "main",
      })
      .returning();
    repoAId = repoA!.id;

    // Popula grafo AST mínimo no DB para trace_symbol_call_graph e analyze_change_impact
    const [fileBilling] = await db
      .insert(codebaseFiles)
      .values({
        repositoryId: repoAId,
        path: "src/billing.ts",
        sha256: "a".repeat(64),
        language: "typescript",
        size: 240,
      })
      .returning();
    const [fileRoute] = await db
      .insert(codebaseFiles)
      .values({
        repositoryId: repoAId,
        path: "src/routes/checkout.ts",
        sha256: "b".repeat(64),
        language: "typescript",
        size: 180,
      })
      .returning();

    const [symCalc] = await db
      .insert(codebaseSymbols)
      .values({
        fileId: fileBilling!.id,
        kind: "function",
        name: "calculateInvoiceTotal",
        signature: "export function calculateInvoiceTotal(amount: number): number",
        lineStart: 1,
        lineEnd: 5,
        exported: true,
      })
      .returning();
    const [symRoute] = await db
      .insert(codebaseSymbols)
      .values({
        fileId: fileRoute!.id,
        kind: "route",
        name: "POST_checkout",
        signature: "export async function POST_checkout(req: Request)",
        lineStart: 1,
        lineEnd: 10,
        exported: true,
      })
      .returning();
    await db.insert(codebaseEdges).values({
      fromSymbolId: symRoute!.id,
      toSymbolId: symCalc!.id,
      relation: "calls",
    });

    // Memória de regra de domínio para check_requirement_conflicts
    await createMemoryScoped(db, {
      organizationId: orgAId,
      input: {
        scopeType: "project",
        scopeId: projectAId,
        category: "domain_rule",
        title: "Regra obrigatória de cobrança idempotente",
        content:
          "Todo pagamento de checkout e faturamento deve exigir Idempotency-Key obrigatório e nunca duplicar cobrança.",
      },
    });

    // Entregável A com EvidencePack e segredo para testar redação
    const validEvidence = EvidencePackSchema.parse({
      deliverableId: crypto.randomUUID(),
      branchName: "uzina/feat-billing",
      baseBranch: "main",
      verifyAttempts: 2,
      verifyPassed: true,
      verifyChecks: [
        { name: "typecheck", passed: true, durationMs: 420, summary: "ok" },
      ],
      testAuditPassed: true,
      testAuditViolationsCount: 0,
      diffSummary: {
        filesChanged: 1,
        diffBytes: 120,
        preview: `--- a/src/billing.ts\n+++ b/src/billing.ts\n+const key = "${rawSecretA}";`,
        fileDiffs: [
          {
            filePath: "src/billing.ts",
            category: "code",
            additions: 2,
            deletions: 0,
            hunkPreview: `+const key = "${rawSecretA}";`,
          },
        ],
      },
      testCommandOutput: `PASS tests/billing.test.ts (secret=${rawSecretA})`,
      securitySummary: {
        scanId: null,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
        scannersRun: ["gitleaks"],
        skippedScanners: [],
        gatePassed: true,
      },
      tokenSummary: {
        totalInputTokens: 1200,
        totalOutputTokens: 300,
        totalCacheReadTokens: 100,
        estimatedCostUsd: 0.05,
      },
      verifierVerdict: "approved",
      verifierNotes: "Tudo certo.",
    });

    const [delivA] = await db
      .insert(deliverables)
      .values({
        projectId: projectAId,
        repositoryId: repoAId,
        title: "Checkout e faturamento idempotente",
        description: "Fluxo de cobrança de checkout com Idempotency-Key",
        status: "building",
        verifyAttempts: 2,
        evidencePackJson: { ...validEvidence },
      })
      .returning();
    deliverableAId = delivA!.id;

    // Corrige deliverableId no evidencePackJson para bater com delivA.id
    await db
      .update(deliverables)
      .set({
        evidencePackJson: {
          ...validEvidence,
          deliverableId: deliverableAId,
        },
      })
      .where(eq(deliverables.id, deliverableAId));

    await db.insert(executionEvents).values({
      deliverableId: deliverableAId,
      stage: "stage_build",
      actorRole: "builder",
      eventType: "token_usage",
      tokensInput: 1000,
      tokensOutput: 500,
      cacheReadTokens: 200,
      estimatedCostUsd: "12.500000",
      payloadJson: { modelId: "openai/gpt-4o" },
    });

    // Security scan + finding em A
    const [scanA] = await db
      .insert(securityScans)
      .values({
        organizationId: orgAId,
        projectId: projectAId,
        deliverableId: deliverableAId,
        mode: "embedded",
        targetType: "git_repo",
        targetRef: "main",
        scannersRun: ["semgrep"],
        scannerStatusesJson: [
          {
            scanner: "semgrep",
            status: "executed",
            binaryName: "semgrep",
            installHint: null,
            findingsCount: 1,
            durationMs: 120,
            errorMessage: null,
          },
        ],
        sarifRawJson: { version: "2.1.0", runs: [] },
        summaryCountsJson: {
          critical: 1,
          high: 0,
          medium: 0,
          low: 0,
          info: 0,
          total: 1,
          confirmedCount: 1,
          suppressedCount: 0,
          skippedScannersCount: 0,
        },
        status: "completed",
      })
      .returning();
    scanAId = scanA!.id;

    await db.insert(securityFindings).values({
      scanId: scanAId,
      projectId: projectAId,
      ruleId: "ts.sql.injection",
      scanner: "semgrep",
      severity: "critical",
      filePath: "src/billing.ts",
      lineStart: 4,
      title: `SQL Injection com segredo ${rawSecretA}`,
      description: "Concatenação de string SQL detectada.",
      fingerprint: "f".repeat(64),
      triageVerdict: "confirmed",
    });

    // Protótipo + design asset em A
    await db.insert(designAssets).values({
      projectId: projectAId,
      assetType: "design_md",
      title: "Visual Baseline",
      intentionTags: ["oklch", "industrial"],
      approved: true,
    });

    const protoDir = path.join(dataDirA, "uploads", "prototypes");
    fs.mkdirSync(protoDir, { recursive: true });
    prototypeAId = crypto.randomUUID();
    fs.writeFileSync(
      path.join(protoDir, `${prototypeAId}.html`),
      `<main id="billing-shell"><section data-slot="summary"><h1>Faturamento</h1><script>alert(1)</script></section></main>`,
      "utf8"
    );
    await db.insert(designPrototypes).values({
      id: prototypeAId,
      projectId: projectAId,
      deliverableId: deliverableAId,
      level: 3,
      source: "native",
      title: "Tela Faturamento v1",
      htmlStoragePath: `${prototypeAId}.html`,
      tokensJson: {
        color: {
          canvas: { $value: "oklch(0.13 0.006 260)", $type: "color" },
        },
        typography: {
          body: { $value: "Geist, sans-serif", $type: "fontFamily" },
        },
        spacing: { md: { $value: "1.00rem", $type: "dimension" } },
        radius: { md: { $value: "0.375rem", $type: "dimension" } },
      },
      approved: true,
    });

    // Lock ativo em SymbolLockManager
    symbolLockManager.tryAcquire({
      projectId: projectAId,
      deliverableId: deliverableAId,
      symbols: ["src/billing.ts::calculateInvoiceTotal"],
    });

    // Org B (isolamento cross-tenant)
    const [orgB] = await db
      .insert(organizations)
      .values({
        name: "Org Beta S28",
        slug: `org-beta-s28-${Date.now()}`,
      })
      .returning();
    orgBId = orgB!.id;

    const [userB] = await db
      .insert(users)
      .values({
        name: "Dev B S28",
        email: `dev-b-s28-${crypto.randomUUID().slice(0, 6)}@uzina.local`,
        organizationId: orgBId,
        role: "developer",
      })
      .returning();
    userBId = userB!.id;

    const [clientB] = await db
      .insert(clients)
      .values({
        organizationId: orgBId,
        name: "Cliente B",
        slug: `cli-b-s28-${Date.now()}`,
      })
      .returning();

    const [projB] = await db
      .insert(projects)
      .values({
        clientId: clientB!.id,
        name: "Projeto Beta S28",
        slug: `proj-b-s28-${Date.now()}`,
      })
      .returning();
    projectBId = projB!.id;

    const [delivB] = await db
      .insert(deliverables)
      .values({
        projectId: projectBId,
        title: "Entrega Secreta Org B",
        status: "discovery",
      })
      .returning();
    deliverableBId = delivB!.id;

    // Skills conflitantes (2 lead + 1 reference + 1 critique) para testar selectNonConflictingSkillsForStage
    const createTestSkill = (
      name: string,
      roleCategory: "lead" | "reference" | "critique"
    ) => {
      const dir = path.join(tempSkillsDir, name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "SKILL.md"),
        [
          "---",
          `name: ${name}`,
          `description: Skill de teste ${name} (${roleCategory}).`,
          "applies_to_roles: [architect]",
          "phase: architecture",
          `role_category: ${roleCategory}`,
          "---",
          `# ${name}`,
          `Conteúdo ${name}.`,
        ].join("\n"),
        "utf8"
      );
    };
    createTestSkill("arch-lead-alpha", "lead");
    createTestSkill("arch-lead-beta", "lead");
    createTestSkill("arch-ref-guide", "reference");
    createTestSkill("arch-critique-audit", "critique");
  });

  afterAll(async () => {
    symbolLockManager.clearAll();
    await resetAgentControllerForTests();
    await resetMastraStorageForTests();
    for (const dir of [tempWorkspaceA, dataDirA, tempSkillsDir]) {
      if (dir && fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
    await closeDb();
  });

  // --------------------------------------------------------------------------
  // 1. Multi-tenant isolation across specialized tools
  // --------------------------------------------------------------------------
  test.each([
    {
      toolId: "trace_symbol_call_graph",
      buildArgs: (targetProjId: string) => ({
        projectId: targetProjId,
        symbol: "calculateInvoiceTotal",
        depth: 1,
        maxResults: 20,
      }),
    },
    {
      toolId: "analyze_change_impact",
      buildArgs: (targetProjId: string) => ({
        projectId: targetProjId,
        changedFiles: ["src/billing.ts"],
        maxResults: 40,
      }),
    },
    {
      toolId: "read_symbol_source_slice",
      buildArgs: (targetProjId: string) => ({
        projectId: targetProjId,
        path: "src/billing.ts",
        symbol: "calculateInvoiceTotal",
        maxBytes: 4096,
      }),
    },
    {
      toolId: "check_requirement_conflicts",
      buildArgs: (targetProjId: string) => ({
        projectId: targetProjId,
        proposedTitle: "Novo checkout",
        proposedScope: "Implementar fluxo de pagamento com cobrança",
        limit: 10,
      }),
    },
    {
      toolId: "read_finops_and_risk_digest",
      buildArgs: (targetProjId: string) => ({
        projectId: targetProjId,
        includeRecentCallsLimit: 5,
      }),
    },
    {
      toolId: "read_design_system_contract",
      buildArgs: (targetProjId: string) => ({
        projectId: targetProjId,
        maxMarkdownBytes: 12288,
        componentsLimit: 50,
      }),
    },
    {
      toolId: "inspect_prototype_version",
      buildArgs: (targetProjId: string) => ({
        projectId: targetProjId,
        versionLimit: 5,
        maxSummaryBytes: 4096,
      }),
    },
    {
      toolId: "read_security_scan_findings",
      buildArgs: (targetProjId: string) => ({
        projectId: targetProjId,
        limit: 25,
        offset: 0,
      }),
    },
    {
      toolId: "read_deliverable_evidence_and_diff",
      buildArgs: (targetProjId: string, targetDelivId: string) => ({
        projectId: targetProjId,
        deliverableId: targetDelivId,
        maxDiffBytes: 8192,
        maxTestOutputBytes: 4096,
        fileDiffsLimit: 30,
      }),
    },
    {
      toolId: "run_test_anti_pattern_audit",
      buildArgs: (targetProjId: string) => ({
        projectId: targetProjId,
        limit: 50,
      }),
    },
    {
      toolId: "inspect_worktrees_and_locks",
      buildArgs: (targetProjId: string) => ({
        projectId: targetProjId,
        includeOrphansOnly: false,
        limit: 50,
      }),
    },
    {
      toolId: "distill_retrospective_memory",
      buildArgs: (targetProjId: string) => ({
        projectId: targetProjId,
        category: "architecture" as const,
        title: "Tentativa cross-tenant",
        content: "Conteúdo válido para testar bloqueio multi-tenant.",
        sourceTrigger: "manual_retro" as const,
      }),
    },
  ])(
    "isolamento multi-tenant: $toolId rejeita projectId/deliverableId de outra organização",
    async ({ toolId, buildArgs }) => {
      const tools = createRoleSpecializedToolsMap({
        db,
        masterKey,
        dataDir: dataDirA,
        workspaceRoot: tempWorkspaceA,
        symbolLockManager,
      });
      const tool = tools[toolId]!;
      const actorB = makeRc({
        organizationId: orgBId,
        userId: userBId,
        role: "owner",
      });

      await expect(
        tool.execute!(buildArgs(projectAId, deliverableAId), {
          requestContext: actorB,
        } as never)
      ).rejects.toThrowError(/organização|não encontrado/i);

      if (toolId === "read_deliverable_evidence_and_diff") {
        const actorA = makeRc({
          organizationId: orgAId,
          userId: userAId,
          role: "owner",
        });
        await expect(
          tool.execute!(buildArgs(projectAId, deliverableBId), {
            requestContext: actorA,
          } as never)
        ).rejects.toThrowError(/Entregável não encontrado/i);
      }
    }
  );

  // --------------------------------------------------------------------------
  // 2. RBAC & Least Privilege
  // --------------------------------------------------------------------------
  test("RBAC: auditor é bloqueado em distill_retrospective_memory e permitido nas tools de leitura", async () => {
    const auditorOrchTools = createWorkspaceToolsForRole({
      db,
      role: "orchestrator",
      actorRole: "auditor",
      masterKey,
      dataDir: dataDirA,
      workspaceRoot: tempWorkspaceA,
      symbolLockManager,
    });
    expect(Object.keys(auditorOrchTools)).not.toContain(
      "distill_retrospective_memory"
    );
    expect(Object.keys(auditorOrchTools)).not.toContain("create_qmd_memory");
    expect(Object.keys(auditorOrchTools)).toContain(
      "inspect_worktrees_and_locks"
    );

    const allTools = createRoleSpecializedToolsMap({
      db,
      masterKey,
      dataDir: dataDirA,
      workspaceRoot: tempWorkspaceA,
      symbolLockManager,
    });
    const auditorRc = makeRc({
      organizationId: orgAId,
      userId: userAId,
      role: "auditor",
    });

    await expect(
      allTools.distill_retrospective_memory!.execute!(
        {
          projectId: projectAId,
          category: "convention",
          title: "Tentativa de auditor",
          content: "Auditor não deve poder gravar memória retrospectiva.",
          sourceTrigger: "manual_retro",
        },
        { requestContext: auditorRc } as never
      )
    ).rejects.toThrowError(/auditor|Permissão insuficiente/i);

    const digest = (await allTools.read_finops_and_risk_digest!.execute!(
      { projectId: projectAId, includeRecentCallsLimit: 5 },
      { requestContext: auditorRc } as never
    )) as {
      tokensTotal: number;
      estimatedCostUsd: number;
      openSecurityCounts: { critical: number };
      overallRiskLevel: string;
    };
    expect(digest.tokensTotal).toBe(1500);
    expect(digest.estimatedCostUsd).toBe(12.5);
    expect(digest.openSecurityCounts.critical).toBe(1);
    expect(digest.overallRiskLevel).toBe("high");
  });

  test("Controller: modo review é estritamente somente leitura e backingAgent ativa ToolSearchProcessor", async () => {
    const forbiddenWriteInReview = [
      "create_qmd_memory",
      "distill_retrospective_memory",
      "task_write",
      "task_update",
      "task_complete",
      "submit_plan",
      "ask_user",
    ];
    for (const forbidden of forbiddenWriteInReview) {
      expect(CONTROLLER_MODE_TOOLS.review).not.toContain(forbidden);
    }
    expect(CONTROLLER_MODE_TOOLS.review).toContain("read_security_scan_findings");
    expect(CONTROLLER_MODE_TOOLS.review).toContain(
      "read_deliverable_evidence_and_diff"
    );
    expect(CONTROLLER_MODE_TOOLS.review).toContain(
      "run_test_anti_pattern_audit"
    );

    await resetAgentControllerForTests();
    await getOrCreateUzinaAgentController({
      db,
      masterKey,
      dataDir: ":memory:",
      modelOverride: createMockModel(),
    });
    const backingAgent = getControllerBackingAgent()!;
    const backingTools = await backingAgent.listTools();
    expect(Object.keys(backingTools).length).toBeGreaterThanOrEqual(8);
    const inputProcs = await backingAgent.listInputProcessors();
    expect(hasToolSearchProcessor(inputProcs)).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 3. WCAG 2.1 math (Hex & OKLCH)
  // --------------------------------------------------------------------------
  test.each([
    {
      label: "branco sobre stone-100 falha AA normal (4.5:1)",
      foreground: "#ffffff",
      background: "#f5f5f4",
      expectedPassed: false,
      expectedFormat: "hex",
      minRatio: 1.0,
      maxRatio: 1.3,
    },
    {
      label: "stone-900 sobre stone-50 passa AA normal (4.5:1)",
      foreground: "#1c1917",
      background: "#fafaf9",
      expectedPassed: true,
      expectedFormat: "hex",
      minRatio: 15.0,
      maxRatio: 21.0,
    },
    {
      label: "OKLCH texto claro sobre canvas dark industrial passa AA normal",
      foreground: "oklch(0.96 0.004 260)",
      background: "oklch(0.13 0.006 260)",
      expectedPassed: true,
      expectedFormat: "oklch",
      minRatio: 12.0,
      maxRatio: 21.0,
    },
    {
      label: "OKLCH baixo contraste falha AA normal",
      foreground: "oklch(0.85 0.02 260)",
      background: "oklch(0.92 0.01 260)",
      expectedPassed: false,
      expectedFormat: "oklch",
      minRatio: 1.0,
      maxRatio: 2.0,
    },
  ])(
    "WCAG 2.1 contraste: $label",
    async ({
      foreground,
      background,
      expectedPassed,
      expectedFormat,
      minRatio,
      maxRatio,
    }) => {
      const tools = createRoleSpecializedToolsMap({ db, masterKey });
      const rc = makeRc({
        organizationId: orgAId,
        userId: userAId,
        role: "developer",
      });
      const res = (await tools.validate_color_contrast_and_tokens!.execute!(
        {
          pairs: [{ label: "sample", foreground, background, level: "aa_normal" }],
          rawTokens: {
            "--hardcoded": "#ff0000",
            "--semantic": "oklch(0.72 0.16 55)",
          },
        },
        { requestContext: rc } as never
      )) as {
        allPassed: boolean;
        results: Array<{
          passed: boolean;
          contrastRatio: number;
          formatDetected: string;
        }>;
        hardcodedColorsDetected: string[];
      };

      expect(res.allPassed).toBe(expectedPassed);
      expect(res.results[0]?.passed).toBe(expectedPassed);
      expect(res.results[0]?.formatDetected).toBe(expectedFormat);
      expect(res.results[0]?.contrastRatio).toBeGreaterThanOrEqual(minRatio);
      expect(res.results[0]?.contrastRatio).toBeLessThanOrEqual(maxRatio);
      expect(res.hardcodedColorsDetected).toEqual(["--hardcoded:#ff0000"]);
    }
  );

  // --------------------------------------------------------------------------
  // 4. Security containment & secret redaction in read_symbol_source_slice
  // --------------------------------------------------------------------------
  test.each([".env", ".env.production", ".master-key", "../outside.ts"])(
    "read_symbol_source_slice bloqueia caminho sensível ou traversal (%s)",
    async (blockedPath) => {
      const tools = createRoleSpecializedToolsMap({
        db,
        masterKey,
        workspaceRoot: tempWorkspaceA,
      });
      const rc = makeRc({
        organizationId: orgAId,
        userId: userAId,
        role: "developer",
      });

      await expect(
        tools.read_symbol_source_slice!.execute!(
          {
            projectId: projectAId,
            path: blockedPath,
            symbol: "API_KEY",
            maxBytes: 2048,
          },
          { requestContext: rc } as never
        )
      ).rejects.toThrowError(/negado|traversal|sensível|inválido|fora/i);
    }
  );

  test("read_symbol_source_slice redige segredos do tenant e calcula savingsPercent", async () => {
    const tools = createRoleSpecializedToolsMap({
      db,
      masterKey,
      workspaceRoot: tempWorkspaceA,
    });
    const rc = makeRc({
      organizationId: orgAId,
      userId: userAId,
      role: "developer",
    });

    const slice = (await tools.read_symbol_source_slice!.execute!(
      {
        projectId: projectAId,
        path: "src/billing.ts",
        symbol: "calculateInvoiceTotal",
        maxBytes: 4096,
      },
      { requestContext: rc } as never
    )) as {
      code: string;
      redactedSecretsCount: number;
      savingsPercent: number;
    };

    expect(slice.code).not.toContain(rawSecretA);
    expect(slice.code).toContain("[REDACTED");
    expect(slice.redactedSecretsCount).toBeGreaterThanOrEqual(1);
    expect(slice.savingsPercent).toBeGreaterThan(0);
  });

  // --------------------------------------------------------------------------
  // 5. Remaining specialized tools + Monorepo boundaries + Wiring + Skills
  // --------------------------------------------------------------------------
  test.each([
    {
      label: "contracts não pode importar nada interno",
      sourcePackage: "@uzina/contracts",
      proposedImports: ["@uzina/core"],
      expectedPassed: false,
    },
    {
      label: "codebase-intel pode importar contracts e core",
      sourcePackage: "@uzina/codebase-intel",
      proposedImports: ["@uzina/contracts", "@uzina/core"],
      expectedPassed: true,
    },
    {
      label: "core não pode importar db nem módulo comercial bloqueado",
      sourcePackage: "@uzina/core",
      proposedImports: ["@uzina/db", ["@mastra", "core-ee"].join("/")],
      expectedPassed: false,
    },
    {
      label: "web pode importar mastra-runtime mas não apps/cli",
      sourcePackage: "apps/web",
      proposedImports: ["@uzina/mastra-runtime", "@uzina/cli"],
      expectedPassed: false,
    },
  ])(
    "check_dependency_boundaries: $label",
    async ({ sourcePackage, proposedImports, expectedPassed }) => {
      const tools = createRoleSpecializedToolsMap({ db, masterKey });
      const rc = makeRc({
        organizationId: orgAId,
        userId: userAId,
        role: "developer",
      });
      const res = (await tools.check_dependency_boundaries!.execute!(
        { sourcePackage, proposedImports },
        { requestContext: rc } as never
      )) as { passed: boolean; violations: Array<{ targetImport: string }> };

      expect(res.passed).toBe(expectedPassed);
      if (!expectedPassed) {
        expect(res.violations.length).toBeGreaterThanOrEqual(1);
      }
    }
  );

  test("executa graph/impact, conflicts, design/prototype, QA/AppSec e orchestration tools", async () => {
    const tools = createRoleSpecializedToolsMap({
      db,
      masterKey,
      dataDir: dataDirA,
      workspaceRoot: tempWorkspaceA,
      symbolLockManager,
    });
    const rc = makeRc({
      organizationId: orgAId,
      userId: userAId,
      role: "developer",
    });

    const graphRes = (await tools.trace_symbol_call_graph!.execute!(
      { projectId: projectAId, symbol: "calculateInvoiceTotal", depth: 2, maxResults: 10 },
      { requestContext: rc } as never
    )) as { nodes: Array<{ name: string }>; edges: Array<unknown> };
    expect(graphRes.nodes.map((n) => n.name)).toContain("POST_checkout");
    expect(graphRes.edges.length).toBeGreaterThanOrEqual(1);

    const impactRes = (await tools.analyze_change_impact!.execute!(
      { projectId: projectAId, changedFiles: ["src/billing.ts"], maxResults: 20 },
      { requestContext: rc } as never
    )) as { affectedRoutes: Array<{ name: string }> };
    expect(impactRes.affectedRoutes.map((r) => r.name)).toContain("POST_checkout");

    const conflictsRes = (await tools.check_requirement_conflicts!.execute!(
      {
        projectId: projectAId,
        proposedTitle: "Fluxo de cobrança e checkout",
        proposedScope: "Permitir pagamento no checkout com idempotência",
        limit: 10,
      },
      { requestContext: rc } as never
    )) as { hasConflicts: boolean; conflicts: Array<{ sourceType: string }> };
    expect(conflictsRes.hasConflicts).toBe(true);
    expect(conflictsRes.conflicts.some((c) => c.sourceType === "deliverable")).toBe(true);

    const designRes = (await tools.read_design_system_contract!.execute!(
      { projectId: projectAId, maxMarkdownBytes: 4096, componentsLimit: 20 },
      { requestContext: rc } as never
    )) as {
      designMdPath: string | null;
      approvedAssetsCount: number;
      uiComponents: Array<{ dataSlot: string }>;
    };
    expect(designRes.designMdPath).toBe(".uzina/DESIGN.md");
    expect(designRes.approvedAssetsCount).toBe(1);
    expect(designRes.uiComponents.some((c) => c.dataSlot === "button")).toBe(true);

    const protoRes = (await tools.inspect_prototype_version!.execute!(
      { projectId: projectAId, versionLimit: 5, maxSummaryBytes: 4096 },
      { requestContext: rc } as never
    )) as {
      versions: Array<{
        versionNumber: number;
        domSections: string[];
        sanitizedHtmlSummary: string;
      }>;
    };
    expect(protoRes.versions[0]?.versionNumber).toBe(1);
    expect(protoRes.versions[0]?.sanitizedHtmlSummary).not.toContain("<script>");
    expect(protoRes.versions[0]?.domSections.length).toBeGreaterThanOrEqual(1);

    const secRes = (await tools.read_security_scan_findings!.execute!(
      {
        projectId: projectAId,
        severities: ["critical"],
        scanner: "semgrep",
        verdict: "confirmed",
        limit: 10,
        offset: 0,
      },
      { requestContext: rc } as never
    )) as { totalMatching: number; findings: Array<{ title: string }> };
    expect(secRes.totalMatching).toBe(1);
    expect(secRes.findings[0]?.title).not.toContain(rawSecretA);

    const evRes = (await tools.read_deliverable_evidence_and_diff!.execute!(
      {
        projectId: projectAId,
        deliverableId: deliverableAId,
        maxDiffBytes: 4096,
        maxTestOutputBytes: 2048,
        fileDiffsLimit: 10,
      },
      { requestContext: rc } as never
    )) as {
      found: boolean;
      diffSummary: { preview: string } | null;
      testCommandOutput: string | null;
      redactedSecretsCount: number;
    };
    expect(evRes.found).toBe(true);
    expect(evRes.diffSummary?.preview).not.toContain(rawSecretA);
    expect(evRes.testCommandOutput).not.toContain(rawSecretA);
    expect(evRes.redactedSecretsCount).toBeGreaterThanOrEqual(2);

    const auditRes = (await tools.run_test_anti_pattern_audit!.execute!(
      { projectId: projectAId, limit: 20 },
      { requestContext: rc } as never
    )) as { passed: boolean; violations: Array<{ rule: string }> };
    expect(auditRes.passed).toBe(false);
    expect(auditRes.violations.some((v) => v.rule === "missing_assertion")).toBe(true);

    const wtRes = (await tools.inspect_worktrees_and_locks!.execute!(
      { projectId: projectAId, includeOrphansOnly: false, limit: 20 },
      { requestContext: rc } as never
    )) as { activeSymbolLocks: Array<{ symbolKey: string }> };
    expect(wtRes.activeSymbolLocks.map((l) => l.symbolKey)).toContain(
      "src/billing.ts::calculateInvoiceTotal"
    );

    const retroRes = (await tools.distill_retrospective_memory!.execute!(
      {
        projectId: projectAId,
        deliverableId: deliverableAId,
        category: "architecture",
        title: "Lição de billing",
        content: "Sempre redigir tokens antes de expor evidências ao auditor.",
        sourceTrigger: "manual_retro",
      },
      { requestContext: rc } as never
    )) as { persisted: boolean; qmdReindexed: boolean };
    expect(retroRes.persisted).toBe(true);
    expect(retroRes.qmdReindexed).toBe(true);
  });

  test("Agent wiring: Executive Copilot, Engineering Agents (>= 8 tools -> ToolSearchProcessor) e selectNonConflictingSkillsForStage", async () => {
    const copilot = createExecutiveCopilotAgent({
      db,
      masterKey,
      modelOverride: createMockModel(),
    });
    const copilotTools = await copilot.listTools();
    expect(Object.keys(copilotTools)).toContain("read_finops_and_risk_digest");
    expect(Object.keys(copilotTools)).toContain("check_requirement_conflicts");

    for (const role of [
      "software_architect",
      "tech_lead",
      "qa_appsec",
    ] as AgencyAgentRole[]) {
      const agent = createEngineeringSpecialistAgent({
        role,
        db,
        masterKey,
        actorRole: "developer",
        skillsDir: tempSkillsDir,
        modelOverride: createMockModel(),
      });
      const agentTools = await agent.listTools();
      expect(Object.keys(agentTools).length).toBeGreaterThanOrEqual(8);
      const procs = await agent.listInputProcessors();
      expect(hasToolSearchProcessor(procs)).toBe(true);
    }

    const catalogProc = createUzinaSkillsCatalogProcessor({
      role: "software_architect",
      skillsDir: tempSkillsDir,
      preferredLeadName: "arch-lead-beta",
      includeCritique: false,
    });
    const ml = new MessageList({ threadId: "t-s28", resourceId: "r-s28" });
    const step = await catalogProc.processInputStep!({
      messages: [],
      messageList: ml,
      requestContext: makeRc({
        organizationId: orgAId,
        userId: userAId,
        role: "developer",
      }),
      systemMessages: [],
      stepNumber: 0,
      abort: () => {
        throw new Error("abort");
      },
    } as never);
    const sysText =
      (step as { systemMessages?: Array<{ content: unknown }> })?.systemMessages
        ?.map((m) => String(m.content))
        .join("\n") ?? "";

    expect(sysText).toContain("arch-lead-beta");
    expect(sysText).toContain("arch-ref-guide");
    expect(sysText).not.toContain("arch-lead-alpha");
    expect(sysText).not.toContain("arch-critique-audit");
  });
});
