import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { afterAll, describe, expect, test } from "vitest";
import {
  MIGRATION_TABLE_ORDER,
  clients,
  designPrototypes,
  ensureDefaultOrgAndInternalClient,
  projects,
} from "../src/index.js";
import * as schema from "../src/schema/index.js";

const MIGRATIONS_FOLDER = path.resolve(import.meta.dirname, "../drizzle");

describe("@uzina/db — Slice 9 design_prototypes Schema", () => {
  const openClients: PGlite[] = [];

  afterAll(async () => {
    for (const c of openClients) {
      await c.close().catch(() => undefined);
    }
  });

  test("persiste design_prototypes com tokensJson W3C e remove em cascade ao deletar projeto", async () => {
    expect(MIGRATION_TABLE_ORDER).toContain("design_prototypes");

    const client = new PGlite();
    openClients.push(client);
    const db = drizzlePglite(client, { schema });
    await migratePglite(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const { organizationId } = await ensureDefaultOrgAndInternalClient(db);
    const [cli] = await db
      .insert(clients)
      .values({
        organizationId,
        name: "Cliente Stitch",
        slug: "cliente-stitch",
      })
      .returning();

    const [proj] = await db
      .insert(projects)
      .values({
        clientId: cli!.id,
        name: "Projeto Stitch",
        slug: "projeto-stitch",
      })
      .returning();

    const [proto] = await db
      .insert(designPrototypes)
      .values({
        projectId: proj!.id,
        level: 3,
        source: "stitch_import",
        title: "Checkout v1",
        htmlStoragePath: "uploads/prototypes/checkout.html",
        tokensJson: {
          color: { primary: { $value: "#0ea5e9", $type: "color" } },
          typography: { body: { $value: "Inter, sans-serif", $type: "fontFamily" } },
          spacing: { md: { $value: "1.00rem", $type: "dimension" } },
          radius: { lg: { $value: "0.50rem", $type: "dimension" } },
        },
        approved: false,
      })
      .returning();

    expect(proto?.title).toBe("Checkout v1");
    expect(proto?.tokensJson.color.primary?.$value).toBe("#0ea5e9");

    await db.delete(projects).where(eq(projects.id, proj!.id));
    const remaining = await db.select().from(designPrototypes);
    expect(remaining).toHaveLength(0);
  });
});
