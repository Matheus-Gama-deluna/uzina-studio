import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  closeDb,
  engineConfigs,
  ensureDefaultOrgAndInternalClient,
  getDb,
  projects,
  type UzinaDb,
} from "../src/index.js";

describe("@uzina/db — Slice 19 (Schema & Migração 0011 Manual/Auto, BudgetCap, CodingExecutorMode)", () => {
  let db: UzinaDb;

  beforeAll(async () => {
    await closeDb();
    const ctx = await getDb({ dataDir: ":memory:" });
    db = ctx.db;
  });

  afterAll(async () => {
    await closeDb();
  });

  test("aplica migração 0011 em PGlite limpo com defaults seguros em projects e engine_configs", async () => {
    const { organizationId, internalClientId } =
      await ensureDefaultOrgAndInternalClient(db);

    const [createdProj] = await db
      .insert(projects)
      .values({
        clientId: internalClientId,
        name: "Projeto Slice 19 DB",
        slug: "projeto-slice-19-db",
      })
      .returning();

    expect(createdProj).toBeDefined();
    expect(createdProj?.stageAutomationJson).toEqual({
      discovery: "manual",
      spec_review: "manual",
      visual_studio: "manual",
      contract_tests: "auto",
      building: "auto",
      verifying: "auto",
      decision_pending: "manual",
    });
    expect(createdProj?.budgetCapUsd).toBeNull();

    const [updatedProj] = await db
      .update(projects)
      .set({
        stageAutomationJson: {
          discovery: "auto",
          spec_review: "auto",
          visual_studio: "manual",
          contract_tests: "auto",
          building: "manual",
          verifying: "auto",
          decision_pending: "manual",
        },
        budgetCapUsd: "42.500000",
      })
      .where(eq(projects.id, createdProj!.id))
      .returning();

    expect(updatedProj?.stageAutomationJson.building).toBe("manual");
    expect(updatedProj?.stageAutomationJson.decision_pending).toBe("manual");
    expect(Number(updatedProj?.budgetCapUsd)).toBeCloseTo(42.5, 4);

    const [cfg] = await db
      .insert(engineConfigs)
      .values({ organizationId })
      .returning();

    expect(cfg?.codingExecutorMode).toBe("opencode");

    const [updatedCfg] = await db
      .update(engineConfigs)
      .set({ codingExecutorMode: "mastra_coding_agent" })
      .where(eq(engineConfigs.id, cfg!.id))
      .returning();

    expect(updatedCfg?.codingExecutorMode).toBe("mastra_coding_agent");
  });
});
