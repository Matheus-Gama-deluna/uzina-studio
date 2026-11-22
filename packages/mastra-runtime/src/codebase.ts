import fs from "node:fs";
import {
  buildCodebaseDirectoryTree,
  buildCodebaseSkeleton,
  computeChangeImpactInMemory,
  probeCodebaseAdapters,
  querySymbolGraphInMemory,
  readSymbolSliceFromWorkspace,
  resolveWorkspaceEdges,
  scanCodebaseWorkspace,
  type IndexedFileDraft,
} from "@uzina/codebase-intel";
import type {
  ChangeImpactRequest,
  ChangeImpactResponse,
  CodebaseEdge,
  CodebaseReindexResponse,
  CodebaseSymbol,
  CodebaseTreeResponse,
  ProvenanceListResponse,
  ProvenanceQuery,
  SymbolGraphQuery,
  SymbolGraphResponse,
  SymbolSliceRequest,
  SymbolSliceResponse,
} from "@uzina/contracts";
import {
  clients,
  codebaseEdges,
  codebaseFiles,
  codebaseSymbols,
  decisionProvenance,
  deliverables,
  projectRepositories,
  projects,
  type UzinaDb,
} from "@uzina/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { WorkflowRuntimeError } from "./errors.js";

async function resolveScopedProjectAndRepo(
  db: UzinaDb,
  params: {
    organizationId: string;
    projectId: string;
    repositoryId?: string;
  }
) {
  const [proj] = await db
    .select({
      id: projects.id,
      clientId: projects.clientId,
      organizationId: clients.organizationId,
    })
    .from(projects)
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(
      and(
        eq(projects.id, params.projectId),
        eq(clients.organizationId, params.organizationId)
      )
    )
    .limit(1);

  if (!proj) {
    throw new WorkflowRuntimeError({
      statusCode: 404,
      code: "DELIVERABLE_NOT_FOUND",
      message: `Projeto '${params.projectId}' não encontrado na organização.`,
    });
  }

  const repos = await db
    .select()
    .from(projectRepositories)
    .where(eq(projectRepositories.projectId, proj.id));

  const repo = params.repositoryId
    ? repos.find((r) => r.id === params.repositoryId) ?? null
    : repos[0] ?? null;

  if (params.repositoryId && !repo) {
    throw new WorkflowRuntimeError({
      statusCode: 404,
      code: "DELIVERABLE_NOT_FOUND",
      message: `Repositório '${params.repositoryId}' não pertence ao projeto.`,
    });
  }

  return { project: proj, repo };
}

async function loadRepositoryGraph(
  db: UzinaDb,
  repositoryId: string
): Promise<{
  files: Array<{ id: string; path: string; size: number }>;
  symbols: CodebaseSymbol[];
  edges: CodebaseEdge[];
}> {
  const fileRows = await db
    .select()
    .from(codebaseFiles)
    .where(eq(codebaseFiles.repositoryId, repositoryId));

  if (fileRows.length === 0) {
    return { files: [], symbols: [], edges: [] };
  }

  const filePathById = new Map(fileRows.map((f) => [f.id, f.path]));
  const fileIds = fileRows.map((f) => f.id);

  const symRows = await db
    .select()
    .from(codebaseSymbols)
    .where(inArray(codebaseSymbols.fileId, fileIds));

  const symbols: CodebaseSymbol[] = symRows.map((s) => {
    const filePath = filePathById.get(s.fileId) ?? "unknown";
    return {
      id: s.id,
      fileId: s.fileId,
      filePath,
      kind: s.kind,
      name: s.name,
      signature: s.signature,
      lineStart: s.lineStart,
      lineEnd: s.lineEnd,
      exported: s.exported,
      citation: `${filePath}#L${s.lineStart}-L${s.lineEnd}`,
    };
  });

  const symIds = symbols.map((s) => s.id);
  const symNameById = new Map(symbols.map((s) => [s.id, s.name]));

  const edgeRows =
    symIds.length > 0
      ? await db
          .select()
          .from(codebaseEdges)
          .where(inArray(codebaseEdges.fromSymbolId, symIds))
      : [];

  const edges: CodebaseEdge[] = edgeRows
    .filter((e) => symNameById.has(e.fromSymbolId) && symNameById.has(e.toSymbolId))
    .map((e) => ({
      id: e.id,
      fromSymbolId: e.fromSymbolId,
      toSymbolId: e.toSymbolId,
      fromSymbolName: symNameById.get(e.fromSymbolId)!,
      toSymbolName: symNameById.get(e.toSymbolId)!,
      relation: e.relation,
    }));

  return {
    files: fileRows.map((f) => ({ id: f.id, path: f.path, size: f.size })),
    symbols,
    edges,
  };
}

export async function syncRepositoryCodebase(
  db: UzinaDb,
  params: {
    organizationId: string;
    projectId: string;
    repositoryId?: string;
    workspaceRoot?: string;
    rebuild?: boolean;
  }
): Promise<CodebaseReindexResponse> {
  const { repo } = await resolveScopedProjectAndRepo(db, params);
  if (!repo) {
    return {
      projectId: params.projectId,
      repositoryId: null,
      indexedFiles: 0,
      skippedUnchangedFiles: 0,
      removedFiles: 0,
      totalSymbols: 0,
      totalEdges: 0,
      tokensBaseline: 0,
      tokensSkeleton: 0,
      savingsPercent: 0,
    };
  }

  const rootDir = params.workspaceRoot ?? repo.localPath ?? process.cwd();
  const scan = fs.existsSync(/*turbopackIgnore: true*/ rootDir)
    ? scanCodebaseWorkspace(rootDir)
    : { files: [], edges: [] };

  const existingFiles = await db
    .select()
    .from(codebaseFiles)
    .where(eq(codebaseFiles.repositoryId, repo.id));
  const existingByPath = new Map(existingFiles.map((f) => [f.path, f]));
  const scannedByPath = new Map(scan.files.map((f) => [f.path, f]));

  let removedFiles = 0;
  for (const existing of existingFiles) {
    if (!scannedByPath.has(existing.path) || params.rebuild) {
      await db.delete(codebaseFiles).where(eq(codebaseFiles.id, existing.id));
      if (!scannedByPath.has(existing.path)) {
        removedFiles += 1;
      }
    }
  }

  let indexedFiles = 0;
  let skippedUnchangedFiles = 0;
  const changedOrNewDrafts: IndexedFileDraft[] = [];

  for (const fileDraft of scan.files) {
    const prev = params.rebuild ? undefined : existingByPath.get(fileDraft.path);
    if (prev && prev.sha256 === fileDraft.sha256) {
      skippedUnchangedFiles += 1;
      continue;
    }

    if (prev) {
      await db.delete(codebaseFiles).where(eq(codebaseFiles.id, prev.id));
    }

    const [insertedFile] = await db
      .insert(codebaseFiles)
      .values({
        repositoryId: repo.id,
        path: fileDraft.path,
        sha256: fileDraft.sha256,
        language: fileDraft.language,
        size: fileDraft.size,
      })
      .returning();

    if (insertedFile && fileDraft.symbols.length > 0) {
      await db.insert(codebaseSymbols).values(
        fileDraft.symbols.map((s) => ({
          fileId: insertedFile.id,
          kind: s.kind,
          name: s.name,
          signature: s.signature,
          lineStart: s.lineStart,
          lineEnd: s.lineEnd,
          exported: s.exported,
        }))
      );
    }

    indexedFiles += 1;
    changedOrNewDrafts.push(fileDraft);
  }

  // Re-sincroniza arestas se houve qualquer alteração no repositório
  if (indexedFiles > 0 || removedFiles > 0 || params.rebuild) {
    const { symbols } = await loadRepositoryGraph(db, repo.id);
    const symIds = symbols.map((s) => s.id);
    if (symIds.length > 0) {
      await db
        .delete(codebaseEdges)
        .where(inArray(codebaseEdges.fromSymbolId, symIds));
    }

    const symByPathAndName = new Map(
      symbols.map((s) => [`${s.filePath}:${s.name}`, s.id])
    );
    const resolvedEdges = resolveWorkspaceEdges(scan.files);
    const edgeValues = resolvedEdges
      .map((e) => {
        const fromId = symByPathAndName.get(
          `${e.fromFilePath}:${e.fromSymbolName}`
        );
        const toId = symByPathAndName.get(`${e.toFilePath}:${e.toSymbolName}`);
        if (!fromId || !toId) return null;
        return {
          fromSymbolId: fromId,
          toSymbolId: toId,
          relation: e.relation,
        };
      })
      .filter((v): v is NonNullable<typeof v> => Boolean(v));

    if (edgeValues.length > 0) {
      await db.insert(codebaseEdges).values(edgeValues);
    }
  }

  const finalGraph = await loadRepositoryGraph(db, repo.id);
  const skeleton = buildCodebaseSkeleton({
    repositoryId: repo.id,
    files: finalGraph.files,
    symbols: finalGraph.symbols,
    edges: finalGraph.edges,
  });

  return {
    projectId: params.projectId,
    repositoryId: repo.id,
    indexedFiles,
    skippedUnchangedFiles,
    removedFiles,
    totalSymbols: finalGraph.symbols.length,
    totalEdges: finalGraph.edges.length,
    tokensBaseline: skeleton.baselineTokens,
    tokensSkeleton: skeleton.tokensEstimated,
    savingsPercent: skeleton.savingsPercent,
  };
}

export async function getProjectCodebaseTreeScoped(
  db: UzinaDb,
  params: {
    organizationId: string;
    projectId: string;
    repositoryId?: string;
    workspaceRoot?: string;
  }
): Promise<CodebaseTreeResponse> {
  const { repo } = await resolveScopedProjectAndRepo(db, params);
  const rootDir = params.workspaceRoot ?? repo?.localPath ?? process.cwd();
  const adapters = await probeCodebaseAdapters(rootDir);

  if (!repo) {
    const emptySkeleton = buildCodebaseSkeleton({
      repositoryId: null,
      files: [],
      symbols: [],
      edges: [],
    });
    return {
      projectId: params.projectId,
      repositoryId: null,
      filesCount: 0,
      symbolsCount: 0,
      edgesCount: 0,
      directories: [],
      skeleton: emptySkeleton,
      adapters,
    };
  }

  const graph = await loadRepositoryGraph(db, repo.id);
  const directories = buildCodebaseDirectoryTree(
    graph.files.map((f) => f.path),
    graph.symbols
  );
  const skeleton = buildCodebaseSkeleton({
    repositoryId: repo.id,
    files: graph.files,
    symbols: graph.symbols,
    edges: graph.edges,
  });

  return {
    projectId: params.projectId,
    repositoryId: repo.id,
    filesCount: graph.files.length,
    symbolsCount: graph.symbols.length,
    edgesCount: graph.edges.length,
    directories,
    skeleton,
    adapters,
  };
}

export async function queryProjectSymbolsScoped(
  db: UzinaDb,
  params: {
    organizationId: string;
    projectId: string;
    query: SymbolGraphQuery;
  }
): Promise<SymbolGraphResponse> {
  const { repo } = await resolveScopedProjectAndRepo(db, {
    organizationId: params.organizationId,
    projectId: params.projectId,
    repositoryId: params.query.repositoryId,
  });

  if (!repo) {
    return {
      query: params.query.symbol,
      nodes: [],
      edges: [],
      tokensEstimated: 0,
    };
  }

  const graph = await loadRepositoryGraph(db, repo.id);
  return querySymbolGraphInMemory(graph.symbols, graph.edges, params.query);
}

export async function readProjectSymbolSliceScoped(
  db: UzinaDb,
  params: {
    organizationId: string;
    projectId: string;
    request: SymbolSliceRequest;
    workspaceRoot?: string;
  }
): Promise<SymbolSliceResponse> {
  const { repo } = await resolveScopedProjectAndRepo(db, {
    organizationId: params.organizationId,
    projectId: params.projectId,
    repositoryId: params.request.repositoryId,
  });

  const rootDir = params.workspaceRoot ?? repo?.localPath ?? process.cwd();
  const graph = repo
    ? await loadRepositoryGraph(db, repo.id)
    : { files: [], symbols: [], edges: [] };

  try {
    return readSymbolSliceFromWorkspace(rootDir, graph.symbols, params.request);
  } catch (err) {
    throw new WorkflowRuntimeError({
      statusCode: 400,
      code: "EXECUTION_FAILED",
      message: err instanceof Error ? err.message : String(err),
      cause: err,
    });
  }
}

export async function computeProjectChangeImpactScoped(
  db: UzinaDb,
  params: {
    organizationId: string;
    projectId: string;
    request: ChangeImpactRequest;
  }
): Promise<ChangeImpactResponse> {
  const { repo } = await resolveScopedProjectAndRepo(db, {
    organizationId: params.organizationId,
    projectId: params.projectId,
    repositoryId: params.request.repositoryId,
  });

  if (!repo) {
    return {
      changedFiles: params.request.changedFiles,
      affectedSymbols: [],
      affectedRoutes: [],
      tokensEstimated: 0,
    };
  }

  const graph = await loadRepositoryGraph(db, repo.id);
  return computeChangeImpactInMemory(
    graph.symbols,
    graph.edges,
    params.request.changedFiles
  );
}

export async function listDecisionProvenanceScoped(
  db: UzinaDb,
  params: {
    organizationId: string;
    projectId: string;
    query: ProvenanceQuery;
  }
): Promise<ProvenanceListResponse> {
  await resolveScopedProjectAndRepo(db, {
    organizationId: params.organizationId,
    projectId: params.projectId,
  });

  const projectDeliverables = await db
    .select({ id: deliverables.id })
    .from(deliverables)
    .where(eq(deliverables.projectId, params.projectId));

  const delivIds = projectDeliverables.map((d) => d.id);
  if (delivIds.length === 0) {
    return { projectId: params.projectId, entries: [] };
  }

  const rows = await db
    .select()
    .from(decisionProvenance)
    .where(
      and(
        eq(decisionProvenance.organizationId, params.organizationId),
        inArray(decisionProvenance.deliverableId, delivIds)
      )
    )
    .orderBy(desc(decisionProvenance.createdAt))
    .limit(params.query.limit);

  const filtered = rows.filter((r) => {
    if (params.query.deliverableId && r.deliverableId !== params.query.deliverableId) {
      return false;
    }
    if (params.query.path && !r.filePath.includes(params.query.path)) {
      return false;
    }
    return true;
  });

  return {
    projectId: params.projectId,
    entries: filtered.map((r) => ({
      id: r.id,
      organizationId: r.organizationId,
      deliverableId: r.deliverableId,
      decisionId: r.decisionId ?? null,
      memoryId: r.memoryId ?? null,
      symbolId: r.symbolId ?? null,
      filePath: r.filePath,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

export async function recordDeliverableProvenance(
  db: UzinaDb,
  params: {
    organizationId: string;
    deliverableId: string;
    repositoryId?: string | null;
    decisionId?: string | null;
    memoryId?: string | null;
    filePaths: string[];
  }
): Promise<number> {
  const uniquePaths = Array.from(
    new Set(
      params.filePaths
        .map((p) => p.replace(/\\/g, "/").trim())
        .filter(Boolean)
    )
  ).slice(0, 50);

  if (uniquePaths.length === 0) return 0;

  let symbolByPath = new Map<string, string>();
  if (params.repositoryId) {
    const graph = await loadRepositoryGraph(db, params.repositoryId);
    symbolByPath = new Map(
      graph.symbols
        .filter((s) => s.exported)
        .map((s) => [s.filePath, s.id])
    );
  }

  await db.insert(decisionProvenance).values(
    uniquePaths.map((filePath) => ({
      organizationId: params.organizationId,
      deliverableId: params.deliverableId,
      decisionId: params.decisionId ?? null,
      memoryId: params.memoryId ?? null,
      symbolId: symbolByPath.get(filePath) ?? null,
      filePath,
    }))
  );

  return uniquePaths.length;
}
