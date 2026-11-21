import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  closeMastraStorage,
  createMastraStorage,
  getMastraStorageSingleton,
  resetMastraStorageForTests,
  resolveMastraStorageConfig,
} from "../src/storage.js";

describe("@uzina/mastra-runtime — Storage Dual-Mode (LibSQL / Postgres)", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await resetMastraStorageForTests();
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      try {
        fs.rmSync(dir, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 150,
        });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EBUSY") {
          throw err;
        }
      }
    }
  });

  test("resolveMastraStorageConfig seleciona libsql :memory:, file:// no Windows e postgres com schema mastra", () => {
    const memCfg = resolveMastraStorageConfig({
      dataDir: ":memory:",
      databaseUrl: undefined,
    });
    expect(memCfg).toEqual({ mode: "libsql", url: ":memory:" });

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-mastra-cfg-"));
    tempDirs.push(dir);
    const fileCfg = resolveMastraStorageConfig({
      dataDir: dir,
      databaseUrl: "",
    });
    expect(fileCfg.mode).toBe("libsql");
    if (fileCfg.mode === "libsql") {
      expect(fileCfg.url.startsWith("file:///")).toBe(true);
      expect(fileCfg.url.endsWith("mastra.db")).toBe(true);
    }

    const pgCfg = resolveMastraStorageConfig({
      dataDir: dir,
      databaseUrl: "postgresql://uzina:secret@localhost:5432/uzina",
    });
    expect(pgCfg).toEqual({
      mode: "postgres",
      connectionString: "postgresql://uzina:secret@localhost:5432/uzina",
      schemaName: "mastra",
    });
  });

  test("createMastraStorage instancia LibSQLStore em disco e PostgresStore sem vazar schema errado", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-mastra-store-"));
    tempDirs.push(dir);
    const nested = path.join(dir, "nested-data");

    const localStore = createMastraStorage({
      dataDir: nested,
      databaseUrl: undefined,
    });
    expect(fs.existsSync(nested)).toBe(true);
    await localStore.init();
    expect(fs.existsSync(path.join(nested, "mastra.db"))).toBe(true);
    await localStore.close();

    const pgStore = createMastraStorage({
      databaseUrl: "postgresql://uzina:secret@localhost:5432/uzina",
    });
    expect(pgStore.constructor.name).toBe("PostgresStore");
    await pgStore.close();
  });

  test("getMastraStorageSingleton deduplica Promise.all concorrente e fecha via closeMastraStorage", async () => {
    const [a, b] = await Promise.all([
      getMastraStorageSingleton({ dataDir: ":memory:", databaseUrl: undefined }),
      getMastraStorageSingleton({ dataDir: ":memory:", databaseUrl: undefined }),
    ]);
    expect(a).toBe(b);
    await closeMastraStorage();

    const c = await getMastraStorageSingleton({
      dataDir: ":memory:",
      databaseUrl: undefined,
    });
    expect(c).not.toBe(a);

    // Troca de configKey (dataDir diferente) substitui o singleton anterior com segurança
    const altDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-mastra-switch-"));
    tempDirs.push(altDir);
    const d = await getMastraStorageSingleton({
      dataDir: altDir,
      databaseUrl: undefined,
    });
    expect(d).not.toBe(c);
    expect(fs.existsSync(path.join(altDir, "mastra.db"))).toBe(true);
  });
});
