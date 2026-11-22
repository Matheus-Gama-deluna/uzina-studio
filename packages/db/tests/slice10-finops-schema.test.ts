import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { afterAll, describe, expect, test } from "vitest";
import {
  MIGRATION_TABLE_ORDER,
  engineConfigs,
  ensureDefaultOrgAndInternalClient,
  tokenSavingsEvents,
} from "../src/index.js";
import * as schema from "../src/schema/index.js";

const MIGRATIONS_FOLDER = path.resolve(import.meta.dirname, "../drizzle");

describe("@uzina/db — Slice 10 token_savings_events Schema", () => {
  const openClients: PGlite[] = [];

  afterAll(async () => {
    for (const c of openClients) {
      await c.close().catch(() => undefined);
    }
  });

  test("persiste token_savings_events com organization_id, technique e tokens medidos", async () => {
    expect(MIGRATION_TABLE_ORDER).toContain("token_savings_events");

    const client = new PGlite();
    openClients.push(client);
    const db = drizzlePglite(client, { schema });
    await migratePglite(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const { organizationId } = await ensureDefaultOrgAndInternalClient(db);
    const [ev] = await db
      .insert(tokenSavingsEvents)
      .values({
        organizationId,
        technique: "qmd",
        tokensBaseline: 8500,
        tokensActual: 620,
      })
      .returning();

    expect(ev?.technique).toBe("qmd");
    expect(ev?.tokensBaseline).toBe(8500);
    expect(ev?.tokensActual).toBe(620);

    expect(MIGRATION_TABLE_ORDER).toContain("engine_configs");
    const [cfg] = await db
      .insert(engineConfigs)
      .values({
        organizationId,
        embeddingMode: "onnx_e5_small",
        astMode: "polyglot",
        autoInjectInRunner: true,
      })
      .returning();
    expect(cfg?.embeddingMode).toBe("onnx_e5_small");
    expect(cfg?.astMode).toBe("polyglot");
  });
});
