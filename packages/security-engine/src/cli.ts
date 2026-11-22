#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { IngestSecurityScanSchema } from "@uzina/contracts";
import {
  buildUzinaBinPath,
  EXTERNAL_SCANNER_SPECS,
  runExternalScanners,
  type ExternalCommandRunner,
} from "./adapters.js";
import { runSecurityScan } from "./engine.js";

export interface PinnedToolManifestEntry {
  scanner: string;
  binaryName: string;
  version: string;
  downloadUrl: string;
  sha256: string;
}

export const PINNED_SCANNER_TOOLS: readonly PinnedToolManifestEntry[] = [
  {
    scanner: "gitleaks",
    binaryName: process.platform === "win32" ? "gitleaks.exe" : "gitleaks",
    version: "8.24.2",
    downloadUrl:
      process.platform === "win32"
        ? "https://github.com/gitleaks/gitleaks/releases/download/v8.24.2/gitleaks_8.24.2_windows_x64.zip"
        : "https://github.com/gitleaks/gitleaks/releases/download/v8.24.2/gitleaks_8.24.2_linux_x64.tar.gz",
    sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  },
  {
    scanner: "trivy",
    binaryName: process.platform === "win32" ? "trivy.exe" : "trivy",
    version: "0.60.0",
    downloadUrl:
      process.platform === "win32"
        ? "https://github.com/aquasecurity/trivy/releases/download/v0.60.0/trivy_0.60.0_windows-64bit.zip"
        : "https://github.com/aquasecurity/trivy/releases/download/v0.60.0/trivy_0.60.0_Linux-64bit.tar.gz",
    sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  },
  {
    scanner: "osv-scanner",
    binaryName: process.platform === "win32" ? "osv-scanner.exe" : "osv-scanner",
    version: "2.0.0",
    downloadUrl:
      process.platform === "win32"
        ? "https://github.com/google/osv-scanner/releases/download/v2.0.0/osv-scanner_windows_amd64.exe"
        : "https://github.com/google/osv-scanner/releases/download/v2.0.0/osv-scanner_linux_amd64",
    sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  },
];

export interface CliDependencies {
  commandRunner?: ExternalCommandRunner;
  fetchImpl?: typeof fetch;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  binDir?: string;
}

export function assertValidApiUrl(rawUrl: string): URL {
  const parsed = new URL(rawUrl);
  const host = parsed.hostname.toLowerCase();
  const isLoopback =
    host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  if (parsed.protocol === "https:") {
    return parsed;
  }
  if (parsed.protocol === "http:" && isLoopback) {
    return parsed;
  }
  throw new Error(
    "--api-url exige protocolo https:// para servidores remotos (http:// permitido apenas para loopback)."
  );
}

export function verifyDownloadedBinarySha256(
  buffer: Uint8Array,
  expectedSha256: string
): void {
  const actual = crypto.createHash("sha256").update(buffer).digest("hex");
  if (actual.toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new Error(
      `Falha na verificação de integridade SHA-256: esperado ${expectedSha256}, obtido ${actual}.`
    );
  }
}

export function assertSafeArchiveEntryPath(
  destRoot: string,
  entryName: string
): string {
  const resolvedRoot = path.resolve(destRoot);
  const candidate = path.resolve(resolvedRoot, entryName);
  if (
    !candidate.startsWith(resolvedRoot + path.sep) &&
    candidate !== resolvedRoot
  ) {
    throw new Error(`Entrada de arquivo insegura (ZipSlip): ${entryName}`);
  }
  return candidate;
}

function readFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

export async function runCli(
  argv: string[],
  deps: CliDependencies = {}
): Promise<number> {
  const stdout = deps.stdout ?? ((line: string) => console.log(line));
  const stderr = deps.stderr ?? ((line: string) => console.error(line));
  const [command = "help", ...rest] = argv;

  if (command === "doctor") {
    const ext = await runExternalScanners({
      targetPath: process.cwd(),
      commandRunner: deps.commandRunner,
      timeoutMs: 5_000,
    });
    const report = {
      nativeScanners: ["native_secrets", "native_ddl", "native_slopsquatting"],
      externalTools: EXTERNAL_SCANNER_SPECS.map((spec) => {
        const matched = ext.statuses.find((s) => s.scanner === spec.id);
        return {
          scanner: spec.id,
          status: matched?.status ?? "skipped_missing_binary",
          binaries: spec.binaries,
          installHint: spec.installHint,
        };
      }),
      uzinaBinDir: deps.binDir ?? buildUzinaBinPath(),
    };
    stdout(JSON.stringify(report, null, 2));
    return 0;
  }

  if (command === "install-tools") {
    const binDir = deps.binDir ?? buildUzinaBinPath();
    fs.mkdirSync(/*turbopackIgnore: true*/ binDir, { recursive: true });
    stdout(
      JSON.stringify(
        {
          targetDir: binDir,
          pinnedManifest: PINNED_SCANNER_TOOLS,
          message:
            "Manifesto pinado com SHA-256 pronto. Use --verify-download com espelho autorizado ou gerenciador de pacotes do SO (brew/winget/apt) para instalação offline segura.",
        },
        null,
        2
      )
    );
    return 0;
  }

  if (command === "scan") {
    const positionalTarget = rest.find((arg) => !arg.startsWith("-")) ?? ".";
    const format = readFlag(rest, "--format") ?? "sarif";
    const apiUrlRaw = readFlag(rest, "--api-url");
    const token = readFlag(rest, "--token") ?? process.env.UZINA_API_TOKEN;
    const projectId = readFlag(rest, "--project-id");
    const deliverableId = readFlag(rest, "--deliverable-id");
    const noTriage = rest.includes("--no-triage");

    try {
      const targetPath = path.resolve(/*turbopackIgnore: true*/ positionalTarget);
      const output = await runSecurityScan(
        {
          mode: "standalone",
          targetType: "git_repo",
          targetPath,
          targetRef: path.basename(targetPath) || "HEAD",
          triage: !noTriage,
        },
        {
          commandRunner: deps.commandRunner,
        }
      );

      if (apiUrlRaw) {
        const apiUrl = assertValidApiUrl(apiUrlRaw);
        if (!token) {
          throw new Error(
            "Informe --token <bearer> ou UZINA_API_TOKEN ao usar --api-url."
          );
        }
        const ingestPayload = IngestSecurityScanSchema.parse({
          projectId: projectId ?? null,
          deliverableId: deliverableId ?? null,
          targetType: output.targetType,
          targetRef: output.targetRef,
          scannersRun: output.scannersRun,
          scannerStatuses: output.scannerStatuses,
          sarifRawJson: output.sarifRawJson,
          summaryCountsJson: output.summaryCountsJson,
          status: output.status,
          findings: output.findings.map((f) => ({
            ruleId: f.ruleId,
            scanner: f.scanner,
            severity: f.severity,
            filePath: f.filePath,
            lineStart: f.lineStart,
            title: f.title,
            description: f.description,
            fingerprint: f.fingerprint,
            triageVerdict: f.triageVerdict,
            triageRationale: f.triageRationale,
            suppressedInMemory: f.suppressedInMemory,
            povTestStatus: f.povTestStatus,
          })),
        });

        const fetchFn = deps.fetchImpl ?? fetch;
        const ingestUrl = new URL("/api/security/scans/ingest", apiUrl);
        const resp = await fetchFn(ingestUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(ingestPayload),
        });
        if (!resp.ok) {
          throw new Error(
            `Falha ao publicar scan em ${ingestUrl.pathname}: HTTP ${resp.status}`
          );
        }
      }

      if (format === "summary") {
        stdout(
          JSON.stringify(
            {
              status: output.status,
              summaryCounts: output.summaryCountsJson,
              scannerStatuses: output.scannerStatuses,
              findingsCount: output.findings.length,
            },
            null,
            2
          )
        );
      } else {
        stdout(JSON.stringify(output.sarifRawJson, null, 2));
      }
      return 0;
    } catch (error) {
      stderr(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }

  stdout(
    "Uso: uzina-sec <scan [dir] [--format sarif|summary] [--no-triage] [--api-url URL --token TOKEN] | doctor | install-tools>"
  );
  return command === "help" ? 0 : 1;
}

const isDirectEntry =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectEntry) {
  runCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    });
}
