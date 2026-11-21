import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { checkDbHealth, closeDb, getDb, organizations, users } from "../src/index.js";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("@uzina/db — integração real com PGlite", () => {
  afterAll(async () => {
    await closeDb();
  });

  test("aplica migrações automáticas, persiste organizations/users com UUID e mantém singleton global", async () => {
    await closeDb();
    const ctx1 = await getDb({ dataDir: ":memory:" });
    const ctx2 = await getDb({ dataDir: ":memory:" });

    expect(ctx1).toBe(ctx2);
    expect(ctx1.mode).toBe("pglite");

    const symbolKey = Symbol.for("@uzina/db/singleton");
    const globalHolder = (globalThis as Record<symbol, unknown>)[symbolKey] as {
      context?: unknown;
    };
    expect(globalHolder.context).toBe(ctx1);

    const tablesResult = await ctx1.db.execute(
      sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
    );
    const tableNames = tablesResult.rows.map((r) => String(r.tablename));
    expect(tableNames).toEqual(
      expect.arrayContaining([
        "accounts",
        "organizations",
        "sessions",
        "users",
        "verifications",
      ])
    );

    const [org] = await ctx1.db
      .insert(organizations)
      .values({ name: "Uzina Core", slug: "uzina-core" })
      .returning();

    expect(org?.id).toMatch(UUID_REGEX);

    const [user] = await ctx1.db
      .insert(users)
      .values({
        name: "Operador Teste",
        email: "operador@uzina.local",
        organizationId: org?.id ?? null,
        role: "owner",
      })
      .returning();

    expect(user?.id).toMatch(UUID_REGEX);
    expect(user?.organizationId).toBe(org?.id);

    const fetched = await ctx1.db
      .select()
      .from(users)
      .where(eq(users.email, "operador@uzina.local"));
    expect(fetched).toHaveLength(1);
    expect(fetched[0]?.role).toBe("owner");

    await expect(
      ctx1.db
        .insert(organizations)
        .values({ name: "Duplicada", slug: "uzina-core" })
    ).rejects.toThrow();

    await expect(
      ctx1.db
        .insert(users)
        .values({ name: "Duplicado", email: "operador@uzina.local" })
    ).rejects.toThrow();

    const health = await checkDbHealth();
    expect(health.status).toBe("up");
    expect(health.mode).toBe("pglite");
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test("deduplica cold start concorrente via Promise.all retornando o mesmo singleton", async () => {
    await closeDb();
    const [ctxA, ctxB] = await Promise.all([
      getDb({ dataDir: ":memory:" }),
      getDb({ dataDir: ":memory:" }),
    ]);

    expect(ctxA).toBe(ctxB);
    expect(ctxA.mode).toBe("pglite");
  });

  test("persiste dados em disco em diretório temporário isolado e reabre sem perda", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-pglite-"));
    try {
      await closeDb();
      const firstRun = await getDb({ dataDir: tmpDir });
      await firstRun.db
        .insert(organizations)
        .values({ name: "Persist Org", slug: "persist-org" });
      await closeDb();

      const secondRun = await getDb({ dataDir: tmpDir });
      const rows = await secondRun.db
        .select()
        .from(organizations)
        .where(eq(organizations.slug, "persist-org"));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.name).toBe("Persist Org");
    } finally {
      await closeDb();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
