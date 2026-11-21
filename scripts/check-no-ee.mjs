#!/usr/bin/env node
/**
 * CI Blocker: Garante uso estrito do Mastra Core (Apache 2.0),
 * proibindo qualquer dependência @mastra/*-ee ou importação de módulos ee/.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const IGNORE_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", ".turbo", "data", "docs"]);
const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".yaml"]);

const FORBIDDEN_PATTERNS = [
  { name: "Pacote comercial @mastra/*-ee", regex: /@mastra\/[a-z0-9-]+-ee(["'/\s]|$)/i },
  { name: "Import de caminho comercial /ee/", regex: /from\s+["']@mastra\/[^"']*\/ee(\/|["']|$)/i },
  { name: "Import side-effect de caminho comercial /ee/", regex: /\bimport\s+["']@mastra\/[^"']*\/ee(\/|["']|$)/i },
  { name: "Import dinâmico de caminho comercial /ee/", regex: /\bimport\(\s*["']@mastra\/[^"']*\/ee(\/|["']|$)/i },
  { name: "Require de caminho comercial /ee/", regex: /require\(\s*["']@mastra\/[^"']*\/ee(\/|["']|$)/i },
  { name: "Dependência mastra-ee", regex: /["']mastra-ee["']/i },
];

const violations = [];

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
    } else if (SOURCE_EXTS.has(path.extname(entry.name))) {
      if (fullPath.endsWith(path.join("scripts", "check-no-ee.mjs"))) continue;
      const content = fs.readFileSync(fullPath, "utf8");
      const lines = content.split(/\r?\n/);
      lines.forEach((line, idx) => {
        for (const rule of FORBIDDEN_PATTERNS) {
          if (rule.regex.test(line)) {
            violations.push({
              file: path.relative(ROOT, fullPath),
              line: idx + 1,
              rule: rule.name,
              snippet: line.trim().slice(0, 120),
            });
          }
        }
      });
    }
  }
}

walk(ROOT);

if (violations.length > 0) {
  console.error("ERRO [check-no-ee]: Detectado uso proibido de módulos comerciais Mastra ee/:");
  for (const v of violations) {
    console.error(`  - ${v.file}:${v.line} [${v.rule}] -> ${v.snippet}`);
  }
  process.exit(1);
}

console.log("OK [check-no-ee]: Nenhuma dependência ou importação comercial Mastra ee/ encontrada.");
