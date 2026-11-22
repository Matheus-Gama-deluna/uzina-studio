import { describe, expect, test } from "vitest";
import {
  SarifLog21Schema,
  SecurityScanSummaryCountsSchema,
} from "@uzina/contracts";
import { runSecurityScan } from "../src/engine.js";
import type { ExternalCommandRunner } from "../src/adapters.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("@uzina/security-engine — Adaptadores Externos, Argument Injection & SARIF 2.1.0", () => {
  test("registra skipped_missing_binary no SARIF quando binários externos não estão instalados", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-sec-missing-"));
    try {
      fs.writeFileSync(
        path.join(tmpDir, "config.ts"),
        'export const token = "ghp_1234567890abcdefghijklmnopqrstuvwxyz1234";\n',
        "utf8"
      );

      const runner: ExternalCommandRunner = async () => ({
        status: "missing_binary",
        exitCode: null,
        stdout: "",
        stderr: "ENOENT",
        durationMs: 1,
      });

      const result = await runSecurityScan(
        {
          targetType: "git_repo",
          targetPath: tmpDir,
          targetRef: "HEAD",
          mode: "standalone",
          triage: true,
        },
        { commandRunner: runner }
      );

      expect(SarifLog21Schema.safeParse(result.sarifRawJson).success).toBe(true);
      expect(
        SecurityScanSummaryCountsSchema.safeParse(result.summaryCountsJson)
          .success
      ).toBe(true);

      const skipped = result.scannerStatuses.filter(
        (s) => s.status === "skipped_missing_binary"
      );
      expect(skipped.length).toBe(4);
      expect(result.summaryCountsJson.skippedScannersCount).toBe(4);
      expect(result.findings.length).toBeGreaterThanOrEqual(1);
      expect(
        JSON.stringify(result.sarifRawJson).includes(
          "ghp_1234567890abcdefghijklmnopqrstuvwxyz1234"
        )
      ).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("parseia outputs reais de gitleaks, opengrep (fallback semgrep), trivy e osv_scanner, redigindo segredos e usando -- sem flags maliciosas", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-sec-fake-"));
    try {
      fs.writeFileSync(path.join(tmpDir, "index.ts"), "export const a = 1;\n");

      const invocations: Array<{ bin: string; args: string[] }> = [];
      const runner: ExternalCommandRunner = async (bin, args) => {
        invocations.push({ bin, args });
        if (bin === "gitleaks") {
          return {
            status: "executed",
            exitCode: 1,
            stdout: JSON.stringify([
              {
                RuleID: "generic-api-key",
                Description: "Generic API Key",
                File: "src/app.ts",
                StartLine: 10,
                Secret: "sk-live-secret99887766554433221100",
                Match: 'apiKey = "sk-live-secret99887766554433221100"',
              },
            ]),
            stderr: "",
            durationMs: 25,
          };
        }
        if (bin === "opengrep") {
          return {
            status: "missing_binary",
            exitCode: null,
            stdout: "",
            stderr: "not found",
            durationMs: 1,
          };
        }
        if (bin === "semgrep") {
          return {
            status: "executed",
            exitCode: 0,
            stdout: JSON.stringify({
              results: [
                {
                  check_id: "ts.sql.injection",
                  path: "src/db.ts",
                  start: { line: 42 },
                  extra: {
                    severity: "ERROR",
                    message: "Possível SQL injection",
                  },
                },
              ],
            }),
            stderr: "",
            durationMs: 40,
          };
        }
        if (bin === "trivy") {
          return {
            status: "executed",
            exitCode: 0,
            stdout: JSON.stringify({
              Results: [
                {
                  Target: "package-lock.json",
                  Vulnerabilities: [
                    {
                      VulnerabilityID: "CVE-2025-9999",
                      PkgName: "lodash",
                      Severity: "HIGH",
                      Title: "Prototype Pollution",
                      Description: "Upgrade lodash",
                    },
                  ],
                },
              ],
            }),
            stderr: "",
            durationMs: 30,
          };
        }
        if (bin === "osv-scanner") {
          return {
            status: "executed",
            exitCode: 1,
            stdout: JSON.stringify({
              results: [
                {
                  source: { path: "pnpm-lock.yaml" },
                  packages: [
                    {
                      package: { name: "tar" },
                      vulnerabilities: [
                        {
                          id: "GHSA-1234-5678",
                          summary: "Arbitrary file overwrite",
                          database_specific: { severity: "CRITICAL" },
                        },
                      ],
                    },
                  ],
                },
              ],
            }),
            stderr: "",
            durationMs: 22,
          };
        }
        return {
          status: "missing_binary",
          exitCode: null,
          stdout: "",
          stderr: "",
          durationMs: 1,
        };
      };

      const result = await runSecurityScan(
        {
          targetType: "git_repo",
          targetPath: tmpDir,
          targetRef: "main",
          mode: "embedded",
          triage: true,
        },
        { commandRunner: runner }
      );

      // Todos os comandos externos devem conter separador `--` antes do caminho alvo
      for (const call of invocations) {
        expect(call.args).toContain("--");
      }

      // Opengrep faltante acionou fallback Semgrep
      expect(invocations.some((c) => c.bin === "semgrep")).toBe(true);
      expect(result.findings.some((f) => f.scanner === "gitleaks")).toBe(true);
      expect(
        result.findings.some((f) => f.scanner === "opengrep_semgrep")
      ).toBe(true);
      expect(result.findings.some((f) => f.scanner === "trivy")).toBe(true);
      expect(result.findings.some((f) => f.scanner === "osv_scanner")).toBe(
        true
      );

      // Segredo do gitleaks redigido no finding e no SARIF
      const rawAll = JSON.stringify(result);
      expect(rawAll).not.toContain("sk-live-secret99887766554433221100");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("rejeita targetRef iniciado por '-' para impedir argument injection", async () => {
    await expect(
      runSecurityScan({
        targetType: "git_diff",
        targetPath: process.cwd(),
        targetRef: "--upload-pack=calc.exe",
        mode: "standalone",
      })
    ).rejects.toThrow(/targetRef/i);
  });
});
