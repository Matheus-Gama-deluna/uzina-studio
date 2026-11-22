import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { parseCliCommand, runCli, type MigrationReport } from "../src/index.js";

describe("@uzina/cli — Slice 6 CLI Unificada (start, dev, sec, db, doctor)", () => {
  const tempDirs: string[] = [];

  afterAll(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test.each([
    [["start", "--port", "4010", "--dry-run"], "start"],
    [["dev", "--port", "3005", "--host", "0.0.0.0", "--dry-run"], "dev"],
    [["doctor", "--json"], "doctor"],
    [["sec", "scan", ".", "--format", "summary"], "sec"],
    [
      [
        "db",
        "migrate-to-postgres",
        "--from",
        "./data",
        "--to",
        "postgresql://uzina:secret@localhost:5432/uzina",
      ],
      "db:migrate-to-postgres",
    ],
  ])("parseCliCommand interpreta comando válido %j", (argv, expectedCommand) => {
    const parsed = parseCliCommand(argv);
    expect(parsed.command).toBe(expectedCommand);
  });

  test.each([
    [["comando-inexistente"]],
    [["start", "--port", "70000"]],
    [["start", "--flag-invalida"]],
    [["db", "drop-all"]],
    [["db", "migrate-to-postgres", "--from", "./data", "--to", "http://localhost/pg"]],
  ])("parseCliCommand rejeita entradas e flags inválidas %j", (badArgv) => {
    expect(() => parseCliCommand(badArgv)).toThrow();
  });

  test("executa --help, --version, start --dry-run, dev --dry-run e doctor --json", async () => {
    const helpLines: string[] = [];
    const helpCode = await runCli(["--help"], {
      stdout: (line) => helpLines.push(line),
    });
    expect(helpCode).toBe(0);
    expect(helpLines.join("\n")).toContain("migrate-to-postgres");

    const versionLines: string[] = [];
    const versionCode = await runCli(["--version"], {
      stdout: (line) => versionLines.push(line),
    });
    expect(versionCode).toBe(0);
    expect(versionLines[0]).toContain("uzina-studio v");

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-cli-s6-"));
    tempDirs.push(tempDir);

    const startOut: string[] = [];
    const startCode = await runCli(
      ["start", "--port", "4200", "--data-dir", tempDir, "--dry-run"],
      {
        env: {},
        stdout: (line) => startOut.push(line),
      }
    );
    expect(startCode).toBe(0);
    const startPlan = JSON.parse(startOut[0]!) as {
      mode: string;
      port: number;
      databaseMode: string;
      singleProcess: boolean;
    };
    expect(startPlan.mode).toBe("start");
    expect(startPlan.port).toBe(4200);
    expect(startPlan.databaseMode).toBe("pglite");
    expect(startPlan.singleProcess).toBe(true);

    const doctorOut: string[] = [];
    const doctorCode = await runCli(["doctor", "--json", "--data-dir", tempDir], {
      env: {},
      stdout: (line) => doctorOut.push(line),
      checkGitAvailable: () => ({ ok: true, version: "git version 2.51.0" }),
      securityDeps: {
        commandRunner: async () => ({
          exitCode: 127,
          stdout: "",
          stderr: "ENOENT",
          missingBinary: true,
        }),
      },
    });
    expect(doctorCode).toBe(0);
    const doctorPayload = JSON.parse(doctorOut[0]!) as {
      nodeOk: boolean;
      databaseMode: string;
      git: { ok: boolean };
    };
    expect(doctorPayload.nodeOk).toBe(true);
    expect(doctorPayload.databaseMode).toBe("pglite");
    expect(doctorPayload.git.ok).toBe(true);
  });

  test("delega 'uzina sec scan' de forma stateless e mascara credenciais em 'uzina db migrate-to-postgres'", async () => {
    const scanDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-cli-sec-"));
    tempDirs.push(scanDir);
    fs.writeFileSync(path.join(scanDir, "safe.ts"), "export const ok = 1;\n");

    const secOut: string[] = [];
    const secCode = await runCli(
      ["sec", "scan", scanDir, "--format", "summary", "--no-triage"],
      {
        stdout: (line) => secOut.push(line),
        securityDeps: {
          commandRunner: async () => ({
            exitCode: 127,
            stdout: "",
            stderr: "ENOENT",
            missingBinary: true,
          }),
        },
      }
    );
    expect(secCode).toBe(0);
    const secSummary = JSON.parse(secOut[0]!) as { status: string };
    expect(secSummary.status).toBe("completed");

    const dbOut: string[] = [];
    const dbCode = await runCli(
      [
        "db",
        "migrate-to-postgres",
        "--from",
        scanDir,
        "--to",
        "postgresql://uzina:TOP_SECRET_PASS_99@db.prod.local:5432/uzina",
      ],
      {
        stdout: (line) => dbOut.push(line),
        migrateImpl: async (): Promise<MigrationReport> => ({
          dryRun: false,
          verified: true,
          targetRedacted: "postgresql://***:***@db.prod.local:5432/uzina",
          mastraLibsqlDetected: false,
          totalSourceRows: 4,
          totalTargetRows: 4,
          tables: [],
        }),
      }
    );

    expect(dbCode).toBe(0);
    expect(dbOut[0]).toContain("postgresql://***:***@db.prod.local:5432/uzina");
    expect(dbOut.join("\n")).not.toContain("TOP_SECRET_PASS_99");
  });
});
