"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ClientListResponse,
  Memory,
  MemoryCategory,
  MemoryListResponse,
  MemoryScope,
  ProjectListResponse,
  QmdReindexResponse,
  QmdSearchMode,
  QmdSearchResponse,
} from "@uzina/contracts";
import {
  AlertCircle,
  Brain,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  architecture: "Arquitetura",
  convention: "Convenção",
  preference: "Preferência",
  security_triage: "Triagem AppSec",
  domain_rule: "Regra de Domínio",
};

const SCOPE_LABELS: Record<MemoryScope, string> = {
  org: "Organização",
  client: "Cliente",
  project: "Projeto",
};

async function fetchMemories(params: {
  scopeType?: MemoryScope | "all";
  category?: MemoryCategory | "all";
}): Promise<MemoryListResponse> {
  const qs = new URLSearchParams();
  if (params.scopeType && params.scopeType !== "all") {
    qs.set("scopeType", params.scopeType);
  }
  if (params.category && params.category !== "all") {
    qs.set("category", params.category);
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const res = await fetch(`/api/memories${suffix}`);
  if (!res.ok) throw new Error("Falha ao listar memórias.");
  return (await res.json()) as MemoryListResponse;
}

async function fetchClients(): Promise<ClientListResponse> {
  const res = await fetch("/api/clients");
  if (!res.ok) throw new Error("Falha ao carregar clientes.");
  return (await res.json()) as ClientListResponse;
}

async function fetchProjects(): Promise<ProjectListResponse> {
  const res = await fetch("/api/projects");
  if (!res.ok) throw new Error("Falha ao carregar projetos.");
  return (await res.json()) as ProjectListResponse;
}

export function MemoriesManager() {
  const queryClient = useQueryClient();
  const [scopeFilter, setScopeFilter] = useState<MemoryScope | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<MemoryCategory | "all">(
    "all"
  );

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newScopeType, setNewScopeType] = useState<MemoryScope>("project");
  const [newScopeId, setNewScopeId] = useState("");
  const [newCategory, setNewCategory] = useState<MemoryCategory>("convention");
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackOk, setFeedbackOk] = useState<string | null>(null);

  const [qmdQuery, setQmdQuery] = useState("");
  const [qmdMode, setQmdMode] = useState<QmdSearchMode>("hybrid");
  const [qmdResult, setQmdResult] = useState<QmdSearchResponse | null>(null);

  const clientsQuery = useQuery({ queryKey: ["clients"], queryFn: fetchClients });
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: fetchProjects,
  });
  const memoriesQuery = useQuery({
    queryKey: ["memories", scopeFilter, categoryFilter],
    queryFn: () =>
      fetchMemories({ scopeType: scopeFilter, category: categoryFilter }),
  });

  const clientsList = useMemo(
    () => clientsQuery.data?.items ?? [],
    [clientsQuery.data]
  );
  const projectsList = useMemo(
    () => projectsQuery.data?.items ?? [],
    [projectsQuery.data]
  );
  const memoriesList = useMemo(
    () => memoriesQuery.data?.items ?? [],
    [memoriesQuery.data]
  );

  const orgId = clientsList[0]?.organizationId ?? "";

  const resolvedScopeId = useMemo(() => {
    if (newScopeType === "org") return orgId;
    if (newScopeType === "client") {
      return clientsList.some((c) => c.id === newScopeId)
        ? newScopeId
        : (clientsList[0]?.id ?? "");
    }
    return projectsList.some((p) => p.id === newScopeId)
      ? newScopeId
      : (projectsList[0]?.id ?? "");
  }, [newScopeType, newScopeId, orgId, clientsList, projectsList]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!resolvedScopeId) {
        throw new Error("Selecione um alvo válido para o escopo escolhido.");
      }
      const res = await fetch("/api/memories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scopeType: newScopeType,
          scopeId: resolvedScopeId,
          category: newCategory,
          title: newTitle.trim(),
          content: newContent.trim(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as
        | Memory
        | { error?: string };
      if (!res.ok) {
        throw new Error(
          "error" in data && data.error
            ? data.error
            : "Falha ao salvar memória."
        );
      }
      return data as Memory;
    },
    onSuccess: async () => {
      setFeedbackError(null);
      setFeedbackOk("Memória gravada e isolada no escopo selecionado.");
      setNewTitle("");
      setNewContent("");
      setCreateModalOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["memories"] });
    },
    onError: (err: Error) => {
      setFeedbackOk(null);
      setFeedbackError(err.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (memoryId: string) => {
      const res = await fetch(`/api/memories/${memoryId}`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? "Falha ao remover memória.");
      }
      return data;
    },
    onSuccess: async () => {
      setFeedbackError(null);
      setFeedbackOk("Memória removida.");
      await queryClient.invalidateQueries({ queryKey: ["memories"] });
    },
    onError: (err: Error) => {
      setFeedbackOk(null);
      setFeedbackError(err.message);
    },
  });

  const qmdSearchMutation = useMutation({
    mutationFn: async (payload: { query: string; mode: QmdSearchMode }) => {
      const res = await fetch("/api/memories/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as QmdSearchResponse & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Falha na busca híbrida QMD.");
      return body;
    },
    onSuccess: (data) => {
      setFeedbackError(null);
      setQmdResult(data);
    },
    onError: (err: Error) => {
      setFeedbackError(err.message);
    },
  });

  const qmdReindexMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/qmd/reindex", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ includeDocs: true, force: false }),
      });
      const body = (await res.json()) as QmdReindexResponse & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Falha ao reindexar QMD.");
      return body;
    },
    onSuccess: (data) => {
      setFeedbackError(null);
      setFeedbackOk(
        `Índice QMD atualizado: ${data.totalChunks} chunk(s) (${data.indexedMemories} memórias, ${data.indexedDocFiles} arquivos .md).`
      );
    },
    onError: (err: Error) => {
      setFeedbackError(err.message);
    },
  });

  function handleQmdSearch(e: FormEvent) {
    e.preventDefault();
    if (qmdQuery.trim().length < 2) {
      setFeedbackError("Digite ao menos 2 caracteres para buscar no QMD.");
      return;
    }
    qmdSearchMutation.mutate({ query: qmdQuery.trim(), mode: qmdMode });
  }

  function resolveScopeDisplay(mem: Memory): string {
    if (mem.scopeType === "org") return "Organização";
    if (mem.scopeType === "client") {
      return clientsList.find((c) => c.id === mem.scopeId)?.name ?? "Cliente";
    }
    return projectsList.find((p) => p.id === mem.scopeId)?.name ?? "Projeto";
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFeedbackError(null);
    setFeedbackOk(null);
    createMutation.mutate();
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header className="flex flex-col gap-3 border-b border-border-subtle pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-fg-muted">
            <Brain className="size-4 text-fg-secondary" strokeWidth={1.75} />
            <span>Contexto Persistente em 3 Escopos</span>
          </div>
          <h1 className="mt-1.5 text-xl font-semibold tracking-tight text-fg-primary">
            Memórias (Organização, Cliente e Projeto)
          </h1>
          <p className="mt-1 text-sm text-fg-secondary">
            Regras arquiteturais e convenções injetadas nos agentes com
            isolamento estrito entre clientes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-center">
          <button
            type="button"
            onClick={() => memoriesQuery.refetch()}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border-default bg-surface px-3 text-xs font-medium text-fg-secondary transition-colors hover:border-border-strong hover:text-fg-primary"
          >
            <RefreshCw className="size-3.5" strokeWidth={1.75} />
            <span>Atualizar</span>
          </button>

          <button
            type="button"
            data-testid="btn-open-new-memory"
            onClick={() => {
              setFeedbackError(null);
              setCreateModalOpen(true);
            }}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover"
          >
            <Plus className="size-4" strokeWidth={2} />
            <span>Nova Memória</span>
          </button>
        </div>
      </header>

      <Dialog.Root open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[1px]" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed left-1/2 top-1/2 z-50 w-[min(94vw,640px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border-default bg-surface p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-border-subtle pb-3">
              <Dialog.Title className="text-base font-semibold text-fg-primary">
                Registrar Nova Memória
              </Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="Fechar modal de memória"
                  className="rounded p-1.5 text-fg-muted hover:text-fg-primary"
                >
                  <X className="size-4" />
                </button>
              </Dialog.Close>
            </div>

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="mem-scope-type"
                    className="block text-xs font-medium text-fg-secondary"
                  >
                    Escopo
                  </label>
                  <select
                    id="mem-scope-type"
                    value={newScopeType}
                    onChange={(e) => {
                      setNewScopeType(e.target.value as MemoryScope);
                      setNewScopeId("");
                    }}
                    className="mt-1 min-h-9 w-full rounded-md border border-border-default bg-inset px-2.5 py-1.5 text-sm text-fg-primary focus:border-border-strong focus:outline-none"
                  >
                    <option value="project">Projeto</option>
                    <option value="client">Cliente</option>
                    <option value="org">Organização (owner/admin)</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="mem-scope-target"
                    className="block text-xs font-medium text-fg-secondary"
                  >
                    Alvo do Escopo
                  </label>
                  {newScopeType === "org" ? (
                    <input
                      id="mem-scope-target"
                      type="text"
                      readOnly
                      value="Organização atual"
                      className="mt-1 min-h-9 w-full rounded-md border border-border-subtle bg-inset px-2.5 py-1.5 text-sm text-fg-muted"
                    />
                  ) : (
                    <select
                      id="mem-scope-target"
                      value={resolvedScopeId}
                      onChange={(e) => setNewScopeId(e.target.value)}
                      className="mt-1 min-h-9 w-full rounded-md border border-border-default bg-inset px-2.5 py-1.5 text-sm text-fg-primary focus:border-border-strong focus:outline-none"
                    >
                      {newScopeType === "client"
                        ? clientsList.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))
                        : projectsList.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                    </select>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="mem-category"
                    className="block text-xs font-medium text-fg-secondary"
                  >
                    Categoria
                  </label>
                  <select
                    id="mem-category"
                    value={newCategory}
                    onChange={(e) =>
                      setNewCategory(e.target.value as MemoryCategory)
                    }
                    className="mt-1 min-h-9 w-full rounded-md border border-border-default bg-inset px-2.5 py-1.5 text-sm text-fg-primary focus:border-border-strong focus:outline-none"
                  >
                    {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="mem-title"
                    className="block text-xs font-medium text-fg-secondary"
                  >
                    Título
                  </label>
                  <input
                    id="mem-title"
                    type="text"
                    required
                    minLength={2}
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="Ex.: Padrão de resposta REST"
                    className="mt-1 min-h-9 w-full rounded-md border border-border-default bg-inset px-2.5 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-border-strong focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="mem-content"
                  className="block text-xs font-medium text-fg-secondary"
                >
                  Conteúdo da memória
                </label>
                <textarea
                  id="mem-content"
                  rows={4}
                  required
                  minLength={3}
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  placeholder="Descreva a convenção, decisão arquitetural ou regra de domínio..."
                  className="mt-1 w-full rounded-md border border-border-default bg-inset px-3 py-2 text-sm leading-relaxed text-fg-primary placeholder:text-fg-muted focus:border-border-strong focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 border-t border-border-subtle pt-3">
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="min-h-9 rounded-md border border-border-default bg-surface px-3.5 text-xs font-medium text-fg-secondary hover:text-fg-primary"
                  >
                    Cancelar
                  </button>
                </Dialog.Close>
                <button
                  type="submit"
                  disabled={createMutation.isPending || !resolvedScopeId}
                  className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-50"
                >
                  {createMutation.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                  <span>Salvar Memória</span>
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {feedbackError && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg border border-status-error/40 bg-status-error/10 px-4 py-2.5 text-xs text-status-error"
        >
          <AlertCircle className="size-4 shrink-0" />
          <span>{feedbackError}</span>
        </div>
      )}

      {feedbackOk && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-status-ok/40 bg-status-ok/10 px-4 py-2.5 text-xs text-status-ok"
        >
          <CheckCircle2 className="size-4 shrink-0" />
          <span>{feedbackOk}</span>
        </div>
      )}

      <section className="uzina-card space-y-3 rounded-xl border border-border-subtle bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-fg-primary">
              <Sparkles className="size-4 text-fg-secondary" strokeWidth={1.75} />
              <span>Busca Híbrida QMD (BM25 + Vetor 384d + RRF)</span>
            </div>
            <p className="mt-0.5 text-xs text-fg-secondary">
              Consulta bilíngue PT-BR / EN sobre memórias e documentos Markdown
              indexados (`.uzina/`, `docs/`).
            </p>
          </div>
          <button
            type="button"
            data-testid="qmd-reindex-btn"
            disabled={qmdReindexMutation.isPending}
            onClick={() => qmdReindexMutation.mutate()}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border-default bg-elevated px-3 text-xs font-medium text-fg-secondary transition-colors hover:border-border-strong hover:text-fg-primary disabled:opacity-50"
          >
            {qmdReindexMutation.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            <span>Reindexar Docs &amp; Memórias</span>
          </button>
        </div>

        <form onSubmit={handleQmdSearch} className="flex flex-wrap gap-2">
          <input
            type="text"
            data-testid="qmd-search-input"
            value={qmdQuery}
            onChange={(e) => setQmdQuery(e.target.value)}
            placeholder="Buscar regra, decisão ou identificador (ex.: VAULT_WRITE_ROLES, isolamento de clientes)..."
            aria-label="Consulta QMD"
            className="min-h-10 min-w-[240px] flex-1 rounded-lg border border-border-default bg-inset px-3.5 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-border-strong focus:outline-none"
          />
          <select
            data-testid="qmd-search-mode"
            aria-label="Modo de busca QMD"
            value={qmdMode}
            onChange={(e) => setQmdMode(e.target.value as QmdSearchMode)}
            className="min-h-10 rounded-lg border border-border-default bg-inset px-3 text-xs text-fg-primary focus:border-border-strong focus:outline-none"
          >
            <option value="hybrid">Híbrido (RRF)</option>
            <option value="lexical">Léxico (BM25)</option>
            <option value="vector">Semântico (384d)</option>
          </select>
          <button
            type="submit"
            data-testid="qmd-search-submit"
            disabled={qmdSearchMutation.isPending}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border-default bg-elevated px-4 text-sm font-medium text-fg-primary transition-colors hover:border-border-strong disabled:opacity-50"
          >
            {qmdSearchMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Search className="size-4" />
            )}
            <span>Buscar QMD</span>
          </button>
        </form>

        {qmdResult && (
          <div className="space-y-2.5 border-t border-border-subtle pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
              <span className="font-mono tabular-nums">
                {qmdResult.hits.length} resultado(s) de {qmdResult.totalCandidates}{" "}
                chunks · modelo: {qmdResult.embeddingModel}
              </span>
              <div className="flex flex-wrap gap-1">
                {qmdResult.contextTree.map((node) => (
                  <span
                    key={node.directory}
                    className="rounded border border-border-subtle bg-inset px-2 py-0.5 font-mono text-xs text-fg-secondary tabular-nums"
                  >
                    {node.directory} ({node.chunkCount})
                  </span>
                ))}
              </div>
            </div>

            {qmdResult.hits.length === 0 ? (
              <p className="text-sm text-fg-secondary">
                Nenhum trecho relevante encontrado no índice QMD.
              </p>
            ) : (
              <div className="space-y-2">
                {qmdResult.hits.map((hit) => (
                  <div
                    key={hit.id}
                    data-testid="qmd-hit-card"
                    className="rounded-lg border border-border-subtle bg-inset p-3.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium text-fg-primary">
                        {hit.headingPath}
                      </span>
                      <span className="font-mono text-xs text-fg-secondary tabular-nums">
                        RRF {hit.scores.rrf.toFixed(4)} · BM25{" "}
                        {hit.scores.bm25.toFixed(2)} · Vec{" "}
                        {hit.scores.vector.toFixed(2)}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-xs text-fg-muted tabular-nums">
                      {hit.sourcePath
                        ? `${hit.sourcePath}#L${hit.lineStart}-L${hit.lineEnd}`
                        : `memory:${hit.scopeType}#L${hit.lineStart}-L${hit.lineEnd}`}
                    </p>
                    <p className="mt-1.5 text-sm leading-relaxed text-fg-secondary">
                      {hit.snippet}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {(["all", "org", "client", "project"] as const).map((sc) => (
            <button
              key={sc}
              type="button"
              onClick={() => setScopeFilter(sc)}
              className={`min-h-8 rounded-md border px-3 text-xs font-medium transition-colors ${
                scopeFilter === sc
                  ? "border-border-strong bg-elevated text-fg-primary"
                  : "border-border-subtle bg-surface text-fg-secondary hover:bg-elevated/60"
              }`}
            >
              {sc === "all" ? "Todos Escopos" : SCOPE_LABELS[sc]}
            </button>
          ))}
        </div>

        <select
          aria-label="Filtrar por categoria"
          value={categoryFilter}
          onChange={(e) =>
            setCategoryFilter(e.target.value as MemoryCategory | "all")
          }
          className="min-h-8 rounded-md border border-border-default bg-surface px-3 text-xs text-fg-primary focus:border-border-strong focus:outline-none"
        >
          <option value="all">Todas Categorias</option>
          {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {memoriesQuery.isLoading ? (
        <div className="space-y-2" aria-label="Carregando memórias">
          <div className="h-24 animate-pulse rounded-xl border border-border-subtle bg-surface" />
          <div className="h-24 animate-pulse rounded-xl border border-border-subtle bg-surface" />
        </div>
      ) : memoriesList.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border-default bg-surface px-6 py-12 text-center">
          <Brain className="size-8 text-fg-muted" strokeWidth={1.5} />
          <h2 className="mt-3 text-base font-medium text-fg-primary">
            Nenhuma memória cadastrada neste filtro
          </h2>
          <p className="mt-1 max-w-md text-sm text-fg-secondary">
            Clique em Nova Memória no topo para registrar convenções de código,
            preferências ou regras arquiteturais.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {memoriesList.map((mem) => (
            <article
              key={mem.id}
              className="uzina-card flex flex-col justify-between rounded-xl border border-border-subtle bg-surface p-5"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-elevated px-2 py-0.5 text-xs font-medium text-fg-primary">
                      <span className="size-1.5 rounded-full bg-status-info" />
                      <span>{SCOPE_LABELS[mem.scopeType]}</span>
                    </span>
                    <span className="rounded-md border border-border-subtle bg-inset px-2 py-0.5 text-xs text-fg-secondary">
                      {CATEGORY_LABELS[mem.category]}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate(mem.id)}
                    aria-label={`Remover memória ${mem.title}`}
                    className="rounded-md border border-border-subtle p-1.5 text-fg-muted transition-colors hover:border-status-danger/40 hover:text-status-danger disabled:opacity-50"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>

                <h2 className="mt-3 text-sm font-semibold text-fg-primary">
                  {mem.title}
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-fg-secondary">
                  {mem.content}
                </p>
              </div>

              <p className="mt-3 border-t border-border-subtle pt-2.5 text-xs text-fg-muted tabular-nums">
                {resolveScopeDisplay(mem)} ·{" "}
                {new Date(mem.updatedAt).toLocaleString("pt-BR")}
              </p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
