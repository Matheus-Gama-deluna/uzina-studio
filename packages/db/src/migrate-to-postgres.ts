import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { count } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migrateNodePg } from "drizzle-orm/node-postgres/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { Pool } from "pg";
import type { UzinaDb } from "./client.js";
import * as schema from "./schema/index.js";

export const MIGRATION_TABLE_ORDER = [
  "organizations",
  "users",
  "sessions",
  "accounts",
  "verifications",
  "provider_profiles",
  "clients",
  "projects",
  "project_repositories",
  "deliverables",
  "design_assets",
  "memories",
  "memory_chunks",
  "decisions",
  "security_scans",
  "security_findings",
  "execution_events",
  "codebase_files",
  "codebase_symbols",
  "codebase_edges",
  "decision_provenance",
  "design_prototypes",
] as const;

export type MigrationTableName = (typeof MIGRATION_TABLE_ORDER)[number];

export interface TableMigrationResult {
  table: MigrationTableName;
  sourceCount: number;
  copiedRows: number;
  targetCount: number;
  matched: boolean;
}

export interface MigrationReport {
  dryRun: boolean;
  verified: boolean;
  targetRedacted: string;
  mastraLibsqlDetected: boolean;
  tables: TableMigrationResult[];
  totalSourceRows: number;
  totalTargetRows: number;
}

export interface MigrateDatabaseOptions {
  sourceDataDir?: string;
  targetDatabaseUrl?: string;
  sourceDb?: UzinaDb;
  targetDb?: UzinaDb;
  dryRun?: boolean;
  batchSize?: number;
}

const TABLE_REGISTRY: ReadonlyArray<readonly [MigrationTableName, PgTable]> = [
  ["organizations", schema.organizations],
  ["users", schema.users],
  ["sessions", schema.sessions],
  ["accounts", schema.accounts],
  ["verifications", schema.verifications],
  ["provider_profiles", schema.providerProfiles],
  ["clients", schema.clients],
  ["projects", schema.projects],
  ["project_repositories", schema.projectRepositories],
  ["deliverables", schema.deliverables],
  ["design_assets", schema.designAssets],
  ["memories", schema.memories],
  ["memory_chunks", schema.memoryChunks],
  ["decisions", schema.decisions],
  ["security_scans", schema.securityScans],
  ["security_findings", schema.securityFindings],
  ["execution_events", schema.executionEvents],
  ["codebase_files", schema.codebaseFiles],
  ["codebase_symbols", schema.codebaseSymbols],
  ["codebase_edges", schema.codebaseEdges],
  ["decision_provenance", schema.decisionProvenance],
  ["design_prototypes", schema.designPrototypes],
];

const DEFAULT_BATCH_SIZE = 250;

export function validatePostgresUrl(rawUrl: string): URL {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error("DATABASE_URL de destino não informada.");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(
      "DATABASE_URL inválida: esperado URI com protocolo postgres:// ou postgresql://"
    );
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(
      `DATABASE_URL inválida: protocolo '${parsed.protocol}' não suportado (use postgres:// ou postgresql://)`
    );
  }

  return parsed;
}

export function redactDatabaseUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  try {
    const parsed = new URL(trimmed);
    const hasCredentials = parsed.username !== "" || parsed.password !== "";
    const redactedAuth = hasCredentials ? "***:***@" : "";
    const portPart = parsed.port ? `:${parsed.port}` : "";
    return `${parsed.protocol}//${redactedAuth}${parsed.hostname}${portPart}${parsed.pathname}`;
  } catch {
    return trimmed.replace(/\/\/[^/@\s]+@/g, "//***:***@");
  }
}

function getMigrationsFolder(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(currentDir, "..", "drizzle"),
    path.resolve(process.cwd(), "packages", "db", "drizzle"),
    path.resolve(process.cwd(), "..", "..", "packages", "db", "drizzle"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "meta", "_journal.json"))) {
      return candidate;
    }
  }

  throw new Error(
    `Pasta de migrações Drizzle não encontrada. Caminhos verificados: ${candidates.join(", ")}`
  );
}

type DbExecutor = Pick<UzinaDb, "select" | "insert">;

async function copyTableInTransaction(
  sourceDb: UzinaDb,
  targetTx: DbExecutor,
  tableName: MigrationTableName,
  table: PgTable,
  dryRun: boolean,
  batchSize: number
): Promise<TableMigrationResult> {
  const rows = (await sourceDb.select().from(table)) as Array<
    Record<string, unknown>
  >;
  const sourceCount = rows.length;

  if (dryRun) {
    const [targetCountRow] = await targetTx
      .select({ value: count() })
      .from(table);
    const targetCount = Number(targetCountRow?.value ?? 0);
    return {
      table: tableName,
      sourceCount,
      copiedRows: 0,
      targetCount,
      matched: true,
    };
  }

  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    if (batch.length > 0) {
      await targetTx.insert(table).values(batch).onConflictDoNothing();
    }
  }

  const [targetCountRow] = await targetTx
    .select({ value: count() })
    .from(table);
  const targetCount = Number(targetCountRow?.value ?? 0);

  return {
    table: tableName,
    sourceCount,
    copiedRows: sourceCount,
    targetCount,
    matched: targetCount >= sourceCount,
  };
}

async function executeMigration(
  sourceDb: UzinaDb,
  targetDb: UzinaDb,
  options: {
    dryRun: boolean;
    batchSize: number;
    targetRedacted: string;
    mastraLibsqlDetected: boolean;
  }
): Promise<MigrationReport> {
  const tables: TableMigrationResult[] = options.dryRun
    ? await (async () => {
        const dryResults: TableMigrationResult[] = [];
        for (const [tableName, table] of TABLE_REGISTRY) {
          dryResults.push(
            await copyTableInTransaction(
              sourceDb,
              targetDb,
              tableName,
              table,
              true,
              options.batchSize
            )
          );
        }
        return dryResults;
      })()
    : await targetDb.transaction(async (tx) => {
        const txResults: TableMigrationResult[] = [];
        for (const [tableName, table] of TABLE_REGISTRY) {
          txResults.push(
            await copyTableInTransaction(
              sourceDb,
              tx,
              tableName,
              table,
              false,
              options.batchSize
            )
          );
        }
        return txResults;
      });

  const totalSourceRows = tables.reduce((acc, item) => acc + item.sourceCount, 0);
  const totalTargetRows = tables.reduce((acc, item) => acc + item.targetCount, 0);
  const verified = tables.every((item) => item.matched);

  return {
    dryRun: options.dryRun,
    verified,
    targetRedacted: options.targetRedacted,
    mastraLibsqlDetected: options.mastraLibsqlDetected,
    tables,
    totalSourceRows,
    totalTargetRows,
  };
}

export async function migrateDatabaseData(
  options: MigrateDatabaseOptions
): Promise<MigrationReport> {
  const dryRun = options.dryRun ?? false;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const resolvedSourceDir = options.sourceDataDir
    ? path.resolve(options.sourceDataDir)
    : undefined;
  const mastraLibsqlDetected = resolvedSourceDir
    ? fs.existsSync(path.join(resolvedSourceDir, "mastra.db"))
    : false;

  if (options.sourceDb && options.targetDb) {
    const targetRedacted = options.targetDatabaseUrl
      ? redactDatabaseUrl(options.targetDatabaseUrl)
      : "injected://target";
    return executeMigration(options.sourceDb, options.targetDb, {
      dryRun,
      batchSize,
      targetRedacted,
      mastraLibsqlDetected,
    });
  }

  if (!resolvedSourceDir) {
    throw new Error(
      "sourceDataDir é obrigatório quando sourceDb não é injetado."
    );
  }
  const targetUrl = options.targetDatabaseUrl;
  if (!targetUrl) {
    throw new Error(
      "targetDatabaseUrl é obrigatória quando targetDb não é injetado."
    );
  }

  validatePostgresUrl(targetUrl);
  const targetRedacted = redactDatabaseUrl(targetUrl);
  const pgDataDir =
    path.basename(resolvedSourceDir) === "pgdata"
      ? resolvedSourceDir
      : path.join(resolvedSourceDir, "pgdata");

  if (!fs.existsSync(pgDataDir)) {
    throw new Error(`Diretório PGlite de origem não encontrado: ${pgDataDir}`);
  }

  const migrationsFolder = getMigrationsFolder();
  const sourceClient = new PGlite(pgDataDir);
  const targetPool = new Pool({
    connectionString: targetUrl,
    connectionTimeoutMillis: 5000,
  });

  try {
    const sourceDb = drizzlePglite(sourceClient, { schema });
    await migratePglite(sourceDb, { migrationsFolder });

    const targetDb = drizzlePg(targetPool, { schema });
    await migrateNodePg(targetDb, { migrationsFolder });

    return await executeMigration(sourceDb, targetDb, {
      dryRun,
      batchSize,
      targetRedacted,
      mastraLibsqlDetected,
    });
  } finally {
    await targetPool.end().catch(() => undefined);
    await sourceClient.close().catch(() => undefined);
  }
}
