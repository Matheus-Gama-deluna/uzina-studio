import crypto from "node:crypto";
import type {
  PovTestStatus,
  SarifLog21,
  SarifResult,
  ScannerExecutionRecord,
  SecurityScanSummaryCounts,
  SecuritySeverity,
  TriageVerdict,
} from "@uzina/contracts";
import { redactSensitiveText } from "@uzina/core";

export interface RawNormalizedFinding {
  ruleId: string;
  scanner: string;
  severity: SecuritySeverity;
  filePath: string | null;
  lineStart: number | null;
  title: string;
  description: string;
  fingerprint: string;
}

export interface TriagedFinding extends RawNormalizedFinding {
  triageVerdict: TriageVerdict;
  triageRationale: string | null;
  suppressedInMemory: boolean;
  povTestStatus: PovTestStatus;
}

export function computeFindingFingerprint(parts: {
  ruleId: string;
  scanner: string;
  filePath?: string | null;
  lineStart?: number | null;
  rawSnippet?: string | null;
}): string {
  const payload = [
    parts.ruleId.trim(),
    parts.scanner.trim(),
    (parts.filePath ?? "").replace(/\\/g, "/").trim(),
    String(parts.lineStart ?? 0),
    (parts.rawSnippet ?? "").trim(),
  ].join("\n::\n");
  return crypto.createHash("sha256").update(payload, "utf8").digest("hex");
}

export function redactFindingFields(
  finding: RawNormalizedFinding,
  knownSecrets: readonly string[] = []
): RawNormalizedFinding {
  return {
    ...finding,
    title: redactSensitiveText(finding.title, knownSecrets).slice(0, 500),
    description: redactSensitiveText(finding.description, knownSecrets).slice(
      0,
      8000
    ),
  };
}

function severityToSarifLevel(
  severity: SecuritySeverity
): "error" | "warning" | "note" {
  switch (severity) {
    case "critical":
    case "high":
      return "error";
    case "medium":
      return "warning";
    case "low":
    case "info":
      return "note";
  }
}

export function buildSarifLog(params: {
  findings: readonly TriagedFinding[];
  scannerStatuses: readonly ScannerExecutionRecord[];
  knownSecrets?: readonly string[];
}): SarifLog21 {
  const knownSecrets = params.knownSecrets ?? [];
  const results: SarifResult[] = params.findings.map((finding) => {
    const cleanTitle = redactSensitiveText(finding.title, knownSecrets);
    const cleanDescription = redactSensitiveText(
      finding.description,
      knownSecrets
    );
    return {
      ruleId: finding.ruleId,
      level: severityToSarifLevel(finding.severity),
      message: {
        text: `${cleanTitle} — ${cleanDescription}`,
      },
      locations: finding.filePath
        ? [
            {
              physicalLocation: {
                artifactLocation: { uri: finding.filePath },
                ...(finding.lineStart
                  ? { region: { startLine: finding.lineStart } }
                  : {}),
              },
            },
          ]
        : undefined,
      fingerprints: {
        "uzina/sha256": finding.fingerprint,
      },
      properties: {
        scanner: finding.scanner,
        severity: finding.severity,
        triageVerdict: finding.triageVerdict,
        suppressedInMemory: finding.suppressedInMemory,
      },
    };
  });

  const invocations = params.scannerStatuses.map((rec) => {
    const cleanError = rec.errorMessage
      ? redactSensitiveText(rec.errorMessage, knownSecrets).slice(0, 1024)
      : null;
    if (rec.status === "skipped_missing_binary") {
      return {
        executionSuccessful: false,
        toolExecutionNotifications: [
          {
            level: "warning" as const,
            message: {
              text: `Scanner '${rec.scanner}' não executado: skipped_missing_binary (${rec.binaryName ?? rec.scanner}). Instale via: ${rec.installHint ?? "uzina-sec install-tools"}`,
            },
            properties: {
              scanner: rec.scanner,
              status: rec.status,
              binaryName: rec.binaryName,
              installHint: rec.installHint,
            },
          },
        ],
      };
    }
    if (rec.status === "failed") {
      return {
        executionSuccessful: false,
        toolExecutionNotifications: [
          {
            level: "error" as const,
            message: {
              text: cleanError ?? `Scanner '${rec.scanner}' falhou.`,
            },
            properties: {
              scanner: rec.scanner,
              status: rec.status,
            },
          },
        ],
      };
    }
    return {
      executionSuccessful: true,
      toolExecutionNotifications: [
        {
          level: "note" as const,
          message: {
            text: `Scanner '${rec.scanner}' concluído (${rec.findingsCount} achados em ${rec.durationMs}ms).`,
          },
          properties: {
            scanner: rec.scanner,
            status: rec.status,
          },
        },
      ],
    };
  });

  return {
    version: "2.1.0",
    $schema:
      "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [
      {
        tool: {
          driver: {
            name: "uzina-security-engine",
            version: "0.1.0",
          },
        },
        invocations,
        results,
        properties: {
          scannerStatuses: params.scannerStatuses,
        },
      },
    ],
  };
}

export function summarizeFindings(
  findings: readonly TriagedFinding[],
  scannerStatuses: readonly ScannerExecutionRecord[]
): SecurityScanSummaryCounts {
  const counts: SecurityScanSummaryCounts = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
    total: findings.length,
    confirmedCount: 0,
    suppressedCount: 0,
    skippedScannersCount: scannerStatuses.filter(
      (s) => s.status === "skipped_missing_binary"
    ).length,
  };

  for (const finding of findings) {
    counts[finding.severity] += 1;
    if (finding.triageVerdict === "confirmed") {
      counts.confirmedCount += 1;
    }
    if (finding.suppressedInMemory || finding.triageVerdict === "false_positive") {
      counts.suppressedCount += 1;
    }
  }

  return counts;
}
