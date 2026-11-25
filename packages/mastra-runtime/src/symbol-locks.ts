import { querySymbolGraphInMemory } from "@uzina/codebase-intel";
import type { CodebaseEdge, CodebaseSymbol } from "@uzina/contracts";
import {
  codebaseEdges,
  codebaseFiles,
  codebaseSymbols,
  projectRepositories,
  type UzinaDb,
} from "@uzina/db";
import { eq, inArray } from "drizzle-orm";

const STOPWORDS = new Set([
  "src",
  "apps",
  "packages",
  "tests",
  "test",
  "spec",
  "docs",
  "index",
  "slice",
  "build",
  "verify",
  "criar",
  "para",
  "com",
  "sem",
  "uma",
  "que",
  "the",
  "and",
  "for",
  "with",
]);

export function extractCandidateSymbolNames(text: string): string[] {
  if (!text.trim()) return [];
  const candidates = new Set<string>();

  for (const match of text.matchAll(/`([A-Za-z_][A-Za-z0-9_.-]{2,80})`/g)) {
    const raw = match[1]!;
    const base = raw.includes("/") ? raw.split("/").pop() ?? raw : raw;
    const cleaned = base.replace(/\.[a-z0-9]+$/i, "");
    if (cleaned.length >= 3 && !STOPWORDS.has(cleaned.toLowerCase())) {
      candidates.add(cleaned);
    }
  }

  for (const match of text.matchAll(/\b([A-Za-z_][A-Za-z0-9_]{2,64})\b/g)) {
    const token = match[1]!;
    if (STOPWORDS.has(token.toLowerCase())) continue;
    const looksTechnical =
      /[a-z][A-Z]/.test(token) ||
      /^[A-Z][a-zA-Z0-9]{2,}$/.test(token) ||
      token.includes("_");
    if (looksTechnical) {
      candidates.add(token);
    }
  }

  return Array.from(candidates).slice(0, 24);
}

export async function resolveDeliverableTargetSymbols(
  db: UzinaDb,
  params: {
    projectId: string;
    title: string;
    description?: string | null;
    specMarkdown?: string | null;
  }
): Promise<string[]> {
  const combinedText = [
    params.title,
    params.description ?? "",
    params.specMarkdown ?? "",
  ]
    .filter(Boolean)
    .join("\n");

  const candidates = extractCandidateSymbolNames(combinedText);
  if (candidates.length === 0) {
    return [];
  }

  const repoRows = await db
    .select({ id: projectRepositories.id })
    .from(projectRepositories)
    .where(eq(projectRepositories.projectId, params.projectId));

  if (repoRows.length === 0) {
    return candidates.map((c) => `symbol::${c.toLowerCase()}`);
  }

  const fileRows = await db
    .select({ id: codebaseFiles.id, path: codebaseFiles.path })
    .from(codebaseFiles)
    .where(
      inArray(
        codebaseFiles.repositoryId,
        repoRows.map((r) => r.id)
      )
    );

  if (fileRows.length === 0) {
    return candidates.map((c) => `symbol::${c.toLowerCase()}`);
  }

  const filePathById = new Map(fileRows.map((f) => [f.id, f.path]));
  const symRows = await db
    .select()
    .from(codebaseSymbols)
    .where(
      inArray(
        codebaseSymbols.fileId,
        fileRows.map((f) => f.id)
      )
    );

  if (symRows.length === 0) {
    return candidates.map((c) => `symbol::${c.toLowerCase()}`);
  }

  const mappedSymbols: CodebaseSymbol[] = symRows.map((row) => {
    const filePath = filePathById.get(row.fileId) ?? "unknown";
    return {
      id: row.id,
      fileId: row.fileId,
      filePath,
      kind: row.kind,
      name: row.name,
      signature: row.signature,
      lineStart: row.lineStart,
      lineEnd: row.lineEnd,
      exported: row.exported,
      citation: `${filePath}#L${row.lineStart}-L${row.lineEnd}`,
    };
  });

  const symIds = mappedSymbols.map((s) => s.id);
  const symNameById = new Map(mappedSymbols.map((s) => [s.id, s.name]));
  const edgeRows = await db
    .select()
    .from(codebaseEdges)
    .where(inArray(codebaseEdges.fromSymbolId, symIds));

  const mappedEdges: CodebaseEdge[] = edgeRows
    .filter(
      (e) => symNameById.has(e.fromSymbolId) && symNameById.has(e.toSymbolId)
    )
    .map((row) => ({
      id: row.id,
      fromSymbolId: row.fromSymbolId,
      toSymbolId: row.toSymbolId,
      fromSymbolName: symNameById.get(row.fromSymbolId)!,
      toSymbolName: symNameById.get(row.toSymbolId)!,
      relation: row.relation,
    }));

  const resolved = new Set<string>();
  for (const candidate of candidates) {
    const graphRes = querySymbolGraphInMemory(mappedSymbols, mappedEdges, {
      symbol: candidate,
      depth: 1,
      maxResults: 20,
    });
    for (const node of graphRes.nodes) {
      resolved.add(`${node.filePath}::${node.name}`);
    }
  }

  if (resolved.size === 0) {
    return candidates.map((c) => `symbol::${c.toLowerCase()}`);
  }

  return Array.from(resolved).slice(0, 64);
}

export interface ActiveSymbolLockEntry {
  symbol: string;
  deliverableId: string;
  acquiredAt: number;
}

export type SymbolLockAcquireResult =
  | {
      acquired: true;
      lockedSymbols: string[];
    }
  | {
      acquired: false;
      conflictingSymbols: string[];
      holdingDeliverableIds: string[];
    };

export class SymbolLockManager {
  private readonly projectLocks = new Map<
    string,
    Map<string, ActiveSymbolLockEntry>
  >();
  private readonly waiters = new Map<string, Set<() => void>>();

  private getOrCreateMap(projectId: string) {
    let map = this.projectLocks.get(projectId);
    if (!map) {
      map = new Map<string, ActiveSymbolLockEntry>();
      this.projectLocks.set(projectId, map);
    }
    return map;
  }

  tryAcquire(params: {
    projectId: string;
    deliverableId: string;
    symbols: readonly string[];
  }): SymbolLockAcquireResult {
    const uniqueSymbols = Array.from(
      new Set(params.symbols.map((s) => s.trim()).filter(Boolean))
    );
    if (uniqueSymbols.length === 0) {
      return { acquired: true, lockedSymbols: [] };
    }

    const map = this.getOrCreateMap(params.projectId);
    const conflictingSymbols: string[] = [];
    const holders = new Set<string>();

    for (const sym of uniqueSymbols) {
      const existing = map.get(sym);
      if (existing && existing.deliverableId !== params.deliverableId) {
        conflictingSymbols.push(sym);
        holders.add(existing.deliverableId);
      }
    }

    if (conflictingSymbols.length > 0) {
      return {
        acquired: false,
        conflictingSymbols,
        holdingDeliverableIds: Array.from(holders),
      };
    }

    const now = Date.now();
    for (const sym of uniqueSymbols) {
      map.set(sym, {
        symbol: sym,
        deliverableId: params.deliverableId,
        acquiredAt: now,
      });
    }

    return {
      acquired: true,
      lockedSymbols: uniqueSymbols,
    };
  }

  async acquireOrWait(params: {
    projectId: string;
    deliverableId: string;
    symbols: readonly string[];
    signal?: AbortSignal;
    onWaiting?: (
      conflictingSymbols: string[],
      holdingDeliverableIds: string[]
    ) => void;
  }): Promise<
    | { acquired: true; lockedSymbols: string[]; aborted: false }
    | { acquired: false; lockedSymbols: []; aborted: true }
  > {
    while (true) {
      if (params.signal?.aborted) {
        return { acquired: false, lockedSymbols: [], aborted: true };
      }

      const attempt = this.tryAcquire({
        projectId: params.projectId,
        deliverableId: params.deliverableId,
        symbols: params.symbols,
      });

      if (attempt.acquired) {
        return {
          acquired: true,
          lockedSymbols: attempt.lockedSymbols,
          aborted: false,
        };
      }

      params.onWaiting?.(
        attempt.conflictingSymbols,
        attempt.holdingDeliverableIds
      );

      await new Promise<void>((resolve) => {
        let settled = false;
        let waiterSet = this.waiters.get(params.projectId);
        if (!waiterSet) {
          waiterSet = new Set();
          this.waiters.set(params.projectId, waiterSet);
        }

        const done = () => {
          if (settled) return;
          settled = true;
          waiterSet?.delete(done);
          if (waiterSet && waiterSet.size === 0) {
            this.waiters.delete(params.projectId);
          }
          params.signal?.removeEventListener("abort", done);
          resolve();
        };

        waiterSet.add(done);
        params.signal?.addEventListener("abort", done, { once: true });
      });
    }
  }

  release(params: { projectId: string; deliverableId: string }): number {
    const map = this.projectLocks.get(params.projectId);
    if (!map) return 0;
    let released = 0;
    for (const [sym, entry] of map.entries()) {
      if (entry.deliverableId === params.deliverableId) {
        map.delete(sym);
        released += 1;
      }
    }
    if (map.size === 0) {
      this.projectLocks.delete(params.projectId);
    }

    const waiterSet = this.waiters.get(params.projectId);
    if (waiterSet && waiterSet.size > 0) {
      for (const wake of Array.from(waiterSet)) {
        wake();
      }
    }
    return released;
  }

  listActiveLocks(projectId: string): ActiveSymbolLockEntry[] {
    const map = this.projectLocks.get(projectId);
    if (!map) return [];
    return Array.from(map.values());
  }

  clearAll(): void {
    this.projectLocks.clear();
    for (const waiterSet of this.waiters.values()) {
      for (const wake of Array.from(waiterSet)) {
        wake();
      }
    }
    this.waiters.clear();
  }
}
