import { describe, expect, it } from "vitest";
import {
  EvidencePackSchema,
  ExecutionEventSchema,
  IngestSecurityScanSchema,
  ResolveDecisionSchema,
  RunSecurityScanSchema,
  UpdateFindingTriageSchema,
  VerifierVerdictOutputSchema,
  WorkflowGateTypeSchema,
} from "../src/index.js";

describe("Slice 4 contracts", () => {
  const validUuid = "11111111-1111-4111-8111-111111111111";
  const validSha256 = "a".repeat(64);
  const nowIso = "2026-11-21T20:00:00.000Z";

  it.each([
    { gate: "discovery_confirm", ok: true },
    { gate: "blueprint_approve", ok: true },
    { gate: "visual_approve", ok: true },
    { gate: "pr_evidence_approve", ok: true },
    { gate: "stuck_intervention", ok: true },
    { gate: "unknown_gate", ok: false },
  ])("validates WorkflowGateTypeSchema for $gate", ({ gate, ok }) => {
    const parsed = WorkflowGateTypeSchema.safeParse(gate);
    expect(parsed.success).toBe(ok);
  });

  it.each([
    {
      name: "approved without feedback",
      input: { status: "approved" },
      ok: true,
    },
    {
      name: "rejected with feedback",
      input: { status: "rejected", humanFeedback: "Fora do escopo" },
      ok: true,
    },
    {
      name: "changes_requested with feedback",
      input: { status: "changes_requested", humanFeedback: "Ajustar SQL" },
      ok: true,
    },
    {
      name: "changes_requested missing feedback",
      input: { status: "changes_requested" },
      ok: false,
    },
    {
      name: "changes_requested short feedback",
      input: { status: "changes_requested", humanFeedback: "ok" },
      ok: false,
    },
    {
      name: "strict rejects unknown key",
      input: { status: "approved", extra: true },
      ok: false,
    },
  ])("validates ResolveDecisionSchema ($name)", ({ input, ok }) => {
    expect(ResolveDecisionSchema.safeParse(input).success).toBe(ok);
  });

  it.each([
    {
      name: "git_diff with deliverableId and relativeSubpath",
      input: {
        deliverableId: validUuid,
        targetType: "git_diff",
        relativeSubpath: "packages/core/src",
      },
      ok: true,
    },
    {
      name: "staging_url with url",
      input: {
        targetType: "staging_url",
        stagingUrl: "http://127.0.0.1:3000",
      },
      ok: true,
    },
    {
      name: "rejects path traversal in relativeSubpath",
      input: {
        projectId: validUuid,
        targetType: "git_repo",
        relativeSubpath: "../secrets",
      },
      ok: false,
    },
    {
      name: "rejects flag-like relativeSubpath",
      input: {
        projectId: validUuid,
        targetType: "git_repo",
        relativeSubpath: "--upload-pack=sh",
      },
      ok: false,
    },
    {
      name: "rejects unknown allowlistedHosts field",
      input: {
        targetType: "staging_url",
        stagingUrl: "http://127.0.0.1:3000",
        allowlistedHosts: ["169.254.169.254"],
      },
      ok: false,
    },
    {
      name: "rejects git_repo without projectId or deliverableId",
      input: {
        targetType: "git_repo",
      },
      ok: false,
    },
  ])("validates RunSecurityScanSchema ($name)", ({ input, ok }) => {
    expect(RunSecurityScanSchema.safeParse(input).success).toBe(ok);
  });

  it.each([
    {
      name: "valid triage update",
      input: {
        triageVerdict: "false_positive",
        triageRationale: "Token de exemplo em fixture sintética",
        suppressedInMemory: true,
        povTestStatus: "not_applicable",
      },
      ok: true,
    },
    {
      name: "rejects pending on manual triage update",
      input: { triageVerdict: "pending" },
      ok: false,
    },
    {
      name: "rejects extra property",
      input: { triageVerdict: "confirmed", scanner: "gitleaks" },
      ok: false,
    },
  ])("validates UpdateFindingTriageSchema ($name)", ({ input, ok }) => {
    expect(UpdateFindingTriageSchema.safeParse(input).success).toBe(ok);
  });

  it("validates EvidencePackSchema, ExecutionEventSchema, VerifierVerdictOutputSchema and IngestSecurityScanSchema", () => {
    const evidence = EvidencePackSchema.safeParse({
      deliverableId: validUuid,
      branchName: "uzina/slice4-demo",
      baseBranch: "main",
      verifyAttempts: 1,
      verifyPassed: true,
      verifyChecks: [
        {
          name: "audit:tests",
          passed: true,
          durationMs: 120,
          summary: "0 anti-patterns",
        },
      ],
      testAuditPassed: true,
      testAuditViolationsCount: 0,
      diffSummary: {
        filesChanged: 2,
        diffBytes: 420,
        preview: "+ export const ok = true;",
      },
      securitySummary: {
        scanId: validUuid,
        critical: 0,
        high: 0,
        medium: 0,
        low: 1,
        info: 0,
        scannersRun: ["native_secrets", "gitleaks"],
        skippedScanners: ["gitleaks"],
        gatePassed: true,
      },
      tokenSummary: {
        totalInputTokens: 1200,
        totalOutputTokens: 350,
        totalCacheReadTokens: 600,
        estimatedCostUsd: 0.014,
      },
      verifierVerdict: "approved",
      verifierNotes: "Mudança atende todos os requisitos.",
    });
    expect(evidence.success).toBe(true);

    const event = ExecutionEventSchema.safeParse({
      id: validUuid,
      deliverableId: validUuid,
      stage: "stage_verify",
      actorRole: "verifier",
      eventType: "verify_result",
      tokensInput: 200,
      tokensOutput: 100,
      cacheReadTokens: 50,
      estimatedCostUsd: 0.0025,
      payloadJson: { passed: true },
      createdAt: nowIso,
    });
    expect(event.success).toBe(true);

    const verdict = VerifierVerdictOutputSchema.safeParse({
      verdict: "changes_required",
      summary: "Faltou validação Zod na borda.",
      issues: [
        {
          severity: "blocker",
          filePath: "src/route.ts",
          message: "Adicionar parse strict",
        },
      ],
    });
    expect(verdict.success).toBe(true);

    const ingest = IngestSecurityScanSchema.safeParse({
      projectId: validUuid,
      targetType: "git_repo",
      targetRef: "repo@HEAD",
      scannersRun: ["native_secrets", "gitleaks"],
      scannerStatuses: [
        {
          scanner: "native_secrets",
          status: "executed",
          binaryName: null,
          installHint: null,
          findingsCount: 1,
          durationMs: 12,
          errorMessage: null,
        },
        {
          scanner: "gitleaks",
          status: "skipped_missing_binary",
          binaryName: "gitleaks",
          installHint: "uzina-sec install-tools",
          findingsCount: 0,
          durationMs: 1,
          errorMessage: "Binário não encontrado no PATH",
        },
      ],
      sarifRawJson: {
        version: "2.1.0",
        runs: [
          {
            tool: { driver: { name: "uzina-security-engine" } },
            results: [],
          },
        ],
      },
      summaryCountsJson: {
        critical: 0,
        high: 1,
        medium: 0,
        low: 0,
        info: 0,
        total: 1,
        confirmedCount: 0,
        suppressedCount: 0,
        skippedScannersCount: 1,
      },
      findings: [
        {
          ruleId: "uzina/native-secret",
          scanner: "native_secrets",
          severity: "high",
          filePath: "src/config.ts",
          lineStart: 4,
          title: "Possível chave exposta",
          description: "Token mascarado: sk-***",
          fingerprint: validSha256,
        },
      ],
    });
    expect(ingest.success).toBe(true);
  });
});
