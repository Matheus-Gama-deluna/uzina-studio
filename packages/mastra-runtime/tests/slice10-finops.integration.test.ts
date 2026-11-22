import crypto from "node:crypto";
import {
  clients,
  closeDb,
  deliverables,
  ensureDefaultOrgAndInternalClient,
  getDb,
  organizations,
  projects,
  type UzinaDb,
} from "@uzina/db";
import {
  DockerExecutionWorkspace,
  LocalGitWorktreeWorkspace,
} from "@uzina/opencode-bridge";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  createConfiguredExecutionWorkspace,
  getFinopsSummaryScoped,
  recordTokenSavingsEventScoped,
  resetMastraStorageForTests,
  resolveConfiguredWorkspaceKind,
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
});
