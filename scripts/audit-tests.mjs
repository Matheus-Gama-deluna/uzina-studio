#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditTestDirectory, mergeTestAuditReports } from "../packages/core/dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const targetRoots = [
  path.join(repoRoot, "packages"),
  path.join(repoRoot, "apps"),
];

const reports = targetRoots.map((dir) => auditTestDirectory(dir));
const merged = mergeTestAuditReports(reports);

console.log(
  `[audit:tests] Arquivos: ${merged.scannedFiles} | Testes: ${merged.scannedTests} | Suprimidos: ${merged.suppressedCount} | Violações: ${merged.violations.length}`
);

if (!merged.passed) {
  for (const finding of merged.violations) {
    console.error(
      `[FAIL] ${finding.filePath}:${finding.line} (${finding.rule}) — ${finding.testTitle}: ${finding.message}`
    );
  }
  process.exit(1);
}

console.log("[audit:tests] OK — nenhum anti-pattern detectado.");
