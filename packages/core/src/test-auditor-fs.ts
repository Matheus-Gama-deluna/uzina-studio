import fs from "node:fs";
import path from "node:path";
import type { TestAuditReport } from "@uzina/contracts";
import { auditTestSource, mergeTestAuditReports } from "./test-auditor.js";

const DEFAULT_IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".next",
  ".turbo",
  ".worktrees",
  "coverage",
  "e2e",
]);

const TEST_FILE_PATTERN = /\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs|cjs)$/;

export function collectTestFiles(
  rootDir: string,
  ignoredDirs: ReadonlySet<string> = DEFAULT_IGNORED_DIRS
): string[] {
  const files: string[] = [];
  if (!fs.existsSync(rootDir)) {
    return files;
  }

  const walk = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (ignoredDirs.has(entry.name)) {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && TEST_FILE_PATTERN.test(entry.name)) {
        files.push(fullPath);
      }
    }
  };

  walk(rootDir);
  return files.sort();
}

export function auditTestDirectory(rootDir: string): TestAuditReport {
  const files = collectTestFiles(rootDir);
  if (files.length === 0) {
    return {
      passed: true,
      scannedFiles: 0,
      scannedTests: 0,
      suppressedCount: 0,
      violations: [],
    };
  }

  const reports = files.map((filePath) => {
    const content = fs.readFileSync(filePath, "utf8");
    const relativePath = path.relative(rootDir, filePath).replace(/\\/g, "/");
    return auditTestSource(relativePath || filePath, content);
  });

  return mergeTestAuditReports(reports);
}
