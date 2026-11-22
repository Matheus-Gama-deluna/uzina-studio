import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { afterAll, describe, expect, test } from "vitest";
import {
  MIGRATION_TABLE_ORDER,
  clients,
  codebaseEdges,
  codebaseFiles,
  codebaseSymbols,
  decisionProvenance,
  deliverables,
  ensureDefaultOrgAndInternalClient,
  projectRepositories,
  projects,
} from "../src/index.js";
import * as schema from "../src/schema/index.js";

const MIGRATIONS_FOLDER = path.resolve(import.meta.dirname, "../drizzle");

describe("@uzina/db — Slice 8 Codebase Intelligence Schema", () => {
  const openClients: PGlite[] = [];

  afterAll(async () => {
    for (const c of openClients) {
      await c.close().catch(() => undefined);
    }
  });

  test("cria tabelas codebase_files, codebase_symbols, codebase_edges e decision_provenance com cascades", async () => {
    expect(MIGRATION_TABLE_ORDER).toContain("codebase_files");
    expect(MIGRATION_TABLE_ORDER).toContain("codebase_symbols");
    expect(MIGRATION_TABLE_ORDER).toContain("codebase_edges");
    expect(MIGRATION_TABLE_ORDER).toContain("decision_provenance");

    const client = new PGlite();
    openClients.push(client);
    const db = drizzlePglite(client, { schema });
    await migratePglite(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const { organizationId } = await ensureDefaultOrgAndInternalClient(db);

    const [cli] = await db
      .insert(clients)
      .values({
        organizationId,
        name: "Cliente AST",
        slug: "cliente-ast",
      })
      .returning();

    const [proj] = await db
      .insert(projects)
      .values({
        clientId: cli!.id,
        name: "Projeto AST",
        slug: "projeto-ast",
      })
      .returning();

    const [repo] = await db
      .insert(projectRepositories)
      .values({
        projectId: proj!.id,
        name: "repo-ast",
        localPath: "/tmp/repo-ast",
      })
      .returning();

    const [deliv] = await db
      .insert(deliverables)
      .values({
        projectId: proj!.id,
        repositoryId: repo!.id,
        title: "Entrega AST",
      })
      .returning();

    const [fileA] = await db
      .insert(codebaseFiles)
      .values({
        repositoryId: repo!.id,
        path: "src/a.ts",
        sha256: "a".repeat(64),
        language: "typescript",
        size: 120,
      })
      .returning();

    const [fileB] = await db
      .insert(codebaseFiles)
      .values({
        repositoryId: repo!.id,
        path: "src/b.ts",
        sha256: "b".repeat(64),
        language: "typescript",
        size: 90,
      })
      .returning();

    const [symA] = await db
      .insert(codebaseSymbols)
      .values({
        fileId: fileA!.id,
        kind: "function",
        name: "runA",
        signature: "export function runA()",
        lineStart: 1,
        lineEnd: 5,
        exported: true,
      })
      .returning();

    const [symB] = await db
      .insert(codebaseSymbols)
      .values({
        fileId: fileB!.id,
        kind: "function",
        name: "helperB",
        signature: "export function helperB()",
        lineStart: 1,
        lineEnd: 4,
        exported: true,
      })
      .returning();

    const [edge] = await db
      .insert(codebaseEdges)
      .values({
        fromSymbolId: symA!.id,
        toSymbolId: symB!.id,
        relation: "calls",
      })
      .returning();
    expect(edge?.relation).toBe("calls");

    const [prov] = await db
      .insert(decisionProvenance)
      .values({
        organizationId,
        deliverableId: deliv!.id,
        symbolId: symA!.id,
        filePath: "src/a.ts",
      })
      .returning();
    expect(prov?.filePath).toBe("src/a.ts");

    // Deletar fileB deve remover symB e edge em cascade
    await db.delete(codebaseFiles).where(eq(codebaseFiles.id, fileB!.id));
    const remainingEdges = await db.select().from(codebaseEdges);
    expect(remainingEdges).toHaveLength(0);
  });
});
