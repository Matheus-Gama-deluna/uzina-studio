import type {
  CodebaseDirectorySummary,
  CodebaseEdge,
  CodebaseSymbol,
  SkeletonResponse,
} from "@uzina/contracts";

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export function resolveSkeletonMaxTokens(override?: number): number {
  if (typeof override === "number" && Number.isFinite(override) && override > 0) {
    return Math.floor(override);
  }
  const fromEnv = Number(process.env.UZINA_SKELETON_MAX_TOKENS);
  if (Number.isFinite(fromEnv) && fromEnv >= 100) {
    return Math.floor(fromEnv);
  }
  return 2000;
}

export function buildCodebaseDirectoryTree(
  filePaths: string[],
  symbols: Pick<CodebaseSymbol, "filePath" | "kind" | "name">[]
): CodebaseDirectorySummary[] {
  const byDir = new Map<
    string,
    { files: Set<string>; kinds: Set<string>; topNames: string[] }
  >();

  for (const filePath of filePaths) {
    const normalized = filePath.replace(/\\/g, "/");
    const parts = normalized.split("/");
    const dir =
      parts.length > 2
        ? parts.slice(0, 2).join("/")
        : parts.length > 1
          ? parts[0]!
          : ".";
    const bucket = byDir.get(dir) ?? {
      files: new Set<string>(),
      kinds: new Set<string>(),
      topNames: [],
    };
    bucket.files.add(normalized);
    byDir.set(dir, bucket);
  }

  for (const sym of symbols) {
    const normalized = sym.filePath.replace(/\\/g, "/");
    const parts = normalized.split("/");
    const dir =
      parts.length > 2
        ? parts.slice(0, 2).join("/")
        : parts.length > 1
          ? parts[0]!
          : ".";
    const bucket = byDir.get(dir);
    if (!bucket) continue;
    bucket.kinds.add(sym.kind);
    if (bucket.topNames.length < 4 && !bucket.topNames.includes(sym.name)) {
      bucket.topNames.push(sym.name);
    }
  }

  return Array.from(byDir.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([directory, info]) => {
      const kindsLabel =
        info.kinds.size > 0
          ? Array.from(info.kinds).sort().join(", ")
          : "módulos";
      const sampleLabel =
        info.topNames.length > 0 ? ` — ${info.topNames.join(", ")}` : "";
      return {
        directory,
        fileCount: info.files.size,
        summary: `${info.files.size} arquivo(s) (${kindsLabel})${sampleLabel}`,
      };
    });
}

export function buildCodebaseSkeleton(params: {
  repositoryId?: string | null;
  files: Array<{ path: string; size: number }>;
  symbols: CodebaseSymbol[];
  edges: CodebaseEdge[];
  maxTokens?: number;
}): SkeletonResponse {
  const maxTokensBudget = resolveSkeletonMaxTokens(params.maxTokens);
  const degreeBySymbolId = new Map<string, number>();

  for (const edge of params.edges) {
    degreeBySymbolId.set(
      edge.fromSymbolId,
      (degreeBySymbolId.get(edge.fromSymbolId) ?? 0) + 1
    );
    degreeBySymbolId.set(
      edge.toSymbolId,
      (degreeBySymbolId.get(edge.toSymbolId) ?? 0) + 1
    );
  }

  const rankedSymbols = [...params.symbols].sort((a, b) => {
    const scoreA =
      (a.exported ? 100 : 0) + (degreeBySymbolId.get(a.id) ?? 0) * 10;
    const scoreB =
      (b.exported ? 100 : 0) + (degreeBySymbolId.get(b.id) ?? 0) * 10;
    if (scoreB !== scoreA) return scoreB - scoreA;
    if (a.filePath !== b.filePath) return a.filePath.localeCompare(b.filePath);
    return a.lineStart - b.lineStart;
  });

  const maxChars = maxTokensBudget * 4;
  const linesByFile = new Map<string, string[]>();
  let usedChars = 0;
  let entriesCount = 0;

  for (const sym of rankedSymbols) {
    const line = `  [${sym.kind}] ${sym.signature} (${sym.citation})`;
    const headerCost = linesByFile.has(sym.filePath)
      ? 0
      : sym.filePath.length + 4;
    if (usedChars + headerCost + line.length + 1 > maxChars && entriesCount > 0) {
      break;
    }
    const list = linesByFile.get(sym.filePath) ?? [];
    if (list.length === 0) {
      usedChars += sym.filePath.length + 4;
    }
    list.push(line);
    linesByFile.set(sym.filePath, list);
    usedChars += line.length + 1;
    entriesCount += 1;
  }

  const sections: string[] = [];
  for (const [filePath, sigLines] of Array.from(linesByFile.entries()).sort(
    ([a], [b]) => a.localeCompare(b)
  )) {
    sections.push(`# ${filePath}\n${sigLines.join("\n")}`);
  }

  const skeletonText = sections.join("\n\n");
  const tokensEstimated = estimateTokens(skeletonText);
  const totalBytes = params.files.reduce((acc, f) => acc + f.size, 0);
  const baselineTokens = Math.max(
    tokensEstimated,
    Math.ceil(totalBytes / 4)
  );
  const savingsPercent =
    baselineTokens > 0
      ? Number(
          Math.max(
            0,
            Math.min(
              100,
              ((baselineTokens - tokensEstimated) / baselineTokens) * 100
            )
          ).toFixed(1)
        )
      : 0;

  return {
    repositoryId: params.repositoryId ?? null,
    entriesCount,
    skeletonText,
    tokensEstimated,
    baselineTokens,
    savingsPercent,
    maxTokensBudget,
  };
}
