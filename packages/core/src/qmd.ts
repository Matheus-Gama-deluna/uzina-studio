import type { QmdContextTreeNode } from "@uzina/contracts";

export const QMD_EMBEDDING_DIMENSIONS = 384;
export const QMD_SNIPPET_MAX_CHARS = 700;
export const QMD_DEFAULT_CHUNK_MAX_CHARS = 1600;
export const QMD_DEFAULT_RRF_K = 60;

export interface MarkdownChunk {
  headingPath: string;
  lineStart: number;
  lineEnd: number;
  content: string;
}

export interface ChunkMarkdownOptions {
  maxChunkChars?: number;
  defaultHeading?: string;
}

export interface Bm25Document {
  id: string;
  text: string;
}

export interface Bm25Options {
  k1?: number;
  b?: number;
}

export interface RankedCandidate {
  id: string;
  score: number;
}

export interface RrfResult {
  id: string;
  rrf: number;
}

export interface EmbeddingProvider {
  readonly id: string;
  readonly dimensions: number;
  readonly degraded: boolean;
  embedDocuments(texts: readonly string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

const BILINGUAL_TECH_CONCEPTS: ReadonlyArray<readonly string[]> = [
  ["seguranca", "security", "appsec", "vulnerabilidade", "vulnerability", "sast", "sarif"],
  ["permissao", "permissoes", "rbac", "role", "roles", "acesso", "access", "autorizacao"],
  ["cofre", "vault", "criptografia", "criptografico", "encryption", "aes", "gcm", "chave", "key"],
  ["isolamento", "isolation", "tenant", "inquilino", "cliente", "client", "clientes"],
  ["banco", "database", "postgres", "postgresql", "pglite", "drizzle", "migracao", "migration"],
  ["memoria", "memorias", "memory", "memories", "contexto", "context", "qmd", "embedding", "vetor", "vector"],
  ["entrega", "deliverable", "entregas", "workflow", "aprovacao", "approval", "decisao", "decision"],
  ["teste", "testes", "test", "tests", "tdd", "vitest", "playwright", "e2e"],
  ["codigo", "code", "codebase", "ast", "simbolo", "symbol", "grafo", "graph"],
  ["prototipo", "prototype", "visual", "design", "stitch", "tokens", "oklch"],
];

const CONCEPT_CANONICAL_MAP: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  BILINGUAL_TECH_CONCEPTS.forEach((group, idx) => {
    const canonical = `__concept_${idx}`;
    for (const term of group) {
      map.set(term, canonical);
    }
  });
  return map;
})();

function stripAccents(input: string): string {
  return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function splitChunkByMaxChars(
  headingPath: string,
  startLine: number,
  lines: readonly string[],
  maxChunkChars: number
): MarkdownChunk[] {
  const fullText = lines.join("\n").trim();
  if (!fullText) {
    return [];
  }
  if (fullText.length <= maxChunkChars) {
    return [
      {
        headingPath,
        lineStart: startLine,
        lineEnd: startLine + lines.length - 1,
        content: fullText,
      },
    ];
  }

  const chunks: MarkdownChunk[] = [];
  let buffer: string[] = [];
  let bufferLen = 0;
  let chunkStartLine = startLine;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const addedLen = line.length + (buffer.length > 0 ? 1 : 0);

    if (buffer.length > 0 && bufferLen + addedLen > maxChunkChars) {
      const content = buffer.join("\n").trim();
      if (content) {
        chunks.push({
          headingPath,
          lineStart: chunkStartLine,
          lineEnd: startLine + i - 1,
          content,
        });
      }
      buffer = [line];
      bufferLen = line.length;
      chunkStartLine = startLine + i;
    } else {
      buffer.push(line);
      bufferLen += addedLen;
    }
  }

  const tail = buffer.join("\n").trim();
  if (tail) {
    chunks.push({
      headingPath,
      lineStart: chunkStartLine,
      lineEnd: startLine + lines.length - 1,
      content: tail,
    });
  }

  return chunks;
}

export function chunkMarkdownByHeadings(
  markdown: string,
  options: ChunkMarkdownOptions = {}
): MarkdownChunk[] {
  const maxChunkChars = options.maxChunkChars ?? QMD_DEFAULT_CHUNK_MAX_CHARS;
  const defaultHeading = options.defaultHeading ?? "Geral";
  const normalized = markdown.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  const headingStack: Array<{ level: number; text: string }> = [];
  let activeHeading = defaultHeading;
  let sectionLines: string[] = [];
  let sectionStartLine = 1;
  let inFence = false;
  let fenceChar = "";

  const out: MarkdownChunk[] = [];

  const flushSection = (endLine: number) => {
    if (sectionLines.length === 0) return;
    const split = splitChunkByMaxChars(
      activeHeading,
      sectionStartLine,
      sectionLines,
      maxChunkChars
    );
    out.push(...split);
    sectionLines = [];
    sectionStartLine = endLine + 1;
  };

  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx]!;
    const lineNumber = idx + 1;
    const trimmed = line.trim();

    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      const marker = trimmed.slice(0, 3);
      if (!inFence) {
        inFence = true;
        fenceChar = marker;
      } else if (fenceChar === marker) {
        inFence = false;
        fenceChar = "";
      }
      sectionLines.push(line);
      continue;
    }

    if (!inFence) {
      const match = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
      if (match) {
        flushSection(lineNumber - 1);
        const level = match[1]!.length;
        const headingText = match[2]!.trim();

        while (
          headingStack.length > 0 &&
          headingStack[headingStack.length - 1]!.level >= level
        ) {
          headingStack.pop();
        }
        headingStack.push({ level, text: headingText });
        activeHeading = headingStack.map((h) => h.text).join(" > ");
        sectionStartLine = lineNumber;
        sectionLines = [line];
        continue;
      }
    }

    sectionLines.push(line);
  }

  flushSection(lines.length);
  return out;
}

export function tokenizeForQmd(text: string): string[] {
  const clean = stripAccents(text);
  const rawMatches = clean.match(/[A-Za-z0-9_]+/g) ?? [];
  const tokens: string[] = [];

  for (const raw of rawMatches) {
    const lowerFull = raw.toLowerCase();
    if (lowerFull.length >= 2) {
      tokens.push(lowerFull);
    }

    const camelSplit = raw.replace(/([a-z0-9])([A-Z])/g, "$1_$2");
    const subParts = camelSplit.split("_");
    if (subParts.length > 1) {
      for (const part of subParts) {
        const lowerPart = part.toLowerCase();
        if (lowerPart.length >= 2 && lowerPart !== lowerFull) {
          tokens.push(lowerPart);
        }
      }
    }
  }

  return tokens;
}

export function computeBm25Scores(
  query: string,
  documents: readonly Bm25Document[],
  options: Bm25Options = {}
): Map<string, number> {
  const k1 = options.k1 ?? 1.5;
  const b = options.b ?? 0.75;
  const scores = new Map<string, number>();

  if (documents.length === 0) {
    return scores;
  }

  const queryTerms = Array.from(new Set(tokenizeForQmd(query)));
  if (queryTerms.length === 0) {
    for (const doc of documents) {
      scores.set(doc.id, 0);
    }
    return scores;
  }

  const docTokenCounts = new Map<string, Map<string, number>>();
  const docLengths = new Map<string, number>();
  const docFreq = new Map<string, number>();
  let totalLen = 0;

  for (const doc of documents) {
    const tokens = tokenizeForQmd(doc.text);
    totalLen += tokens.length;
    docLengths.set(doc.id, tokens.length);

    const tf = new Map<string, number>();
    for (const tok of tokens) {
      tf.set(tok, (tf.get(tok) ?? 0) + 1);
    }
    docTokenCounts.set(doc.id, tf);

    for (const term of queryTerms) {
      if (tf.has(term)) {
        docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
      }
    }
  }

  const avgDl = totalLen / documents.length || 1;
  const nDocs = documents.length;

  for (const doc of documents) {
    const tfMap = docTokenCounts.get(doc.id)!;
    const dl = docLengths.get(doc.id) ?? 0;
    let sum = 0;

    for (const term of queryTerms) {
      const tf = tfMap.get(term) ?? 0;
      if (tf === 0) continue;
      const df = docFreq.get(term) ?? 0;
      const idf = Math.log(1 + (nDocs - df + 0.5) / (df + 0.5));
      const denom = tf + k1 * (1 - b + b * (dl / avgDl));
      sum += idf * ((tf * (k1 + 1)) / denom);
    }

    scores.set(doc.id, Number(sum.toFixed(6)));
  }

  return scores;
}

export function cosineSimilarity(
  a: ReadonlyArray<number> | Float32Array,
  b: ReadonlyArray<number> | Float32Array
): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < len; i += 1) {
    const va = a[i]!;
    const vb = b[i]!;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

export function reciprocalRankFusion(
  lists: readonly (readonly RankedCandidate[])[],
  k = QMD_DEFAULT_RRF_K
): RrfResult[] {
  const rrfMap = new Map<string, number>();

  for (const list of lists) {
    const sorted = [...list]
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

    for (let idx = 0; idx < sorted.length; idx += 1) {
      const item = sorted[idx]!;
      const rank = idx + 1;
      const contrib = 1 / (k + rank);
      rrfMap.set(item.id, (rrfMap.get(item.id) ?? 0) + contrib);
    }
  }

  return Array.from(rrfMap.entries())
    .map(([id, rrf]) => ({ id, rrf: Number(rrf.toFixed(6)) }))
    .sort((a, b) => b.rrf - a.rrf || a.id.localeCompare(b.id));
}

export function formatQmdSnippet(
  content: string,
  maxChars = QMD_SNIPPET_MAX_CHARS
): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

export function buildDirectoryContextTree(
  items: readonly {
    sourcePath: string | null;
    scopeType: string;
    headingPath: string;
  }[]
): QmdContextTreeNode[] {
  const grouped = new Map<string, { headings: Set<string>; count: number }>();

  for (const item of items) {
    const dir = item.sourcePath
      ? item.sourcePath.split("/").slice(0, -1).join("/") || "."
      : `memories/${item.scopeType}`;

    let bucket = grouped.get(dir);
    if (!bucket) {
      bucket = { headings: new Set<string>(), count: 0 };
      grouped.set(dir, bucket);
    }
    bucket.count += 1;
    if (bucket.headings.size < 4) {
      bucket.headings.add(item.headingPath);
    }
  }

  return Array.from(grouped.entries())
    .map(([directory, data]) => ({
      directory,
      summary: Array.from(data.headings).join(" · ") || directory,
      chunkCount: data.count,
    }))
    .sort((a, b) => b.chunkCount - a.chunkCount || a.directory.localeCompare(b.directory));
}

function fnv1aHash(str: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function addHashedFeature(
  vec: Float32Array,
  feature: string,
  weight: number
): void {
  const idx = fnv1aHash(feature, 2166136261) % QMD_EMBEDDING_DIMENSIONS;
  const sign = (fnv1aHash(feature, 374761393) & 1) === 0 ? 1 : -1;
  vec[idx] = (vec[idx] ?? 0) + sign * weight;
}

function embedWithTrigramAndBilingualConcepts(prefixedText: string): number[] {
  const body = prefixedText.replace(/^(query|passage):\s*/i, "");
  const tokens = tokenizeForQmd(body);
  const vec = new Float32Array(QMD_EMBEDDING_DIMENSIONS);

  for (const token of tokens) {
    addHashedFeature(vec, `tok:${token}`, 1.0);

    const concept = CONCEPT_CANONICAL_MAP.get(token);
    if (concept) {
      addHashedFeature(vec, `concept:${concept}`, 2.5);
    }

    if (token.length >= 3) {
      for (let i = 0; i <= token.length - 3; i += 1) {
        addHashedFeature(vec, `tri:${token.slice(i, i + 3)}`, 0.35);
      }
    }
  }

  let normSq = 0;
  for (let i = 0; i < QMD_EMBEDDING_DIMENSIONS; i += 1) {
    const val = vec[i]!;
    normSq += val * val;
  }
  const norm = Math.sqrt(normSq);
  if (norm === 0) {
    vec[0] = 1;
    return Array.from(vec);
  }

  const normalized = new Array<number>(QMD_EMBEDDING_DIMENSIONS);
  for (let i = 0; i < QMD_EMBEDDING_DIMENSIONS; i += 1) {
    normalized[i] = Number((vec[i]! / norm).toFixed(6));
  }
  return normalized;
}

export function createDeterministicEmbeddingProvider(): EmbeddingProvider {
  return {
    id: "deterministic-trigram-384",
    dimensions: QMD_EMBEDDING_DIMENSIONS,
    degraded: true,
    async embedDocuments(texts) {
      return texts.map((text) =>
        embedWithTrigramAndBilingualConcepts(`passage: ${text}`)
      );
    },
    async embedQuery(text) {
      return embedWithTrigramAndBilingualConcepts(`query: ${text}`);
    },
  };
}
