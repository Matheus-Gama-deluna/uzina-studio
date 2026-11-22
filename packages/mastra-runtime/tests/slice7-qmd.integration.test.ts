import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  clients,
  closeDb,
  ensureDefaultOrgAndInternalClient,
  getDb,
  memoryChunks,
  projects,
  type UzinaDb,
} from "@uzina/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  createMemoryScoped,
  deleteMemoryScoped,
  reindexWorkspaceQmd,
  searchQmdScoped,
} from "../src/index.js";

describe("@uzina/mastra-runtime — Slice 7 Motor QMD Híbrido & Isolamento Multi-Tenant", () => {
  let db: UzinaDb;
  let organizationId: string;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    await closeDb();
    const ctx = await getDb({ dataDir: ":memory:" });
    db = ctx.db;
    const seeded = await ensureDefaultOrgAndInternalClient(db);
    organizationId = seeded.organizationId;
  });

  afterAll(async () => {
    await closeDb();
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("indexa Markdown e memórias com redação, encontra termo exato (BM25) + bilíngue PT-BR/EN (vetor) e isola Cliente A vs B", async () => {
    const suffix = crypto.randomUUID().slice(0, 6);
    const [clientA] = await db
      .insert(clients)
      .values({
        organizationId,
        name: "Banco Alpha",
        slug: `banco-alpha-${suffix}`,
      })
      .returning();
    const [clientB] = await db
      .insert(clients)
      .values({
        organizationId,
        name: "Varejo Beta",
        slug: `varejo-beta-${suffix}`,
      })
      .returning();

    const [projA] = await db
      .insert(projects)
      .values({
        clientId: clientA!.id,
        name: "Core Pix",
        slug: `core-pix-${suffix}`,
      })
      .returning();
    const [projB] = await db
      .insert(projects)
      .values({
        clientId: clientB!.id,
        name: "Loja Beta",
        slug: `loja-beta-${suffix}`,
      })
      .returning();

    // Memória global com termo técnico em inglês e segredo que deve ser redigido
    const orgMem = await createMemoryScoped(db, {
      organizationId,
      input: {
        scopeType: "org",
        scopeId: organizationId,
        category: "architecture",
        title: "Vault RBAC Enforcement",
        content:
          "RBAC role tenant isolation and vault AES encryption require VAULT_WRITE_ROLES. Nunca expor sk-or-v1-1234567890abcdef1234567890abcdef.",
      },
    });

    // Memória exclusiva do Cliente A (NUNCA pode aparecer no Projeto B)
    await createMemoryScoped(db, {
      organizationId,
      input: {
        scopeType: "client",
        scopeId: clientA!.id,
        category: "domain_rule",
        title: "Regra Confidencial Alpha",
        content: "Taxa Pix exclusiva do Banco Alpha com chave VAULT_WRITE_ROLES_ALPHA.",
      },
    });

    // Memória exclusiva do Projeto B
    await createMemoryScoped(db, {
      organizationId,
      input: {
        scopeType: "project",
        scopeId: projB!.id,
        category: "convention",
        title: "Checkout Varejo Beta",
        content: "Usar carrinho headless no Projeto Beta.",
      },
    });

    // Arquivos Markdown temporários (.uzina e docs) + .env ignorado
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-qmd-s7-"));
    tempDirs.push(tempRoot);
    fs.mkdirSync(path.join(tempRoot, ".uzina"), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, "docs", "adr"), { recursive: true });
    fs.writeFileSync(
      path.join(tempRoot, ".env"),
      "SECRET_KEY=sk-live-9999999999999999999999999"
    );
    fs.writeFileSync(
      path.join(tempRoot, ".uzina", "steering.md"),
      "# Steering\n## Banco Dual-Mode\nUsa PGlite local e PostgreSQL em VPS.\n"
    );
    fs.writeFileSync(
      path.join(tempRoot, "docs", "adr", "004.md"),
      "# ADR-004\n## Embeddings\nPipeline QMD com BM25 e vetor 384d.\n"
    );

    const reindexFirst = await reindexWorkspaceQmd(db, {
      organizationId,
      rootDir: tempRoot,
      request: { includeDocs: true, force: false },
    });
    expect(reindexFirst.indexedDocFiles).toBe(2);
    expect(reindexFirst.totalChunks).toBeGreaterThanOrEqual(5);

    // 1. Busca lexical por identificador técnico exato
    const lexicalRes = await searchQmdScoped(db, {
      organizationId,
      request: {
        query: "VAULT_WRITE_ROLES",
        mode: "lexical",
        projectId: projB!.id,
        limit: 5,
      },
    });
    expect(lexicalRes.hits[0]?.memoryId).toBe(orgMem.id);
    expect(lexicalRes.hits[0]?.snippet).not.toContain(
      "sk-or-v1-1234567890abcdef1234567890abcdef"
    );
    expect(lexicalRes.hits.every((h) => h.scopeId !== clientA!.id)).toBe(true);

    // 2. Busca vetorial em português encontra documento em inglês técnico + docs Markdown
    const vectorRes = await searchQmdScoped(db, {
      organizationId,
      request: {
        query: "isolamento de permissões e cofre criptográfico",
        mode: "vector",
        projectId: projB!.id,
        limit: 5,
      },
    });
    expect(vectorRes.hits.some((h) => h.memoryId === orgMem.id)).toBe(true);
    expect(vectorRes.hits.every((h) => h.scopeId !== clientA!.id)).toBe(true);

    // 3. Busca híbrida no Projeto B vê Org + Docs + Projeto B, mas JAMAIS Cliente A / .env
    const hybridB = await searchQmdScoped(db, {
      organizationId,
      request: {
        query: "Regra Confidencial Alpha",
        mode: "hybrid",
        projectId: projB!.id,
        limit: 5,
      },
    });
    expect(hybridB.hits.every((h) => h.scopeId !== clientA!.id)).toBe(true);
    expect(hybridB.contextTree.some((n) => n.directory === "docs/adr")).toBe(
      true
    );

    // 4. Projeto de outra organização recebe vazio (anti-IDOR)
    const crossOrgRes = await searchQmdScoped(db, {
      organizationId: crypto.randomUUID(),
      request: {
        query: "VAULT_WRITE_ROLES",
        projectId: projA!.id,
        mode: "hybrid",
      },
    });
    expect(crossOrgRes.hits).toHaveLength(0);

    // 5. Deletar memória limpa chunks em cascade
    await deleteMemoryScoped(db, { id: orgMem.id, organizationId });
    const leftover = await db
      .select()
      .from(memoryChunks)
      .where(eq(memoryChunks.memoryId, orgMem.id));
    expect(leftover).toHaveLength(0);
  });
});
