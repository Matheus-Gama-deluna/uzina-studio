import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { LibSQLStore } from "@mastra/libsql";
import { PostgresStore } from "@mastra/pg";
import { resolveDataDir } from "@uzina/db";

export type MastraStorageConfig =
  | {
      mode: "libsql";
      url: string;
    }
  | {
      mode: "postgres";
      connectionString: string;
      schemaName: "mastra";
    };

export interface MastraStorageOptions {
  dataDir?: string;
  databaseUrl?: string;
}

export type UzinaMastraStore = LibSQLStore | PostgresStore;

interface MastraStorageSingletonState {
  store?: UzinaMastraStore;
  configKey?: string;
  initPromise?: Promise<UzinaMastraStore>;
  closingPromise?: Promise<void>;
}

const SINGLETON_KEY = Symbol.for("@uzina/mastra-runtime/singleton");

function getSingletonState(): MastraStorageSingletonState {
  const holder = globalThis as Record<
    symbol,
    MastraStorageSingletonState | undefined
  >;
  if (!holder[SINGLETON_KEY]) {
    holder[SINGLETON_KEY] = {};
  }
  return holder[SINGLETON_KEY];
}

export function resolveMastraStorageConfig(
  options: MastraStorageOptions = {}
): MastraStorageConfig {
  const rawDbUrl =
    options.databaseUrl !== undefined
      ? options.databaseUrl
      : process.env.DATABASE_URL;
  const trimmedUrl = rawDbUrl?.trim();

  if (trimmedUrl && trimmedUrl.length > 0) {
    return {
      mode: "postgres",
      connectionString: trimmedUrl,
      schemaName: "mastra",
    };
  }

  const rawDataDir = options.dataDir ?? resolveDataDir();
  if (rawDataDir === ":memory:") {
    return {
      mode: "libsql",
      url: ":memory:",
    };
  }

  const resolvedDir = path.resolve(/*turbopackIgnore: true*/ rawDataDir);
  fs.mkdirSync(/*turbopackIgnore: true*/ resolvedDir, { recursive: true });
  const dbPath = path.join(/*turbopackIgnore: true*/ resolvedDir, "mastra.db");

  return {
    mode: "libsql",
    url: pathToFileURL(dbPath).href,
  };
}

export function createMastraStorage(
  options: MastraStorageOptions = {}
): UzinaMastraStore {
  const cfg = resolveMastraStorageConfig(options);
  if (cfg.mode === "postgres") {
    return new PostgresStore({
      id: "uzina-mastra",
      connectionString: cfg.connectionString,
      schemaName: cfg.schemaName,
    });
  }

  return new LibSQLStore({
    id: "uzina-mastra",
    url: cfg.url,
  });
}

function buildConfigKey(cfg: MastraStorageConfig): string {
  return cfg.mode === "postgres"
    ? `postgres:${cfg.schemaName}:${cfg.connectionString}`
    : `libsql:${cfg.url}`;
}

export async function getMastraStorageSingleton(
  options: MastraStorageOptions = {}
): Promise<UzinaMastraStore> {
  const state = getSingletonState();
  if (state.closingPromise) {
    await state.closingPromise;
  }

  const cfg = resolveMastraStorageConfig(options);
  const key = buildConfigKey(cfg);

  if (state.store && state.configKey === key) {
    return state.store;
  }

  if (state.initPromise) {
    const inFlight = await state.initPromise;
    if (state.configKey === key) {
      return inFlight;
    }
  }

  if (state.store && state.configKey !== key) {
    await closeMastraStorage();
  }

  state.configKey = key;
  state.initPromise = (async () => {
    const store = createMastraStorage(options);
    await store.init();
    state.store = store;
    return store;
  })();

  try {
    return await state.initPromise;
  } finally {
    state.initPromise = undefined;
  }
}

export async function closeMastraStorage(): Promise<void> {
  const state = getSingletonState();
  if (state.closingPromise) {
    return state.closingPromise;
  }

  state.closingPromise = (async () => {
    if (state.initPromise) {
      try {
        await state.initPromise;
      } catch {
        // Ignore initialization error while closing
      }
    }
    const store = state.store;
    state.store = undefined;
    state.configKey = undefined;
    if (store) {
      await store.close();
    }
  })();

  try {
    await state.closingPromise;
  } finally {
    state.closingPromise = undefined;
  }
}

export async function resetMastraStorageForTests(): Promise<void> {
  await closeMastraStorage();
}
