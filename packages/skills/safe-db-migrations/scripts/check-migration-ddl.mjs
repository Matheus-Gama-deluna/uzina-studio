#!/usr/bin/env node
/**
 * Uzina Studio — Detector estático de DDL destrutivo e locks bloqueantes em migrações SQL.
 * Uso: node check-migration-ddl.mjs <caminho-sql-ou-diretorio> [--json]
 * Sai com código 1 quando encontra violações bloqueantes ("error"), ou 0 quando seguro.
 */
import fs from "node:fs";
import path from "node:path";

const ALLOW_MARKER = "uzina-allow-destructive";

const RULES = [
  {
    id: "destructive_drop_table",
    severity: "error",
    regex: /\bDROP\s+TABLE\b/i,
    message:
      "DROP TABLE detectado: aplique padrão Expand-Migrate-Contract e aprovação HITL antes de remover tabelas.",
  },
  {
    id: "destructive_truncate",
    severity: "error",
    regex: /\bTRUNCATE\s+(?:TABLE\s+)?[a-zA-Z0-9_."]+/i,
    message:
      "TRUNCATE detectado: operação destrutiva irreversível proibida em migração automática.",
  },
  {
    id: "destructive_drop_column",
    severity: "error",
    regex: /\bALTER\s+TABLE\b[\s\S]*?\bDROP\s+COLUMN\b/i,
    message:
      "DROP COLUMN detectado em passo único: deprecie em código antes de remover coluna em slice futuro.",
  },
  {
    id: "destructive_alter_column_type",
    severity: "error",
    regex: /\bALTER\s+TABLE\b[\s\S]*?\bALTER\s+COLUMN\b[\s\S]*?\bTYPE\b/i,
    message:
      "ALTER COLUMN ... TYPE detectado: pode causar reescrita de tabela com lock longo ou truncamento de dados.",
  },
  {
    id: "not_null_without_default",
    severity: "error",
    regex: /\bADD\s+(?:COLUMN\s+)?(?!CONSTRAINT\b)[a-zA-Z0-9_"]+\s+[^;]*\bNOT\s+NULL\b/i,
    guard: (stmt) => !/\bDEFAULT\b/i.test(stmt),
    message:
      "ADD COLUMN ... NOT NULL sem DEFAULT detectado: falha em tabelas populadas e impõe lock exclusivo.",
  },
  {
    id: "unscoped_delete",
    severity: "error",
    regex: /\bDELETE\s+FROM\b[\s\S]*$/i,
    guard: (stmt) => !/\bWHERE\b/i.test(stmt),
    message:
      "DELETE FROM sem cláusula WHERE detectado: apaga todos os registros da tabela.",
  },
  {
    id: "non_concurrent_index",
    severity: "warning",
    regex: /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b(?!\s+CONCURRENTLY\b)/i,
    message:
      "CREATE INDEX sem CONCURRENTLY detectado: avalie uso de CONCURRENTLY para evitar lock de escrita em produção.",
  },
];

function stripSqlCommentsPreserveLines(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/--.*$/gm, "");
}

function collectSqlFiles(targetPath) {
  const resolved = path.resolve(targetPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Caminho não encontrado: ${targetPath}`);
  }
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink()) {
    throw new Error(`Symlink não permitido: ${targetPath}`);
  }
  if (stat.isFile()) {
    return [resolved];
  }
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (fs.lstatSync(full).isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".sql")) {
        files.push(full);
      }
    }
  };
  walk(resolved);
  return files.sort((a, b) => a.localeCompare(b));
}

export function analyzeSqlMigration(sqlText, fileLabel = "<memory>") {
  const rawLines = sqlText.replace(/\r\n/g, "\n").split("\n");
  const cleaned = stripSqlCommentsPreserveLines(sqlText.replace(/\r\n/g, "\n"));
  const statements = cleaned.split(";");
  const issues = [];

  let lineCursor = 1;
  for (const stmt of statements) {
    const trimmed = stmt.trim();
    const stmtLines = stmt.split("\n").length - 1;
    if (!trimmed) {
      lineCursor += stmtLines;
      continue;
    }

    const firstNonEmptyOffset = stmt
      .split("\n")
      .findIndex((l) => l.trim().length > 0);
    const stmtStartLine = lineCursor + Math.max(0, firstNonEmptyOffset);
    const previousRawLine = rawLines[stmtStartLine - 2] ?? "";
    const currentRawLine = rawLines[stmtStartLine - 1] ?? "";
    const hasExplicitOverride =
      previousRawLine.includes(ALLOW_MARKER) ||
      currentRawLine.includes(ALLOW_MARKER);

    if (!hasExplicitOverride) {
      for (const rule of RULES) {
        if (!rule.regex.test(trimmed)) continue;
        if (rule.guard && !rule.guard(trimmed)) continue;
        issues.push({
          file: fileLabel,
          line: stmtStartLine,
          ruleId: rule.id,
          severity: rule.severity,
          message: rule.message,
        });
      }
    }

    lineCursor += stmtLines;
  }

  const hasErrors = issues.some((i) => i.severity === "error");
  return {
    ok: !hasErrors,
    issues,
  };
}

function main() {
  const args = process.argv.slice(2);
  const targets = args.filter((a) => !a.startsWith("--"));
  if (targets.length === 0) {
    console.error(
      "Uso: node check-migration-ddl.mjs <arquivo.sql|diretorio> [--json]"
    );
    process.exit(2);
  }

  const allIssues = [];
  for (const target of targets) {
    for (const file of collectSqlFiles(target)) {
      const content = fs.readFileSync(file, "utf8");
      const report = analyzeSqlMigration(content, path.relative(process.cwd(), file));
      allIssues.push(...report.issues);
    }
  }

  const hasErrors = allIssues.some((i) => i.severity === "error");
  const output = { ok: !hasErrors, issues: allIssues };
  console.log(JSON.stringify(output, null, 2));
  process.exit(hasErrors ? 1 : 0);
}

const isEntrypoint =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

if (isEntrypoint) {
  main();
}
