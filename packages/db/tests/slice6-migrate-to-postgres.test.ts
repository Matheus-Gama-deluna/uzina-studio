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
  clients,
  decisions,
  deliverables,
  designAssets,
  ensureDefaultOrgAndInternalClient,
  executionEvents,
  memories,
  migrateDatabaseData,
  projectRepositories,
  projects,
  providerProfiles,
  redactDatabaseUrl,
  securityFindings,
  securityScans,
  users,
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

    await sourceDb.insert(memories).values({
      organizationId,
      scopeType: "org",
      scopeId: organizationId,
      category: "architecture",
      title: "Memória Preservada",
      content: "Usar Drizzle pg-core em PGlite e Postgres.",
      sourceDeliverableId: deliverable!.id,
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

    await sourceDb.insert(executionEvents).values({
      deliverableId: deliverable!.id,
      stage: "stage_finalize",
      actorRole: "executor",
      eventType: "stage_completed",
      payloadJson: { status: "merged" },
    });

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
    });

    expect(firstRun.dryRun).toBe(false);
    expect(firstRun.verified).toBe(true);
    expect(firstRun.totalSourceRows).toBeGreaterThanOrEqual(13);
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
    });

    expect(secondRun.verified).toBe(true);
    expect(secondRun.totalTargetRows).toBe(firstRun.totalTargetRows);
  });
});
