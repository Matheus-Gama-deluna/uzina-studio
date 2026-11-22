import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { afterAll, describe, expect, test } from "vitest";
import * as schema from "../src/schema/index.js";
import {
  MIGRATION_TABLE_ORDER,
  accounts,
  clients,
  codebaseEdges,
  codebaseFiles,
  codebaseSymbols,
  decisionProvenance,
  decisions,
  deliverables,
  designAssets,
  designPrototypes,
  ensureDefaultOrgAndInternalClient,
  executionEvents,
  memories,
  memoryChunks,
  migrateDatabaseData,
  organizations,
  projectRepositories,
  projects,
  providerProfiles,
  redactDatabaseUrl,
  securityFindings,
  securityScans,
  sessions,
  users,
  verifications,
  validatePostgresUrl,
} from "../src/index.js";

const MIGRATIONS_FOLDER = path.resolve(import.meta.dirname, "../drizzle");

describe("@uzina/db — Slice 6 migrate-to-postgres (Idempotência, Ordem Topológica & Redação)", () => {
  const openClients: PGlite[] = [];
  const tempDirs: string[] = [];

  afterAll(async () => {
    for (const client of openClients) {
      await client.close().catch(() => undefined);
    }
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test.each([
    [
      "postgresql://uzina:super-secret-pass@db.example.com:5432/uzina_prod",
      "postgresql://***:***@db.example.com:5432/uzina_prod",
    ],
    [
      "postgres://admin:p@ss!123@10.0.0.5/appdb?sslmode=require",
      "postgres://***:***@10.0.0.5/appdb",
    ],
    ["postgres://localhost:5432/uzina_dev", "postgres://localhost:5432/uzina_dev"],
  ])(
    "redactDatabaseUrl mascara credenciais sensíveis em %s",
    (inputUrl, expectedRedacted) => {
      const masked = redactDatabaseUrl(inputUrl);
      expect(masked).toBe(expectedRedacted);
      expect(masked).not.toContain("super-secret-pass");
      expect(masked).not.toContain("p@ss!123");
    }
  );

  test.each([
    [""],
    ["not-a-url"],
    ["http://localhost:5432/uzina"],
    ["mysql://user:pass@localhost:3306/uzina"],
  ])("validatePostgresUrl rejeita URI inválida %s", (invalidUrl) => {
    expect(() => validatePostgresUrl(invalidUrl)).toThrow();
  });

  test("migra todas as entidades em ordem topológica com transação, dryRun e reexecução idempotente", async () => {
    const sourceClient = new PGlite();
    const targetClient = new PGlite();
    openClients.push(sourceClient, targetClient);

    const sourceDb = drizzlePglite(sourceClient, { schema });
    const targetDb = drizzlePglite(targetClient, { schema });

    await migratePglite(sourceDb, { migrationsFolder: MIGRATIONS_FOLDER });
    await migratePglite(targetDb, { migrationsFolder: MIGRATIONS_FOLDER });

    const { organizationId, internalClientId } =
      await ensureDefaultOrgAndInternalClient(sourceDb);

    const tempSourceDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "uzina-migrate-s6-")
    );
    tempDirs.push(tempSourceDir);
    fs.writeFileSync(path.join(tempSourceDir, "mastra.db"), "");

    const suffix = crypto.randomUUID().slice(0, 8);
    const [user] = await sourceDb
      .insert(users)
      .values({
        name: "Operador Migração",
        email: `migracao-${suffix}@uzina.local`,
        organizationId,
        role: "owner",
      })
      .returning();

    const [profile] = await sourceDb
      .insert(providerProfiles)
      .values({
        organizationId,
        name: "Perfil OpenRouter Cifrado",
        providerType: "openrouter",
        encryptedApiKey: "v1:iv12:tag16:cipher",
        keyPreview: "sk-or-***99",
      })
      .returning();

    const [project] = await sourceDb
      .insert(projects)
      .values({
        clientId: internalClientId,
        name: "Projeto Migração Slice 6",
        slug: `proj-mig-${suffix}`,
      })
      .returning();

    const [repo] = await sourceDb
      .insert(projectRepositories)
      .values({
        projectId: project!.id,
        name: "repo-core",
        localPath: "/tmp/repo-core",
      })
      .returning();

    const [deliverable] = await sourceDb
      .insert(deliverables)
      .values({
        projectId: project!.id,
        repositoryId: repo!.id,
        title: "Entrega Migrada",
        status: "merged",
      })
      .returning();

    await sourceDb.insert(designAssets).values({
      projectId: project!.id,
      deliverableId: deliverable!.id,
      assetType: "design_md",
      title: "DESIGN.md",
    });

    const [mem] = await sourceDb
      .insert(memories)
      .values({
        organizationId,
        scopeType: "org",
        scopeId: organizationId,
        category: "architecture",
        title: "Memória Preservada",
        content: "Usar Drizzle pg-core em PGlite e Postgres.",
        sourceDeliverableId: deliverable!.id,
      })
      .returning();

    await sourceDb.insert(memoryChunks).values({
      organizationId,
      sourceType: "memory",
      memoryId: mem!.id,
      scopeType: "org",
      scopeId: organizationId,
      headingPath: "Memória Preservada",
      lineStart: 1,
      lineEnd: 1,
      content: "Usar Drizzle pg-core em PGlite e Postgres.",
      contentHash: `hash-${suffix}`,
      embedding: Array.from({ length: 384 }, (_, idx) => (idx === 0 ? 1 : 0)),
      embeddingModel: "deterministic-trigram-384",
    });

    await sourceDb.insert(decisions).values({
      deliverableId: deliverable!.id,
      mastraStepId: "stage_decision",
      decisionType: "pr_evidence_approve",
      summary: "Aprovação migrada",
      payloadJson: { verifyPassed: true },
      resolvedBy: user!.id,
      status: "approved",
    });

    const [scan] = await sourceDb
      .insert(securityScans)
      .values({
        organizationId,
        projectId: project!.id,
        deliverableId: deliverable!.id,
        mode: "lightweight",
        targetType: "worktree",
        targetRef: "packages/core",
        scannersRun: ["native_secrets"],
        scannerStatusesJson: [],
        sarifRawJson: {
          version: "2.1.0",
          $schema:
            "https://json.schemastore.org/sarif-2.1.0.json",
          runs: [],
        },
        summaryCountsJson: {
          critical: 0,
          high: 1,
          medium: 0,
          low: 0,
          info: 0,
          skippedScanners: 0,
        },
        status: "completed",
      })
      .returning();

    await sourceDb.insert(securityFindings).values({
      scanId: scan!.id,
      projectId: project!.id,
      ruleId: "UZINA-TEST-001",
      scanner: "native_secrets",
      severity: "high",
      title: "Achado Teste",
      description: "Descrição redigida",
      fingerprint: `fp-${suffix}`,
    });

    await sourceDb.insert(sessions).values({
      userId: user!.id,
      token: `tok-${suffix}`,
      expiresAt: new Date(Date.now() + 3600_000),
    });

    await sourceDb.insert(accounts).values({
      userId: user!.id,
      accountId: `acc-${suffix}`,
      providerId: "credential",
    });

    await sourceDb.insert(verifications).values({
      identifier: `migracao-${suffix}@uzina.local`,
      value: `code-${suffix}`,
      expiresAt: new Date(Date.now() + 600_000),
    });

    await sourceDb.insert(executionEvents).values({
      deliverableId: deliverable!.id,
      stage: "stage_finalize",
      actorRole: "executor",
      eventType: "stage_completed",
      payloadJson: { status: "merged" },
    });

    const [cbFile1] = await sourceDb
      .insert(codebaseFiles)
      .values({
        repositoryId: repo!.id,
        path: "src/index.ts",
        sha256: "a".repeat(64),
        language: "typescript",
        size: 100,
      })
      .returning();

    const [cbFile2] = await sourceDb
      .insert(codebaseFiles)
      .values({
        repositoryId: repo!.id,
        path: "src/helper.ts",
        sha256: "b".repeat(64),
        language: "typescript",
        size: 80,
      })
      .returning();

    const [cbSym1] = await sourceDb
      .insert(codebaseSymbols)
      .values({
        fileId: cbFile1!.id,
        kind: "function",
        name: "main",
        signature: "export function main()",
        lineStart: 1,
        lineEnd: 5,
        exported: true,
      })
      .returning();

    const [cbSym2] = await sourceDb
      .insert(codebaseSymbols)
      .values({
        fileId: cbFile2!.id,
        kind: "function",
        name: "help",
        signature: "export function help()",
        lineStart: 1,
        lineEnd: 3,
        exported: true,
      })
      .returning();

    await sourceDb.insert(codebaseEdges).values({
      fromSymbolId: cbSym1!.id,
      toSymbolId: cbSym2!.id,
      relation: "calls",
    });

    await sourceDb.insert(decisionProvenance).values({
      organizationId,
      deliverableId: deliverable!.id,
      memoryId: mem!.id,
      symbolId: cbSym1!.id,
      filePath: "src/index.ts",
    });

    await sourceDb.insert(designPrototypes).values({
      projectId: project!.id,
      deliverableId: deliverable!.id,
      level: 3,
      source: "stitch_import",
      title: "Protótipo Migrado",
      htmlStoragePath: "uploads/prototypes/demo.html",
      tokensJson: {
        color: { primary: { $value: "#38bdf8", $type: "color" } },
        typography: { body: { $value: "Inter, sans-serif", $type: "fontFamily" } },
        spacing: { md: { $value: "1.00rem", $type: "dimension" } },
        radius: { lg: { $value: "0.50rem", $type: "dimension" } },
      },
      approved: true,
    });

    // Inserir 2 clientes adicionais para exercitar batchSize: 2
    await sourceDb.insert(clients).values([
      {
        organizationId,
        name: `Cliente Batch 1 ${suffix}`,
        slug: `cli-batch-1-${suffix}`,
      },
      {
        organizationId,
        name: `Cliente Batch 2 ${suffix}`,
        slug: `cli-batch-2-${suffix}`,
      },
    ]);

    const dryReport = await migrateDatabaseData({
      sourceDb,
      targetDb,
      sourceDataDir: tempSourceDir,
      targetDatabaseUrl: "postgresql://uzina:secret@pg.internal:5432/uzina",
      dryRun: true,
    });

    expect(dryReport.dryRun).toBe(true);
    expect(dryReport.verified).toBe(true);
    expect(dryReport.mastraLibsqlDetected).toBe(true);
    expect(dryReport.targetRedacted).toBe("postgresql://***:***@pg.internal:5432/uzina");
    expect(dryReport.targetRedacted).not.toContain("secret");
    expect(dryReport.totalTargetRows).toBe(0);
    expect(dryReport.tables.map((t) => t.table)).toEqual([...MIGRATION_TABLE_ORDER]);

    const firstRun = await migrateDatabaseData({
      sourceDb,
      targetDb,
      sourceDataDir: tempSourceDir,
      targetDatabaseUrl: "postgresql://uzina:secret@pg.internal:5432/uzina",
      batchSize: 2,
    });

    expect(firstRun.dryRun).toBe(false);
    expect(firstRun.verified).toBe(true);
    expect(firstRun.tables.every((t) => t.sourceCount >= 1 && t.matched)).toBe(true);
    expect(firstRun.totalTargetRows).toBe(firstRun.totalSourceRows);

    const [migratedProfile] = await targetDb
      .select()
      .from(providerProfiles)
      .where(eq(providerProfiles.id, profile!.id));
    expect(migratedProfile?.encryptedApiKey).toBe("v1:iv12:tag16:cipher");

    const [migratedClient] = await targetDb
      .select()
      .from(clients)
      .where(eq(clients.id, internalClientId));
    expect(migratedClient?.isDefaultInternal).toBe(true);

    // Reexecução idempotente no mesmo destino não duplica registros e mantém verified === true
    const secondRun = await migrateDatabaseData({
      sourceDb,
      targetDb,
      sourceDataDir: tempSourceDir,
      targetDatabaseUrl: "postgresql://uzina:secret@pg.internal:5432/uzina",
      batchSize: 2,
    });

    expect(secondRun.verified).toBe(true);
    expect(secondRun.totalTargetRows).toBe(firstRun.totalTargetRows);
  });

  test("falha para pgdata inexistente e executa rollback transacional se falhar no meio da migração", async () => {
    const missingDir = path.join(os.tmpdir(), `uzina-missing-${crypto.randomUUID()}`);
    await expect(
      migrateDatabaseData({
        sourceDataDir: missingDir,
        targetDatabaseUrl: "postgresql://uzina:secret@localhost:5432/uzina",
      })
    ).rejects.toThrow("Diretório PGlite de origem não encontrado");

    const sourceClient = new PGlite();
    const emptyTargetClient = new PGlite();
    openClients.push(sourceClient, emptyTargetClient);

    const sourceDb = drizzlePglite(sourceClient, { schema });
    const badTargetDb = drizzlePglite(emptyTargetClient, { schema });

    await migratePglite(sourceDb, { migrationsFolder: MIGRATIONS_FOLDER });
    await migratePglite(badTargetDb, { migrationsFolder: MIGRATIONS_FOLDER });

    const { organizationId } = await ensureDefaultOrgAndInternalClient(sourceDb);
    await sourceDb.insert(users).values({
      name: "Rollback User",
      email: `rb-${crypto.randomUUID().slice(0, 6)}@uzina.local`,
      organizationId,
      role: "owner",
    });

    // Força erro na 2a tabela removendo 'users' no destino para validar atomicidade da transação
    await emptyTargetClient.exec("DROP TABLE users CASCADE;");

    await expect(
      migrateDatabaseData({
        sourceDb,
        targetDb: badTargetDb,
        targetDatabaseUrl: "postgresql://uzina:secret@localhost:5432/uzina",
      })
    ).rejects.toThrow();

    // Se a transação sofreu rollback, organizations inserida no passo 1 não deve permanecer no destino
    const leftoverOrgs = await badTargetDb.select().from(organizations);
    expect(leftoverOrgs).toHaveLength(0);
  });
});
