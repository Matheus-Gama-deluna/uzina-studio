"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ClientListResponse,
  Memory,
  MemoryCategory,
  MemoryListResponse,
  MemoryScope,
  ProjectListResponse,
} from "@uzina/contracts";
import {
  AlertCircle,
  Brain,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
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

  const [newScopeType, setNewScopeType] = useState<MemoryScope>("project");
  const [newScopeId, setNewScopeId] = useState("");
  const [newCategory, setNewCategory] = useState<MemoryCategory>("convention");
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackOk, setFeedbackOk] = useState<string | null>(null);

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

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFeedbackError(null);
    setFeedbackOk(null);
    createMutation.mutate();
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 border-b border-border-subtle pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-fg-muted">
            <Brain className="size-3.5 text-accent" strokeWidth={1.75} />
            <span>Contexto Persistente em 3 Escopos</span>
          </div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-fg-primary">
            Memórias (Organização, Cliente e Projeto)
          </h1>
          <p className="mt-0.5 text-sm text-fg-secondary">
            Regras arquiteturais e convenções injetadas nos agentes com
            isolamento estrito entre clientes.
          </p>
        </div>

        <button
          type="button"
          onClick={() => memoriesQuery.refetch()}
          className="inline-flex items-center gap-1.5 self-start rounded-md border border-border-default bg-surface px-3 py-1.5 text-xs font-medium text-fg-secondary hover:bg-elevated hover:text-fg-primary"
        >
          <RefreshCw className="size-3.5" strokeWidth={1.75} />
          <span>Atualizar</span>
        </button>
      </header>

      <form
        onSubmit={handleSubmit}
        className="space-y-3 rounded-lg border border-border-subtle bg-surface p-4"
      >
        <div className="grid gap-3 sm:grid-cols-4">
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
              className="mt-1 w-full rounded-md border border-border-default bg-inset px-2.5 py-1.5 text-sm text-fg-primary focus:border-accent focus:outline-none"
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
                className="mt-1 w-full rounded-md border border-border-subtle bg-inset px-2.5 py-1.5 text-sm text-fg-muted"
              />
            ) : (
              <select
                id="mem-scope-target"
                value={resolvedScopeId}
                onChange={(e) => setNewScopeId(e.target.value)}
                className="mt-1 w-full rounded-md border border-border-default bg-inset px-2.5 py-1.5 text-sm text-fg-primary focus:border-accent focus:outline-none"
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
              onChange={(e) => setNewCategory(e.target.value as MemoryCategory)}
              className="mt-1 w-full rounded-md border border-border-default bg-inset px-2.5 py-1.5 text-sm text-fg-primary focus:border-accent focus:outline-none"
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
              className="mt-1 w-full rounded-md border border-border-default bg-inset px-2.5 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-accent focus:outline-none"
            />
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label
              htmlFor="mem-content"
              className="block text-xs font-medium text-fg-secondary"
            >
              Conteúdo da memória
            </label>
            <textarea
              id="mem-content"
              rows={2}
              required
              minLength={3}
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="Descreva a convenção, decisão arquitetural ou regra de domínio..."
              className="mt-1 w-full rounded-md border border-border-default bg-inset px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-accent focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={createMutation.isPending || !resolvedScopeId}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md bg-accent px-4 text-xs font-semibold text-base transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {createMutation.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}
            <span>Salvar Memória</span>
          </button>
        </div>
      </form>

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

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {(["all", "org", "client", "project"] as const).map((sc) => (
            <button
              key={sc}
              type="button"
              onClick={() => setScopeFilter(sc)}
              className={`rounded-md border px-3 py-1 text-xs font-medium transition-colors ${
                scopeFilter === sc
                  ? "border-accent bg-accent-subtle text-accent"
                  : "border-border-default bg-surface text-fg-secondary hover:bg-elevated"
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
          className="rounded-md border border-border-default bg-surface px-2.5 py-1 text-xs text-fg-secondary focus:border-accent focus:outline-none"
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
          <div className="h-20 animate-pulse rounded-lg border border-border-subtle bg-surface" />
          <div className="h-20 animate-pulse rounded-lg border border-border-subtle bg-surface" />
        </div>
      ) : memoriesList.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border-default bg-surface px-6 py-12 text-center">
          <Brain className="size-8 text-fg-muted" strokeWidth={1.5} />
          <h2 className="mt-3 text-sm font-medium text-fg-primary">
            Nenhuma memória cadastrada neste filtro
          </h2>
          <p className="mt-1 max-w-md text-xs text-fg-secondary">
            Adicione convenções de código, preferências de cliente ou lições de
            entregas concluídas acima.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {memoriesList.map((mem) => (
            <article
              key={mem.id}
              className="flex flex-col justify-between rounded-lg border border-border-subtle bg-surface p-4"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="rounded border border-border-default bg-inset px-2 py-0.5 font-mono text-[10px] uppercase text-accent">
                      {SCOPE_LABELS[mem.scopeType]}
                    </span>
                    <span className="rounded border border-border-subtle bg-inset px-2 py-0.5 text-[11px] text-fg-secondary">
                      {CATEGORY_LABELS[mem.category]}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate(mem.id)}
                    aria-label={`Remover memória ${mem.title}`}
                    className="rounded border border-border-subtle p-1 text-fg-muted hover:border-status-error/40 hover:text-status-error disabled:opacity-50"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>

                <h2 className="mt-2 text-sm font-semibold text-fg-primary">
                  {mem.title}
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-fg-secondary">
                  {mem.content}
                </p>
              </div>

              <p className="mt-3 font-mono text-[10px] text-fg-muted tabular-nums">
                Escopo ID: {mem.scopeId} •{" "}
                {new Date(mem.updatedAt).toLocaleString("pt-BR")}
              </p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
