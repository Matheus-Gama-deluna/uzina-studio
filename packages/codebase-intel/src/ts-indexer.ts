import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  CodebaseRelation,
  CodebaseSymbolKind,
} from "@uzina/contracts";
import ts from "typescript";

export interface ExtractedRawReference {
  fromSymbolName: string;
  targetName: string;
  relation: CodebaseRelation;
}

export interface IndexedSymbolDraft {
  kind: CodebaseSymbolKind;
  name: string;
  signature: string;
  lineStart: number;
  lineEnd: number;
  exported: boolean;
  filePath: string;
  citation: string;
}

export interface IndexedFileDraft {
  path: string;
  sha256: string;
  language: "typescript" | "tsx" | "javascript" | "jsx";
  size: number;
  lineCount: number;
  symbols: IndexedSymbolDraft[];
  references: ExtractedRawReference[];
}

export interface ResolvedEdgeDraft {
  fromFilePath: string;
  fromSymbolName: string;
  toFilePath: string;
  toSymbolName: string;
  relation: CodebaseRelation;
}

export interface WorkspaceScanResult {
  files: IndexedFileDraft[];
  edges: ResolvedEdgeDraft[];
}

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  ".worktrees",
  "coverage",
  ".turbo",
  ".uzina-data",
]);

const HTTP_ROUTE_EXPORTS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

function detectLanguage(
  relPath: string
): "typescript" | "tsx" | "javascript" | "jsx" | null {
  const lower = relPath.toLowerCase();
  if (lower.endsWith(".d.ts")) return null;
  if (lower.endsWith(".tsx")) return "tsx";
  if (lower.endsWith(".ts")) return "typescript";
  if (lower.endsWith(".jsx")) return "jsx";
  if (lower.endsWith(".js")) return "javascript";
  return null;
}

function getScriptKind(lang: IndexedFileDraft["language"]): ts.ScriptKind {
  switch (lang) {
    case "tsx":
      return ts.ScriptKind.TSX;
    case "jsx":
      return ts.ScriptKind.JSX;
    case "javascript":
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

function isRouteFile(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/");
  return /(^|\/)route\.(ts|tsx|js|jsx)$/i.test(normalized);
}

function hasExportModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  const modifiers = ts.getModifiers(node);
  return (
    modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
  );
}

function containsJsx(node: ts.Node): boolean {
  let found = false;
  function visit(n: ts.Node): void {
    if (found) return;
    if (
      ts.isJsxElement(n) ||
      ts.isJsxSelfClosingElement(n) ||
      ts.isJsxFragment(n)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  }
  visit(node);
  return found;
}

function isPascalCase(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(name);
}

function formatParams(
  params: ts.NodeArray<ts.ParameterDeclaration>,
  sf: ts.SourceFile
): string {
  return params
    .map((p) => {
      const name = p.name.getText(sf);
      const typeText = p.type ? `: ${p.type.getText(sf)}` : "";
      const q = p.questionToken ? "?" : "";
      return `${name}${q}${typeText}`;
    })
    .join(", ");
}

function buildCitation(relPath: string, lineStart: number, lineEnd: number): string {
  return `${relPath.replace(/\\/g, "/")}#L${lineStart}-L${lineEnd}`;
}

function collectBodyReferences(
  fromSymbolName: string,
  node: ts.Node,
  sf: ts.SourceFile,
  importedNames: Set<string>,
  refs: ExtractedRawReference[]
): void {
  const seen = new Set<string>();
  const addRef = (targetName: string, relation: CodebaseRelation) => {
    if (!targetName || targetName === fromSymbolName) return;
    const key = `${relation}:${targetName}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({ fromSymbolName, targetName, relation });
  };

  function visit(n: ts.Node): void {
    if (ts.isCallExpression(n)) {
      const expr = n.expression;
      // foo(...) or db.select().from(table) or Schema.parse(...)
      if (ts.isIdentifier(expr)) {
        addRef(expr.text, "calls");
      } else if (ts.isPropertyAccessExpression(expr)) {
        const method = expr.name.text;
        const objText = expr.expression.getText(sf);
        if (
          (method === "parse" || method === "safeParse") &&
          ts.isIdentifier(expr.expression)
        ) {
          addRef(expr.expression.text, "validates_with");
        } else if (
          (method === "from" ||
            method === "insert" ||
            method === "update" ||
            method === "delete") &&
          n.arguments.length > 0 &&
          ts.isIdentifier(n.arguments[0]!)
        ) {
          addRef(n.arguments[0].text, "queries_table");
        } else if (objText.endsWith("Schema")) {
          addRef(objText, "validates_with");
        } else {
          addRef(method, "calls");
        }
      }
    } else if (
      (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) &&
      ts.isIdentifier(n.tagName) &&
      isPascalCase(n.tagName.text)
    ) {
      addRef(n.tagName.text, "renders");
    } else if (ts.isIdentifier(n) && importedNames.has(n.text)) {
      addRef(n.text, "imports");
    }

    ts.forEachChild(n, visit);
  }

  visit(node);
}

export function indexSourceText(
  relativePath: string,
  content: string
): IndexedFileDraft {
  const normalizedPath = relativePath.replace(/\\/g, "/");
  const language = detectLanguage(normalizedPath) ?? "typescript";
  const sf = ts.createSourceFile(
    normalizedPath,
    content,
    ts.ScriptTarget.ES2022,
    true,
    getScriptKind(language)
  );

  const symbols: IndexedSymbolDraft[] = [];
  const references: ExtractedRawReference[] = [];
  const importedNames = new Set<string>();
  const routeFile = isRouteFile(normalizedPath);

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && stmt.importClause) {
      if (stmt.importClause.name) {
        importedNames.add(stmt.importClause.name.text);
      }
      const named = stmt.importClause.namedBindings;
      if (named && ts.isNamedImports(named)) {
        for (const el of named.elements) {
          importedNames.add(el.name.text);
        }
      }
    }
  }

  for (const stmt of sf.statements) {
    const startPos = sf.getLineAndCharacterOfPosition(stmt.getStart(sf));
    const endPos = sf.getLineAndCharacterOfPosition(stmt.getEnd());
    const lineStart = startPos.line + 1;
    const lineEnd = Math.max(lineStart, endPos.line + 1);
    const exported = hasExportModifier(stmt);

    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      const name = stmt.name.text;
      const isRoute = routeFile && exported && HTTP_ROUTE_EXPORTS.has(name);
      const isComp =
        !isRoute &&
        isPascalCase(name) &&
        (language === "tsx" || language === "jsx" || containsJsx(stmt));
      const kind: CodebaseSymbolKind = isRoute
        ? "route"
        : isComp
          ? "component"
          : "function";
      const retType = stmt.type ? `: ${stmt.type.getText(sf)}` : "";
      const asyncPrefix = stmt.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.AsyncKeyword
      )
        ? "async "
        : "";
      const sig = `${exported ? "export " : ""}${asyncPrefix}function ${name}(${formatParams(stmt.parameters, sf)})${retType}`;

      symbols.push({
        kind,
        name,
        signature: sig,
        lineStart,
        lineEnd,
        exported,
        filePath: normalizedPath,
        citation: buildCitation(normalizedPath, lineStart, lineEnd),
      });
      collectBodyReferences(name, stmt, sf, importedNames, references);
      continue;
    }

    if (ts.isClassDeclaration(stmt) && stmt.name) {
      const name = stmt.name.text;
      const methods = stmt.members
        .filter((m): m is ts.MethodDeclaration => ts.isMethodDeclaration(m))
        .map((m) => m.name.getText(sf))
        .slice(0, 6);
      const suffix = methods.length > 0 ? ` { ${methods.join("; ")} }` : "";
      const sig = `${exported ? "export " : ""}class ${name}${suffix}`;
      symbols.push({
        kind: "class",
        name,
        signature: sig,
        lineStart,
        lineEnd,
        exported,
        filePath: normalizedPath,
        citation: buildCitation(normalizedPath, lineStart, lineEnd),
      });
      collectBodyReferences(name, stmt, sf, importedNames, references);
      continue;
    }

    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        const name = decl.name.text;
        const initText = decl.initializer.getText(sf);

        let kind: CodebaseSymbolKind | null = null;
        let sig = "";

        if (/\bpgTable\s*\(/.test(initText)) {
          kind = "db_table";
          const tableMatch = initText.match(/pgTable\s*\(\s*["'`]([^"'`]+)["'`]/);
          const tableName = tableMatch?.[1] ?? name;
          sig = `${exported ? "export " : ""}const ${name} = pgTable("${tableName}")`;
        } else if (
          /\bz\.(object|enum|discriminatedUnion|array|union)\s*\(/.test(initText)
        ) {
          kind = "zod_schema";
          sig = `${exported ? "export " : ""}const ${name} = z.schema(...)`;
        } else if (
          ts.isArrowFunction(decl.initializer) ||
          ts.isFunctionExpression(decl.initializer)
        ) {
          const fn = decl.initializer;
          const isRoute = routeFile && exported && HTTP_ROUTE_EXPORTS.has(name);
          const isComp =
            !isRoute &&
            isPascalCase(name) &&
            (language === "tsx" || language === "jsx" || containsJsx(fn));
          kind = isRoute ? "route" : isComp ? "component" : "function";
          const retType = fn.type ? `: ${fn.type.getText(sf)}` : "";
          sig = `${exported ? "export " : ""}const ${name} = (${formatParams(fn.parameters, sf)})${retType} => ...`;
        }

        if (kind) {
          symbols.push({
            kind,
            name,
            signature: sig,
            lineStart,
            lineEnd,
            exported,
            filePath: normalizedPath,
            citation: buildCitation(normalizedPath, lineStart, lineEnd),
          });
          collectBodyReferences(
            name,
            decl.initializer,
            sf,
            importedNames,
            references
          );
        }
      }
    }
  }

  return {
    path: normalizedPath,
    sha256: crypto.createHash("sha256").update(content, "utf8").digest("hex"),
    language,
    size: Buffer.byteLength(content, "utf8"),
    lineCount: content.split(/\r?\n/).length,
    symbols,
    references,
  };
}

function walkSourceFiles(rootDir: string, currentDir: string, out: string[]): void {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const name = entry.name;
    if (name.startsWith(".env") || name === ".master-key") continue;
    const fullPath = path.join(currentDir, name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(name)) continue;
      walkSourceFiles(rootDir, fullPath, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const rel = path.relative(rootDir, fullPath).replace(/\\/g, "/");
    if (detectLanguage(rel)) {
      out.push(rel);
    }
  }
}

export function resolveWorkspaceEdges(
  files: IndexedFileDraft[]
): ResolvedEdgeDraft[] {
  const symbolByName = new Map<string, IndexedSymbolDraft[]>();
  for (const file of files) {
    for (const sym of file.symbols) {
      const list = symbolByName.get(sym.name) ?? [];
      list.push(sym);
      symbolByName.set(sym.name, list);
    }
  }

  const edges: ResolvedEdgeDraft[] = [];
  const dedup = new Set<string>();

  for (const file of files) {
    for (const ref of file.references) {
      const candidates = symbolByName.get(ref.targetName);
      if (!candidates || candidates.length === 0) continue;
      const target =
        candidates.find((c) => c.exported) ?? candidates[0]!;
      if (
        target.filePath === file.path &&
        target.name === ref.fromSymbolName
      ) {
        continue;
      }
      const key = `${file.path}:${ref.fromSymbolName}->${target.filePath}:${target.name}:${ref.relation}`;
      if (dedup.has(key)) continue;
      dedup.add(key);
      edges.push({
        fromFilePath: file.path,
        fromSymbolName: ref.fromSymbolName,
        toFilePath: target.filePath,
        toSymbolName: target.name,
        relation: ref.relation,
      });
    }
  }

  return edges;
}

export function scanCodebaseWorkspace(rootDir: string): WorkspaceScanResult {
  const resolvedRoot = path.resolve(rootDir);
  if (!fs.existsSync(resolvedRoot)) {
    return { files: [], edges: [] };
  }

  const relPaths: string[] = [];
  walkSourceFiles(resolvedRoot, resolvedRoot, relPaths);
  relPaths.sort();

  const files: IndexedFileDraft[] = [];
  for (const rel of relPaths) {
    const abs = path.join(resolvedRoot, rel);
    const stat = fs.statSync(abs);
    if (stat.size > 512 * 1024) continue;
    const content = fs.readFileSync(abs, "utf8");
    files.push(indexSourceText(rel, content));
  }

  const edges = resolveWorkspaceEdges(files);
  return { files, edges };
}
