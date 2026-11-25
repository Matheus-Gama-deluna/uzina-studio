import {
  MigrationSafetyReportSchema,
  type MigrationSafetyIssue,
  type MigrationSafetyReport,
} from "@uzina/contracts";

const ALLOW_DESTRUCTIVE_MARKER = "uzina-allow-destructive";
const MAX_STATEMENT_LENGTH = 500;
const MAX_ISSUES = 200;

interface MigrationSafetyRule {
  id: string;
  severity: MigrationSafetyIssue["severity"];
  regex: RegExp;
  guard?: (statement: string) => boolean;
  recommendation: string;
}

const MIGRATION_SAFETY_RULES: readonly MigrationSafetyRule[] = [
  {
    id: "no_drop_table",
    severity: "blocking",
    regex: /\bDROP\s+TABLE\b/i,
    recommendation:
      "Aplique Expand-Migrate-Contract e obtenha aprovação HITL antes de remover tabelas.",
  },
  {
    id: "no_drop_column",
    severity: "blocking",
    regex: /\bDROP\s+COLUMN\b/i,
    recommendation:
      "Deprecie a coluna no código antes de removê-la em uma migração futura separada.",
  },
  {
    id: "no_truncate",
    severity: "blocking",
    regex: /\bTRUNCATE\s+(?:TABLE\s+)?[a-zA-Z0-9_."]+/i,
    recommendation:
      "TRUNCATE é destrutivo e irreversível; proibido em migrações automáticas.",
  },
  {
    id: "no_add_column_not_null_without_default",
    severity: "blocking",
    regex:
      /\bADD\s+(?:COLUMN\s+)?(?!CONSTRAINT\b)[a-zA-Z0-9_"]+\s+[^;]*\bNOT\s+NULL\b/i,
    guard: (statement) => !/\bDEFAULT\b/i.test(statement),
    recommendation:
      "Adicione DEFAULT seguro ou crie a coluna nullable, faça backfill e aplique NOT NULL depois.",
  },
  {
    id: "unsafe_alter_column_type",
    severity: "blocking",
    regex: /\bALTER\s+COLUMN\b[\s\S]*?\bTYPE\b/i,
    recommendation:
      "ALTER COLUMN TYPE reescreve a tabela com lock longo; use nova coluna + backfill gradual.",
  },
  {
    id: "create_index_without_concurrently",
    severity: "warning",
    regex: /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b(?!\s+CONCURRENTLY\b)/i,
    recommendation:
      "Prefira CREATE INDEX CONCURRENTLY para evitar bloqueio de escrita em produção.",
  },
];

function stripSqlCommentsPreservingLines(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/--.*$/gm, "");
}

function truncateStatement(statement: string): string {
  const collapsed = statement.replace(/\s+/g, " ").trim();
  if (collapsed.length <= MAX_STATEMENT_LENGTH) {
    return collapsed;
  }
  return `${collapsed.slice(0, MAX_STATEMENT_LENGTH - 3)}...`;
}

export interface ValidateMigrationSafetyOptions {
  failOnWarnings?: boolean;
}

export function validateMigrationSafety(
  content: string,
  filePath = "<memory>",
  options: ValidateMigrationSafetyOptions = {}
): MigrationSafetyReport {
  const normalizedPath = filePath.trim().slice(0, 500) || "<memory>";
  const normalizedSql = content.replace(/\r\n/g, "\n");
  const rawLines = normalizedSql.split("\n");
  const cleaned = stripSqlCommentsPreservingLines(normalizedSql);
  const statements = cleaned.split(";");
  const issues: MigrationSafetyIssue[] = [];

  let lineCursor = 1;
  for (const stmt of statements) {
    const trimmed = stmt.trim();
    const stmtNewlines = stmt.split("\n").length - 1;
    if (!trimmed) {
      lineCursor += stmtNewlines;
      continue;
    }

    const firstNonEmptyOffset = stmt
      .split("\n")
      .findIndex((line) => line.trim().length > 0);
    const stmtStartLine = lineCursor + Math.max(0, firstNonEmptyOffset);
    const prevRawLine = rawLines[stmtStartLine - 2] ?? "";
    const currRawLine = rawLines[stmtStartLine - 1] ?? "";
    const hasOverride =
      prevRawLine.includes(ALLOW_DESTRUCTIVE_MARKER) ||
      currRawLine.includes(ALLOW_DESTRUCTIVE_MARKER);

    if (!hasOverride) {
      for (const rule of MIGRATION_SAFETY_RULES) {
        if (issues.length >= MAX_ISSUES) {
          break;
        }
        if (!rule.regex.test(trimmed)) {
          continue;
        }
        if (rule.guard && !rule.guard(trimmed)) {
          continue;
        }
        issues.push({
          severity: rule.severity,
          rule: rule.id,
          filePath: normalizedPath,
          line: stmtStartLine,
          statement: truncateStatement(trimmed),
          recommendation: rule.recommendation,
        });
      }
    }

    lineCursor += stmtNewlines;
  }

  const failOnWarnings = Boolean(options.failOnWarnings);
  const passed = !issues.some(
    (issue) =>
      issue.severity === "blocking" ||
      (failOnWarnings && issue.severity === "warning")
  );

  return MigrationSafetyReportSchema.parse({
    passed,
    scannedFiles: [normalizedPath],
    issues,
  });
}

export function validateMigrationSafetyBatch(
  files: ReadonlyArray<{ content: string; filePath: string }>,
  options: ValidateMigrationSafetyOptions = {}
): MigrationSafetyReport {
  const scannedFiles: string[] = [];
  const allIssues: MigrationSafetyIssue[] = [];

  for (const file of files) {
    const report = validateMigrationSafety(file.content, file.filePath, options);
    scannedFiles.push(...report.scannedFiles);
    for (const issue of report.issues) {
      if (allIssues.length >= MAX_ISSUES) {
        break;
      }
      allIssues.push(issue);
    }
  }

  const failOnWarnings = Boolean(options.failOnWarnings);
  const passed = !allIssues.some(
    (issue) =>
      issue.severity === "blocking" ||
      (failOnWarnings && issue.severity === "warning")
  );

  return MigrationSafetyReportSchema.parse({
    passed,
    scannedFiles,
    issues: allIssues,
  });
}
