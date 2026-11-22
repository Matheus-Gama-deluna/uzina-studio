import fs from "node:fs";
import path from "node:path";
import type {
  ChangeImpactResponse,
  CodebaseEdge,
  CodebaseSymbol,
  SymbolGraphQuery,
  SymbolGraphResponse,
  SymbolSliceRequest,
  SymbolSliceResponse,
} from "@uzina/contracts";
import { assertPathInsideWorkspace, redactSensitiveText } from "@uzina/core";
import { estimateTokens } from "./skeleton.js";
import {
  detectPolyglotLanguage,
  indexPolyglotSourceText,
} from "./polyglot-indexer.js";
import { indexSourceText } from "./ts-indexer.js";

const BLOCKED_FILENAMES = new Set([".master-key", ".env"]);

function assertAllowedCodebasePath(relativePath: string): void {
  const normalized = relativePath.replace(/\\/g, "/");
  const base = path.posix.basename(normalized).toLowerCase();
  if (
    BLOCKED_FILENAMES.has(base) ||
    base.startsWith(".env.") ||
    normalized.includes("/.env")
  ) {
    throw new Error(
      `Acesso negado ao arquivo sensível '${relativePath}' em readSymbolSlice.`
    );
  }
}

export function querySymbolGraphInMemory(
  symbols: CodebaseSymbol[],
  edges: CodebaseEdge[],
  query: SymbolGraphQuery
): SymbolGraphResponse {
  const needle = query.symbol.trim().toLowerCase();
  const byId = new Map(symbols.map((s) => [s.id, s]));

  const seedNodes = symbols.filter((s) =>
    s.name.toLowerCase().includes(needle)
  );
  const visitedIds = new Set<string>();
  const queue: Array<{ id: string; level: number }> = [];

  for (const seed of seedNodes) {
    if (visitedIds.size >= query.maxResults) break;
    visitedIds.add(seed.id);
    queue.push({ id: seed.id, level: 0 });
  }

  const collectedEdges: CodebaseEdge[] = [];
  const edgeSeen = new Set<string>();

  while (queue.length > 0 && visitedIds.size < query.maxResults) {
    const current = queue.shift()!;
    if (current.level >= query.depth) continue;

    for (const edge of edges) {
      if (query.relation && edge.relation !== query.relation) continue;

      let neighborId: string | null = null;
      if (edge.fromSymbolId === current.id) {
        neighborId = edge.toSymbolId;
      } else if (edge.toSymbolId === current.id) {
        neighborId = edge.fromSymbolId;
      }

      if (!neighborId || !byId.has(neighborId)) continue;
      if (!edgeSeen.has(edge.id)) {
        edgeSeen.add(edge.id);
        collectedEdges.push(edge);
      }
      if (!visitedIds.has(neighborId)) {
        visitedIds.add(neighborId);
        if (visitedIds.size >= query.maxResults) break;
        queue.push({ id: neighborId, level: current.level + 1 });
      }
    }
  }

  const nodes = Array.from(visitedIds)
    .map((id) => byId.get(id))
    .filter((s): s is CodebaseSymbol => Boolean(s))
    .slice(0, query.maxResults);

  const nodeIdSet = new Set(nodes.map((n) => n.id));
  const filteredEdges = collectedEdges.filter(
    (e) => nodeIdSet.has(e.fromSymbolId) && nodeIdSet.has(e.toSymbolId)
  );

  const summarySize = nodes
    .map((n) => `${n.signature} (${n.citation})`)
    .join("\n");

  return {
    query: query.symbol,
    nodes,
    edges: filteredEdges,
    tokensEstimated: estimateTokens(summarySize),
  };
}

export function computeChangeImpactInMemory(
  symbols: CodebaseSymbol[],
  edges: CodebaseEdge[],
  changedFiles: string[]
): ChangeImpactResponse {
  const normalizedChanged = new Set(
    changedFiles.map((f) => f.replace(/\\/g, "/").replace(/^\.\//, ""))
  );
  const byId = new Map(symbols.map((s) => [s.id, s]));

  const affectedIds = new Set<string>();
  const queue: string[] = [];

  for (const sym of symbols) {
    if (normalizedChanged.has(sym.filePath.replace(/\\/g, "/"))) {
      affectedIds.add(sym.id);
      queue.push(sym.id);
    }
  }

  // Propaga impacto para chamadores/dependentes (quem aponta para os símbolos alterados)
  let hops = 0;
  while (queue.length > 0 && hops < 200) {
    const targetId = queue.shift()!;
    hops += 1;
    for (const edge of edges) {
      if (edge.toSymbolId === targetId && !affectedIds.has(edge.fromSymbolId)) {
        affectedIds.add(edge.fromSymbolId);
        queue.push(edge.fromSymbolId);
      }
    }
  }

  const affectedSymbols = Array.from(affectedIds)
    .map((id) => byId.get(id))
    .filter((s): s is CodebaseSymbol => Boolean(s));
  const affectedRoutes = affectedSymbols.filter((s) => s.kind === "route");

  const summary = affectedSymbols
    .map((s) => `${s.name} (${s.citation})`)
    .join("\n");

  return {
    changedFiles: Array.from(normalizedChanged),
    affectedSymbols,
    affectedRoutes,
    tokensEstimated: estimateTokens(summary),
  };
}

export function readSymbolSliceFromWorkspace(
  rootDir: string,
  symbols: CodebaseSymbol[],
  request: SymbolSliceRequest
): SymbolSliceResponse {
  assertAllowedCodebasePath(request.path);
  const absPath = assertPathInsideWorkspace(rootDir, request.path);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Arquivo '${request.path}' não encontrado no workspace.`);
  }

  const rawContent = fs.readFileSync(absPath, "utf8");
  const lines = rawContent.split(/\r?\n/);
  const normalizedPath = request.path.replace(/\\/g, "/").replace(/^\.\//, "");

  let target = symbols.find(
    (s) =>
      s.filePath.replace(/\\/g, "/") === normalizedPath &&
      s.name === request.symbol
  );

  if (!target) {
    const parsed = detectPolyglotLanguage(normalizedPath)
      ? indexPolyglotSourceText(normalizedPath, rawContent)
      : indexSourceText(normalizedPath, rawContent);
    const draft = parsed.symbols.find((s) => s.name === request.symbol);
    if (draft) {
      target = {
        id: "00000000-0000-4000-8000-000000000000",
        fileId: "00000000-0000-4000-8000-000000000000",
        filePath: draft.filePath,
        kind: draft.kind,
        name: draft.name,
        signature: draft.signature,
        lineStart: draft.lineStart,
        lineEnd: draft.lineEnd,
        exported: draft.exported,
        citation: draft.citation,
      };
    }
  }

  if (!target) {
    throw new Error(
      `Símbolo '${request.symbol}' não encontrado em '${normalizedPath}'.`
    );
  }

  const sliceRaw = lines
    .slice(Math.max(0, target.lineStart - 1), target.lineEnd)
    .join("\n");
  const redacted = redactSensitiveText(sliceRaw);
  const slicedBytes =
    Buffer.byteLength(redacted, "utf8") > request.maxBytes
      ? redacted.slice(0, request.maxBytes) + "\n// ... [truncado por maxBytes]"
      : redacted;

  const tokensEstimated = estimateTokens(slicedBytes);
  const baselineFileTokens = Math.max(
    tokensEstimated,
    estimateTokens(rawContent)
  );
  const savingsPercent =
    baselineFileTokens > 0
      ? Number(
          Math.max(
            0,
            Math.min(
              100,
              ((baselineFileTokens - tokensEstimated) / baselineFileTokens) *
                100
            )
          ).toFixed(1)
        )
      : 0;

  return {
    path: normalizedPath,
    symbol: target.name,
    kind: target.kind,
    lineStart: target.lineStart,
    lineEnd: target.lineEnd,
    citation: target.citation,
    code: slicedBytes,
    tokensEstimated,
    baselineFileTokens,
    savingsPercent,
  };
}
