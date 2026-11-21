import path from "node:path";
import { describe, expect, test } from "vitest";
import { resolveDataDir, resolveDatabaseConfig } from "../src/index.js";

describe("@uzina/db — resolveDataDir", () => {
  test.each([
    {
      label: "prioriza UZINA_DATA_DIR sobre FACTORY_DATA_DIR",
      env: { UZINA_DATA_DIR: "./custom-uzina", FACTORY_DATA_DIR: "./legacy" },
      expected: "./custom-uzina",
    },
    {
      label: "usa FACTORY_DATA_DIR como fallback se UZINA_DATA_DIR ausente",
      env: { FACTORY_DATA_DIR: "./legacy-factory" },
      expected: "./legacy-factory",
    },
    {
      label: "ignora espaços em branco e usa ./data como default",
      env: { UZINA_DATA_DIR: "   ", FACTORY_DATA_DIR: "" },
      expected: "./data",
    },
    {
      label: "preserva modo especial :memory:",
      env: { UZINA_DATA_DIR: ":memory:" },
      expected: ":memory:",
    },
  ])("$label", ({ env, expected }) => {
    expect(resolveDataDir(env as NodeJS.ProcessEnv)).toBe(expected);
  });
});

describe("@uzina/db — resolveDatabaseConfig (Dual-Mode)", () => {
  test.each([
    {
      label: "sem DATABASE_URL seleciona pglite em disco",
      env: { UZINA_DATA_DIR: "./tmp-data" },
      expectedMode: "pglite",
      expectedDataDir: path.join("./tmp-data", "pgdata"),
    },
    {
      label: "DATABASE_URL vazia seleciona pglite em memória",
      env: { DATABASE_URL: "   ", UZINA_DATA_DIR: ":memory:" },
      expectedMode: "pglite",
      expectedDataDir: ":memory:",
    },
    {
      label: "DATABASE_URL postgres:// seleciona postgres",
      env: { DATABASE_URL: "postgres://uzina:uzina@localhost:5432/uzina_dev" },
      expectedMode: "postgres",
      expectedConn: "postgres://uzina:uzina@localhost:5432/uzina_dev",
    },
    {
      label: "DATABASE_URL postgresql:// seleciona postgres",
      env: { DATABASE_URL: "postgresql://uzina:uzina@db.internal:5432/prod" },
      expectedMode: "postgres",
      expectedConn: "postgresql://uzina:uzina@db.internal:5432/prod",
    },
  ])("$label", ({ env, expectedMode, expectedDataDir, expectedConn }) => {
    const config = resolveDatabaseConfig(env as NodeJS.ProcessEnv);
    expect(config.mode).toBe(expectedMode);
    if (expectedDataDir !== undefined) {
      expect(config.dataDir).toBe(expectedDataDir);
    }
    if (expectedConn !== undefined) {
      expect(config.connectionString).toBe(expectedConn);
    }
  });

  test.each([
    { raw: "mysql://user:pass@localhost:3306/db" },
    { raw: "http://localhost:5432/db" },
    { raw: "not-a-valid-url" },
    { raw: "postgre://typo:pass@localhost:5432/db" },
  ])("lança erro fail-fast para DATABASE_URL inválida: $raw", ({ raw }) => {
    expect(() =>
      resolveDatabaseConfig({ DATABASE_URL: raw } as NodeJS.ProcessEnv)
    ).toThrow(/DATABASE_URL inválida/i);
  });
});
