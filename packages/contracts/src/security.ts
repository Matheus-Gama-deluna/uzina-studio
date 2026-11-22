import { z } from "zod";
import { SecuritySeveritySchema, TriageVerdictSchema } from "./enums.js";
import { HttpUrlSchema } from "./errors.js";

export const TestAntiPatternRuleSchema = z.enum([
  "missing_assertion",
  "trivial_assertion_only",
  "swallowed_exception",
  "arbitrary_sleep",
  "duplicate_test_blocks",
]);
export type TestAntiPatternRule = z.infer<typeof TestAntiPatternRuleSchema>;

export const TestAuditFindingSchema = z.object({
  filePath: z.string().trim().min(1),
  line: z.number().int().min(1),
  testTitle: z.string().trim().min(1),
  rule: TestAntiPatternRuleSchema,
  message: z.string().trim().min(1),
  suppressed: z.boolean().default(false),
  suppressionReason: z.string().trim().min(1).nullable().default(null),
});
export type TestAuditFinding = z.infer<typeof TestAuditFindingSchema>;

export const TestAuditReportSchema = z.object({
  passed: z.boolean(),
  scannedFiles: z.number().int().nonnegative(),
  scannedTests: z.number().int().nonnegative(),
  suppressedCount: z.number().int().nonnegative(),
  violations: z.array(TestAuditFindingSchema),
});
export type TestAuditReport = z.infer<typeof TestAuditReportSchema>;

export const SecurityScanModeSchema = z.enum(["embedded", "standalone"]);
export type SecurityScanMode = z.infer<typeof SecurityScanModeSchema>;

export const SecurityTargetTypeSchema = z.enum([
  "git_repo",
  "git_diff",
  "container",
  "staging_url",
]);
export type SecurityTargetType = z.infer<typeof SecurityTargetTypeSchema>;

export const SecurityScanStatusSchema = z.enum([
  "running",
  "completed",
  "failed",
]);
export type SecurityScanStatus = z.infer<typeof SecurityScanStatusSchema>;

export const ScannerExecutionStatusSchema = z.enum([
  "executed",
  "skipped_missing_binary",
  "failed",
]);
export type ScannerExecutionStatus = z.infer<
  typeof ScannerExecutionStatusSchema
>;

export const PovTestStatusSchema = z.enum([
  "not_applicable",
  "missing",
  "failing_confirmed",
  "passing_fixed",
]);
export type PovTestStatus = z.infer<typeof PovTestStatusSchema>;

export const ScannerExecutionRecordSchema = z.object({
  scanner: z.string().trim().min(1).max(80),
  status: ScannerExecutionStatusSchema,
  binaryName: z.string().trim().min(1).max(80).nullable().default(null),
  installHint: z.string().trim().min(1).max(300).nullable().default(null),
  findingsCount: z.number().int().nonnegative().default(0),
  durationMs: z.number().int().nonnegative().default(0),
  errorMessage: z.string().max(1024).nullable().default(null),
});
export type ScannerExecutionRecord = z.infer<
  typeof ScannerExecutionRecordSchema
>;

export const SecurityScanSummaryCountsSchema = z.object({
  critical: z.number().int().nonnegative().default(0),
  high: z.number().int().nonnegative().default(0),
  medium: z.number().int().nonnegative().default(0),
  low: z.number().int().nonnegative().default(0),
  info: z.number().int().nonnegative().default(0),
  total: z.number().int().nonnegative().default(0),
  confirmedCount: z.number().int().nonnegative().default(0),
  suppressedCount: z.number().int().nonnegative().default(0),
  skippedScannersCount: z.number().int().nonnegative().default(0),
});
export type SecurityScanSummaryCounts = z.infer<
  typeof SecurityScanSummaryCountsSchema
>;

export const SarifLocationSchema = z.object({
  physicalLocation: z
    .object({
      artifactLocation: z
        .object({
          uri: z.string().min(1),
        })
        .optional(),
      region: z
        .object({
          startLine: z.number().int().min(1).optional(),
          endLine: z.number().int().min(1).optional(),
          snippet: z
            .object({
              text: z.string(),
            })
            .optional(),
        })
        .optional(),
    })
    .optional(),
});

export const SarifResultSchema = z.object({
  ruleId: z.string().min(1),
  level: z.enum(["error", "warning", "note", "none"]).optional(),
  message: z.object({
    text: z.string().min(1),
  }),
  locations: z.array(SarifLocationSchema).optional(),
  fingerprints: z.record(z.string(), z.string()).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
});
export type SarifResult = z.infer<typeof SarifResultSchema>;

export const SarifRunSchema = z.object({
  tool: z.object({
    driver: z.object({
      name: z.string().min(1),
      version: z.string().optional(),
      informationUri: z.string().optional(),
    }),
  }),
  invocations: z
    .array(
      z.object({
        executionSuccessful: z.boolean(),
        exitCode: z.number().int().optional(),
        toolExecutionNotifications: z
          .array(
            z.object({
              level: z.enum(["error", "warning", "note", "none"]).optional(),
              message: z.object({
                text: z.string(),
              }),
              properties: z.record(z.string(), z.unknown()).optional(),
            })
          )
          .optional(),
      })
    )
    .optional(),
  results: z.array(SarifResultSchema),
  properties: z.record(z.string(), z.unknown()).optional(),
});

export const SarifLog21Schema = z.object({
  version: z.literal("2.1.0"),
  $schema: z.string().optional(),
  runs: z.array(SarifRunSchema),
});
export type SarifLog21 = z.infer<typeof SarifLog21Schema>;

export const SecurityFindingDTOSchema = z.object({
  id: z.uuid(),
  scanId: z.uuid(),
  projectId: z.uuid().nullable(),
  ruleId: z.string().trim().min(1).max(200),
  scanner: z.string().trim().min(1).max(80),
  severity: SecuritySeveritySchema,
  filePath: z.string().trim().max(1000).nullable(),
  lineStart: z.number().int().min(1).nullable(),
  title: z.string().trim().min(1).max(500),
  description: z.string().max(8000),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  triageVerdict: TriageVerdictSchema,
  triageRationale: z.string().max(4000).nullable(),
  suppressedInMemory: z.boolean(),
  povTestStatus: PovTestStatusSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type SecurityFindingDTO = z.infer<typeof SecurityFindingDTOSchema>;

export const IngestSecurityFindingInputSchema = z
  .object({
    ruleId: z.string().trim().min(1).max(200),
    scanner: z.string().trim().min(1).max(80),
    severity: SecuritySeveritySchema,
    filePath: z.string().trim().max(1000).nullable().optional(),
    lineStart: z.number().int().min(1).nullable().optional(),
    title: z.string().trim().min(1).max(500),
    description: z.string().max(8000),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    triageVerdict: TriageVerdictSchema.default("pending"),
    triageRationale: z.string().max(4000).nullable().optional(),
    suppressedInMemory: z.boolean().default(false),
    povTestStatus: PovTestStatusSchema.default("not_applicable"),
  })
  .strict();
export type IngestSecurityFindingInput = z.infer<
  typeof IngestSecurityFindingInputSchema
>;

export const SecurityScanResultSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  projectId: z.uuid().nullable(),
  deliverableId: z.uuid().nullable(),
  mode: SecurityScanModeSchema,
  targetType: SecurityTargetTypeSchema,
  targetRef: z.string().trim().min(1).max(500),
  scannersRun: z.array(z.string().trim().min(1)),
  scannerStatuses: z.array(ScannerExecutionRecordSchema).default([]),
  summaryCountsJson: SecurityScanSummaryCountsSchema,
  status: SecurityScanStatusSchema,
  sarifRawJson: SarifLog21Schema.nullable().optional(),
  findings: z.array(SecurityFindingDTOSchema).optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type SecurityScanResult = z.infer<typeof SecurityScanResultSchema>;

export const SecurityScanListResponseSchema = z.object({
  items: z.array(SecurityScanResultSchema),
});
export type SecurityScanListResponse = z.infer<
  typeof SecurityScanListResponseSchema
>;

const SafeRelativeSubpathSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.startsWith("\\") &&
      !value.startsWith("-") &&
      !/^[A-Za-z]:/.test(value) &&
      !value.split(/[\\/]/).includes(".."),
    "Subcaminho relativo inválido"
  );

export const RunSecurityScanSchema = z
  .object({
    projectId: z.uuid().optional(),
    deliverableId: z.uuid().optional(),
    targetType: z.enum(["git_repo", "git_diff", "staging_url"]),
    relativeSubpath: SafeRelativeSubpathSchema.optional(),
    stagingUrl: HttpUrlSchema.optional(),
    scanners: z.array(z.string().trim().min(1).max(60)).max(12).optional(),
    triage: z.boolean().default(true),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.targetType === "staging_url") {
      if (!val.stagingUrl) {
        ctx.addIssue({
          code: "custom",
          path: ["stagingUrl"],
          message: "stagingUrl é obrigatória quando targetType = staging_url",
        });
      }
      return;
    }
    if (!val.projectId && !val.deliverableId) {
      ctx.addIssue({
        code: "custom",
        path: ["projectId"],
        message:
          "Informe projectId ou deliverableId para resolver o alvo no servidor.",
      });
    }
  });
export type RunSecurityScanInput = z.input<typeof RunSecurityScanSchema>;

export const IngestSecurityScanSchema = z
  .object({
    projectId: z.uuid().nullable().optional(),
    deliverableId: z.uuid().nullable().optional(),
    targetType: SecurityTargetTypeSchema,
    targetRef: z.string().trim().min(1).max(500),
    scannersRun: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
    scannerStatuses: z.array(ScannerExecutionRecordSchema).max(20).default([]),
    sarifRawJson: SarifLog21Schema,
    summaryCountsJson: SecurityScanSummaryCountsSchema,
    status: SecurityScanStatusSchema.default("completed"),
    findings: z.array(IngestSecurityFindingInputSchema).max(2000),
  })
  .strict();
export type IngestSecurityScanInput = z.infer<typeof IngestSecurityScanSchema>;

export const UpdateFindingTriageSchema = z
  .object({
    triageVerdict: z.enum(["confirmed", "false_positive", "unknown"]),
    triageRationale: z.string().trim().max(4000).optional(),
    suppressedInMemory: z.boolean().optional(),
    povTestStatus: PovTestStatusSchema.optional(),
  })
  .strict();
export type UpdateFindingTriageInput = z.infer<
  typeof UpdateFindingTriageSchema
>;
