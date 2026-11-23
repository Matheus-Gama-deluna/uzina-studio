"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ClientListResponse,
  Deliverable,
  DeliverableListResponse,
  DeliverableStatus,
  DevelopmentStrategy,
  Project,
  ProjectListResponse,
  RiskLevel,
} from "@uzina/contracts";
import { getAllowedNextStatuses } from "@uzina/core/state-machine";
import {
  AlertCircle,
  ArrowRight,
  FolderPlus,
  Kanban,
  List,
  Loader2,
  Pause,
  Plus,
  RefreshCw,
  Sparkles,
  UserPlus,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { AgencyCommandCenter } from "./agency-command-center";

type ViewMode = "kanban" | "list";

const STAGE_COLUMNS: Array<{
  id: DeliverableStatus;
  label: string;
  tone: string;
}> = [
  { id: "discovery", label: "Descoberta", tone: "text-status-info" },
  { id: "spec_review", label: "Spec Review", tone: "text-status-info" },
  { id: "visual_studio", label: "Estúdio Visual", tone: "text-accent" },
  { id: "contract_tests", label: "Contratos & TDD", tone: "text-accent" },
  { id: "building", label: "Build Isolado", tone: "text-status-warn" },
  { id: "verifying", label: "Verify & AppSec", tone: "text-status-warn" },
  { id: "decision_pending", label: "Decisão HITL", tone: "text-accent" },
  { id: "approved", label: "Aprovado", tone: "text-status-ok" },
  { id: "merged", label: "Entregue", tone: "text-status-ok" },
  { id: "paused", label: "Pausado", tone: "text-status-neutral" },
  { id: "failed", label: "Falhou", tone: "text-status-danger" },
];

const STAGE_LABELS = Object.fromEntries(
  STAGE_COLUMNS.map((c) => [c.id, c.label])
) as Record<DeliverableStatus, string>;

const RISK_STYLES: Record<RiskLevel, string> = {
  low: "border-status-ok/35 text-status-ok bg-status-ok/10",
  medium: "border-status-warn/35 text-status-warn bg-status-warn/10",
  high: "border-status-danger/35 text-status-danger bg-status-danger/10",
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(err?.error ?? `Erro HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export function WorkspaceBoard() {
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<ViewMode>("kanban");
  const [selectedClientId, setSelectedClientId] = useState<string>("all");
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");

  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [deliverableModalOpen, setDeliverableModalOpen] = useState(false);

  const [formError, setFormError] = useState<string | null>(null);
  const [clientName, setClientName] = useState("");
  const [clientNotes, setClientNotes] = useState("");

  const [projectName, setProjectName] = useState("");
  const [projectClientId, setProjectClientId] = useState("");
  const [projectStrategy] =
    useState<DevelopmentStrategy>("frontend_first_msw");
  const [repoName, setRepoName] = useState("");
  const [repoPath, setRepoPath] = useState("");

  const [delivTitle, setDelivTitle] = useState("");
  const [delivDesc, setDelivDesc] = useState("");
  const [delivHasUi, setDelivHasUi] = useState(true);
  const [delivRisk, setDelivRisk] = useState<RiskLevel>("medium");

  const clientsQuery = useQuery({
    queryKey: ["clients"],
    queryFn: () => fetchJson<ClientListResponse>("/api/clients"),
  });

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => fetchJson<ProjectListResponse>("/api/projects"),
  });

  const clientsList = useMemo(
    () => clientsQuery.data?.items ?? [],
    [clientsQuery.data?.items]
  );
  const allProjects = useMemo(
    () => projectsQuery.data?.items ?? [],
    [projectsQuery.data?.items]
  );

  const visibleProjects = useMemo(() => {
    if (selectedClientId === "all") return allProjects;
    return allProjects.filter((p) => p.clientId === selectedClientId);
  }, [allProjects, selectedClientId]);

  const activeProject: Project | null = useMemo(() => {
    if (visibleProjects.length === 0) return null;
    const found = visibleProjects.find((p) => p.id === selectedProjectId);
    return found ?? visibleProjects[0] ?? null;
  }, [visibleProjects, selectedProjectId]);

  const deliverablesQuery = useQuery({
    queryKey: ["deliverables", activeProject?.id ?? "none"],
    enabled: Boolean(activeProject?.id),
    queryFn: () =>
      fetchJson<DeliverableListResponse>(
        `/api/projects/${activeProject?.id}/deliverables`
      ),
  });

  const deliverablesList = useMemo(
    () => deliverablesQuery.data?.items ?? [],
    [deliverablesQuery.data?.items]
  );

  const createClientMutation = useMutation({
    mutationFn: async (payload: { name: string; notes?: string }) => {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Falha ao criar cliente");
      }
      return res.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["clients"] });
      setClientName("");
      setClientNotes("");
      setFormError(null);
      setClientModalOpen(false);
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const createProjectMutation = useMutation({
    mutationFn: async (payload: {
      clientId: string;
      name: string;
      defaultDevelopmentStrategy: DevelopmentStrategy;
      repository?: { name: string; localPath: string };
    }) => {
      let resolvedClientId = payload.clientId;
      if (!resolvedClientId) {
        const cliRes = await fetch("/api/clients");
        if (cliRes.ok) {
          const cliData = (await cliRes.json()) as ClientListResponse;
          resolvedClientId = cliData.items[0]?.id ?? "";
        }
      }
      if (!resolvedClientId) {
        throw new Error("Selecione um cliente.");
      }
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...payload,
          clientId: resolvedClientId,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Falha ao criar projeto");
      }
      return (await res.json()) as Project;
    },
    onSuccess: async (created) => {
      setSelectedProjectId(created.id);
      setProjectName("");
      setRepoName("");
      setRepoPath("");
      setFormError(null);
      setProjectModalOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const createDeliverableMutation = useMutation({
    mutationFn: async (payload: {
      projectId: string;
      title: string;
      description?: string;
      hasUi: boolean;
      riskLevel: RiskLevel;
    }) => {
      const res = await fetch(`/api/projects/${payload.projectId}/deliverables`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: payload.title,
          description: payload.description,
          hasUi: payload.hasUi,
          riskLevel: payload.riskLevel,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Falha ao criar entrega");
      }
      return (await res.json()) as Deliverable;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["deliverables", activeProject?.id ?? "none"],
      });
      setDelivTitle("");
      setDelivDesc("");
      setFormError(null);
      setDeliverableModalOpen(false);
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const transitionMutation = useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: DeliverableStatus;
    }) => {
      const res = await fetch(`/api/deliverables/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Falha ao atualizar estágio");
      }
      return (await res.json()) as Deliverable;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["deliverables", activeProject?.id ?? "none"],
      });
    },
  });

  function handleCreateClient(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (clientName.trim().length < 2) {
      setFormError("Informe o nome do cliente (mínimo 2 caracteres).");
      return;
    }
    createClientMutation.mutate({
      name: clientName.trim(),
      notes: clientNotes.trim() || undefined,
    });
  }

  function handleCreateProject(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const targetClientId = projectClientId || clientsList[0]?.id || "";
    if (projectName.trim().length < 2) {
      setFormError("Informe o nome do projeto (mínimo 2 caracteres).");
      return;
    }
    const repository =
      repoName.trim() && repoPath.trim()
        ? { name: repoName.trim(), localPath: repoPath.trim() }
        : undefined;

    createProjectMutation.mutate({
      clientId: targetClientId,
      name: projectName.trim(),
      defaultDevelopmentStrategy: projectStrategy,
      repository,
    });
  }

  function handleCreateDeliverable(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!activeProject) {
      setFormError("Crie ou selecione um projeto primeiro.");
      return;
    }
    if (delivTitle.trim().length < 3) {
      setFormError("Título da entrega deve ter ao menos 3 caracteres.");
      return;
    }
    createDeliverableMutation.mutate({
      projectId: activeProject.id,
      title: delivTitle.trim(),
      description: delivDesc.trim() || undefined,
      hasUi: delivHasUi,
      riskLevel: delivRisk,
    });
  }

  const isBootLoading = clientsQuery.isLoading || projectsQuery.isLoading;
  const bootError = clientsQuery.error || projectsQuery.error;

  return (
    <div className="space-y-3">
      {/* Barra Superior Unificada & Compacta: Título + Seletores Cliente/Projeto + Ações */}
      <section className="flex flex-wrap items-center justify-between gap-2.5 border-b border-border-subtle pb-2.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-base font-semibold tracking-tight text-fg-primary">
            Torre de Controle
          </h1>

          <label htmlFor="filter-client" className="sr-only">
            Filtrar por cliente
          </label>
          <select
            id="filter-client"
            value={selectedClientId}
            onChange={(e) => setSelectedClientId(e.target.value)}
            className="h-7 rounded-md border border-border-default bg-surface px-2 py-0 text-xs text-fg-primary"
          >
            <option value="all">Todos os clientes</option>
            {clientsList.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.isDefaultInternal ? " (Padrão)" : ""}
              </option>
            ))}
          </select>

          {visibleProjects.length > 0 && (
            <>
              <label htmlFor="filter-project" className="sr-only">
                Selecionar projeto ativo
              </label>
              <select
                id="filter-project"
                value={activeProject?.id ?? ""}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="h-7 rounded-md border border-border-default bg-surface px-2 py-0 text-xs text-fg-primary"
              >
                {visibleProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </>
          )}

          {activeProject && (
            <Link
              href={`/app/projects/${activeProject.id}/studio`}
              data-testid="link-project-studio"
              className="inline-flex h-7 items-center gap-1 rounded-md border border-border-default bg-surface px-2 text-xs font-medium text-fg-primary transition-colors hover:border-border-strong"
            >
              <Sparkles className="size-3 text-accent" strokeWidth={1.75} />
              <span>Estúdio Visual &amp; Workflow</span>
            </Link>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            data-testid="btn-new-client"
            onClick={() => {
              setFormError(null);
              setClientModalOpen(true);
            }}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border-default bg-surface px-2.5 text-xs font-medium text-fg-primary transition-colors hover:border-border-strong"
          >
            <UserPlus className="size-3 text-fg-secondary" strokeWidth={1.75} />
            <span>Novo Cliente</span>
          </button>

          <button
            type="button"
            data-testid="btn-new-project"
            onClick={() => {
              setFormError(null);
              setProjectClientId(clientsList[0]?.id ?? "");
              setProjectModalOpen(true);
            }}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border-default bg-surface px-2.5 text-xs font-medium text-fg-primary transition-colors hover:border-border-strong"
          >
            <FolderPlus className="size-3 text-fg-secondary" strokeWidth={1.75} />
            <span>Novo Projeto</span>
          </button>

          <button
            type="button"
            data-testid="btn-new-deliverable"
            disabled={!activeProject}
            onClick={() => {
              setFormError(null);
              setDeliverableModalOpen(true);
            }}
            className="inline-flex h-7 items-center gap-1 rounded-md bg-accent px-2.5 text-xs font-semibold text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="size-3" strokeWidth={2} />
            <span>Nova Entrega</span>
          </button>

          <div
            role="tablist"
            aria-label="Modo de visualização"
            className="inline-flex rounded-md border border-border-default bg-inset p-0.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "kanban"}
              data-testid="view-kanban"
              onClick={() => setViewMode("kanban")}
              className={`inline-flex h-6 items-center gap-1 rounded px-2 text-xs font-medium transition-colors ${
                viewMode === "kanban"
                  ? "bg-surface text-fg-primary border border-border-subtle"
                  : "text-fg-secondary hover:text-fg-primary"
              }`}
            >
              <Kanban className="size-3" strokeWidth={1.75} />
              <span>Kanban</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "list"}
              data-testid="view-list"
              onClick={() => setViewMode("list")}
              className={`inline-flex h-6 items-center gap-1 rounded px-2 text-xs font-medium transition-colors ${
                viewMode === "list"
                  ? "bg-surface text-fg-primary border border-border-subtle"
                  : "text-fg-secondary hover:text-fg-primary"
              }`}
            >
              <List className="size-3" strokeWidth={1.75} />
              <span>Lista</span>
            </button>
          </div>
        </div>
      </section>

      {/* Central de Comando da Empresa de Engenharia: Guia de Prontidão + Equipe (Model Tiering) + Chat Multi-Agente + Inspetor de Artefatos (Longo Prazo & Slices) */}
      <AgencyCommandCenter
        selectedClientId={selectedClientId}
        activeProjectId={activeProject?.id ?? ""}
        bootReady={!isBootLoading}
        onSelectProject={(projectId) => setSelectedProjectId(projectId)}
      />

      {/* Estado 1: Loading Skeleton (CLS = 0) */}
      {isBootLoading && (
        <div
          className="grid grid-cols-1 gap-3 md:grid-cols-3"
          aria-label="Carregando quadro operacional"
        >
          {[0, 1, 2].map((idx) => (
            <div
              key={idx}
              className="h-56 animate-pulse rounded-lg border border-border-subtle bg-surface"
            />
          ))}
        </div>
      )}

      {/* Estado 2: Error State com Retry */}
      {!isBootLoading && bootError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-status-danger/40 bg-status-danger/10 p-4 text-sm text-status-danger"
        >
          <span className="flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0" strokeWidth={1.75} />
            <span>
              {(bootError as Error).message || "Falha ao carregar dados."}
            </span>
          </span>
          <button
            type="button"
            onClick={() => {
              void clientsQuery.refetch();
              void projectsQuery.refetch();
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-status-danger/40 bg-surface px-3 text-xs font-medium text-fg-primary hover:border-border-strong"
          >
            <RefreshCw className="size-3.5" strokeWidth={1.75} />
            <span>Tentar novamente</span>
          </button>
        </div>
      )}

      {/* Estado 3: Empty State — Nenhum projeto criado ainda */}
      {!isBootLoading && !bootError && !activeProject && (
        <div
          data-testid="empty-projects-state"
          className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border-default bg-surface px-6 py-14 text-center"
        >
          <FolderPlus className="mb-3 size-7 text-fg-muted" strokeWidth={1.5} />
          <h2 className="text-sm font-semibold text-fg-primary">
            Nenhum projeto cadastrado ainda
          </h2>
          <p className="mt-1 max-w-md text-xs text-fg-secondary">
            O cliente padrão <strong className="text-fg-primary">Internos</strong> já
            está pronto. Crie o primeiro projeto para organizar especificações e
            entregas.
          </p>
          <button
            type="button"
            onClick={() => {
              setFormError(null);
              setProjectClientId(clientsList[0]?.id ?? "");
              setProjectModalOpen(true);
            }}
            className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3.5 text-xs font-semibold text-accent-fg hover:bg-accent-hover"
          >
            <Plus className="size-3.5" strokeWidth={2} />
            <span>Criar Primeiro Projeto</span>
          </button>
        </div>
      )}

      {/* Conteúdo de Entregas do Projeto Ativo */}
      {!isBootLoading && !bootError && activeProject && (
        <>
          {deliverablesQuery.isLoading ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-44 animate-pulse rounded-lg border border-border-subtle bg-surface"
                />
              ))}
            </div>
          ) : deliverablesQuery.error ? (
            <div
              role="alert"
              className="flex items-center justify-between rounded-lg border border-status-danger/40 bg-status-danger/10 p-4 text-xs text-status-danger"
            >
              <span>{(deliverablesQuery.error as Error).message}</span>
              <button
                type="button"
                onClick={() => void deliverablesQuery.refetch()}
                className="rounded border border-border-default bg-surface px-2.5 py-1 text-fg-primary"
              >
                Tentar novamente
              </button>
            </div>
          ) : deliverablesList.length === 0 ? (
            <div
              data-testid="empty-deliverables-state"
              className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border-default bg-surface px-6 py-12 text-center"
            >
              <Kanban
                className="mb-3 size-7 text-fg-muted"
                strokeWidth={1.5}
              />
              <h2 className="text-sm font-semibold text-fg-primary">
                Projeto {activeProject.name} sem entregas
              </h2>
              <p className="mt-1 max-w-md text-xs text-fg-secondary">
                Adicione a primeira entrega para iniciar o ciclo SDLC na esteira.
              </p>
              <button
                type="button"
                onClick={() => {
                  setFormError(null);
                  setDeliverableModalOpen(true);
                }}
                className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3.5 text-xs font-semibold text-accent-fg hover:bg-accent-hover"
              >
                <Plus className="size-3.5" strokeWidth={2} />
                <span>Adicionar Entrega</span>
              </button>
            </div>
          ) : viewMode === "kanban" ? (
            /* Visão 1: Kanban Vivo (scroll horizontal contido em telas menores) */
            <div
              data-testid="kanban-board"
              className="flex gap-3 overflow-x-auto pb-3"
            >
              {STAGE_COLUMNS.map((col) => {
                const colItems = deliverablesList.filter(
                  (d) => d.status === col.id
                );
                return (
                  <section
                    key={col.id}
                    aria-label={`Coluna ${col.label}`}
                    className="flex w-72 shrink-0 flex-col rounded-lg border border-border-subtle bg-surface"
                  >
                    <header className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
                      <span className={`text-xs font-semibold ${col.tone}`}>
                        {col.label}
                      </span>
                      <span className="tabular-nums rounded border border-border-subtle bg-inset px-1.5 py-0.5 font-mono text-[11px] text-fg-secondary">
                        {colItems.length}
                      </span>
                    </header>

                    <div className="flex max-h-[540px] flex-1 flex-col gap-2 overflow-y-auto p-2.5">
                      {colItems.length === 0 ? (
                        <p className="py-6 text-center text-[11px] text-fg-muted">
                          Vazio
                        </p>
                      ) : (
                        colItems.map((item) => {
                          const nextAllowed = getAllowedNextStatuses(
                            item.status,
                            {
                              hasUi: item.hasUi,
                              pausedFromStatus: item.pausedFromStatus,
                              verifyAttempts: item.verifyAttempts,
                              maxVerifyAttempts: item.maxVerifyAttempts,
                            }
                          );
                          const primaryNext = nextAllowed.find(
                            (s) => s !== "paused" && s !== "failed"
                          );
                          return (
                            <article
                              key={item.id}
                              data-testid={`deliverable-card-${item.id}`}
                              className="space-y-2 rounded-md border border-border-default bg-canvas p-3 transition-colors hover:border-border-strong"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <h3 className="text-xs font-semibold leading-snug text-fg-primary">
                                  {item.title}
                                </h3>
                                <span
                                  className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${RISK_STYLES[item.riskLevel]}`}
                                >
                                  {item.riskLevel}
                                </span>
                              </div>

                              {item.description && (
                                <p className="line-clamp-2 text-[11px] text-fg-secondary">
                                  {item.description}
                                </p>
                              )}

                              <div className="flex items-center justify-between border-t border-border-subtle pt-2 text-[10px] text-fg-muted">
                                <span className="font-mono">
                                  {item.hasUi ? "UI + API" : "API/Core"}
                                </span>
                                <div className="flex items-center gap-1">
                                  {primaryNext && (
                                    <button
                                      type="button"
                                      disabled={transitionMutation.isPending}
                                      onClick={() =>
                                        transitionMutation.mutate({
                                          id: item.id,
                                          status: primaryNext,
                                        })
                                      }
                                      title={`Avançar para ${primaryNext}`}
                                      className="inline-flex items-center gap-1 rounded border border-border-default bg-surface px-1.5 py-0.5 text-[10px] font-medium text-fg-primary hover:border-accent hover:text-accent"
                                    >
                                      <span>Avançar</span>
                                      <ArrowRight
                                        className="size-2.5"
                                        strokeWidth={1.75}
                                      />
                                    </button>
                                  )}
                                  {item.status !== "paused" &&
                                    nextAllowed.includes("paused") && (
                                      <button
                                        type="button"
                                        disabled={transitionMutation.isPending}
                                        aria-label={`Pausar ${item.title}`}
                                        onClick={() =>
                                          transitionMutation.mutate({
                                            id: item.id,
                                            status: "paused",
                                          })
                                        }
                                        className="rounded border border-border-subtle p-1 text-fg-muted hover:border-border-strong hover:text-fg-primary"
                                      >
                                        <Pause
                                          className="size-2.5"
                                          strokeWidth={1.75}
                                        />
                                      </button>
                                    )}
                                </div>
                              </div>
                            </article>
                          );
                        })
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : (
            /* Visão 2: Lista Hierárquica Densa (hairline 1px + tabular-nums) */
            <div
              data-testid="list-board"
              className="overflow-x-auto rounded-lg border border-border-subtle bg-surface"
            >
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 border-b border-border-subtle bg-elevated text-[11px] uppercase tracking-wider text-fg-muted">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">Entrega</th>
                    <th className="px-3 py-2.5 font-medium">Estágio</th>
                    <th className="px-3 py-2.5 font-medium">Risco</th>
                    <th className="px-3 py-2.5 font-medium">Escopo</th>
                    <th className="px-3 py-2.5 font-medium text-right">
                      Tentativas Verify
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {deliverablesList.map((item) => (
                    <tr
                      key={item.id}
                      className="transition-colors hover:bg-elevated/60"
                    >
                      <td className="px-3 py-2.5 font-medium text-fg-primary">
                        {item.title}
                      </td>
                      <td className="px-3 py-2.5 text-fg-secondary">
                        {STAGE_LABELS[item.status]}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${RISK_STYLES[item.riskLevel]}`}
                        >
                          {item.riskLevel}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-fg-secondary">
                        {item.hasUi ? "UI + API" : "API/Core"}
                      </td>
                      <td className="tabular-nums px-3 py-2.5 text-right font-mono text-fg-secondary">
                        {item.verifyAttempts}/{item.maxVerifyAttempts}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Modal: Novo Cliente */}
      <Dialog.Root open={clientModalOpen} onOpenChange={setClientModalOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,440px)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border-default bg-surface p-5 shadow-2xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <Dialog.Title className="text-sm font-semibold text-fg-primary">
                Novo Cliente / Conta
              </Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="Fechar modal de cliente"
                  className="rounded p-1 text-fg-muted hover:text-fg-primary"
                >
                  <X className="size-4" strokeWidth={1.75} />
                </button>
              </Dialog.Close>
            </div>
            <form onSubmit={handleCreateClient} className="space-y-3">
              <div className="space-y-1">
                <label
                  htmlFor="client-name"
                  className="block text-xs font-medium text-fg-secondary"
                >
                  Nome do Cliente
                </label>
                <input
                  id="client-name"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Ex.: Fintech Horizonte"
                  className="h-9 w-full rounded-md border border-border-default bg-inset px-3 text-sm text-fg-primary"
                />
              </div>
              <div className="space-y-1">
                <label
                  htmlFor="client-notes"
                  className="block text-xs font-medium text-fg-secondary"
                >
                  Notas de Escopo (opcional)
                </label>
                <textarea
                  id="client-notes"
                  rows={2}
                  value={clientNotes}
                  onChange={(e) => setClientNotes(e.target.value)}
                  className="w-full rounded-md border border-border-default bg-inset p-2.5 text-sm text-fg-primary"
                />
              </div>
              {formError && (
                <p role="alert" className="text-xs text-status-danger">
                  {formError}
                </p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="h-8 rounded-md border border-border-default px-3 text-xs text-fg-secondary"
                  >
                    Cancelar
                  </button>
                </Dialog.Close>
                <button
                  type="submit"
                  disabled={createClientMutation.isPending}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-60"
                >
                  {createClientMutation.isPending && (
                    <Loader2 className="size-3.5 animate-spin" />
                  )}
                  <span>Salvar Cliente</span>
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Modal: Novo Projeto */}
      <Dialog.Root open={projectModalOpen} onOpenChange={setProjectModalOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,480px)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border-default bg-surface p-5 shadow-2xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <Dialog.Title className="text-sm font-semibold text-fg-primary">
                Novo Projeto
              </Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="Fechar modal de projeto"
                  className="rounded p-1 text-fg-muted hover:text-fg-primary"
                >
                  <X className="size-4" strokeWidth={1.75} />
                </button>
              </Dialog.Close>
            </div>
            <form onSubmit={handleCreateProject} className="space-y-3">
              <div className="space-y-1">
                <label
                  htmlFor="project-client"
                  className="block text-xs font-medium text-fg-secondary"
                >
                  Cliente
                </label>
                <select
                  id="project-client"
                  value={projectClientId}
                  onChange={(e) => setProjectClientId(e.target.value)}
                  className="h-9 w-full rounded-md border border-border-default bg-inset px-3 text-sm text-fg-primary"
                >
                  {clientsList.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label
                  htmlFor="project-name"
                  className="block text-xs font-medium text-fg-secondary"
                >
                  Nome do Projeto
                </label>
                <input
                  id="project-name"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="Ex.: Cockpit Operacional"
                  className="h-9 w-full rounded-md border border-border-default bg-inset px-3 text-sm text-fg-primary"
                />
              </div>
              <div className="rounded-md border border-accent/30 bg-accent-subtle/20 p-2.5 text-xs text-fg-secondary">
                <strong className="text-accent">Estratégia decidida pelo Arquiteto:</strong>{" "}
                Você não precisa escolher a estratégia técnica manualmente. O Agente Arquiteto de Software analisará a conversa do projeto e definirá a melhor estratégia para execução por IA.
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <label
                    htmlFor="repo-name"
                    className="block text-xs font-medium text-fg-secondary"
                  >
                    Repositório (opcional)
                  </label>
                  <input
                    id="repo-name"
                    value={repoName}
                    onChange={(e) => setRepoName(e.target.value)}
                    placeholder="app-web"
                    className="h-9 w-full rounded-md border border-border-default bg-inset px-3 text-sm text-fg-primary"
                  />
                </div>
                <div className="space-y-1">
                  <label
                    htmlFor="repo-path"
                    className="block text-xs font-medium text-fg-secondary"
                  >
                    Caminho Local (opcional)
                  </label>
                  <input
                    id="repo-path"
                    value={repoPath}
                    onChange={(e) => setRepoPath(e.target.value)}
                    placeholder="/repos/app-web"
                    className="h-9 w-full rounded-md border border-border-default bg-inset px-3 text-sm text-fg-primary"
                  />
                </div>
              </div>
              {formError && (
                <p role="alert" className="text-xs text-status-danger">
                  {formError}
                </p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="h-8 rounded-md border border-border-default px-3 text-xs text-fg-secondary"
                  >
                    Cancelar
                  </button>
                </Dialog.Close>
                <button
                  type="submit"
                  disabled={createProjectMutation.isPending}
                  data-testid="submit-project"
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-60"
                >
                  {createProjectMutation.isPending && (
                    <Loader2 className="size-3.5 animate-spin" />
                  )}
                  <span>Criar Projeto</span>
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Modal: Nova Entrega */}
      <Dialog.Root
        open={deliverableModalOpen}
        onOpenChange={setDeliverableModalOpen}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,460px)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border-default bg-surface p-5 shadow-2xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <Dialog.Title className="text-sm font-semibold text-fg-primary">
                Nova Entrega ({activeProject?.name ?? ""})
              </Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="Fechar modal de entrega"
                  className="rounded p-1 text-fg-muted hover:text-fg-primary"
                >
                  <X className="size-4" strokeWidth={1.75} />
                </button>
              </Dialog.Close>
            </div>
            <form onSubmit={handleCreateDeliverable} className="space-y-3">
              <div className="space-y-1">
                <label
                  htmlFor="deliv-title"
                  className="block text-xs font-medium text-fg-secondary"
                >
                  Título da Entrega
                </label>
                <input
                  id="deliv-title"
                  value={delivTitle}
                  onChange={(e) => setDelivTitle(e.target.value)}
                  placeholder="Ex.: Painel de Auditoria AppSec"
                  className="h-9 w-full rounded-md border border-border-default bg-inset px-3 text-sm text-fg-primary"
                />
              </div>
              <div className="space-y-1">
                <label
                  htmlFor="deliv-desc"
                  className="block text-xs font-medium text-fg-secondary"
                >
                  Contexto / Objetivo (opcional)
                </label>
                <textarea
                  id="deliv-desc"
                  rows={2}
                  value={delivDesc}
                  onChange={(e) => setDelivDesc(e.target.value)}
                  className="w-full rounded-md border border-border-default bg-inset p-2.5 text-sm text-fg-primary"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label
                    htmlFor="deliv-risk"
                    className="block text-xs font-medium text-fg-secondary"
                  >
                    Nível de Risco
                  </label>
                  <select
                    id="deliv-risk"
                    value={delivRisk}
                    onChange={(e) => setDelivRisk(e.target.value as RiskLevel)}
                    className="h-9 w-full rounded-md border border-border-default bg-inset px-3 text-sm text-fg-primary"
                  >
                    <option value="low">Baixo</option>
                    <option value="medium">Médio</option>
                    <option value="high">Alto</option>
                  </select>
                </div>
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 text-xs text-fg-primary">
                    <input
                      type="checkbox"
                      checked={delivHasUi}
                      onChange={(e) => setDelivHasUi(e.target.checked)}
                      className="size-4 accent-accent"
                    />
                    <span>Possui UI (Estúdio Visual)</span>
                  </label>
                </div>
              </div>
              {formError && (
                <p role="alert" className="text-xs text-status-danger">
                  {formError}
                </p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="h-8 rounded-md border border-border-default px-3 text-xs text-fg-secondary"
                  >
                    Cancelar
                  </button>
                </Dialog.Close>
                <button
                  type="submit"
                  disabled={createDeliverableMutation.isPending}
                  data-testid="submit-deliverable"
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-60"
                >
                  {createDeliverableMutation.isPending && (
                    <Loader2 className="size-3.5 animate-spin" />
                  )}
                  <span>Criar Entrega</span>
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
