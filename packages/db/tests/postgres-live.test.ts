import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { checkDbHealth, closeDb, getDb, organizations } from "../src/index.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

describe.skipIf(!testDatabaseUrl)(
  "@uzina/db — integração live com PostgreSQL + pgvector",
  () => {
    const originalDbUrl = process.env.DATABASE_URL;

    afterAll(async () => {
      await closeDb();
      if (originalDbUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = originalDbUrl;
      }
    });

    test("executa migrações, valida extensão pgvector, healthcheck e CRUD com limpeza", async () => {
      await closeDb();
      process.env.DATABASE_URL = testDatabaseUrl;

      const ctx = await getDb();
      expect(ctx.mode).toBe("postgres");

      const extRes = await ctx.db.execute(
        sql`SELECT extname FROM pg_extension WHERE extname = 'vector'`
      );
      expect(extRes.rows.map((r) => String(r.extname))).toContain("vector");

      const slug = `pg-live-${Date.now()}`;
      const [created] = await ctx.db
        .insert(organizations)
        .values({ name: "Postgres Live Org", slug })
        .returning();

      expect(created?.slug).toBe(slug);

      await ctx.db.delete(organizations).where(eq(organizations.slug, slug));

      const health = await checkDbHealth();
      expect(health.status).toBe("up");
      expect(health.mode).toBe("postgres");
    });
  }
);
