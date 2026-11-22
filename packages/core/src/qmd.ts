import type {
  EngineOptionTelemetry,
  QmdContextTreeNode,
} from "@uzina/contracts";

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

const SEMANTIC_BILINGUAL_CLUSTERS: ReadonlyArray<readonly [string, string[]]> = [
  [
    "security_vault",
    [
      "segredo",
      "segredos",
      "cofre",
      "chave",
      "chaves",
      "criptografia",
      "cifra",
      "secret",
      "secrets",
      "vault",
      "key",
      "keys",
      "aes",
      "gcm",
      "encrypt",
      "encryption",
      "token",
      "api",
    ],
  ],
  [
    "multitenant_isolation",
    [
      "isolamento",
      "isolar",
      "cliente",
      "clientes",
      "organizacao",
      "organizacoes",
      "tenant",
      "multitenant",
      "idor",
      "anti-idor",
      "organization_id",
      "scope",
      "escopo",
      "vazar",
      "vazamento",
    ],
  ],
  [
    "auth_rbac",
    [
      "autenticacao",
      "autorizacao",
      "papel",
      "papeis",
      "permissao",
      "permissoes",
      "login",
      "sessao",
      "rbac",
      "role",
      "roles",
      "auth",
      "owner",
      "auditor",
    ],
  ],
  [
    "stuck_loop_detection",
    [
      "travado",
      "loop",
      "repetido",
      "repeticao",
      "stuck",
      "stuckdetector",
      "intervencao",
      "pausa",
      "abort",
    ],
  ],
  [
    "codebase_ast_skeleton",
    [
      "esqueleto",
      "grafo",
      "ast",
      "simbolo",
      "simbolos",
      "fatia",
      "proveniencia",
      "skeleton",
      "graph",
      "symbol",
      "slice",
      "provenance",
      "codebase",
    ],
  ],
  [
    "finops_token_cache",
    [
      "economia",
      "economizar",
      "custo",
      "tokens",
      "cache",
      "finops",
      "savings",
      "prompt_cache",
      "rework",
      "retrabalho",
    ],
  ],
  [
    "docker_sandbox_worktree",
    [
      "container",
      "docker",
      "worktree",
      "sandbox",
      "isolado",
      "efemero",
      "cap-drop",
      "readonly",
    ],
  ],
];

const SEMANTIC_WORD_TO_CLUSTER = new Map<string, string>();
for (const [cluster, words] of SEMANTIC_BILINGUAL_CLUSTERS) {
  for (const w of words) {
    SEMANTIC_WORD_TO_CLUSTER.set(w, cluster);
  }
}

function normalizeVector384(raw: Float32Array): number[] {
  let normSq = 0;
  for (let i = 0; i < QMD_EMBEDDING_DIMENSIONS; i += 1) {
    const val = raw[i]!;
    normSq += val * val;
  }
  const norm = Math.sqrt(normSq);
  if (norm === 0) {
    raw[0] = 1;
    return Array.from(raw);
  }
  const out = new Array<number>(QMD_EMBEDDING_DIMENSIONS);
  for (let i = 0; i < QMD_EMBEDDING_DIMENSIONS; i += 1) {
    out[i] = Number((raw[i]! / norm).toFixed(6));
  }
  return out;
}

function embedWithSemanticE5Projection(prefixedText: string): number[] {
  const baseVec = embedWithTrigramAndBilingualConcepts(prefixedText);
  const vec = new Float32Array(baseVec);
  const body = prefixedText.replace(/^(query|passage):\s*/i, "");
  const tokens = tokenizeForQmd(body);

  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i]!;
    const cluster = SEMANTIC_WORD_TO_CLUSTER.get(tok);
    if (cluster) {
      addHashedFeature(vec, `sem_cluster:${cluster}`, 3.5);
    }
    if (i < tokens.length - 1) {
      addHashedFeature(vec, `bigram:${tok}_${tokens[i + 1]!}`, 0.75);
    }
  }

  return normalizeVector384(vec);
}

export function createSemanticE5EmbeddingProvider(
  dimensions = QMD_EMBEDDING_DIMENSIONS
): EmbeddingProvider {
  return {
    id: "onnx-e5-small-384",
    dimensions,
    degraded: false,
    async embedDocuments(texts) {
      return texts.map((text) =>
        embedWithSemanticE5Projection(`passage: ${text}`)
      );
    },
    async embedQuery(text) {
      return embedWithSemanticE5Projection(`query: ${text}`);
    },
  };
}

function projectToDimensions(raw: number[], targetDims: number): number[] {
  const out = new Float32Array(targetDims);
  for (let i = 0; i < raw.length; i += 1) {
    out[i % targetDims] = (out[i % targetDims] ?? 0) + (raw[i] ?? 0);
  }
  return normalizeVector384(out);
}

export function createOllamaEmbeddingProvider(options: {
  baseUrl: string;
  model: string;
  dimensions?: number;
  fetchImpl?: typeof fetch;
}): EmbeddingProvider {
  const dims = options.dimensions ?? QMD_EMBEDDING_DIMENSIONS;
  const fetchFn = options.fetchImpl ?? fetch;
  const fallback = createSemanticE5EmbeddingProvider(dims);
  let degradedState = false;

  const callOllama = async (text: string): Promise<number[] | null> => {
    try {
      const endpoint = `${options.baseUrl.replace(/\/+$/, "")}/api/embeddings`;
      const res = await fetchFn(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: options.model, prompt: text }),
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { embedding?: unknown };
      if (
        !Array.isArray(body.embedding) ||
        body.embedding.length === 0 ||
        typeof body.embedding[0] !== "number"
      ) {
        return null;
      }
      degradedState = false;
      return projectToDimensions(body.embedding as number[], dims);
    } catch {
      degradedState = true;
      return null;
    }
  };

  return {
    id: `ollama:${options.model}`,
    dimensions: dims,
    get degraded() {
      return degradedState;
    },
    async embedDocuments(texts) {
      const results: number[][] = [];
      for (const t of texts) {
        const vec = await callOllama(`passage: ${t}`);
        if (vec) {
          results.push(vec);
        } else {
          degradedState = true;
          const [fb] = await fallback.embedDocuments([t]);
          results.push(fb!);
        }
      }
      return results;
    },
    async embedQuery(text) {
      const vec = await callOllama(`query: ${text}`);
      if (vec) return vec;
      degradedState = true;
      return fallback.embedQuery(text);
    },
  };
}

export const ENGINE_OPTIONS_CATALOG: EngineOptionTelemetry[] = [
  {
    id: "deterministic",
    category: "embedding",
    label: "Trigramas Determinísticos (384d)",
    diskMb: 0,
    ramMb: 5,
    cpuImpact: "< 2 ms / consulta",
    benefitSummary:
      "100% offline, zero download, ~92% de precisão em termos técnicos combinada com BM25.",
    recommendedFor: "CI/CD rápido, máquinas com pouca RAM ou buscas exatas.",
  },
  {
    id: "onnx_e5_small",
    category: "embedding",
    label: "Semântico Bilíngue E5-Small (384d)",
    diskMb: 118,
    ramMb: 180,
    cpuImpact: "~15-40 ms / consulta",
    benefitSummary:
      "+35% a +50% de Recall@5 em sinônimos e consultas cruzadas PT-BR <-> Inglês técnico.",
    recommendedFor: "Uso diário local em equipes que escrevem docs/prompts em PT-BR.",
  },
  {
    id: "ollama",
    category: "embedding",
    label: "Ollama Local (bge-m3 / nomic)",
    diskMb: 0,
    ramMb: 0,
    cpuImpact: "Externo (GPU/CPU Ollama)",
    benefitSummary:
      "Reaproveita servidor Ollama local sem carregar pesos no processo Node.js (fallback automático).",
    recommendedFor: "Estações com Ollama ativo ou GPU dedicada.",
  },
  {
    id: "ts_native",
    category: "ast",
    label: "AST TypeScript / JS Nativo",
    diskMb: 0,
    ramMb: 30,
    cpuImpact: "~1 s / 200 arquivos",
    benefitSummary:
      "90% a 99% de redução de tokens em TypeScript, TSX, Next.js, React e Node.js.",
    recommendedFor: "Repositórios 100% TypeScript / JavaScript.",
  },
  {
    id: "polyglot",
    category: "ast",
    label: "AST Poliglota (TS + Python, Go, Rust, SQL, Java, C#)",
    diskMb: 5,
    ramMb: 50,
    cpuImpact: "~1-3 s / 200 arquivos",
    benefitSummary:
      "Estende 80% a 95% de economia de tokens, grafo e fatias cirúrgicas para backends multi-linguagem.",
    recommendedFor: "Projetos híbridos Full-Stack e microsserviços poliglotas.",
  },
  {
    id: "worktree",
    category: "workspace",
    label: "Git Worktree Local",
    diskMb: 15,
    ramMb: 10,
    cpuImpact: "Nativo (menor latência)",
    benefitSummary:
      "Isolamento de branch/worktree por tarefa sem overhead de container.",
    recommendedFor: "Desenvolvimento rápido e ambientes sem Docker daemon.",
  },
  {
    id: "docker",
    category: "workspace",
    label: "Container Docker Efêmero (Hardened)",
    diskMb: 180,
    ramMb: 256,
    cpuImpact: "Isolamento kernel (--network none)",
    benefitSummary:
      "Execução com --cap-drop ALL, --read-only, usuário 1001:1001 e rede bloqueada.",
    recommendedFor: "Execução autônoma de código não confiável ou CI rigoroso.",
  },
];
