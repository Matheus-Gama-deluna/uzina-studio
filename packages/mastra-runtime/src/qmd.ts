import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  QmdReindexRequestSchema,
  QmdSearchRequestSchema,
  QmdSearchResponseSchema,
  type Memory,
  type QmdReindexRequest,
  type QmdReindexResponse,
  type QmdSearchRequest,
  type QmdSearchResponse,
} from "@uzina/contracts";
import {
  assertPathInsideWorkspace,
  buildDirectoryContextTree,
  chunkMarkdownByHeadings,
  computeBm25Scores,
  cosineSimilarity,
  createDeterministicEmbeddingProvider,
  formatQmdSnippet,
  reciprocalRankFusion,
  redactSensitiveText,
  type EmbeddingProvider,
} from "@uzina/core";
import {
  clients,
  memories,
  memoryChunks,
  projectRepositories,
  projects,
  type UzinaDb,
} from "@uzina/db";
import { and, eq, inArray, or, type SQL } from "drizzle-orm";
import { WorkflowRuntimeError } from "./errors.js";
import {
  recordTokenSavingsEventScoped,
  resolveOrganizationEmbeddingProvider,
} from "./finops.js";

const MAX_MARKDOWN_BYTES = 512 * 1024;
const IGNORED_DIRS = new Set(["node_modules", ".git", ".next", "dist", ".turbo"]);

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function resolveDefaultEmbeddingProvider(): EmbeddingProvider {
  return createDeterministicEmbeddingProvider();
}

export async function indexMemoryChunks(
  db: UzinaDb,
  memory: Memory,
  provider: EmbeddingProvider = resolveDefaultEmbeddingProvider()
): Promise<number> {
  const cleanTitle = redactSensitiveText(memory.title);
  const cleanContent = redactSensitiveText(memory.content);
  const fullMarkdown = `# ${cleanTitle}\n${cleanContent}`;
  const chunks = chunkMarkdownByHeadings(fullMarkdown, {
    defaultHeading: cleanTitle,
  });

  await db.delete(memoryChunks).where(eq(memoryChunks.memoryId, memory.id));

  if (chunks.length === 0) {
    return 0;
  }

  const embeddings = await provider.embedDocuments(chunks.map((c) => c.content));

  await db.insert(memoryChunks).values(
    chunks.map((chunk, idx) => ({
      organizationId: memory.organizationId,
      sourceType: "memory" as const,
      memoryId: memory.id,
      sourcePath: null,
      scopeType: memory.scopeType,
      scopeId: memory.scopeId,
      headingPath: chunk.headingPath,
      lineStart: chunk.lineStart,
      lineEnd: chunk.lineEnd,
      content: chunk.content,
      contentHash: sha256Hex(chunk.content),
      embedding: embeddings[idx]!,
      embeddingModel: provider.id,
    }))
  );

  return chunks.length;
}

function collectMarkdownFiles(
  rootDir: string,
  subDirs: readonly string[]
): Array<{ relativePath: string; absolutePath: string }> {
  const results: Array<{ relativePath: string; absolutePath: string }> = [];
  const seenRel = new Set<string>();
  const rawResolved = path.resolve(rootDir);
  const resolvedRoot = fs.existsSync(/*turbopackIgnore: true*/ rawResolved)
    ? assertPathInsideWorkspace(rawResolved, rawResolved, { allowRoot: true })
    : rawResolved;

  const walk = (dirPath: string) => {
    if (!fs.existsSync(/*turbopackIgnore: true*/ dirPath)) return;
    const entries = fs.readdirSync(/*turbopackIgnore: true*/ dirPath, {
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (
        IGNORED_DIRS.has(entry.name) ||
        entry.name.startsWith(".env") ||
        entry.name === ".master-key"
      ) {
        continue;
      }
      const abs = path.join(dirPath, entry.name);
      let safeAbs: string;
      try {
        safeAbs = assertPathInsideWorkspace(resolvedRoot, abs);
      } catch (err) {
        if (err instanceof Error && err.name === "WorkspaceBoundaryError") {
          continue;
        }
        throw err;
      }
      if (entry.isDirectory()) {
        walk(safeAbs);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        const stat = fs.statSync(/*turbopackIgnore: true*/ safeAbs);
        if (stat.size <= MAX_MARKDOWN_BYTES) {
          const relativePath = path
            .relative(resolvedRoot, safeAbs)
            .replace(/\\/g, "/");
          if (!seenRel.has(relativePath)) {
            seenRel.add(relativePath);
            results.push({
              relativePath,
              absolutePath: safeAbs,
            });
          }
        }
      }
    }
  };

  for (const sub of subDirs) {
    if (sub === ".") {
      if (fs.existsSync(/*turbopackIgnore: true*/ resolvedRoot)) {
        walk(resolvedRoot);
      }
      continue;
    }
    const candidate = path.join(resolvedRoot, sub);
    if (fs.existsSync(/*turbopackIgnore: true*/ candidate)) {
      walk(assertPathInsideWorkspace(resolvedRoot, candidate));
    }
  }

  return results;
}

interface ScopedMarkdownTarget {
  relativePath: string;
  absolutePath: string;
  scopeType: "org" | "project";
  scopeId: string;
}

export async function reindexWorkspaceQmd(
  db: UzinaDb,
  params: {
    organizationId: string;
    rootDir?: string;
    allowDirectRootDocs?: boolean;
    request?: QmdReindexRequest;
    provider?: EmbeddingProvider;
  }
): Promise<QmdReindexResponse> {
  const parsed = QmdReindexRequestSchema.parse(params.request ?? {});
  const provider = params.provider ?? resolveDefaultEmbeddingProvider();

  if (parsed.projectId) {
    const [scopedProject] = await db
      .select({ id: projects.id })
      .from(projects)
      .innerJoin(clients, eq(projects.clientId, clients.id))
      .where(
        and(
          eq(projects.id, parsed.projectId),
          eq(clients.organizationId, params.organizationId)
        )
      )
      .limit(1);

    if (!scopedProject) {
      throw new WorkflowRuntimeError({
        statusCode: 404,
        code: "FORBIDDEN_PROJECT_SCOPE",
        message: `Projeto '${parsed.projectId}' não encontrado na organização.`,
      });
    }
  }

  const orgMemories = await db
    .select()
    .from(memories)
    .where(eq(memories.organizationId, params.organizationId));

  let indexedMemories = 0;
  let totalChunks = 0;

  for (const row of orgMemories) {
    if (!parsed.force) {
      const existing = await db
        .select({ embeddingModel: memoryChunks.embeddingModel })
        .from(memoryChunks)
        .where(eq(memoryChunks.memoryId, row.id));
      if (
        existing.length > 0 &&
        existing.every((c) => c.embeddingModel === provider.id)
      ) {
        totalChunks += existing.length;
        continue;
      }
    }

    const mapped: Memory = {
      id: row.id,
      organizationId: row.organizationId,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      category: row.category,
      title: row.title,
      content: row.content,
      sourceDeliverableId: row.sourceDeliverableId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
    totalChunks += await indexMemoryChunks(db, mapped, provider);
    indexedMemories += 1;
  }

  let indexedDocFiles = 0;
  if (parsed.includeDocs) {
    const targets: ScopedMarkdownTarget[] = [];

    if (parsed.projectId) {
      const repos = await db
        .select()
        .from(projectRepositories)
        .where(eq(projectRepositories.projectId, parsed.projectId));

      for (const repo of repos) {
        if (!repo.localPath || !fs.existsSync(/*turbopackIgnore: true*/ repo.localPath)) {
          continue;
        }
        const repoFiles = collectMarkdownFiles(repo.localPath, ["."]);
        for (const f of repoFiles) {
          const scopedPath =
            repos.length > 1 ? `${repo.name}/${f.relativePath}` : f.relativePath;
          targets.push({
            relativePath: scopedPath,
            absolutePath: f.absolutePath,
            scopeType: "project",
            scopeId: parsed.projectId,
          });
        }
      }

      if (parsed.force) {
        await db
          .delete(memoryChunks)
          .where(
            and(
              eq(memoryChunks.organizationId, params.organizationId),
              eq(memoryChunks.sourceType, "markdown"),
              eq(memoryChunks.scopeType, "project"),
              eq(memoryChunks.scopeId, parsed.projectId)
            )
          );
      }
    } else {
      const allowPlatformScan =
        parsed.includePlatformDocs === true ||
        (params.rootDir !== undefined && params.allowDirectRootDocs !== false);
      if (allowPlatformScan) {
        const rootDir = params.rootDir ?? process.cwd();
        const mdFiles = collectMarkdownFiles(rootDir, [".uzina", "docs"]);
        for (const f of mdFiles) {
          targets.push({
            relativePath: f.relativePath,
            absolutePath: f.absolutePath,
            scopeType: "org",
            scopeId: params.organizationId,
          });
        }
      }
    }

    for (const file of targets) {
      const rawContent = fs.readFileSync(
        /*turbopackIgnore: true*/ file.absolutePath,
        "utf8"
      );
      const cleanMarkdown = redactSensitiveText(rawContent);
      const fileHash = sha256Hex(cleanMarkdown);

      if (!parsed.force) {
        const existingFileChunks = await db
          .select({
            contentHash: memoryChunks.contentHash,
            embeddingModel: memoryChunks.embeddingModel,
          })
          .from(memoryChunks)
          .where(
            and(
              eq(memoryChunks.organizationId, params.organizationId),
              eq(memoryChunks.scopeType, file.scopeType),
              eq(memoryChunks.scopeId, file.scopeId),
              eq(memoryChunks.sourcePath, file.relativePath)
            )
          );
        if (
          existingFileChunks.length > 0 &&
          existingFileChunks.every(
            (c) => c.contentHash === fileHash && c.embeddingModel === provider.id
          )
        ) {
          totalChunks += existingFileChunks.length;
          continue;
        }
      }

      await db
        .delete(memoryChunks)
        .where(
          and(
            eq(memoryChunks.organizationId, params.organizationId),
            eq(memoryChunks.scopeType, file.scopeType),
            eq(memoryChunks.scopeId, file.scopeId),
            eq(memoryChunks.sourcePath, file.relativePath)
          )
        );

      const chunks = chunkMarkdownByHeadings(cleanMarkdown, {
        defaultHeading: path.basename(file.relativePath, ".md"),
      });
      if (chunks.length === 0) continue;

      const embeddings = await provider.embedDocuments(
        chunks.map((c) => c.content)
      );

      await db.insert(memoryChunks).values(
        chunks.map((chunk, idx) => ({
          organizationId: params.organizationId,
          sourceType: "markdown" as const,
          memoryId: null,
          sourcePath: file.relativePath,
          scopeType: file.scopeType,
          scopeId: file.scopeId,
          headingPath: chunk.headingPath,
          lineStart: chunk.lineStart,
          lineEnd: chunk.lineEnd,
          content: chunk.content,
          contentHash: fileHash,
          embedding: embeddings[idx]!,
          embeddingModel: provider.id,
        }))
      );

      indexedDocFiles += 1;
      totalChunks += chunks.length;
    }
  }

  return {
    indexedMemories,
    indexedDocFiles,
    totalChunks,
    embeddingModel: provider.id,
    degraded: provider.degraded,
  };
}

async function ensureMissingMemoryChunksIndexed(
  db: UzinaDb,
  organizationId: string,
  provider: EmbeddingProvider
): Promise<void> {
  const orgMemories = await db
    .select()
    .from(memories)
    .where(eq(memories.organizationId, organizationId));

  if (orgMemories.length === 0) return;

  const existingChunks = await db
    .select({ memoryId: memoryChunks.memoryId })
    .from(memoryChunks)
    .where(
      and(
        eq(memoryChunks.organizationId, organizationId),
        inArray(
          memoryChunks.memoryId,
          orgMemories.map((m) => m.id)
        )
      )
    );

  const indexedIds = new Set(
    existingChunks.map((c) => c.memoryId).filter((id): id is string => Boolean(id))
  );

  for (const row of orgMemories) {
    if (indexedIds.has(row.id)) continue;
    await indexMemoryChunks(
      db,
      {
        id: row.id,
        organizationId: row.organizationId,
        scopeType: row.scopeType,
        scopeId: row.scopeId,
        category: row.category,
        title: row.title,
        content: row.content,
        sourceDeliverableId: row.sourceDeliverableId,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      },
      provider
    );
  }
}

export async function searchQmdScoped(
  db: UzinaDb,
  params: {
    organizationId: string;
    request: QmdSearchRequest;
    provider?: EmbeddingProvider;
  }
): Promise<QmdSearchResponse> {
  const parsed = QmdSearchRequestSchema.parse(params.request);
  const provider =
    params.provider ??
    (await resolveOrganizationEmbeddingProvider(db, params.organizationId));

  await ensureMissingMemoryChunksIndexed(db, params.organizationId, provider);

  const scopeFilters: SQL[] = [
    eq(memoryChunks.organizationId, params.organizationId),
  ];

  if (parsed.projectId) {
    const [proj] = await db
      .select({ id: projects.id, clientId: projects.clientId })
      .from(projects)
      .innerJoin(clients, eq(projects.clientId, clients.id))
      .where(
        and(
          eq(projects.id, parsed.projectId),
          eq(clients.organizationId, params.organizationId)
        )
      )
      .limit(1);

    if (!proj) {
      return QmdSearchResponseSchema.parse({
        query: parsed.query,
        mode: parsed.mode,
        embeddingModel: provider.id,
        degraded: provider.degraded,
        totalCandidates: 0,
        contextTree: [],
        hits: [],
      });
    }

    const allowedScopeOr = or(
      and(
        eq(memoryChunks.scopeType, "org"),
        eq(memoryChunks.scopeId, params.organizationId)
      ),
      and(
        eq(memoryChunks.scopeType, "client"),
        eq(memoryChunks.scopeId, proj.clientId)
      ),
      and(
        eq(memoryChunks.scopeType, "project"),
        eq(memoryChunks.scopeId, proj.id)
      )
    )!;
    scopeFilters.push(allowedScopeOr);
  } else if (parsed.clientId) {
    const [client] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(
        and(
          eq(clients.id, parsed.clientId),
          eq(clients.organizationId, params.organizationId)
        )
      )
      .limit(1);

    if (!client) {
      return QmdSearchResponseSchema.parse({
        query: parsed.query,
        mode: parsed.mode,
        embeddingModel: provider.id,
        degraded: provider.degraded,
        totalCandidates: 0,
        contextTree: [],
        hits: [],
      });
    }

    const allowedClientOr = or(
      and(
        eq(memoryChunks.scopeType, "org"),
        eq(memoryChunks.scopeId, params.organizationId)
      ),
      and(
        eq(memoryChunks.scopeType, "client"),
        eq(memoryChunks.scopeId, client.id)
      )
    )!;
    scopeFilters.push(allowedClientOr);
  }

  if (parsed.scopeType) {
    scopeFilters.push(eq(memoryChunks.scopeType, parsed.scopeType));
  }

  const candidates = await db
    .select()
    .from(memoryChunks)
    .where(and(...scopeFilters));

  if (candidates.length === 0) {
    return QmdSearchResponseSchema.parse({
      query: parsed.query,
      mode: parsed.mode,
      embeddingModel: provider.id,
      degraded: provider.degraded,
      totalCandidates: 0,
      contextTree: [],
      hits: [],
    });
  }

  const bm25Scores = computeBm25Scores(
    parsed.query,
    candidates.map((c) => ({
      id: c.id,
      text: `${c.headingPath} ${c.content}`,
    }))
  );

  const queryVec = await provider.embedQuery(parsed.query);
  const vectorScores = new Map<string, number>();
  for (const cand of candidates) {
    const sim = cosineSimilarity(queryVec, cand.embedding);
    vectorScores.set(cand.id, Number(Math.max(0, sim).toFixed(6)));
  }

  const bm25List = candidates.map((c) => ({
    id: c.id,
    score: bm25Scores.get(c.id) ?? 0,
  }));
  const vectorList = candidates.map((c) => ({
    id: c.id,
    score: vectorScores.get(c.id) ?? 0,
  }));

  const ranked =
    parsed.mode === "lexical"
      ? reciprocalRankFusion([bm25List])
      : parsed.mode === "vector"
        ? reciprocalRankFusion([vectorList])
        : reciprocalRankFusion([bm25List, vectorList]);

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const hits = ranked.slice(0, parsed.limit).map((item) => {
    const row = byId.get(item.id)!;
    return {
      id: row.id,
      sourceType: row.sourceType,
      memoryId: row.memoryId,
      sourcePath: row.sourcePath,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      headingPath: row.headingPath,
      lineStart: row.lineStart,
      lineEnd: row.lineEnd,
      snippet: formatQmdSnippet(row.content),
      scores: {
        bm25: bm25Scores.get(row.id) ?? 0,
        vector: vectorScores.get(row.id) ?? 0,
        rrf: item.rrf,
      },
    };
  });

  const contextTree = buildDirectoryContextTree(
    candidates.map((c) => ({
      sourcePath: c.sourcePath,
      scopeType: c.scopeType,
      headingPath: c.headingPath,
    }))
  );

  if (candidates.length > 0) {
    const baselineChars = candidates.reduce((acc, c) => acc + c.content.length, 0);
    const actualChars = hits.reduce((acc, h) => acc + h.snippet.length, 0);
    await recordTokenSavingsEventScoped(db, {
      organizationId: params.organizationId,
      input: {
        technique: "qmd",
        tokensBaseline: Math.max(1, Math.ceil(baselineChars / 4)),
        tokensActual: Math.max(1, Math.ceil(actualChars / 4)),
      },
    }).catch(() => undefined);
  }

  return QmdSearchResponseSchema.parse({
    query: parsed.query,
    mode: parsed.mode,
    embeddingModel: provider.id,
    degraded: provider.degraded,
    totalCandidates: candidates.length,
    contextTree,
    hits,
  });
}
