import { z } from "zod";
import { ScannerExecutionStatusSchema } from "./security.js";

export const VisualA11yViolationSchema = z
  .object({
    id: z.string().trim().min(1).max(120),
    impact: z.enum(["minor", "moderate", "serious", "critical"]),
    nodesCount: z.number().int().nonnegative(),
    help: z.string().trim().min(1).max(500),
  })
  .strict();
export type VisualA11yViolation = z.infer<typeof VisualA11yViolationSchema>;

export const VisualA11yVerifyReportSchema = z
  .object({
    executed: z.boolean(),
    status: z.enum(["passed", "failed", "skipped_missing_binary"]),
    viewports: z.array(z.enum(["1440x900", "390x844"])).min(1),
    consoleErrors: z.array(z.string().max(1000)),
    horizontalOverflowPx: z.number().nonnegative(),
    axeViolations: z.array(VisualA11yViolationSchema),
  })
  .strict();
export type VisualA11yVerifyReport = z.infer<
  typeof VisualA11yVerifyReportSchema
>;

export const SkillsLockEntrySchema = z
  .object({
    name: z.string().regex(/^[a-z0-9-]+$/, "Nome da skill deve ser kebab-case"),
    source: z.string().trim().min(1).max(300),
    version: z.string().trim().min(1).max(40),
    license: z.string().trim().min(1).max(64),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    verified: z.boolean(),
    enabled: z.boolean(),
  })
  .strict();
export type SkillsLockEntry = z.infer<typeof SkillsLockEntrySchema>;

export const SkillsLockManifestSchema = z
  .object({
    lockVersion: z.literal(1),
    skills: z.array(SkillsLockEntrySchema),
  })
  .strict();
export type SkillsLockManifest = z.infer<typeof SkillsLockManifestSchema>;

export const EntropyAuditReportSchema = z
  .object({
    deadCodeCandidates: z.array(
      z
        .object({
          symbol: z.string().trim().min(1).max(200),
          filePath: z.string().trim().min(1).max(500),
          line: z.number().int().min(1),
        })
        .strict()
    ),
    docSpecDrifts: z.array(
      z
        .object({
          specPath: z.string().trim().min(1).max(500),
          missingTarget: z.string().trim().min(1).max(500),
          detail: z.string().trim().min(1).max(500),
        })
        .strict()
    ),
    orphanWorktrees: z.array(
      z
        .object({
          workspacePath: z.string().trim().min(1).max(500),
          branchName: z.string().trim().min(1).max(200),
          deliverableId: z.string().trim().min(1).max(160).nullable(),
        })
        .strict()
    ),
    unusedDependencies: z.array(
      z
        .object({
          packageName: z.string().trim().min(1).max(160),
          dependencyName: z.string().trim().min(1).max(160),
        })
        .strict()
    ),
  })
  .strict();
export type EntropyAuditReport = z.infer<typeof EntropyAuditReportSchema>;

export const MutationPbtReportSchema = z
  .object({
    pbtExecuted: z.boolean(),
    pbtCasesRun: z.number().int().nonnegative(),
    pbtPassed: z.boolean(),
    mutationStatus: ScannerExecutionStatusSchema,
    mutationScorePercent: z.number().min(0).max(100).nullable(),
    killedMutants: z.number().int().nonnegative().default(0),
    survivedMutants: z.number().int().nonnegative().default(0),
    targetFiles: z.array(z.string().trim().min(1).max(500)).default([]),
  })
  .strict();
export type MutationPbtReport = z.infer<typeof MutationPbtReportSchema>;
