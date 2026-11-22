import crypto from "node:crypto";
import type { CodebaseSymbolKind } from "@uzina/contracts";
import type {
  ExtractedRawReference,
  IndexedFileDraft,
  IndexedSymbolDraft,
} from "./ts-indexer.js";

export type PolyglotLanguage =
  | "python"
  | "go"
  | "rust"
  | "sql"
  | "java"
  | "csharp";

export function detectPolyglotLanguage(relPath: string): PolyglotLanguage | null {
  const lower = relPath.toLowerCase();
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".go")) return "go";
  if (lower.endsWith(".rs")) return "rust";
  if (lower.endsWith(".sql")) return "sql";
  if (lower.endsWith(".java")) return "java";
  if (lower.endsWith(".cs")) return "csharp";
  return null;
}

function findBlockEndLine(
  lines: string[],
  startIdx: number,
  language: PolyglotLanguage
): number {
  if (language === "python") {
    const startIndent = lines[startIdx]!.search(/\S|$/);
    for (let i = startIdx + 1; i < lines.length; i += 1) {
      const line = lines[i]!;
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const indent = line.search(/\S|$/);
      if (indent <= startIndent) {
        return i; // 1-based lineEnd = previous line
      }
    }
    return lines.length;
  }

  let braceDepth = 0;
  let seenOpen = false;
  for (let i = startIdx; i < lines.length; i += 1) {
    const line = lines[i]!;
    for (const ch of line) {
      if (ch === "{") {
        braceDepth += 1;
        seenOpen = true;
      } else if (ch === "}") {
        braceDepth -= 1;
        if (seenOpen && braceDepth <= 0) {
          return i + 1;
        }
      }
    }
    if (language === "sql" && line.includes(";")) {
      return i + 1;
    }
  }
  return Math.min(lines.length, startIdx + 1);
}

export function indexPolyglotSourceText(
  relativePath: string,
  content: string
): IndexedFileDraft {
  const normalizedPath = relativePath.replace(/\\/g, "/");
  const language = detectPolyglotLanguage(normalizedPath) ?? "python";
  const lines = content.split(/\r?\n/);
  const symbols: IndexedSymbolDraft[] = [];
  const references: ExtractedRawReference[] = [];

  for (let idx = 0; idx < lines.length; idx += 1) {
    const rawLine = lines[idx]!;
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    let match: RegExpMatchArray | null = null;
    let kind: CodebaseSymbolKind | null = null;
    let name = "";
    let signature = "";
    let exported = true;

    if (language === "python") {
      if ((match = trimmed.match(/^(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)(?:\s*->\s*([^:]+))?:/))) {
        name = match[1]!;
        const prevLine = idx > 0 ? lines[idx - 1]!.trim() : "";
        const isRoute = /^@(?:app|router)\.(get|post|put|patch|delete)\b/i.test(prevLine);
        kind = isRoute ? "route" : "function";
        signature = `def ${name}(${match[2]?.trim() ?? ""})${match[3] ? ` -> ${match[3].trim()}` : ""}`;
        exported = !name.startsWith("_");
      } else if ((match = trimmed.match(/^class\s+([A-Za-z_][A-Za-z0-9_]*)(?:\(([^)]*)\))?:/))) {
        name = match[1]!;
        const bases = match[2] ?? "";
        kind = /\bBaseModel\b/i.test(bases) ? "zod_schema" : "class";
        signature = `class ${name}${bases ? `(${bases.trim()})` : ""}`;
        exported = !name.startsWith("_");
      }
    } else if (language === "go") {
      if ((match = trimmed.match(/^func\s+(?:\([^)]+\)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/))) {
        name = match[1]!;
        kind = /http\.ResponseWriter/i.test(trimmed) ? "route" : "function";
        signature = `func ${name}(${match[2]?.trim() ?? ""})`;
        exported = /^[A-Z]/.test(name);
      } else if ((match = trimmed.match(/^type\s+([A-Za-z_][A-Za-z0-9_]*)\s+(struct|interface)\b/))) {
        name = match[1]!;
        kind = "class";
        signature = `type ${name} ${match[2]}`;
        exported = /^[A-Z]/.test(name);
      }
    } else if (language === "rust") {
      if ((match = trimmed.match(/^(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/))) {
        name = match[1]!;
        kind = "function";
        signature = `${trimmed.startsWith("pub") ? "pub " : ""}fn ${name}(${match[2]?.trim() ?? ""})`;
        exported = trimmed.startsWith("pub ");
      } else if ((match = trimmed.match(/^(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z_][A-Za-z0-9_]*)/))) {
        name = match[1]!;
        kind = "class";
        signature = trimmed.replace(/\{.*$/, "").trim();
        exported = trimmed.startsWith("pub ");
      }
    } else if (language === "sql") {
      if ((match = trimmed.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([A-Za-z_][A-Za-z0-9_.]*)["`]?/i))) {
        name = match[1]!;
        kind = "db_table";
        signature = `CREATE TABLE ${name}`;
        exported = true;
      } else if ((match = trimmed.match(/^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([A-Za-z_][A-Za-z0-9_.]*)\s*\(([^)]*)\)/i))) {
        name = match[1]!;
        kind = "function";
        signature = `CREATE FUNCTION ${name}(${match[2]?.trim() ?? ""})`;
        exported = true;
      }
    } else if (language === "java" || language === "csharp") {
      if ((match = trimmed.match(/^(?:public|private|protected|internal)?\s*(?:static\s+)?(?:async\s+)?(?:class|interface|record)\s+([A-Za-z_][A-Za-z0-9_]*)/))) {
        name = match[1]!;
        kind = "class";
        signature = trimmed.replace(/\{.*$/, "").trim();
        exported = trimmed.startsWith("public");
      } else if ((match = trimmed.match(/^(?:public|private|protected|internal)\s+(?:static\s+)?(?:async\s+)?[A-Za-z0-9_<>\[\],\s]+\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/))) {
        name = match[1]!;
        const prevLine = idx > 0 ? lines[idx - 1]!.trim() : "";
        const isRoute = /@(?:Get|Post|Put|Delete)Mapping|\[Http(?:Get|Post|Put|Delete)/i.test(prevLine);
        kind = isRoute ? "route" : "function";
        signature = trimmed.replace(/\{.*$/, "").trim();
        exported = trimmed.startsWith("public");
      }
    }

    if (kind && name) {
      const lineStart = idx + 1;
      const lineEnd = Math.max(lineStart, findBlockEndLine(lines, idx, language));
      symbols.push({
        kind,
        name,
        signature,
        lineStart,
        lineEnd,
        exported,
        filePath: normalizedPath,
        citation: `${normalizedPath}#L${lineStart}-L${lineEnd}`,
      });

      const bodySlice = lines.slice(idx + 1, lineEnd).join("\n");
      const callMatches = bodySlice.matchAll(/\b([A-Za-z_][A-Za-z0-9_]{2,})\s*\(/g);
      const seenCalls = new Set<string>();
      for (const cm of callMatches) {
        const target = cm[1]!;
        if (target !== name && !seenCalls.has(target)) {
          seenCalls.add(target);
          references.push({
            fromSymbolName: name,
            targetName: target,
            relation: "calls",
          });
        }
      }
    }
  }

  return {
    path: normalizedPath,
    sha256: crypto.createHash("sha256").update(content, "utf8").digest("hex"),
    language,
    size: Buffer.byteLength(content, "utf8"),
    lineCount: lines.length,
    symbols,
    references,
  };
}
