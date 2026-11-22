import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  clients,
  closeDb,
  deliverables,
  ensureDefaultOrgAndInternalClient,
  getDb,
  organizations,
  projectRepositories,
  projects,
  type UzinaDb,
} from "@uzina/db";
import {
  DockerExecutionWorkspace,
  LocalGitWorktreeWorkspace,
} from "@uzina/opencode-bridge";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  buildAutoInjectedCodebaseContext,
  createConfiguredExecutionWorkspace,
  createMemoryScoped,
  createOrganizationExecutionWorkspace,
  getEngineConfigScoped,
  getFinopsSummaryScoped,
  recordTokenSavingsEventScoped,
  resetMastraStorageForTests,
  resolveConfiguredWorkspaceKind,
  syncRepositoryCodebase,
  updateEngineConfigScoped,
} from "../src/index.js";

describe("@uzina/mastra-runtime — Slice 10 FinOps & Seleção de Workspace", () => {
  let db: UzinaDb;
  let organizationId: string;
  let deliverableId: string;

  beforeAll(async () => {
    await resetMastraStorageForTests();
    await closeDb();
    const ctx = await getDb({ dataDir: ":memory:" });
    db = ctx.db;
    const seeded = await ensureDefaultOrgAndInternalClient(db);
    organizationId = seeded.organizationId;

    const [cli] = await db
      .insert(clients)
      .values({
        organizationId,
        name: "Cliente FinOps",
        slug: `cli-finops-${crypto.randomUUID().slice(0, 5)}`,
      })
      .returning();

    const [proj] = await db
      .insert(projects)
      .values({
        clientId: cli!.id,
        name: "Projeto FinOps",
        slug: `proj-finops-${crypto.randomUUID().slice(0, 5)}`,
      })
      .returning();

    const [deliv] = await db
      .insert(deliverables)
      .values({
        projectId: proj!.id,
        title: "Entrega FinOps",
        status: "merged",
        verifyAttempts: 1,
      })
      .returning();
    deliverableId = deliv!.id;
  });

  afterAll(async () => {
    await resetMastraStorageForTests();
    await closeDb();
  });

  test("seleciona worktree ou docker via UZINA_WORKSPACE", () => {
    expect(resolveConfiguredWorkspaceKind({})).toBe("worktree");
    expect(resolveConfiguredWorkspaceKind({ UZINA_WORKSPACE: "docker" })).toBe(
      "docker"
    );
    expect(createConfiguredExecutionWorkspace({})).toBeInstanceOf(
      LocalGitWorktreeWorkspace
    );
    expect(
      createConfiguredExecutionWorkspace({ UZINA_WORKSPACE: "docker" })
    ).toBeInstanceOf(DockerExecutionWorkspace);
  });

  test("registra token_savings_events, agrega FinOpsSummary e isola organizações", async () => {
    await recordTokenSavingsEventScoped(db, {
      organizationId,
      input: {
        deliverableId,
        technique: "skeleton",
        tokensBaseline: 10000,
        tokensActual: 1000,
      },
    });

    await recordTokenSavingsEventScoped(db, {
      organizationId,
      input: {
        deliverableId,
        technique: "qmd",
        tokensBaseline: 5000,
        tokensActual: 500,
      },
    });

    const summary = await getFinopsSummaryScoped(db, {
      organizationId,
      env: { UZINA_WORKSPACE: "docker" },
    });

    expect(summary.workspaceKind).toBe("docker");
    expect(summary.totalEvents).toBe(2);
    expect(summary.totalTokensBaseline).toBe(15000);
    expect(summary.totalTokensActual).toBe(1500);
    expect(summary.totalTokensSaved).toBe(13500);
    expect(summary.overallSavingsPercent).toBe(90);
    expect(summary.cacheHitRate).toBe(90);
    expect(summary.reworkRate).toBe(0);
    expect(summary.estimatedCostSavedUsd).toBeGreaterThan(0);

    const [otherOrg] = await db
      .insert(organizations)
      .values({
        name: "Org Isolada FinOps",
        slug: `other-finops-${crypto.randomUUID().slice(0, 5)}`,
      })
      .returning();

    const otherSummary = await getFinopsSummaryScoped(db, {
      organizationId: otherOrg!.id,
    });
    expect(otherSummary.totalEvents).toBe(0);
    expect(otherSummary.totalTokensSaved).toBe(0);
  });

  test("hot-reload de engine_configs (sem restart), AST poliglota e buildAutoInjectedCodebaseContext gravando prompt_cache", async () => {
    const initialCfg = await getEngineConfigScoped(db, { organizationId });
    expect(initialCfg.config.embeddingMode).toBe("deterministic");

    const updatedCfg = await updateEngineConfigScoped(db, {
      organizationId,
      input: {
        embeddingMode: "onnx_e5_small",
        astMode: "polyglot",
        workspaceKind: "docker",
        skeletonMaxTokens: 1500,
        autoInjectInRunner: true,
      },
    });
    expect(updatedCfg.activeEmbeddingProviderId).toBe("onnx-e5-small-384");
    expect(updatedCfg.degraded).toBe(false);
    expect(
      await createOrganizationExecutionWorkspace(db, organizationId)
    ).toBeInstanceOf(DockerExecutionWorkspace);

    // Repositório temporário poliglota (TS + Python + Go)
    const polyRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-s11-rt-"));
    try {
      fs.writeFileSync(
        path.join(polyRepoDir, "service.ts"),
        `export function processPayment(amount: number): number {\n  return amount * 1.1;\n}\n`,
        "utf8"
      );
      fs.writeFileSync(
        path.join(polyRepoDir, "ml_worker.py"),
        `def score_fraud(tx_id: str) -> float:\n    return 0.02\n`,
        "utf8"
      );

      const [cli] = await db
        .select()
        .from(clients)
        .limit(1);
      const [proj] = await db
        .insert(projects)
        .values({
          clientId: cli!.id,
          name: "Projeto Poliglota S11",
          slug: `proj-s11-${crypto.randomUUID().slice(0, 5)}`,
        })
        .returning();
      await db.insert(projectRepositories).values({
        projectId: proj!.id,
        name: "repo-poly-s11",
        localPath: polyRepoDir,
      });

      const sync = await syncRepositoryCodebase(db, {
        organizationId,
        projectId: proj!.id,
        workspaceRoot: polyRepoDir,
      });
      expect(sync.indexedFiles).toBe(2);

      await createMemoryScoped(db, {
        organizationId,
        input: {
          scopeType: "org",
          scopeId: organizationId,
          category: "architecture",
          title: "Cofre AES-256-GCM",
          content: "Provider Vault AES-256-GCM encryption key storage",
        },
      });

      const injected = await buildAutoInjectedCodebaseContext(db, {
        organizationId,
        projectId: proj!.id,
        deliverableId,
        queryText: "como protegemos chaves no cofre?",
        workspaceRoot: polyRepoDir,
      });
      expect(injected.enabled).toBe(true);
      expect(injected.contextMarkdown).toContain("processPayment");
      expect(injected.contextMarkdown).toContain("score_fraud");
      expect(injected.contextMarkdown).toContain("onnx-e5-small-384");

      const summaryAfter = await getFinopsSummaryScoped(db, { organizationId });
      const promptCacheBreakdown = summaryAfter.byTechnique.find(
        (b) => b.technique === "prompt_cache"
      );
      expect(promptCacheBreakdown?.eventsCount).toBeGreaterThanOrEqual(1);
    } finally {
      fs.rmSync(polyRepoDir, { recursive: true, force: true });
    }
  });
});
