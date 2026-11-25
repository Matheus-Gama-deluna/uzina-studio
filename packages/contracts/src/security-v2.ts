import { z } from "zod";
import { SecuritySeveritySchema } from "./enums.js";
import { HttpUrlSchema } from "./errors.js";
import { ScannerExecutionStatusSchema } from "./security.js";

export const DastHeaderCheckSchema = z
  .object({
    header: z.string().trim().min(1).max(120),
    present: z.boolean(),
    value: z.string().max(1000).nullable(),
    status: z.enum(["ok", "missing", "misconfigured"]),
    severity: SecuritySeveritySchema,
    recommendation: z.string().trim().min(1).max(500),
  })
  .strict();
export type DastHeaderCheck = z.infer<typeof DastHeaderCheckSchema>;

export const DastPassiveReportSchema = z
  .object({
    targetUrl: HttpUrlSchema,
    statusCode: z.number().int().min(100).max(599).nullable(),
    executed: z.boolean(),
    status: ScannerExecutionStatusSchema,
    headers: z.array(DastHeaderCheckSchema),
    corsIssues: z.array(z.string().trim().min(1).max(500)).default([]),
    cookieIssues: z.array(z.string().trim().min(1).max(500)).default([]),
    nucleiFindingsCount: z.number().int().nonnegative().default(0),
    durationMs: z.number().int().nonnegative(),
  })
  .strict();
export type DastPassiveReport = z.infer<typeof DastPassiveReportSchema>;

export const SbomComponentSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    version: z.string().trim().min(1).max(100),
    purl: z.string().trim().min(1).max(300),
    license: z.string().trim().min(1).max(120).nullable().default(null),
    scope: z.enum(["required", "optional", "dev"]).default("required"),
  })
  .strict();
export type SbomComponent = z.infer<typeof SbomComponentSchema>;

export const SbomDocumentSummarySchema = z
  .object({
    bomFormat: z.literal("CycloneDX"),
    specVersion: z.literal("1.5"),
    serialNumber: z.string().trim().min(1).max(120),
    generatedAt: z.iso.datetime(),
    generator: z.string().trim().min(1).max(120),
    totalComponents: z.number().int().nonnegative(),
    componentsSample: z.array(SbomComponentSchema).max(500),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type SbomDocumentSummary = z.infer<typeof SbomDocumentSummarySchema>;

export const ScaReachabilityStatusSchema = z.enum([
  "reachable",
  "unreachable",
  "unknown",
]);
export type ScaReachabilityStatus = z.infer<typeof ScaReachabilityStatusSchema>;

export const ScaReachabilityAnnotationSchema = z
  .object({
    findingFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    packageName: z.string().trim().min(1).max(200),
    reachability: ScaReachabilityStatusSchema,
    importedInFiles: z.array(z.string().trim().min(1).max(500)).default([]),
    epssScore: z.number().min(0).max(1).nullable().default(null),
    inCisaKev: z.boolean().default(false),
    rationale: z.string().trim().min(1).max(500),
  })
  .strict();
export type ScaReachabilityAnnotation = z.infer<
  typeof ScaReachabilityAnnotationSchema
>;

export const AgenticPromptInjectionCategorySchema = z.enum([
  "ci_script_injection",
  "hidden_control_tags",
  "shell_exfiltration",
  "unsafe_tool_directive",
]);
export type AgenticPromptInjectionCategory = z.infer<
  typeof AgenticPromptInjectionCategorySchema
>;

export const AgenticPromptInjectionFindingSchema = z
  .object({
    ruleId: z.string().trim().min(1).max(160),
    category: AgenticPromptInjectionCategorySchema,
    severity: SecuritySeveritySchema,
    filePath: z.string().trim().min(1).max(500),
    line: z.number().int().min(1),
    matchedSnippet: z.string().trim().min(1).max(400),
    message: z.string().trim().min(1).max(500),
  })
  .strict();
export type AgenticPromptInjectionFinding = z.infer<
  typeof AgenticPromptInjectionFindingSchema
>;
