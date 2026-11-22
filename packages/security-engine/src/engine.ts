import type {
  SarifLog21,
  ScannerExecutionRecord,
  SecurityScanMode,
  SecurityScanSummaryCounts,
  SecurityTargetType,
} from "@uzina/contracts";
import {
  assertSafeScanArg,
  runExternalScanners,
  type ExternalCommandRunner,
} from "./adapters.js";
import { assertDastTargetAllowed, type DastGuardOptions } from "./dast-guard.js";
import {
  collectTargetFiles,
  scanDdlNative,
  scanSecretsNative,
  scanSlopsquattingNative,
} from "./native-scanners.js";
import {
  buildSarifLog,
  summarizeFindings,
  type RawNormalizedFinding,
  type TriagedFinding,
} from "./sarif.js";
import {
  triageFindings,
  type FindingSuppressionLookup,
  type SecurityTriageEvaluator,
} from "./triage.js";

export interface RunSecurityScanRequest {
  mode: SecurityScanMode;
  targetType: SecurityTargetType;
  targetPath?: string;
  targetRef: string;
  changedRelativePaths?: readonly string[];
  scanners?: readonly string[];
  triage?: boolean;
}

export interface RunSecurityScanDeps {
  commandRunner?: ExternalCommandRunner;
  suppressionLookup?: FindingSuppressionLookup;
  evaluator?: SecurityTriageEvaluator;
  dastGuard?: DastGuardOptions;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ExecutedSecurityScanOutput {
  mode: SecurityScanMode;
  targetType: SecurityTargetType;
  targetRef: string;
  scannersRun: string[];
  scannerStatuses: ScannerExecutionRecord[];
  findings: TriagedFinding[];
  sarifRawJson: SarifLog21;
  summaryCountsJson: SecurityScanSummaryCounts;
  status: "completed" | "failed";
}

export async function runSecurityScan(
  request: RunSecurityScanRequest,
  deps: RunSecurityScanDeps = {}
): Promise<ExecutedSecurityScanOutput> {
  const safeTargetRef = assertSafeScanArg("targetRef", request.targetRef);

  if (request.targetType === "staging_url") {
    const allowedUrl = await assertDastTargetAllowed(
      safeTargetRef,
      deps.dastGuard ?? { serverAllowlist: [] }
    );
    const statusRecord: ScannerExecutionRecord = {
      scanner: "dast_url_guard",
      status: "executed",
      binaryName: null,
      installHint: null,
      findingsCount: 0,
      durationMs: 1,
      errorMessage: null,
    };
    const sarif = buildSarifLog({
      findings: [],
      scannerStatuses: [statusRecord],
    });
    return {
      mode: request.mode,
      targetType: request.targetType,
      targetRef: allowedUrl.toString(),
      scannersRun: ["dast_url_guard"],
      scannerStatuses: [statusRecord],
      findings: [],
      sarifRawJson: sarif,
      summaryCountsJson: summarizeFindings([], [statusRecord]),
      status: "completed",
    };
  }

  const targetPath = assertSafeScanArg(
    "targetPath",
    request.targetPath ?? process.cwd()
  );
  const files = collectTargetFiles(
    targetPath,
    request.targetType === "git_diff" ? request.changedRelativePaths : undefined
  );

  const selectedSet = request.scanners ? new Set(request.scanners) : null;
  const nativeStatuses: ScannerExecutionRecord[] = [];
  const rawFindings: RawNormalizedFinding[] = [];

  const runNative = (
    name: string,
    fn: () => ReturnType<typeof scanSecretsNative>
  ) => {
    if (selectedSet && !selectedSet.has(name)) {
      return;
    }
    const startedAt = Date.now();
    const res = fn();
    rawFindings.push(...res);
    nativeStatuses.push({
      scanner: name,
      status: "executed",
      binaryName: null,
      installHint: null,
      findingsCount: res.length,
      durationMs: Date.now() - startedAt,
      errorMessage: null,
    });
  };

  runNative("native_secrets", () => scanSecretsNative(files));
  runNative("native_ddl", () => scanDdlNative(files));
  runNative("native_slopsquatting", () => scanSlopsquattingNative(files));

  const external = await runExternalScanners({
    targetPath,
    selectedScanners: request.scanners,
    commandRunner: deps.commandRunner,
    timeoutMs: deps.timeoutMs,
    signal: deps.signal,
  });

  const allRawFindings = [...rawFindings, ...external.findings];
  const allStatuses = [...nativeStatuses, ...external.statuses];

  const triaged = await triageFindings(allRawFindings, {
    useTriage: request.triage !== false,
    suppressionLookup: deps.suppressionLookup,
    evaluator: deps.evaluator,
  });

  const sarifRawJson = buildSarifLog({
    findings: triaged,
    scannerStatuses: allStatuses,
  });

  const summaryCountsJson = summarizeFindings(triaged, allStatuses);

  return {
    mode: request.mode,
    targetType: request.targetType,
    targetRef: safeTargetRef,
    scannersRun: allStatuses.map((s) => s.scanner),
    scannerStatuses: allStatuses,
    findings: triaged,
    sarifRawJson,
    summaryCountsJson,
    status: "completed",
  };
}
