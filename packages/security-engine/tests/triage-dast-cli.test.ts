import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { assertDastTargetAllowed } from "../src/dast-guard.js";
import { triageFindings } from "../src/triage.js";
import { runCli } from "../src/cli.js";
import type { ExternalCommandRunner } from "../src/adapters.js";
import type { RawNormalizedFinding } from "../src/sarif.js";

describe("@uzina/security-engine — Triagem 3 Vereditos, DAST Guard & CLI Stateless", () => {
  test("triagem aplica suppressed_in_memory prévio, avaliador injetado e fallback offline em 3 vereditos", async () => {
    const baseFinding: RawNormalizedFinding = {
      ruleId: "uzina/native-secret",
      scanner: "native_secrets",
      severity: "high",
      filePath: "src/secrets.ts",
      lineStart: 8,
      title: "Secret detected",
      description: "Token [REDACTED_API_KEY]",
      fingerprint: "c".repeat(64),
    };
    const testFixtureFinding: RawNormalizedFinding = {
      ...baseFinding,
      filePath: "tests/fixtures/sample.test.ts",
      fingerprint: "d".repeat(64),
    };
    const evalFinding: RawNormalizedFinding = {
      ...baseFinding,
      filePath: "src/auth.ts",
      fingerprint: "e".repeat(64),
    };

    const triaged = await triageFindings([baseFinding, testFixtureFinding, evalFinding], {
      suppressionLookup: {
        async getSuppressedFingerprints(fps) {
          return new Set(fps.filter((fp) => fp === baseFinding.fingerprint));
        },
      },
      evaluator: {
        async evaluate(finding) {
          if (finding.fingerprint === evalFinding.fingerprint) {
            return {
              triageVerdict: "confirmed",
              triageRationale: "Confirmado em rota autenticada.",
            };
          }
          return {
            triageVerdict: "unknown",
            triageRationale: "Requer revisão manual.",
          };
        },
      },
    });

    expect(triaged[0]!.suppressedInMemory).toBe(true);
    expect(triaged[0]!.triageVerdict).toBe("false_positive");
    expect(triaged[1]!.triageVerdict).toBe("unknown");
    expect(triaged[2]!.triageVerdict).toBe("confirmed");
  });

  test.each([
    {
      name: "permite loopback quando explicitamente configurado na allowlist do servidor",
      url: "http://127.0.0.1:3000/health",
      allowlist: ["127.0.0.1"],
      resolvedIps: ["127.0.0.1"],
      ok: true,
    },
    {
      name: "permite domínio público allowlisted resolvendo para IP público",
      url: "https://staging.uzina.example/api",
      allowlist: ["staging.uzina.example"],
      resolvedIps: ["93.184.216.34"],
      ok: true,
    },
    {
      name: "bloqueia host fora da allowlist",
      url: "https://evil.internal/",
      allowlist: ["staging.uzina.example"],
      resolvedIps: ["93.184.216.34"],
      ok: false,
    },
    {
      name: "bloqueia metadata AWS/GCP mesmo se hostname estiver em allowlist (DNS Rebinding)",
      url: "https://staging.uzina.example/latest/meta-data",
      allowlist: ["staging.uzina.example"],
      resolvedIps: ["169.254.169.254"],
      ok: false,
    },
    {
      name: "bloqueia IPv4-mapped IPv6 privado via DNS",
      url: "https://staging.uzina.example/",
      allowlist: ["staging.uzina.example"],
      resolvedIps: ["::ffff:10.0.0.5"],
      ok: false,
    },
    {
      name: "bloqueia protocolo file:",
      url: "file:///etc/passwd",
      allowlist: ["localhost"],
      resolvedIps: ["127.0.0.1"],
      ok: false,
    },
  ])("DAST guard: $name", async ({ url, allowlist, resolvedIps, ok }) => {
    const exec = () =>
      assertDastTargetAllowed(url, {
        serverAllowlist: allowlist,
        lookupDns: async () =>
          resolvedIps.map((address) => ({
            address,
            family: address.includes(":") ? 6 : 4,
          })),
      });

    if (ok) {
      await expect(exec()).resolves.toMatchObject({ hostname: expect.any(String) });
    } else {
      await expect(exec()).rejects.toThrow();
    }
  });

  test("CLI stateless executa doctor, scan e valida --api-url sem abrir ./data/pgdata", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-cli-scan-"));
    const logs: string[] = [];
    const runner: ExternalCommandRunner = async () => ({
      status: "missing_binary",
      exitCode: null,
      stdout: "",
      stderr: "ENOENT",
      durationMs: 1,
    });

    try {
      fs.writeFileSync(
        path.join(tmpDir, "migration.sql"),
        "DROP TABLE critical_data;",
        "utf8"
      );

      const doctorCode = await runCli(["doctor"], {
        commandRunner: runner,
        stdout: (line) => logs.push(line),
        stderr: (line) => logs.push(line),
      });
      expect(doctorCode).toBe(0);
      expect(logs.join("\n")).toContain("skipped_missing_binary");

      const scanLogs: string[] = [];
      let postedBody: unknown = null;
      const scanCode = await runCli(
        [
          "scan",
          tmpDir,
          "--format",
          "sarif",
          "--api-url",
          "http://127.0.0.1:3000",
          "--token",
          "bearer-demo-token",
        ],
        {
          commandRunner: runner,
          fetchImpl: async (_url, init) => {
            postedBody = JSON.parse(String(init?.body ?? "{}"));
            return new Response(JSON.stringify({ id: crypto.randomUUID() }), {
              status: 201,
              headers: { "content-type": "application/json" },
            });
          },
          stdout: (line) => scanLogs.push(line),
          stderr: (line) => scanLogs.push(line),
        }
      );

      expect(scanCode).toBe(0);
      const parsedSarif = JSON.parse(scanLogs.join("\n")) as { version?: string };
      expect(parsedSarif.version).toBe("2.1.0");
      expect(postedBody).toMatchObject({
        targetType: "git_repo",
      });

      // Rejeita http:// não-loopback em --api-url
      const errLogs: string[] = [];
      const badCode = await runCli(
        ["scan", tmpDir, "--api-url", "http://remote.example.com", "--token", "x"],
        {
          commandRunner: runner,
          stdout: (line) => errLogs.push(line),
          stderr: (line) => errLogs.push(line),
        }
      );
      expect(badCode).toBe(1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
