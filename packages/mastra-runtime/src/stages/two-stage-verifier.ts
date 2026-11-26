import fs from "node:fs";
import path from "node:path";
import {
  DecisionRiskBriefingSchema,
  OpenSpecDeltaSchema,
  VerifierTwoStageOutputSchema,
  type DecisionRiskBriefing,
  type EvidencePack,
  type Memory,
  type MemoryCategory,
  type OpenSpecDelta,
  type RiskLevel,
  type SemanticDiffFile,
  type ShapeSpec,
  type SpecComplianceRow,
  type SpecComplianceStatus,
  type TestAuditReport,
  type VerifierIssue,
  type VerifierTwoStageOutput,
  type VerifyCheckSummary,
} from "@uzina/contracts";
import {
  assertPathInsideWorkspace,
  parseUnifiedDiffSemantic,
  redactSensitiveText,
} from "@uzina/core";
import type { UzinaDb } from "@uzina/db";
import { createMemoryScoped } from "../memories.js";

export interface SpecCriterionInput {
  id: string;
  text: string;
}

export interface VerifierSarifFindingSummary {
  ruleId: string;
  severity: string;
  title: string;
  filePath?: string | null;
  triageVerdict?: string;
  suppressedInMemory?: boolean;
}

export interface CleanContextStageEvaluator {
  evaluateStage1?: (input: {
    deliverableTitle: string;
    specMarkdown: string | null;
    criteria: readonly SpecCriterionInput[];
    semanticDiffs: readonly SemanticDiffFile[];
    verifyChecks: readonly VerifyCheckSummary[];
    testCommandOutput: string | null;
  }) => Promise<{
    matrix: SpecComplianceRow[];
    summary?: string;
  }>;
  evaluateStage2?: (input: {
    deliverableTitle: string;
    specMarkdown: string | null;
    stage1Matrix: readonly SpecComplianceRow[];
    semanticDiffs: readonly SemanticDiffFile[];
    verifyChecks: readonly VerifyCheckSummary[];
    testCommandOutput: string | null;
    testAuditReport: TestAuditReport | null;
    securitySummary: EvidencePack["securitySummary"] | null;
    sarifFindings: readonly VerifierSarifFindingSummary[];
  }) => Promise<{
    passed: boolean;
    summary?: string;
    issues?: VerifierIssue[];
    refutingChecksPerformed?: string[];
    survivingMutantRisks?: string[];
  }>;
}

export interface EvaluateTwoStageVerifierParams {
  deliverableTitle: string;
  specMarkdown: string | null;
  shapeSpec?: ShapeSpec | null;
  acceptanceCriteria?: readonly SpecCriterionInput[];
  semanticDiffs?: readonly SemanticDiffFile[];
  rawDiff?: string;
  verifyChecks?: readonly VerifyCheckSummary[];
  testCommandOutput?: string | null;
  testAuditReport?: TestAuditReport | null;
  securitySummary?: EvidencePack["securitySummary"] | null;
  sarifFindings?: readonly VerifierSarifFindingSummary[];
  stage1MatrixOverride?: readonly SpecComplianceRow[];
  evaluator?: CleanContextStageEvaluator;
  knownSecrets?: readonly string[];
}

const STOP_WORDS = new Set([
  "para",
  "como",
  "deve",
  "com",
  "sem",
  "que",
  "uma",
  "por",
  "dos",
  "das",
  "nos",
  "nas",
  "when",
  "then",
  "given",
  "with",
  "from",
  "that",
  "this",
  "must",
  "should",
]);

function tokenizeKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9_]+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

export function extractAcceptanceCriteriaFromSpec(params: {
  deliverableTitle: string;
  specMarkdown: string | null;
  shapeSpec?: ShapeSpec | null;
  explicitCriteria?: readonly SpecCriterionInput[];
}): SpecCriterionInput[] {
  if (params.explicitCriteria && params.explicitCriteria.length > 0) {
    return [...params.explicitCriteria];
  }

  const collected: SpecCriterionInput[] = [];
  if (params.shapeSpec) {
    params.shapeSpec.acceptanceCriteria.forEach((criterion, idx) => {
      collected.push({
        id: `AC-${idx + 1}`,
        text: criterion,
      });
    });
    params.shapeSpec.bddScenarios.forEach((scenario, idx) => {
      collected.push({
        id: scenario.id ?? `BDD-${idx + 1}`,
        text: `${scenario.title}: Given ${scenario.given}; When ${scenario.when}; Then ${scenario.then}`,
      });
    });
    if (collected.length > 0) {
      return collected;
    }
  }

  const markdown = params.specMarkdown?.trim() ?? "";
  if (markdown) {
    const lines = markdown.split(/\r?\n/);
    let inCriteriaSection = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^#{1,4}\s+/.test(trimmed)) {
        inCriteriaSection =
          /(?:crit[eé]rios|acceptance|bdd|requisitos|scenarios|escopo)/i.test(
            trimmed
          );
        continue;
      }
      const bulletMatch = /^(?:[-*]|\d+\.)\s+(.+)$/.exec(trimmed);
      if (bulletMatch?.[1] && (inCriteriaSection || collected.length < 12)) {
        const text = bulletMatch[1].trim();
        if (text.length >= 4) {
          collected.push({
            id: `AC-${collected.length + 1}`,
            text: text.slice(0, 1000),
          });
        }
      }
    }
  }

  if (collected.length > 0) {
    return collected.slice(0, 50);
  }

  return [
    {
      id: "AC-1",
      text: `Implementação e cobertura verificada para: ${params.deliverableTitle}`.slice(
        0,
        1000
      ),
    },
  ];
}

function findFirstAddedLine(hunkPreview: string): number | null {
  const match = /@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(hunkPreview);
  if (!match?.[1]) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : null;
}

function scoreFileMatch(
  file: SemanticDiffFile,
  keywords: readonly string[]
): number {
  const haystack = `${file.filePath}\n${file.hunkPreview}`.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (haystack.includes(kw)) {
      score += 1;
    }
  }
  return score;
}

function buildDeterministicStage1Matrix(params: {
  criteria: readonly SpecCriterionInput[];
  semanticDiffs: readonly SemanticDiffFile[];
  verifyChecks: readonly VerifyCheckSummary[];
  testCommandOutput: string | null;
}): SpecComplianceRow[] {
  const codeFiles = params.semanticDiffs.filter(
    (d) => d.category === "code" || d.category === "config"
  );
  const testFiles = params.semanticDiffs.filter((d) => d.category === "test");
  const hasAnyFailingCheck = params.verifyChecks.some((c) => !c.passed);
  const hasPassingVerify =
    params.verifyChecks.length > 0 && !hasAnyFailingCheck;
  const testOutLower = (params.testCommandOutput ?? "").toLowerCase();

  return params.criteria.map((criterion) => {
    const keywords = tokenizeKeywords(criterion.text);
    const rankedCode = [...codeFiles]
      .map((f) => ({ f, score: scoreFileMatch(f, keywords) }))
      .sort((a, b) => b.score - a.score);
    const rankedTests = [...testFiles]
      .map((f) => ({ f, score: scoreFileMatch(f, keywords) }))
      .sort((a, b) => b.score - a.score);

    const bestCode =
      (rankedCode[0]?.score ?? 0) > 0
        ? rankedCode[0]?.f ?? null
        : codeFiles[0] ?? null;
    const bestTest =
      (rankedTests[0]?.score ?? 0) > 0
        ? rankedTests[0]?.f ?? null
        : testFiles[0] ?? null;

    const testMentionsMissing =
      testOutLower.includes("not implemented") ||
      testOutLower.includes("0 passed");

    let status: SpecComplianceStatus = "covered";
    if (params.semanticDiffs.length === 0 || (!bestCode && !bestTest)) {
      status = "missing";
    } else if (!bestTest && !hasPassingVerify) {
      status = "missing";
    } else if (hasAnyFailingCheck || testMentionsMissing) {
      status = "divergent";
    }

    return {
      criterionId: criterion.id.slice(0, 120),
      criterionText: criterion.text.slice(0, 1000),
      testFile: bestTest ? bestTest.filePath.slice(0, 500) : null,
      testLine: bestTest ? findFirstAddedLine(bestTest.hunkPreview) : null,
      sourceFile: bestCode ? bestCode.filePath.slice(0, 500) : null,
      sourceLine: bestCode ? findFirstAddedLine(bestCode.hunkPreview) : null,
      status,
    };
  });
}

function detectMutantAndAdversarialRisks(params: {
  semanticDiffs: readonly SemanticDiffFile[];
  verifyChecks: readonly VerifyCheckSummary[];
  testAuditReport: TestAuditReport | null;
  securitySummary: EvidencePack["securitySummary"] | null;
}): {
  refutingChecksPerformed: string[];
  survivingMutantRisks: string[];
  adversarialIssues: VerifierIssue[];
} {
  const refutingChecksPerformed: string[] = [];
  const survivingMutantRisks: string[] = [];
  const adversarialIssues: VerifierIssue[] = [];

  const codeDiffs = params.semanticDiffs.filter((d) => d.category === "code");
  const testDiffs = params.semanticDiffs.filter((d) => d.category === "test");

  refutingChecksPerformed.push(
    `Inspeção de diff semântico: ${codeDiffs.length} arquivo(s) de código e ${testDiffs.length} arquivo(s) de teste.`
  );

  if (codeDiffs.length > 0 && testDiffs.length === 0) {
    const firstCode = codeDiffs[0]!;
    survivingMutantRisks.push(
      `Alteração em '${firstCode.filePath}' sem novo teste ou ajuste de teste associado no diff.`
    );
    if (params.verifyChecks.length === 0) {
      adversarialIssues.push({
        severity: "major",
        filePath: firstCode.filePath,
        message:
          "Código de produção alterado sem evidência de teste no diff nem check determinístico executado.",
      });
    }
  }

  for (const diff of codeDiffs) {
    const hunk = diff.hunkPreview;
    if (/\+(?=.*(?:>=|<=|===|!==))/.test(hunk)) {
      survivingMutantRisks.push(
        `Operadores relacionais/de fronteira adicionados em '${diff.filePath}'; valide casos de borda exatos.`
      );
    }
    if (/\+(?=.*catch\s*(?:\([^)]*\))?\s*\{)/.test(hunk)) {
      survivingMutantRisks.push(
        `Bloco catch adicionado em '${diff.filePath}'; confirme que erros críticos não são silenciados.`
      );
    }
    if (
      /\+(?=.*(?:organizationId|role|session|authorize))/.test(hunk) &&
      !testDiffs.some((t) =>
        t.hunkPreview.toLowerCase().includes("forbidden") ||
        t.hunkPreview.toLowerCase().includes("403") ||
        t.hunkPreview.toLowerCase().includes("unauthorized")
      )
    ) {
      survivingMutantRisks.push(
        `Checagem de autorização/tenant em '${diff.filePath}' sem teste negativo explícito (401/403) visível no diff.`
      );
    }
  }

  if (params.testAuditReport) {
    refutingChecksPerformed.push(
      `Auditoria anti-tautologia: ${params.testAuditReport.scannedTests} teste(s), ${params.testAuditReport.violations.length} violação(ões).`
    );
    if (!params.testAuditReport.passed) {
      for (const v of params.testAuditReport.violations.slice(0, 5)) {
        adversarialIssues.push({
          severity: "blocker",
          filePath: v.filePath,
          message: `Anti-pattern de teste (${v.rule}) em '${v.testTitle}': ${v.message}`,
        });
      }
    }
  }

  if (params.securitySummary) {
    refutingChecksPerformed.push(
      `Gate AppSec SARIF: critical=${params.securitySummary.critical}, high=${params.securitySummary.high}, pulados=${params.securitySummary.skippedScanners.length}.`
    );
    if (!params.securitySummary.gatePassed) {
      adversarialIssues.push({
        severity: "blocker",
        message: `Gate de segurança reprovado (${params.securitySummary.critical} critical, ${params.securitySummary.high} high).`,
      });
    }
  }

  for (const check of params.verifyChecks) {
    refutingChecksPerformed.push(
      `Check '${check.name}': ${check.passed ? "PASS" : "FAIL"} (${check.durationMs}ms).`
    );
    if (!check.passed) {
      adversarialIssues.push({
        severity: "blocker",
        message: `Falha no check determinístico '${check.name}': ${check.summary}`,
      });
    }
  }

  return {
    refutingChecksPerformed: refutingChecksPerformed.slice(0, 20),
    survivingMutantRisks: Array.from(new Set(survivingMutantRisks)).slice(0, 20),
    adversarialIssues,
  };
}

function computeConfidenceScore(params: {
  stage1Passed: boolean;
  stage2Passed: boolean;
  matrix: readonly SpecComplianceRow[];
  issues: readonly VerifierIssue[];
  survivingMutantRisks: readonly string[];
  securitySummary: EvidencePack["securitySummary"] | null;
  testAuditReport: TestAuditReport | null;
  verifyChecks: readonly VerifyCheckSummary[];
}): number {
  const totalCriteria = Math.max(1, params.matrix.length);
  const coveredCriteria = params.matrix.filter(
    (row) => row.status === "covered"
  ).length;

  if (!params.stage1Passed) {
    return Math.max(0, Math.min(45, Math.round((coveredCriteria / totalCriteria) * 45)));
  }

  let score = 100;
  for (const issue of params.issues) {
    if (issue.severity === "blocker") score -= 35;
    else if (issue.severity === "major") score -= 15;
    else score -= 5;
  }

  const skippedCount = params.securitySummary?.skippedScanners.length ?? 0;
  score -= Math.min(15, skippedCount * 5);
  score -= Math.min(20, params.survivingMutantRisks.length * 4);

  if (!params.testAuditReport) score -= 5;
  if (params.verifyChecks.length === 0) score -= 10;
  if (!params.stage2Passed && score > 59) score = 55;

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Avalia entregas em contexto limpo (sem histórico/CoT do Builder) em 2 estágios:
 * Stage 1 (Spec Compliance com short-circuit) -> Stage 2 (Qualidade, Segurança & Mutantes).
 */
export async function evaluateTwoStageVerifier(
  params: EvaluateTwoStageVerifierParams
): Promise<VerifierTwoStageOutput> {
  const knownSecrets = params.knownSecrets ?? [];
  const semanticDiffs: SemanticDiffFile[] =
    params.semanticDiffs && params.semanticDiffs.length > 0
      ? [...params.semanticDiffs]
      : params.rawDiff
        ? parseUnifiedDiffSemantic(params.rawDiff, { knownSecrets })
        : [];
  const verifyChecks = [...(params.verifyChecks ?? [])];
  const testCommandOutput = params.testCommandOutput
    ? redactSensitiveText(params.testCommandOutput, knownSecrets)
    : null;
  const criteria = extractAcceptanceCriteriaFromSpec({
    deliverableTitle: params.deliverableTitle,
    specMarkdown: params.specMarkdown,
    shapeSpec: params.shapeSpec,
    explicitCriteria: params.acceptanceCriteria,
  });

  // --- STAGE 1: Spec Compliance (short-circuit imediato se houver missing/divergent) ---
  let stage1Matrix: SpecComplianceRow[];
  let stage1EvaluatorSummary: string | undefined;

  if (params.stage1MatrixOverride && params.stage1MatrixOverride.length > 0) {
    stage1Matrix = [...params.stage1MatrixOverride];
  } else if (params.evaluator?.evaluateStage1) {
    const evalRes = await params.evaluator.evaluateStage1({
      deliverableTitle: params.deliverableTitle,
      specMarkdown: params.specMarkdown,
      criteria,
      semanticDiffs,
      verifyChecks,
      testCommandOutput,
    });
    stage1Matrix = evalRes.matrix;
    stage1EvaluatorSummary = evalRes.summary;
  } else {
    stage1Matrix = buildDeterministicStage1Matrix({
      criteria,
      semanticDiffs,
      verifyChecks,
      testCommandOutput,
    });
  }

  const failingCriteria = stage1Matrix.filter(
    (row) => row.status === "missing" || row.status === "divergent"
  );

  if (failingCriteria.length > 0) {
    const stage1Issues: VerifierIssue[] = failingCriteria.map((row) => ({
      severity: "blocker",
      ...(row.sourceFile ? { filePath: row.sourceFile } : {}),
      message: `Critério '${row.criterionId}' está '${row.status}': ${row.criterionText.slice(0, 200)}`,
    }));

    const confidenceScore = computeConfidenceScore({
      stage1Passed: false,
      stage2Passed: false,
      matrix: stage1Matrix,
      issues: stage1Issues,
      survivingMutantRisks: [],
      securitySummary: params.securitySummary ?? null,
      testAuditReport: params.testAuditReport ?? null,
      verifyChecks,
    });

    const summary =
      stage1EvaluatorSummary ||
      `Reprovado no Estágio 1 (Spec Compliance): ${failingCriteria.length} critério(s) pendente(s) (${failingCriteria
        .map((c) => `${c.criterionId}:${c.status}`)
        .slice(0, 5)
        .join(", ")}). Estágio 2 interrompido por short-circuit.`;

    return VerifierTwoStageOutputSchema.parse({
      verdict: "changes_required",
      summary: redactSensitiveText(summary, knownSecrets).slice(0, 4000),
      issues: stage1Issues.slice(0, 50),
      stage1SpecCompliance: {
        passed: false,
        matrix: stage1Matrix.slice(0, 200),
      },
      stage2QualityAndSecurity: {
        passed: false,
        refutingChecksPerformed: [
          "Estágio 2 não executado (short-circuit após reprovação no Estágio 1).",
        ],
        survivingMutantRisks: [],
      },
      confidenceScore,
    });
  }

  // --- STAGE 2: Qualidade Adversarial, Segurança & Riscos de Mutantes ---
  const sarifFindings = [...(params.sarifFindings ?? [])];
  const deterministicStage2 = detectMutantAndAdversarialRisks({
    semanticDiffs,
    verifyChecks,
    testAuditReport: params.testAuditReport ?? null,
    securitySummary: params.securitySummary ?? null,
  });

  const blockingSarif = sarifFindings.filter(
    (f) =>
      (f.severity === "critical" || f.severity === "high") &&
      f.triageVerdict !== "false_positive" &&
      !f.suppressedInMemory
  );
  for (const finding of blockingSarif.slice(0, 5)) {
    deterministicStage2.adversarialIssues.push({
      severity: "blocker",
      ...(finding.filePath ? { filePath: finding.filePath } : {}),
      message: `Achado AppSec '${finding.ruleId}' (${finding.severity}): ${finding.title}`,
    });
  }

  let stage2Issues = [...deterministicStage2.adversarialIssues];
  let refutingChecks = [...deterministicStage2.refutingChecksPerformed];
  let mutantRisks = [...deterministicStage2.survivingMutantRisks];
  let stage2Summary: string | undefined;
  let stage2EvaluatorPassed = true;

  if (params.evaluator?.evaluateStage2) {
    const eval2 = await params.evaluator.evaluateStage2({
      deliverableTitle: params.deliverableTitle,
      specMarkdown: params.specMarkdown,
      stage1Matrix,
      semanticDiffs,
      verifyChecks,
      testCommandOutput,
      testAuditReport: params.testAuditReport ?? null,
      securitySummary: params.securitySummary ?? null,
      sarifFindings,
    });
    stage2EvaluatorPassed = eval2.passed;
    stage2Summary = eval2.summary;
    if (eval2.issues && eval2.issues.length > 0) {
      stage2Issues = [...stage2Issues, ...eval2.issues];
    }
    if (eval2.refutingChecksPerformed && eval2.refutingChecksPerformed.length > 0) {
      refutingChecks = Array.from(
        new Set([...refutingChecks, ...eval2.refutingChecksPerformed])
      );
    }
    if (eval2.survivingMutantRisks && eval2.survivingMutantRisks.length > 0) {
      mutantRisks = Array.from(
        new Set([...mutantRisks, ...eval2.survivingMutantRisks])
      );
    }
  }

  const hasBlockers = stage2Issues.some((issue) => issue.severity === "blocker");
  const stage2Passed = stage2EvaluatorPassed && !hasBlockers;

  const confidenceScore = computeConfidenceScore({
    stage1Passed: true,
    stage2Passed,
    matrix: stage1Matrix,
    issues: stage2Issues,
    survivingMutantRisks: mutantRisks,
    securitySummary: params.securitySummary ?? null,
    testAuditReport: params.testAuditReport ?? null,
    verifyChecks,
  });

  const verdict = stage2Passed ? "approved" : "changes_required";
  const summary =
    stage2Summary ||
    (stage2Passed
      ? `Aprovado nos 2 estágios (${stage1Matrix.length} critério(s) coberto(s), Confidence Score ${confidenceScore}/100).`
      : `Reprovado no Estágio 2 (Qualidade/Segurança): ${stage2Issues
          .slice(0, 3)
          .map((i) => i.message)
          .join("; ")}`);

  return VerifierTwoStageOutputSchema.parse({
    verdict,
    summary: redactSensitiveText(summary, knownSecrets).slice(0, 4000),
    issues: stage2Issues.slice(0, 50),
    stage1SpecCompliance: {
      passed: true,
      matrix: stage1Matrix.slice(0, 200),
    },
    stage2QualityAndSecurity: {
      passed: stage2Passed,
      refutingChecksPerformed: refutingChecks,
      survivingMutantRisks: mutantRisks,
    },
    confidenceScore,
  });
}

export interface ComputeDecisionRiskBriefingParams {
  semanticDiffs?: readonly SemanticDiffFile[];
  rawDiff?: string;
  confidenceScore: number;
  tokensTotal?: number;
  estimatedCostUsd?: number;
  securitySummary?: EvidencePack["securitySummary"] | null;
}

const NON_DEP_PACKAGE_JSON_KEYS = new Set([
  "name",
  "version",
  "description",
  "private",
  "type",
  "main",
  "types",
  "module",
  "license",
  "author",
  "scripts",
  "exports",
  "engines",
  "packageManager",
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
  "overrides",
  "resolutions",
]);

function extractAddedLines(semanticDiffs: readonly SemanticDiffFile[], rawDiff?: string): string[] {
  const lines: string[] = [];
  for (const file of semanticDiffs) {
    for (const line of file.hunkPreview.split(/\r?\n/)) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        lines.push(line.slice(1));
      }
    }
  }
  if (rawDiff) {
    for (const line of rawDiff.split(/\r?\n/)) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        lines.push(line.slice(1));
      }
    }
  }
  return lines;
}

/**
 * Calcula deterministicamente o briefing de risco de mudança de superfície para a Caixa de Decisões e Draft PR.
 */
export function computeDecisionRiskBriefing(
  params: ComputeDecisionRiskBriefingParams
): DecisionRiskBriefing {
  const semanticDiffs =
    params.semanticDiffs && params.semanticDiffs.length > 0
      ? [...params.semanticDiffs]
      : params.rawDiff
        ? parseUnifiedDiffSemantic(params.rawDiff)
        : [];

  const filePaths = semanticDiffs.map((f) => f.filePath.replace(/\\/g, "/"));
  const addedLines = extractAddedLines(semanticDiffs, params.rawDiff);
  const addedJoined = addedLines.join("\n");

  const dbMigrations =
    filePaths.some(
      (p) =>
        /(?:^|\/)(?:drizzle|migrations?)\/.*\.sql$/i.test(p) ||
        /(?:^|\/)schema\/.*\.ts$/i.test(p)
    ) ||
    /\b(?:CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|DROP\s+COLUMN|ADD\s+COLUMN|CREATE\s+(?:UNIQUE\s+)?INDEX)\b/i.test(
      addedJoined
    );

  const authOrRbac =
    filePaths.some((p) =>
      /(?:^|\/)(?:auth|rbac|session|permission|guard|middleware)[^/]*\./i.test(p)
    ) ||
    /\b(?:better-auth|OrgRole|requireRole|assertCan|authorize|session\.user|roleBindings)\b/.test(
      addedJoined
    );

  const cryptoOrSecrets =
    filePaths.some((p) =>
      /(?:^|\/)(?:vault|crypto|secret|cipher|master-key)[^/]*\./i.test(p)
    ) ||
    /\b(?:createCipheriv|createDecipheriv|aes-256-gcm|encryptSecret|decryptSecret|MASTER_ENCRYPTION_KEY|resolveMasterKey)\b/.test(
      addedJoined
    );

  const newDependenciesSet = new Set<string>();
  const pkgDiffs = semanticDiffs.filter(
    (d) => path.posix.basename(d.filePath) === "package.json"
  );
  for (const pkgDiff of pkgDiffs) {
    for (const line of pkgDiff.hunkPreview.split(/\r?\n/)) {
      if (!line.startsWith("+") || line.startsWith("+++")) continue;
      const depMatch = /^\+\s*"(@?[a-z0-9._-]+(?:\/[a-z0-9._-]+)?)"\s*:\s*"([^"]+)"/i.exec(
        line
      );
      const depName = depMatch?.[1];
      if (depName && !NON_DEP_PACKAGE_JSON_KEYS.has(depName)) {
        newDependenciesSet.add(depName.slice(0, 160));
      }
    }
  }

  const newEnvVarsSet = new Set<string>();
  for (const line of addedLines) {
    for (const m of line.matchAll(/\bprocess\.env\.([A-Z][A-Z0-9_]{2,})\b/g)) {
      if (m[1]) newEnvVarsSet.add(m[1].slice(0, 160));
    }
    for (const m of line.matchAll(/^\s*([A-Z][A-Z0-9_]{2,})\s*=/g)) {
      if (m[1]) newEnvVarsSet.add(m[1].slice(0, 160));
    }
  }

  const newDependencies = Array.from(newDependenciesSet).sort();
  const newEnvVars = Array.from(newEnvVarsSet).sort();
  const clampedConfidence = Math.max(
    0,
    Math.min(100, Math.round(params.confidenceScore))
  );

  const hasSecurityBlocker =
    (params.securitySummary?.critical ?? 0) > 0 ||
    (params.securitySummary?.high ?? 0) > 0;

  let riskLevel: RiskLevel = "low";
  if (
    dbMigrations ||
    cryptoOrSecrets ||
    authOrRbac ||
    hasSecurityBlocker ||
    clampedConfidence < 60
  ) {
    riskLevel = "high";
  } else if (
    newDependencies.length > 0 ||
    newEnvVars.length > 0 ||
    clampedConfidence < 80 ||
    semanticDiffs.length >= 8
  ) {
    riskLevel = "medium";
  }

  const rollbackSteps: string[] = [];
  if (dbMigrations) {
    rollbackSteps.push(
      "Reverter migração SQL com snapshot prévio do banco e aplicar script compensatório antes do git revert."
    );
  }
  if (cryptoOrSecrets || authOrRbac) {
    rollbackSteps.push(
      "Invalidar sessões/chaves afetadas caso haja rotação e restaurar versão anterior das rotas/guards."
    );
  }
  if (newDependencies.length > 0) {
    rollbackSteps.push(
      `Reverter lockfile e remover pacotes adicionados (${newDependencies.slice(0, 5).join(", ")}).`
    );
  }
  if (newEnvVars.length > 0) {
    rollbackSteps.push(
      `Remover ou manter fallback seguro para variáveis de ambiente (${newEnvVars.slice(0, 5).join(", ")}).`
    );
  }
  rollbackSteps.push(
    "Executar `git revert` do commit de entrega e validar `pnpm verify` na branch base."
  );

  return DecisionRiskBriefingSchema.parse({
    riskLevel,
    confidenceScore: clampedConfidence,
    changedSurface: {
      dbMigrations,
      authOrRbac,
      cryptoOrSecrets,
      newDependencies,
      newEnvVars,
    },
    rollbackPlan: rollbackSteps.join(" ").slice(0, 2000),
    finopsSummary: {
      tokensTotal: Math.max(0, Math.round(params.tokensTotal ?? 0)),
      estimatedCostUsd: Math.max(
        0,
        Number((params.estimatedCostUsd ?? 0).toFixed(6))
      ),
    },
  });
}

export interface DistillRetrospectiveParams {
  organizationId: string;
  projectId: string;
  deliverableId: string;
  deliverableTitle: string;
  verifyAttempts: number;
  decision?: "approved" | "changes_requested" | "rejected" | null;
  feedback?: string | null;
  failureReasons?: readonly string[];
  verifierNotes?: string | null;
  hasSecurityFailure?: boolean;
  securityFindingsCount?: number;
}

export interface DistillRetrospectiveResult {
  distilled: boolean;
  reason: "ok" | "trigger_not_met";
  category: MemoryCategory | null;
  memory: Memory | null;
}

const SECURITY_RETRO_KEYWORDS_RE =
  /\b(?:appsec|sarif|ssrf|rbac|xss|sqli|secret|cripto|aes-256-gcm|vulnerabilidade|seguran[cç]a|cors|cookie|dast|injection)\b/i;

/**
 * Destila lições aprendidas para o QMD quando houver retrabalho (`verifyAttempts >= 2`)
 * ou reprovação/ajuste humano com feedback.
 */
export async function distillRetrospectiveToQmd(
  db: UzinaDb,
  params: DistillRetrospectiveParams
): Promise<DistillRetrospectiveResult> {
  const feedbackTrimmed = params.feedback?.trim() ?? "";
  const isHumanRejectionOrChange =
    (params.decision === "changes_requested" || params.decision === "rejected") &&
    feedbackTrimmed.length > 0;
  const isReworkThreshold = params.verifyAttempts >= 2;

  if (!isReworkThreshold && !isHumanRejectionOrChange) {
    return {
      distilled: false,
      reason: "trigger_not_met",
      category: null,
      memory: null,
    };
  }

  const combinedText = [
    feedbackTrimmed,
    params.verifierNotes ?? "",
    ...(params.failureReasons ?? []),
  ].join("\n");

  const isSecurityRelated =
    Boolean(params.hasSecurityFailure) ||
    (params.securityFindingsCount ?? 0) > 0 ||
    SECURITY_RETRO_KEYWORDS_RE.test(combinedText);

  const category: MemoryCategory = isSecurityRelated
    ? "security_triage"
    : "convention";

  const triggerLabel = isHumanRejectionOrChange
    ? `Decisão humana '${params.decision}'`
    : `${params.verifyAttempts} tentativas no Verify Gate`;

  const cleanTitle = redactSensitiveText(
    `Retrospectiva (${triggerLabel}): ${params.deliverableTitle}`
  )
    .trim()
    .slice(0, 200);

  const reasonsList =
    params.failureReasons && params.failureReasons.length > 0
      ? params.failureReasons.map((r) => `- ${redactSensitiveText(r)}`).join("\n")
      : "- Sem falhas determinísticas adicionais registradas.";

  const markdownContent = [
    `## Contexto da Retrospectiva`,
    `- Entregável: ${params.deliverableTitle} (${params.deliverableId})`,
    `- Gatilho: ${triggerLabel}`,
    `- Tentativas de Verify: ${params.verifyAttempts}`,
    "",
    "## Apontamentos & Causas",
    reasonsList,
    ...(feedbackTrimmed
      ? ["", "## Feedback Humano", redactSensitiveText(feedbackTrimmed)]
      : []),
    ...(params.verifierNotes?.trim()
      ? ["", "## Parecer do Verifier", redactSensitiveText(params.verifierNotes.trim())]
      : []),
    "",
    "## Regra Preventiva para Próximos Ciclos",
    isSecurityRelated
      ? "Validar entradas com Zod, checar fronteiras AppSec/RBAC e rodar verificação incremental antes de concluir o Build."
      : "Garantir cobertura completa dos critérios de aceite da Spec com testes focados antes de submeter ao Verify Gate.",
  ]
    .join("\n")
    .slice(0, 16000);

  const memory = await createMemoryScoped(db, {
    organizationId: params.organizationId,
    input: {
      scopeType: "project",
      scopeId: params.projectId,
      category,
      title: cleanTitle,
      content: markdownContent,
      sourceDeliverableId: params.deliverableId,
    },
  });

  return {
    distilled: true,
    reason: "ok",
    category,
    memory,
  };
}

export interface SyncOpenSpecArchiveParams {
  deliverableId: string;
  deliverableTitle: string;
  delta: OpenSpecDelta;
  existingSpecMarkdown?: string;
  workspaceRoot?: string;
  specRelativePath?: string;
  mergedAt?: Date;
  db?: UzinaDb;
  organizationId?: string;
  projectId?: string;
}

export interface SyncOpenSpecArchiveResult {
  updated: boolean;
  specPath: string | null;
  markdown: string;
  appliedCounts: {
    added: number;
    modified: number;
    removed: number;
  };
  memoryId: string | null;
}

const DEFAULT_OPENSPEC_REL_PATH = ".uzina/OPENSPEC.md";

const EMPTY_ACTIVE_PLACEHOLDER = "(Nenhuma capacidade ativa registrada)";
const EMPTY_REMOVED_PLACEHOLDER = "(Nenhuma remoção registrada)";

/**
 * Aplica o `openSpecDelta` entregue ao documento vivo de especificação após o merge.
 */
export function applyOpenSpecDeltaToMarkdown(params: {
  existingMarkdown: string;
  delta: OpenSpecDelta;
  deliverableId: string;
  deliverableTitle: string;
  mergedAtIso: string;
}): string {
  const parsedDelta = OpenSpecDeltaSchema.parse(params.delta);
  const existing = params.existingMarkdown.trim();

  const activeItems = new Set<string>();
  const removedItems = new Set<string>();
  const archiveBlocks: string[] = [];

  if (existing) {
    let section: "none" | "active" | "removed" | "archive" = "none";
    const currentArchiveLines: string[] = [];

    for (const line of existing.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.startsWith("## Capacidades Ativas")) {
        section = "active";
        continue;
      }
      if (trimmed.startsWith("## Capacidades Removidas")) {
        section = "removed";
        continue;
      }
      if (trimmed.startsWith("## Histórico de Deltas Arquivados")) {
        section = "archive";
        continue;
      }
      if (section === "active" && trimmed.startsWith("- ")) {
        const val = trimmed.slice(2).trim();
        if (val && val !== EMPTY_ACTIVE_PLACEHOLDER) {
          activeItems.add(val);
        }
      } else if (section === "removed" && trimmed.startsWith("- ")) {
        const val = trimmed.slice(2).trim();
        if (val && val !== EMPTY_REMOVED_PLACEHOLDER) {
          removedItems.add(val);
        }
      } else if (section === "archive") {
        currentArchiveLines.push(line);
      }
    }

    if (currentArchiveLines.length > 0) {
      archiveBlocks.push(currentArchiveLines.join("\n").trim());
    }
  }

  for (const item of parsedDelta.removed) {
    const clean = item.trim();
    activeItems.delete(clean);
    for (const existingItem of Array.from(activeItems)) {
      if (existingItem.toLowerCase().includes(clean.toLowerCase())) {
        activeItems.delete(existingItem);
      }
    }
    removedItems.add(clean);
  }

  for (const item of parsedDelta.modified) {
    const clean = item.trim();
    activeItems.add(clean);
  }

  for (const item of parsedDelta.added) {
    const clean = item.trim();
    activeItems.add(clean);
  }

  const deltaLines: string[] = [
    `### [${params.mergedAtIso}] ${params.deliverableTitle} (${params.deliverableId})`,
  ];
  if (parsedDelta.added.length > 0) {
    deltaLines.push("**ADDED:**");
    for (const item of parsedDelta.added) deltaLines.push(`- ${item}`);
  }
  if (parsedDelta.modified.length > 0) {
    deltaLines.push("**MODIFIED:**");
    for (const item of parsedDelta.modified) deltaLines.push(`- ${item}`);
  }
  if (parsedDelta.removed.length > 0) {
    deltaLines.push("**REMOVED:**");
    for (const item of parsedDelta.removed) deltaLines.push(`- ${item}`);
  }
  archiveBlocks.push(deltaLines.join("\n"));

  const activeList =
    activeItems.size > 0
      ? Array.from(activeItems).map((item) => `- ${item}`)
      : [`- ${EMPTY_ACTIVE_PLACEHOLDER}`];

  const removedList =
    removedItems.size > 0
      ? Array.from(removedItems).map((item) => `- ${item}`)
      : [`- ${EMPTY_REMOVED_PLACEHOLDER}`];

  return [
    "# OpenSpec Vivo do Projeto",
    "",
    `Última sincronização: ${params.mergedAtIso}`,
    "",
    "## Capacidades Ativas (Live Spec)",
    ...activeList,
    "",
    "## Capacidades Removidas / Depreciadas",
    ...removedList,
    "",
    "## Histórico de Deltas Arquivados",
    archiveBlocks.filter(Boolean).join("\n\n"),
    "",
  ].join("\n");
}

export async function syncOpenSpecArchive(
  params: SyncOpenSpecArchiveParams
): Promise<SyncOpenSpecArchiveResult> {
  const parsedDelta = OpenSpecDeltaSchema.parse(params.delta);
  const totalChanges =
    parsedDelta.added.length +
    parsedDelta.modified.length +
    parsedDelta.removed.length;
  const mergedAtIso = (params.mergedAt ?? new Date()).toISOString();

  let specPath: string | null = null;
  let existingMarkdown = params.existingSpecMarkdown ?? "";

  if (params.workspaceRoot) {
    const relPath = params.specRelativePath?.trim() || DEFAULT_OPENSPEC_REL_PATH;
    specPath = assertPathInsideWorkspace(params.workspaceRoot, relPath);
    if (!existingMarkdown && fs.existsSync(/*turbopackIgnore: true*/ specPath)) {
      const stat = fs.lstatSync(/*turbopackIgnore: true*/ specPath);
      if (stat.isFile() && !stat.isSymbolicLink()) {
        existingMarkdown = fs.readFileSync(/*turbopackIgnore: true*/ specPath, "utf8");
      }
    }
  }

  if (totalChanges === 0) {
    return {
      updated: false,
      specPath,
      markdown: existingMarkdown,
      appliedCounts: { added: 0, modified: 0, removed: 0 },
      memoryId: null,
    };
  }

  const nextMarkdown = applyOpenSpecDeltaToMarkdown({
    existingMarkdown,
    delta: parsedDelta,
    deliverableId: params.deliverableId,
    deliverableTitle: params.deliverableTitle,
    mergedAtIso,
  });

  if (specPath) {
    fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(specPath), {
      recursive: true,
    });
    fs.writeFileSync(/*turbopackIgnore: true*/ specPath, nextMarkdown, "utf8");
  }

  let memoryId: string | null = null;
  if (params.db && params.organizationId && params.projectId) {
    const memory = await createMemoryScoped(params.db, {
      organizationId: params.organizationId,
      input: {
        scopeType: "project",
        scopeId: params.projectId,
        category: "architecture",
        title: `OpenSpec Sync: ${params.deliverableTitle}`.slice(0, 200),
        content: nextMarkdown.slice(0, 16000),
        sourceDeliverableId: params.deliverableId,
      },
    });
    memoryId = memory.id;
  }

  return {
    updated: true,
    specPath,
    markdown: nextMarkdown,
    appliedCounts: {
      added: parsedDelta.added.length,
      modified: parsedDelta.modified.length,
      removed: parsedDelta.removed.length,
    },
    memoryId,
  };
}
