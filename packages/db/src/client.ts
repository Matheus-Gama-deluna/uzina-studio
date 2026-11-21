import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import type { DatabaseMode } from "@uzina/contracts";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate as migrateNodePg } from "drizzle-orm/node-postgres/migrator";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { Pool } from "pg";
import * as schema from "./schema/index.js";

export type UzinaSchema = typeof schema;
export type UzinaDb = PgliteDatabase<UzinaSchema> | NodePgDatabase<UzinaSchema>;

export interface DatabaseConfig {
  mode: DatabaseMode;
  connectionString?: string;
  dataDir?: string;
}

export interface GetDbOptions {
  dataDir?: string;
}

export interface UzinaDbContext {
  mode: DatabaseMode;
  db: UzinaDb;
  close: () => Promise<void>;
  ping: () => Promise<void>;
}

interface DbSingletonState {
  context?: UzinaDbContext;
  initPromise?: Promise<UzinaDbContext>;
  closingPromise?: Promise<void>;
  oneDriveWarned?: boolean;
  signalsRegistered?: boolean;
}

const SINGLETON_KEY = Symbol.for("@uzina/db/singleton");
const POSTGRES_ADVISORY_LOCK_ID = 847291;

function getSingletonState(): DbSingletonState {
  const holder = globalThis as Record<symbol, DbSingletonState | undefined>;
  let state = holder[SINGLETON_KEY];
  if (!state) {
    state = {};
    holder[SINGLETON_KEY] = state;
  }
  return state;
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

export function resolveDataDir(
  env: Record<string, string | undefined> = process.env
): string {
  const uzinaDir = env.UZINA_DATA_DIR?.trim();
  if (uzinaDir) {
    return uzinaDir;
  }
  const legacyDir = env.FACTORY_DATA_DIR?.trim();
  if (legacyDir) {
    return legacyDir;
  }
  return "./data";
}

export function resolveDatabaseConfig(
  env: Record<string, string | undefined> = process.env,
  options?: GetDbOptions
): DatabaseConfig {
  const rawUrl = env.DATABASE_URL?.trim();
  if (!rawUrl) {
    const baseDir = options?.dataDir ?? resolveDataDir(env);
    if (baseDir === ":memory:") {
      return { mode: "pglite", dataDir: ":memory:" };
    }
    const pgDataDir =
      path.basename(baseDir) === "pgdata" ? baseDir : path.join(baseDir, "pgdata");
    return { mode: "pglite", dataDir: pgDataDir };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
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

  return { mode: "postgres", connectionString: rawUrl };
}

function warnIfOneDrivePath(resolvedDir: string): void {
  if (resolvedDir === ":memory:") return;
  const state = getSingletonState();
  if (state.oneDriveWarned) return;
  const abs = path.resolve(resolvedDir);
  if (/onedrive/i.test(abs)) {
    state.oneDriveWarned = true;
    console.warn(
      `[uzina/db] Aviso: PGlite configurado em caminho dentro do OneDrive (${abs}). ` +
        "Defina UZINA_DATA_DIR fora do OneDrive para evitar locks EBUSY/EPERM."
    );
  }
}

function registerShutdownHooks(): void {
  const state = getSingletonState();
  if (state.signalsRegistered) return;
  state.signalsRegistered = true;

  const handleSignal = () => {
    void closeDb();
  };
  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);
}

async function createContext(options?: GetDbOptions): Promise<UzinaDbContext> {
  const config = resolveDatabaseConfig(process.env, options);
  const migrationsFolder = getMigrationsFolder();

  if (config.mode === "pglite") {
    const targetDir = config.dataDir ?? ":memory:";
    if (targetDir !== ":memory:") {
      warnIfOneDrivePath(targetDir);
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const client =
      targetDir === ":memory:" ? new PGlite() : new PGlite(targetDir);
    const db = drizzlePglite(client, { schema });
    await migratePglite(db, { migrationsFolder });

    return {
      mode: "pglite",
      db,
      ping: async () => {
        await client.query("SELECT 1");
      },
      close: async () => {
        await client.close();
      },
    };
  }

  const pool = new Pool({
    connectionString: config.connectionString,
    connectionTimeoutMillis: 2000,
  });
  const db = drizzlePg(pool, { schema });

  const lockClient = await pool.connect();
  try {
    await lockClient.query("SELECT pg_advisory_lock($1)", [
      POSTGRES_ADVISORY_LOCK_ID,
    ]);
    await migrateNodePg(db, { migrationsFolder });
  } finally {
    await lockClient
      .query("SELECT pg_advisory_unlock($1)", [POSTGRES_ADVISORY_LOCK_ID])
      .catch(() => undefined);
    lockClient.release();
  }

  return {
    mode: "postgres",
    db,
    ping: async () => {
      await pool.query("SELECT 1");
    },
    close: async () => {
      await pool.end();
    },
  };
}

export async function getDb(options?: GetDbOptions): Promise<UzinaDbContext> {
  const state = getSingletonState();
  if (state.closingPromise) {
    await state.closingPromise;
  }
  if (state.context) {
    return state.context;
  }
  if (!state.initPromise) {
    registerShutdownHooks();
    state.initPromise = createContext(options)
      .then((ctx) => {
        state.context = ctx;
        return ctx;
      })
      .catch((err: unknown) => {
        state.initPromise = undefined;
        throw err;
      });
  }
  return state.initPromise;
}

export async function closeDb(): Promise<void> {
  const state = getSingletonState();
  if (state.closingPromise) {
    await state.closingPromise;
    return;
  }
  const doClose = async () => {
    const active =
      state.context ??
      (state.initPromise
        ? await state.initPromise.catch(() => undefined)
        : undefined);
    state.context = undefined;
    state.initPromise = undefined;
    if (active) {
      await active.close();
    }
  };
  state.closingPromise = doClose().finally(() => {
    state.closingPromise = undefined;
  });
  await state.closingPromise;
}
