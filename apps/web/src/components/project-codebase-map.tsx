"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CodebaseReindexResponseSchema,
  CodebaseTreeResponseSchema,
  ProvenanceListResponseSchema,
  SymbolGraphResponseSchema,
  SymbolSliceResponseSchema,
  type CodebaseRelation,
  type CodebaseSymbol,
  type SymbolSliceResponse,
} from "@uzina/contracts";
import {
  ArrowLeft,
  Code2,
  Cpu,
  FileCode2,
  GitFork,
  History,
  RefreshCw,
  Search,
} from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";

interface ProjectCodebaseMapProps {
  projectId: string;
  initialProjectName?: string;
}

const RELATION_OPTIONS: Array<{ value: "" | CodebaseRelation; label: string }> = [
  { value: "", label: "Todas as relações" },
  { value: "imports", label: "imports" },
  { value: "calls", label: "calls" },
  { value: "validates_with", label: "validates_with" },
  { value: "queries_table", label: "queries_table" },
  { value: "renders", label: "renders" },
];

export function ProjectCodebaseMap({
  projectId,
  initialProjectName,
}: ProjectCodebaseMapProps) {
  const queryClient = useQueryClient();
  const [symbolQuery, setSymbolQuery] = useState("");
  const [relationFilter, setRelationFilter] = useState<"" | CodebaseRelation>(
    ""
  );
  const [selectedSlice, setSelectedSlice] = useState<SymbolSliceResponse | null>(
    null
  );
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const treeQuery = useQuery({
    queryKey: ["codebase-tree", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/codebase`);
      if (!res.ok) {
        throw new Error("Falha ao carregar Mapa do Código.");
      }
      return CodebaseTreeResponseSchema.parse(await res.json());
    },
  });

  const provenanceQuery = useQuery({
    queryKey: ["codebase-provenance", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/codebase/provenance`);
      if (!res.ok) {
        throw new Error("Falha ao carregar proveniência.");
      }
      return ProvenanceListResponseSchema.parse(await res.json());
    },
  });

  const reindexMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/codebase/reindex`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rebuild: false }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Falha ao reindexar AST.");
      }
      return CodebaseReindexResponseSchema.parse(await res.json());
    },
    onSuccess: async (data) => {
      setActionError(null);
      setActionMessage(
        `AST sincronizada: ${data.indexedFiles} indexado(s), ${data.skippedUnchangedFiles} inalterado(s), ${data.totalSymbols} símbolo(s), economia de ${data.savingsPercent}%.`
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["codebase-tree", projectId] }),
        queryClient.invalidateQueries({
          queryKey: ["codebase-provenance", projectId],
        }),
      ]);
    },
    onError: (err: Error) => {
      setActionMessage(null);
      setActionError(err.message);
    },
  });

  const searchMutation = useMutation({
    mutationFn: async () => {
      const trimmed = symbolQuery.trim();
      if (!trimmed) {
        throw new Error("Informe o nome de um símbolo para consultar o grafo.");
      }
      const res = await fetch(`/api/projects/${projectId}/codebase/symbols`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: trimmed,
          ...(relationFilter ? { relation: relationFilter } : {}),
          depth: 2,
          maxResults: 20,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Falha na busca do grafo AST.");
      }
      return SymbolGraphResponseSchema.parse(await res.json());
    },
    onError: (err: Error) => {
      setActionError(err.message);
    },
  });

  const sliceMutation = useMutation({
    mutationFn: async (sym: CodebaseSymbol) => {
      const res = await fetch(`/api/projects/${projectId}/codebase/symbols`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "slice",
          path: sym.filePath,
          symbol: sym.name,
          maxBytes: 4096,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Falha ao ler trecho do símbolo.");
      }
      return SymbolSliceResponseSchema.parse(await res.json());
    },
    onSuccess: (slice) => {
      setActionError(null);
      setSelectedSlice(slice);
    },
    onError: (err: Error) => {
      setActionError(err.message);
    },
  });

  function handleSearchSubmit(e: FormEvent) {
    e.preventDefault();
    setActionError(null);
    searchMutation.mutate();
  }

  const tree = treeQuery.data;
  const provEntries = provenanceQuery.data?.entries ?? [];
  const graphResult = searchMutation.data;

  return (
    <div className="min-w-0 max-w-full space-y-5" data-testid="project-codebase-root">
      <section className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-fg-secondary">
            <Link
              href={`/app/projects/${projectId}/studio`}
              className="inline-flex items-center gap-1 rounded border border-border-subtle bg-surface px-2 py-1 text-xs font-medium text-fg-secondary transition-colors hover:border-border-default hover:text-fg-primary"
            >
              <ArrowLeft className="size-3.5" strokeWidth={1.75} />
              <span>Estúdio</span>
            </Link>
            <span>/</span>
            <span className="font-mono text-[11px] uppercase tracking-wider text-fg-muted">
              Codebase Intelligence (AST & Prompt Cache)
            </span>
          </div>
          <h1 className="text-lg font-semibold tracking-tight text-fg-primary">
            Mapa do Código — {initialProjectName ?? projectId.slice(0, 8)}
          </h1>
        </div>

        <button
          type="button"
          data-testid="codebase-reindex-btn"
          disabled={reindexMutation.isPending}
          onClick={() => reindexMutation.mutate()}
          className="inline-flex items-center gap-1.5 rounded border border-accent/50 bg-accent/15 px-3 py-1.5 text-xs font-medium text-fg-primary transition-colors hover:bg-accent/25 disabled:opacity-50"
        >
          <RefreshCw
            className={`size-3.5 ${reindexMutation.isPending ? "animate-spin" : ""}`}
            strokeWidth={1.75}
          />
          <span>
            {reindexMutation.isPending
              ? "Indexando AST..."
              : "Reindexar AST Incremental"}
          </span>
        </button>
      </section>

      {actionMessage && (
        <div className="rounded border border-status-ok/40 bg-status-ok/10 px-3 py-2 text-xs text-status-ok">
          {actionMessage}
        </div>
      )}
      {actionError && (
        <div className="rounded border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-xs text-status-danger">
          {actionError}
        </div>
      )}

      {/* Métricas de Economia & Grafo */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded border border-border-subtle bg-surface p-3">
          <p className="text-[11px] uppercase tracking-wider text-fg-muted">
            Arquivos Indexados
          </p>
          <p className="mt-1 font-mono text-xl font-semibold text-fg-primary tabular-nums">
            {tree?.filesCount ?? 0}
          </p>
        </div>
        <div className="rounded border border-border-subtle bg-surface p-3">
          <p className="text-[11px] uppercase tracking-wider text-fg-muted">
            Símbolos AST
          </p>
          <p className="mt-1 font-mono text-xl font-semibold text-fg-primary tabular-nums">
            {tree?.symbolsCount ?? 0}
          </p>
        </div>
        <div className="rounded border border-border-subtle bg-surface p-3">
          <p className="text-[11px] uppercase tracking-wider text-fg-muted">
            Arestas do Grafo
          </p>
          <p className="mt-1 font-mono text-xl font-semibold text-fg-primary tabular-nums">
            {tree?.edgesCount ?? 0}
          </p>
        </div>
        <div className="rounded border border-border-subtle bg-surface p-3">
          <p className="text-[11px] uppercase tracking-wider text-fg-muted">
            Economia Esqueleto
          </p>
          <p className="mt-1 font-mono text-xl font-semibold text-status-ok tabular-nums">
            {tree?.skeleton.savingsPercent ?? 0}%
          </p>
        </div>
      </section>

      {/* Busca no Grafo AST */}
      <section className="space-y-3 rounded border border-border-subtle bg-surface p-4">
        <div className="flex items-center gap-2">
          <GitFork className="size-4 text-accent" strokeWidth={1.75} />
          <h2 className="text-sm font-semibold text-fg-primary">
            Consulta Cirúrgica ao Grafo AST
          </h2>
        </div>

        <form
          onSubmit={handleSearchSubmit}
          className="flex flex-col gap-2 sm:flex-row sm:items-center"
        >
          <input
            type="text"
            data-testid="codebase-symbol-input"
            value={symbolQuery}
            onChange={(e) => setSymbolQuery(e.target.value)}
            placeholder="Nome do símbolo (ex: calculateTax, createDeliverable, POST)"
            className="min-w-0 flex-1 rounded border border-border-subtle bg-inset px-3 py-1.5 text-xs text-fg-primary placeholder:text-fg-muted focus:border-accent focus:outline-none"
          />
          <select
            value={relationFilter}
            onChange={(e) =>
              setRelationFilter(e.target.value as "" | CodebaseRelation)
            }
            className="rounded border border-border-subtle bg-inset px-2.5 py-1.5 text-xs text-fg-primary focus:border-accent focus:outline-none"
          >
            {RELATION_OPTIONS.map((opt) => (
              <option key={opt.label} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            data-testid="codebase-symbol-submit"
            disabled={searchMutation.isPending}
            className="inline-flex items-center justify-center gap-1.5 rounded border border-border-default bg-inset px-3 py-1.5 text-xs font-medium text-fg-primary transition-colors hover:border-accent disabled:opacity-50"
          >
            <Search className="size-3.5" strokeWidth={1.75} />
            <span>{searchMutation.isPending ? "Buscando..." : "Consultar"}</span>
          </button>
        </form>

        {graphResult && (
          <div className="space-y-2 pt-2">
            <p className="text-[11px] text-fg-muted tabular-nums">
              {graphResult.nodes.length} símbolo(s) · {graphResult.edges.length}{" "}
              aresta(s) · ~{graphResult.tokensEstimated} tokens
            </p>
            {graphResult.nodes.length === 0 ? (
              <p className="rounded border border-border-subtle bg-inset px-3 py-2 text-xs text-fg-secondary">
                Nenhum símbolo encontrado para &ldquo;{graphResult.query}&rdquo;.
              </p>
            ) : (
              <div className="grid min-w-0 gap-2 md:grid-cols-2">
                {graphResult.nodes.map((sym) => (
                  <div
                    key={sym.id}
                    data-testid="codebase-symbol-card"
                    className="flex min-w-0 flex-col justify-between gap-2 overflow-hidden rounded border border-border-subtle bg-inset p-3"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <span className="truncate font-mono text-xs font-semibold text-fg-primary">
                          {sym.name}
                        </span>
                        <span className="shrink-0 rounded border border-border-subtle bg-surface px-1.5 py-0.5 font-mono text-[10px] text-fg-secondary">
                          {sym.kind}
                        </span>
                      </div>
                      <p className="truncate font-mono text-[11px] text-fg-secondary">
                        {sym.signature}
                      </p>
                      <p className="truncate font-mono text-[10px] text-fg-muted tabular-nums">
                        {sym.citation}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => sliceMutation.mutate(sym)}
                      className="inline-flex w-fit items-center gap-1 rounded border border-border-subtle bg-surface px-2 py-1 text-[11px] font-medium text-fg-secondary hover:border-accent hover:text-fg-primary"
                    >
                      <Code2 className="size-3" strokeWidth={1.75} />
                      <span>Ler Fatia (Slice)</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {selectedSlice && (
          <div className="mt-3 min-w-0 space-y-2 rounded border border-accent/40 bg-inset p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="break-all font-mono text-xs font-semibold text-fg-primary">
                {selectedSlice.citation} ({selectedSlice.symbol})
              </span>
              <span className="font-mono text-[11px] text-status-ok tabular-nums">
                {selectedSlice.tokensEstimated} vs {selectedSlice.baselineFileTokens}{" "}
                tokens ({selectedSlice.savingsPercent}% economia)
              </span>
            </div>
            <pre className="max-h-64 w-full max-w-full overflow-auto rounded border border-border-subtle bg-canvas p-2.5 font-mono text-[11px] text-fg-primary">
              {selectedSlice.code}
            </pre>
          </div>
        )}
      </section>

      {/* Esqueleto Prompt Cache + Context Tree + Adaptadores + Proveniência */}
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <section className="min-w-0 space-y-2.5 overflow-hidden rounded border border-border-subtle bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FileCode2 className="size-4 text-accent" strokeWidth={1.75} />
              <h2 className="text-sm font-semibold text-fg-primary">
                Esqueleto Prompt Cache
              </h2>
            </div>
            <span className="font-mono text-[11px] text-fg-muted tabular-nums">
              {tree?.skeleton.tokensEstimated ?? 0} /{" "}
              {tree?.skeleton.maxTokensBudget ?? 2000} tokens
            </span>
          </div>
          <pre
            data-testid="codebase-skeleton-box"
            className="max-h-72 w-full max-w-full overflow-auto rounded border border-border-subtle bg-inset p-3 font-mono text-[11px] leading-relaxed text-fg-secondary"
          >
            {tree?.skeleton.skeletonText ||
              "Nenhum símbolo indexado ainda. Clique em Reindexar AST Incremental."}
          </pre>
        </section>

        <section className="min-w-0 space-y-4 overflow-hidden rounded border border-border-subtle bg-surface p-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Cpu className="size-4 text-accent" strokeWidth={1.75} />
              <h2 className="text-sm font-semibold text-fg-primary">
                Adaptadores & Context Tree
              </h2>
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {(tree?.adapters ?? []).map((ad) => (
                <div
                  key={ad.adapter}
                  className="flex items-center justify-between rounded border border-border-subtle bg-inset px-2.5 py-1.5 text-[11px]"
                >
                  <span className="font-mono text-fg-primary">{ad.adapter}</span>
                  <span
                    className={
                      ad.status === "ok"
                        ? "font-mono text-status-ok"
                        : "font-mono text-fg-muted"
                    }
                  >
                    {ad.status}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <History className="size-4 text-accent" strokeWidth={1.75} />
              <h2 className="text-sm font-semibold text-fg-primary">
                Proveniência de Decisões
              </h2>
            </div>
            {provEntries.length === 0 ? (
              <p className="rounded border border-border-subtle bg-inset px-3 py-2 text-xs text-fg-muted">
                Nenhuma proveniência registrada para este projeto ainda.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {provEntries.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-border-subtle bg-inset px-2.5 py-1.5 text-[11px]"
                  >
                    <span className="font-mono text-fg-primary">
                      {entry.filePath}
                    </span>
                    <span className="font-mono text-[10px] text-fg-muted tabular-nums">
                      Entrega {entry.deliverableId.slice(0, 8)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
