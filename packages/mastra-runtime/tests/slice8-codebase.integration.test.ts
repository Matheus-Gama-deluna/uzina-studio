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
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  computeProjectChangeImpactScoped,
  getProjectCodebaseTreeScoped,
  listDecisionProvenanceScoped,
  queryProjectSymbolsScoped,
  readProjectSymbolSliceScoped,
  recordDeliverableProvenance,
  resetMastraStorageForTests,
  syncRepositoryCodebase,
} from "../src/index.js";

function createTempRepoFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-s8-runtime-"));
  fs.mkdirSync(path.join(dir, "src", "api"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "src", "billing.ts"),
    `export function calculateTax(amount: number): number {
  const pad1 = "long_commentary_padding_for_skeleton_savings_comparison_001";
  const pad2 = "long_commentary_padding_for_skeleton_savings_comparison_002";
  return Math.round(amount * 0.15) + pad1.length * 0 + pad2.length * 0;
}
`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(dir, "src", "api", "route.ts"),
    `import { calculateTax } from "../billing.js";
export async function POST() {
  return Response.json({ tax: calculateTax(100) });
}
`,
    "utf8"
  );
  return dir;
}

describe("@uzina/mastra-runtime — Slice 8 Codebase Intelligence (Incremental, Grafo, Provenance & Tenant)", () => {
  let db: UzinaDb;
  let organizationId: string;
  let projectId: string;
  let deliverableId: string;
  let repoId: string;
  let repoDir: string;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    await resetMastraStorageForTests();
    await closeDb();
    const ctx = await getDb({ dataDir: ":memory:" });
    db = ctx.db;
    const seeded = await ensureDefaultOrgAndInternalClient(db);
    organizationId = seeded.organizationId;

    repoDir = createTempRepoFixture();
    tempDirs.push(repoDir);

    const [client] = await db
      .insert(clients)
      .values({
        organizationId,
        name: "Cliente Codebase",
        slug: `cli-cb-${crypto.randomUUID().slice(0, 5)}`,
      })
      .returning();

    const [proj] = await db
      .insert(projects)
      .values({
        clientId: client!.id,
        name: "Projeto Codebase",
        slug: `proj-cb-${crypto.randomUUID().slice(0, 5)}`,
      })
      .returning();
    projectId = proj!.id;

    const [repo] = await db
      .insert(projectRepositories)
      .values({
        projectId,
        name: "repo-cb",
        localPath: repoDir,
      })
      .returning();
    repoId = repo!.id;

    const [deliv] = await db
      .insert(deliverables)
      .values({
        projectId,
        repositoryId: repoId,
        title: "Entrega Billing",
        status: "merged",
      })
      .returning();
    deliverableId = deliv!.id;
  });

  afterAll(async () => {
    await resetMastraStorageForTests();
    await closeDb();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("executa reindexação incremental por SHA-256, remoção de deletados, grafo, slice, impacto, provenance e isolamento multi-tenant", async () => {
    // 1. Indexação inicial
    const first = await syncRepositoryCodebase(db, {
      organizationId,
      projectId,
      repositoryId: repoId,
      workspaceRoot: repoDir,
    });
    expect(first.indexedFiles).toBe(2);
    expect(first.skippedUnchangedFiles).toBe(0);
    expect(first.totalSymbols).toBeGreaterThanOrEqual(2);
    expect(first.totalEdges).toBeGreaterThanOrEqual(1);

    // 2. Reindex sem alteração deve pular os 2 arquivos
    const unchanged = await syncRepositoryCodebase(db, {
      organizationId,
      projectId,
      repositoryId: repoId,
      workspaceRoot: repoDir,
    });
    expect(unchanged.indexedFiles).toBe(0);
    expect(unchanged.skippedUnchangedFiles).toBe(2);

    // 3. Alterar apenas 1 arquivo -> apenas 1 reindexado, 1 skipped
    fs.writeFileSync(
      path.join(repoDir, "src", "billing.ts"),
      `export function calculateTax(amount: number): number {
  return Math.round(amount * 0.2);
}
export function helperBilling(): string {
  return "ok";
}
`,
      "utf8"
    );
    const incremental = await syncRepositoryCodebase(db, {
      organizationId,
      projectId,
      repositoryId: repoId,
      workspaceRoot: repoDir,
    });
    expect(incremental.indexedFiles).toBe(1);
    expect(incremental.skippedUnchangedFiles).toBe(1);

    // 4. Tree + Skeleton + Graph + Impact + Slice
    const tree = await getProjectCodebaseTreeScoped(db, {
      organizationId,
      projectId,
      repositoryId: repoId,
      workspaceRoot: repoDir,
    });
    expect(tree.filesCount).toBe(2);
    expect(tree.skeleton.skeletonText).toContain("calculateTax");
    expect(tree.adapters.some((a) => a.adapter === "qmd")).toBe(true);

    const graph = await queryProjectSymbolsScoped(db, {
      organizationId,
      projectId,
      query: { symbol: "calculateTax", depth: 2, maxResults: 10 },
    });
    expect(graph.nodes.some((n) => n.name === "POST")).toBe(true);

    const impact = await computeProjectChangeImpactScoped(db, {
      organizationId,
      projectId,
      request: { changedFiles: ["src/billing.ts"] },
    });
    expect(impact.affectedRoutes.some((r) => r.name === "POST")).toBe(true);

    const slice = await readProjectSymbolSliceScoped(db, {
      organizationId,
      projectId,
      workspaceRoot: repoDir,
      request: {
        path: "src/billing.ts",
        symbol: "helperBilling",
        maxBytes: 2048,
      },
    });
    expect(slice.code).toContain("helperBilling");
    expect(slice.lineStart).toBeGreaterThanOrEqual(4);

    // 5. Provenance
    const insertedProv = await recordDeliverableProvenance(db, {
      organizationId,
      deliverableId,
      repositoryId: repoId,
      filePaths: ["src/billing.ts"],
    });
    expect(insertedProv).toBe(1);

    const provList = await listDecisionProvenanceScoped(db, {
      organizationId,
      projectId,
      query: { path: "src/billing.ts", limit: 10 },
    });
    expect(provList.entries).toHaveLength(1);
    expect(provList.entries[0]?.symbolId).toBeTruthy();

    // 6. Deletar um arquivo -> remoção automática no reindex
    fs.unlinkSync(path.join(repoDir, "src", "api", "route.ts"));
    const afterDelete = await syncRepositoryCodebase(db, {
      organizationId,
      projectId,
      repositoryId: repoId,
      workspaceRoot: repoDir,
    });
    expect(afterDelete.removedFiles).toBe(1);

    // 7. Isolamento multi-tenant
    const [otherOrg] = await db
      .insert(organizations)
      .values({
        name: "Outra Org S8",
        slug: `other-s8-${crypto.randomUUID().slice(0, 5)}`,
      })
      .returning();

    await expect(
      getProjectCodebaseTreeScoped(db, {
        organizationId: otherOrg!.id,
        projectId,
      })
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
