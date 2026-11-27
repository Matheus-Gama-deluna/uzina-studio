import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ScannerExecutionRecord,
  SecuritySeverity,
} from "@uzina/contracts";
import { redactSensitiveText } from "@uzina/core";
import {
  computeFindingFingerprint,
  redactFindingFields,
  type RawNormalizedFinding,
} from "./sarif.js";

export interface ExternalCommandResult {
  status: "executed" | "missing_binary" | "failed";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export type ExternalCommandRunner = (
  binary: string,
  args: string[],
  options: { cwd: string; timeoutMs: number; signal?: AbortSignal }
) => Promise<ExternalCommandResult>;

const MAX_STDERR_CHARS = 1024;
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;

export function sanitizeAdapterText(text: string): string {
  return redactSensitiveText(text).slice(0, MAX_STDERR_CHARS);
}

export function buildUzinaBinPath(): string {
  return path.join(os.homedir(), ".uzina", "bin");
}

function buildSanitizedChildEnv(): NodeJS.ProcessEnv {
  const uzinaBin = buildUzinaBinPath();
  const currentPath = process.env.PATH ?? "";
  return {
    PATH: currentPath ? `${uzinaBin}${path.delimiter}${currentPath}` : uzinaBin,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    SystemRoot: process.env.SystemRoot,
    NODE_ENV: process.env.NODE_ENV,
  };
}

export const defaultCommandRunner: ExternalCommandRunner = (
  binary,
  args,
  options
) => {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    if (options.signal?.aborted) {
      resolve({
        status: "failed",
        exitCode: null,
        stdout: "",
        stderr: "Execução abortada pelo chamador.",
        durationMs: Date.now() - startedAt,
      });
      return;
    }

    execFile(
      binary,
      args,
      {
        cwd: options.cwd,
        timeout: options.timeoutMs,
        maxBuffer: MAX_BUFFER_BYTES,
        shell: false,
        env: buildSanitizedChildEnv(),
        signal: options.signal,
      },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - startedAt;
        const errno = error as NodeJS.ErrnoException | null;
        if (errno?.code === "ENOENT") {
          resolve({
            status: "missing_binary",
            exitCode: null,
            stdout: "",
            stderr: "Binário não encontrado no PATH.",
            durationMs,
          });
          return;
        }
        const exitCode =
          typeof errno?.code === "number"
            ? errno.code
            : error
              ? 1
              : 0;
        resolve({
          status: "executed",
          exitCode,
          stdout: typeof stdout === "string" ? stdout : "",
          stderr: sanitizeAdapterText(typeof stderr === "string" ? stderr : ""),
          durationMs,
        });
      }
    );
  });
};

function mapExternalSeverity(raw: unknown): SecuritySeverity {
  const normalized = String(raw ?? "").trim().toUpperCase();
  if (normalized === "CRITICAL") return "critical";
  if (normalized === "HIGH" || normalized === "ERROR") return "high";
  if (normalized === "MEDIUM" || normalized === "WARNING") return "medium";
  if (normalized === "LOW" || normalized === "INFO" || normalized === "NOTE") {
    return normalized === "INFO" ? "info" : "low";
  }
  return "medium";
}

function parseGitleaksJson(stdout: string): RawNormalizedFinding[] {
  if (!stdout.trim()) return [];
  const items = JSON.parse(stdout) as Array<{
    RuleID?: string;
    Description?: string;
    File?: string;
    StartLine?: number;
    Secret?: string;
    Match?: string;
  }>;
  if (!Array.isArray(items)) return [];

  return items.map((item) => {
    const secret = item.Secret ?? "";
    const ruleId = item.RuleID || "gitleaks/secret";
    const filePath = item.File ?? null;
    const lineStart = typeof item.StartLine === "number" && item.StartLine >= 1 ? item.StartLine : null;
    const rawSnippet = item.Match ?? secret;
    const fingerprint = computeFindingFingerprint({
      ruleId,
      scanner: "gitleaks",
      filePath,
      lineStart,
      rawSnippet,
    });
    return redactFindingFields(
      {
        ruleId,
        scanner: "gitleaks",
        severity: "critical",
        filePath,
        lineStart,
        title: item.Description || `Segredo detectado (${ruleId})`,
        description: `Gitleaks encontrou correspondência em ${filePath ?? "repositório"}: ${rawSnippet}`,
        fingerprint,
      },
      secret ? [secret] : []
    );
  });
}

function parseSemgrepLikeJson(stdout: string): RawNormalizedFinding[] {
  if (!stdout.trim()) return [];
  const parsed = JSON.parse(stdout) as {
    results?: Array<{
      check_id?: string;
      path?: string;
      start?: { line?: number };
      extra?: { severity?: string; message?: string; lines?: string };
    }>;
  };
  if (!Array.isArray(parsed.results)) return [];

  return parsed.results.map((r) => {
    const ruleId = r.check_id || "sast/rule";
    const filePath = r.path ?? null;
    const lineStart =
      typeof r.start?.line === "number" && r.start.line >= 1
        ? r.start.line
        : null;
    const rawSnippet = r.extra?.lines ?? r.extra?.message ?? ruleId;
    const fingerprint = computeFindingFingerprint({
      ruleId,
      scanner: "opengrep_semgrep",
      filePath,
      lineStart,
      rawSnippet,
    });
    return redactFindingFields({
      ruleId,
      scanner: "opengrep_semgrep",
      severity: mapExternalSeverity(r.extra?.severity),
      filePath,
      lineStart,
      title: ruleId,
      description: r.extra?.message || "Apontamento SAST detectado.",
      fingerprint,
    });
  });
}

function parseTrivyJson(stdout: string): RawNormalizedFinding[] {
  if (!stdout.trim()) return [];
  const parsed = JSON.parse(stdout) as {
    Results?: Array<{
      Target?: string;
      Vulnerabilities?: Array<{
        VulnerabilityID?: string;
        PkgName?: string;
        Severity?: string;
        Title?: string;
        Description?: string;
      }>;
    }>;
  };
  const findings: RawNormalizedFinding[] = [];
  for (const res of parsed.Results ?? []) {
    for (const vuln of res.Vulnerabilities ?? []) {
      const ruleId = vuln.VulnerabilityID || "trivy/vuln";
      const filePath = res.Target ?? null;
      const fingerprint = computeFindingFingerprint({
        ruleId,
        scanner: "trivy",
        filePath,
        lineStart: 1,
        rawSnippet: `${vuln.PkgName ?? ""}:${ruleId}`,
      });
      findings.push(
        redactFindingFields({
          ruleId,
          scanner: "trivy",
          severity: mapExternalSeverity(vuln.Severity),
          filePath,
          lineStart: 1,
          title: vuln.Title || `${ruleId} em ${vuln.PkgName ?? "dependência"}`,
          description: vuln.Description || "Vulnerabilidade detectada pelo Trivy.",
          fingerprint,
        })
      );
    }
  }
  return findings;
}

function parseOsvScannerJson(stdout: string): RawNormalizedFinding[] {
  if (!stdout.trim()) return [];
  const parsed = JSON.parse(stdout) as {
    results?: Array<{
      source?: { path?: string };
      packages?: Array<{
        package?: { name?: string };
        vulnerabilities?: Array<{
          id?: string;
          summary?: string;
          database_specific?: { severity?: string };
        }>;
      }>;
    }>;
  };
  const findings: RawNormalizedFinding[] = [];
  for (const res of parsed.results ?? []) {
    const filePath = res.source?.path ?? null;
    for (const pkg of res.packages ?? []) {
      for (const vuln of pkg.vulnerabilities ?? []) {
        const ruleId = vuln.id || "osv/vuln";
        const fingerprint = computeFindingFingerprint({
          ruleId,
          scanner: "osv_scanner",
          filePath,
          lineStart: 1,
          rawSnippet: `${pkg.package?.name ?? ""}:${ruleId}`,
        });
        findings.push(
          redactFindingFields({
            ruleId,
            scanner: "osv_scanner",
            severity: mapExternalSeverity(vuln.database_specific?.severity ?? "HIGH"),
            filePath,
            lineStart: 1,
            title: `${ruleId} (${pkg.package?.name ?? "pacote"})`,
            description: vuln.summary || "Vulnerabilidade conhecida via OSV.",
            fingerprint,
          })
        );
      }
    }
  }
  return findings;
}

export interface AdapterSpec {
  id: "gitleaks" | "opengrep_semgrep" | "trivy" | "osv_scanner";
  binaries: string[];
  installHint: string;
  buildArgs: (targetPath: string) => string[];
  parseOutput: (stdout: string) => RawNormalizedFinding[];
}

export function resolveBundledOpengrepRulesPath(): string {
  const candidates = [
    fileURLToPath(new URL("../rules/uzina-sast-core.yaml", import.meta.url)),
    path.resolve(
      process.cwd(),
      "packages/security-engine/rules/uzina-sast-core.yaml"
    ),
    path.resolve(
      process.cwd(),
      "../../packages/security-engine/rules/uzina-sast-core.yaml"
    ),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(/*turbopackIgnore: true*/ candidate)) {
      return candidate;
    }
  }
  return candidates[0]!;
}

export const EXTERNAL_SCANNER_SPECS: readonly AdapterSpec[] = [
  {
    id: "gitleaks",
    binaries: ["gitleaks"],
    installHint: "uzina-sec install-tools (ou brew/winget install gitleaks)",
    buildArgs: (targetPath) => [
      "detect",
      "--no-git",
      "--report-format",
      "json",
      "--report-path",
      "-",
      "--exit-code",
      "0",
      "--source",
      "--",
      targetPath,
    ],
    parseOutput: parseGitleaksJson,
  },
  {
    id: "opengrep_semgrep",
    binaries: ["opengrep", "semgrep"],
    installHint: "uzina-sec install-tools (Opengrep / Semgrep OSS)",
    buildArgs: (targetPath) => [
      "scan",
      "--no-git-ignore",
      "--config",
      resolveBundledOpengrepRulesPath(),
      "--json",
      "--quiet",
      "--",
      targetPath,
    ],
    parseOutput: parseSemgrepLikeJson,
  },
  {
    id: "trivy",
    binaries: ["trivy"],
    installHint: "uzina-sec install-tools (aquasecurity/trivy)",
    buildArgs: (targetPath) => buildTrivyFsArgs(targetPath),
    parseOutput: parseTrivyJson,
  },
  {
    id: "osv_scanner",
    binaries: ["osv-scanner"],
    installHint: "uzina-sec install-tools (google/osv-scanner)",
    buildArgs: (targetPath) => [
      "--format",
      "json",
      "-r",
      "--",
      targetPath,
    ],
    parseOutput: parseOsvScannerJson,
  },
];

export function buildTrivyFsArgs(
  targetPath: string,
  env: Record<string, string | undefined> = process.env
): string[] {
  const rawCacheDir =
    env.TRIVY_CACHE_DIR?.trim() ||
    path.join(
      env.UZINA_DATA_DIR?.trim() || path.resolve(process.cwd(), ".uzina-data"),
      "trivy-cache"
    );
  const cacheDir = assertSafeScanArg("cacheDir", rawCacheDir);
  const hasCachedDb =
    fs.existsSync(/*turbopackIgnore: true*/ path.join(cacheDir, "db", "trivy.db")) ||
    fs.existsSync(/*turbopackIgnore: true*/ path.join(cacheDir, "trivy.db"));
  const offline =
    env.UZINA_TRIVY_OFFLINE?.trim() === "1" ||
    env.UZINA_TRIVY_OFFLINE?.trim()?.toLowerCase() === "true";

  return [
    "fs",
    "--format",
    "json",
    "--quiet",
    "--cache-dir",
    cacheDir,
    ...(hasCachedDb || offline ? ["--skip-db-update"] : []),
    ...(offline ? ["--offline-scan"] : []),
    "--",
    targetPath,
  ];
}

export function assertSafeScanArg(label: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("-")) {
    throw new Error(
      `Parâmetro '${label}' inválido: não pode estar vazio nem iniciar com '-'.`
    );
  }
  return trimmed;
}

export async function runExternalScanners(params: {
  targetPath: string;
  selectedScanners?: readonly string[];
  commandRunner?: ExternalCommandRunner;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<{
  findings: RawNormalizedFinding[];
  statuses: ScannerExecutionRecord[];
}> {
  const safePath = assertSafeScanArg("targetPath", params.targetPath);
  const runner = params.commandRunner ?? defaultCommandRunner;
  const timeoutMs = params.timeoutMs ?? 60_000;
  const selectedSet = params.selectedScanners
    ? new Set(params.selectedScanners)
    : null;

  const findings: RawNormalizedFinding[] = [];
  const statuses: ScannerExecutionRecord[] = [];

  for (const spec of EXTERNAL_SCANNER_SPECS) {
    if (selectedSet && !selectedSet.has(spec.id)) {
      continue;
    }

    let executedResult: ExternalCommandResult | null = null;
    let usedBinary: string = spec.binaries[0]!;

    for (const bin of spec.binaries) {
      usedBinary = bin;
      const res = await runner(bin, spec.buildArgs(safePath), {
        cwd: safePath,
        timeoutMs,
        signal: params.signal,
      });
      if (res.status === "missing_binary") {
        continue;
      }
      executedResult = res;
      break;
    }

    if (!executedResult) {
      statuses.push({
        scanner: spec.id,
        status: "skipped_missing_binary",
        binaryName: spec.binaries[0] ?? spec.id,
        installHint: spec.installHint,
        findingsCount: 0,
        durationMs: 1,
        errorMessage: `Binário (${spec.binaries.join(" ou ")}) não encontrado no PATH.`,
      });
      continue;
    }

    if (executedResult.status === "failed") {
      statuses.push({
        scanner: spec.id,
        status: "failed",
        binaryName: usedBinary,
        installHint: spec.installHint,
        findingsCount: 0,
        durationMs: executedResult.durationMs,
        errorMessage: sanitizeAdapterText(
          executedResult.stderr || `Erro ao executar ${usedBinary}`
        ),
      });
      continue;
    }

    try {
      const parsed = spec.parseOutput(executedResult.stdout);
      findings.push(...parsed);
      statuses.push({
        scanner: spec.id,
        status: "executed",
        binaryName: usedBinary,
        installHint: null,
        findingsCount: parsed.length,
        durationMs: executedResult.durationMs,
        errorMessage: null,
      });
    } catch (error) {
      statuses.push({
        scanner: spec.id,
        status: "failed",
        binaryName: usedBinary,
        installHint: spec.installHint,
        findingsCount: 0,
        durationMs: executedResult.durationMs,
        errorMessage: sanitizeAdapterText(
          error instanceof Error ? error.message : String(error)
        ),
      });
    }
  }

  return { findings, statuses };
}
