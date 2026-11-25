import type {
  AgenticPromptInjectionFinding,
  DastPassiveReport,
  SarifLog21,
  SbomDocumentSummary,
  ScaReachabilityAnnotation,
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
import { type DastGuardOptions } from "./dast-guard.js";
import { runPassiveDastScan } from "./dast-passive.js";
import {
  collectTargetFiles,
  promptInjectionFindingsToRaw,
  scanAgenticPromptInjectionNative,
  scanDdlNative,
  scanSecretsNative,
  scanSlopsquattingNative,
} from "./native-scanners.js";
import {
  annotateScaReachability,
  type ImportedPackagesInput,
  type ScaAdvisoryMetadata,
} from "./reachability.js";
import {
  buildSarifLog,
  summarizeFindings,
  type RawNormalizedFinding,
  type TriagedFinding,
} from "./sarif.js";
import { generateCycloneDxSbom } from "./sbom.js";
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
  includeSbom?: boolean;
  includeReachability?: boolean;
  importedPackagesMap?: ImportedPackagesInput;
  advisoryMetadata?: Readonly<Record<string, ScaAdvisoryMetadata>>;
}

export interface RunSecurityScanDeps {
  commandRunner?: ExternalCommandRunner;
  suppressionLookup?: FindingSuppressionLookup;
  evaluator?: SecurityTriageEvaluator;
  dastGuard?: DastGuardOptions;
  fetchImpl?: typeof fetch;
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
  dastReport?: DastPassiveReport;
  reachabilityAnnotations?: ScaReachabilityAnnotation[];
  sbomSummary?: SbomDocumentSummary;
  promptInjectionFindings?: AgenticPromptInjectionFinding[];
}

export async function runSecurityScan(
  request: RunSecurityScanRequest,
  deps: RunSecurityScanDeps = {}
): Promise<ExecutedSecurityScanOutput> {
  const safeTargetRef = assertSafeScanArg("targetRef", request.targetRef);

  if (request.targetType === "staging_url") {
    const selectedSet = request.scanners ? new Set(request.scanners) : null;
    const includeHttpPassive =
      !selectedSet ||
      selectedSet.has("dast_passive") ||
      selectedSet.has("dast_url_guard");
    const includeNuclei = !selectedSet || selectedSet.has("nuclei");

    const dastResult = await runPassiveDastScan({
      targetUrl: safeTargetRef,
      dastGuard: deps.dastGuard ?? { serverAllowlist: [] },
      fetchImpl: deps.fetchImpl,
      commandRunner: deps.commandRunner,
      includeHttpPassive,
      includeNuclei,
      timeoutMs: deps.timeoutMs,
      signal: deps.signal,
    });

    const triaged = await triageFindings(dastResult.findings, {
      useTriage: request.triage !== false,
      suppressionLookup: deps.suppressionLookup,
      evaluator: deps.evaluator,
    });

    const sarif = buildSarifLog({
      findings: triaged,
      scannerStatuses: dastResult.scannerStatuses,
    });

    return {
      mode: request.mode,
      targetType: request.targetType,
      targetRef: dastResult.report.targetUrl,
      scannersRun: dastResult.scannerStatuses.map((s) => s.scanner),
      scannerStatuses: dastResult.scannerStatuses,
      findings: triaged,
      sarifRawJson: sarif,
      summaryCountsJson: summarizeFindings(triaged, dastResult.scannerStatuses),
      status: dastResult.report.status === "failed" ? "failed" : "completed",
      dastReport: dastResult.report,
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
  let promptInjectionFindings: AgenticPromptInjectionFinding[] | undefined;

  const runNative = (
    name: string,
    fn: () => RawNormalizedFinding[]
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
  runNative("native_prompt_injection", () => {
    const promptResults = scanAgenticPromptInjectionNative(files);
    promptInjectionFindings = promptResults;
    return promptInjectionFindingsToRaw(promptResults);
  });

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

  const reachabilityAnnotations =
    request.includeReachability !== false
      ? annotateScaReachability({
          targetPath,
          findings: triaged,
          importedPackagesMap: request.importedPackagesMap,
          advisoryMetadata: request.advisoryMetadata,
        })
      : undefined;

  const sbomResult = request.includeSbom
    ? await generateCycloneDxSbom({
        targetPath,
        commandRunner: deps.commandRunner,
        timeoutMs: deps.timeoutMs,
        signal: deps.signal,
      })
    : undefined;

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
    ...(reachabilityAnnotations && reachabilityAnnotations.length > 0
      ? { reachabilityAnnotations }
      : {}),
    ...(sbomResult ? { sbomSummary: sbomResult.summary } : {}),
    ...(promptInjectionFindings && promptInjectionFindings.length > 0
      ? { promptInjectionFindings }
      : {}),
  };
}
