import type { TriageVerdict } from "@uzina/contracts";
import type { RawNormalizedFinding, TriagedFinding } from "./sarif.js";

export interface FindingSuppressionLookup {
  getSuppressedFingerprints(
    fingerprints: readonly string[]
  ): Promise<Set<string>>;
}

export interface SecurityTriageEvaluator {
  evaluate(finding: RawNormalizedFinding): Promise<{
    triageVerdict: Exclude<TriageVerdict, "pending">;
    triageRationale: string;
  }>;
}

export interface TriageFindingsOptions {
  useTriage?: boolean;
  suppressionLookup?: FindingSuppressionLookup;
  evaluator?: SecurityTriageEvaluator;
}

function deterministicHeuristicTriage(finding: RawNormalizedFinding): {
  triageVerdict: Exclude<TriageVerdict, "pending">;
  triageRationale: string;
} {
  const filePath = (finding.filePath ?? "").toLowerCase();
  const isExampleOrTest =
    filePath.includes("/tests/") ||
    filePath.startsWith("tests/") ||
    filePath.includes(".test.") ||
    filePath.includes(".spec.") ||
    filePath.includes(".example") ||
    filePath.includes("fixtures/");

  if (isExampleOrTest) {
    return {
      triageVerdict: "unknown",
      triageRationale:
        "Ocorrência em arquivo de teste ou fixture sintética; validar se não contém segredo real.",
    };
  }

  if (finding.severity === "critical" || finding.severity === "high") {
    return {
      triageVerdict: "confirmed",
      triageRationale:
        "Achado de alta severidade em código/migração fora de fixtures de teste.",
    };
  }

  return {
    triageVerdict: "unknown",
    triageRationale: "Severidade moderada/baixa aguardando revisão humana.",
  };
}

export async function triageFindings(
  findings: readonly RawNormalizedFinding[],
  options: TriageFindingsOptions = {}
): Promise<TriagedFinding[]> {
  if (findings.length === 0) {
    return [];
  }

  const suppressedSet = options.suppressionLookup
    ? await options.suppressionLookup.getSuppressedFingerprints(
        findings.map((f) => f.fingerprint)
      )
    : new Set<string>();

  const useTriage = options.useTriage !== false;
  const output: TriagedFinding[] = [];

  for (const finding of findings) {
    if (suppressedSet.has(finding.fingerprint)) {
      output.push({
        ...finding,
        triageVerdict: "false_positive",
        triageRationale:
          "Suprimido automaticamente via histórico suppressed_in_memory.",
        suppressedInMemory: true,
        povTestStatus: "not_applicable",
      });
      continue;
    }

    if (!useTriage) {
      output.push({
        ...finding,
        triageVerdict: "pending",
        triageRationale: null,
        suppressedInMemory: false,
        povTestStatus:
          finding.severity === "critical" || finding.severity === "high"
            ? "missing"
            : "not_applicable",
      });
      continue;
    }

    const decision = options.evaluator
      ? await options.evaluator.evaluate(finding)
      : deterministicHeuristicTriage(finding);

    output.push({
      ...finding,
      triageVerdict: decision.triageVerdict,
      triageRationale: decision.triageRationale,
      suppressedInMemory: false,
      povTestStatus:
        decision.triageVerdict === "confirmed" &&
        (finding.severity === "critical" || finding.severity === "high")
          ? "missing"
          : "not_applicable",
    });
  }

  return output;
}
