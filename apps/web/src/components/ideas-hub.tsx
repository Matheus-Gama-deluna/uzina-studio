"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgencyChatIntent,
  AgencyChatResponse,
  AgencyOverviewResponse,
  ClientListResponse,
  DevelopmentStrategy,
  Project,
  ProjectListResponse,
} from "@uzina/contracts";
import {
  ArrowRight,
  FolderPlus,
  GitBranch,
  Layers,
  Lightbulb,
  Loader2,
  MessageSquare,
  Palette,
  Plus,
  Sparkles,
  UserPlus,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import {
  setActiveContext,
  useActiveClientId,
} from "@/lib/active-project-store";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(err?.error ?? `Erro HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

const INSPIRATION_CHIPS = [
  {
    label: "SaaS de Faturamento & Métricas",
    prompt:
      "Quero criar um SaaS multi-tenant de gestão financeira com dashboard de métricas, fluxo visual moderno e alertas inteligentes.",
  },
  {
    label: "Clínica & Prontuário Digital",
    prompt:
      "Construir plataforma de gestão odontológica e clínica com agenda inteligente, prontuário visual e acompanhamento de orçamentos.",
  },
  {
    label: "Portal de Auditoria & Compliance",
    prompt:
      "Criar plataforma de auditoria técnica com checklist automatizado, aprovação em portões HITL e trilha imutável de evidências.",
  },
];

export function IdeasHub({ embedded = false }: { embedded?: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const selectedClientId = useActiveClientId();

  const [originMode, setOriginMode] = useState<"greenfield" | "brownfield">(
    "greenfield"
  );
  const [ideaPrompt, setIdeaPrompt] = useState("");
  const [ideaName, setIdeaName] = useState("");
  const [gitUrl, setGitUrl] = useState("");
  const [ideaError, setIdeaError] = useState<string | null>(null);

  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [clientName, setClientName] = useState("");
  const [clientNotes, setClientNotes] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectClientId, setProjectClientId] = useState("");
  const [repoName, setRepoName] = useState("");
  const [repoPath, setRepoPath] = useState("");

  const clientsQuery = useQuery({
    queryKey: ["clients"],
    queryFn: () => fetchJson<ClientListResponse>("/api/clients"),
  });

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => fetchJson<ProjectListResponse>("/api/projects"),
  });

  const agencyOverviewQuery = useQuery({
    queryKey: ["agency-status", selectedClientId, ""],
    queryFn: () =>
      fetchJson<AgencyOverviewResponse>(
        `/api/agency/status?clientId=${encodeURIComponent(selectedClientId)}`
      ),
  });

  const clientsList = useMemo(
    () => clientsQuery.data?.items ?? [],
    [clientsQuery.data?.items]
  );
  const allProjects = useMemo(
    () => projectsQuery.data?.items ?? [],
    [projectsQuery.data?.items]
  );
  const projectStates = useMemo(
    () => agencyOverviewQuery.data?.allProjectStates ?? [],
    [agencyOverviewQuery.data?.allProjectStates]
  );

  const visibleProjects = useMemo(() => {
    if (selectedClientId === "all") return allProjects;
    return allProjects.filter((p) => p.clientId === selectedClientId);
  }, [allProjects, selectedClientId]);

  const startIdeaMutation = useMutation({
    mutationFn: async (payload: {
      message: string;
      intent: AgencyChatIntent;
      projectName?: string;
      gitUrl?: string;
    }) => {
      const res = await fetch("/api/agency/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: payload.message,
          intent: payload.intent,
          teamTopology: "lean_mvp",
          autonomyMode: "semi_autonomous",
          ...(selectedClientId !== "all" ? { clientId: selectedClientId } : {}),
          ...(payload.projectName ? { projectName: payload.projectName } : {}),
          ...(payload.gitUrl ? { gitUrl: payload.gitUrl } : {}),
          targetAgentRole:
            payload.intent === "import_git_or_repo"
              ? "software_architect"
              : "product_discovery",
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(
          err?.error ?? "Falha ao iniciar projeto com a equipe de engenharia."
        );
      }
      return (await res.json()) as AgencyChatResponse;
    },
    onSuccess: async (data, variables) => {
      const createdId = data.projectState?.projectId ?? "";
      if (createdId) {
        try {
          const initialTurns = [
            {
              id: crypto.randomUUID(),
              role: "user",
              content: variables.message,
            },
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: data.reply,
              agentName: data.activeAgent.name,
              agentRole: data.activeAgent.role,
              tierLabel: data.activeAgent.tierLabel,
              boundModelId: data.activeAgent.boundModelId,
              executionMode: data.executionMode,
              llmLatencyMs: data.llmLatencyMs,
              cycleNumber: data.cycleNumber,
              handedOffFrom: data.handedOffFrom,
              actionsExecuted: data.actionsExecuted,
            },
          ];
          window.localStorage.setItem(
            `uzina:agency-chat-turns:${createdId}`,
            JSON.stringify(initialTurns)
          );
        } catch {
          // ignore storage errors
        }
        setActiveContext({
          clientId: data.projectState?.clientId,
          projectId: createdId,
        });
      }

      setIdeaPrompt("");
      setIdeaName("");
      setGitUrl("");
      setIdeaError(null);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["deliverables"] }),
        queryClient.invalidateQueries({ queryKey: ["agency-status"] }),
      ]);

      if (createdId) {
        router.push(`/app?projectId=${encodeURIComponent(createdId)}`);
      }
    },
    onError: (err: Error) => setIdeaError(err.message),
  });

  const createClientMutation = useMutation({
    mutationFn: async (payload: { name: string; notes?: string }) => {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Falha ao criar cliente");
      }
      return res.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["clients"] });
      setClientName("");
      setClientNotes("");
      setModalError(null);
      setClientModalOpen(false);
    },
    onError: (err: Error) => setModalError(err.message),
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
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Falha ao criar projeto");
      }
      return (await res.json()) as Project;
    },
    onSuccess: async (created) => {
      setActiveContext({
        clientId: created.clientId,
        projectId: created.id,
      });
      setProjectName("");
      setRepoName("");
      setRepoPath("");
      setModalError(null);
      setProjectModalOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["agency-status"] }),
      ]);
      router.push(`/app?projectId=${encodeURIComponent(created.id)}`);
    },
    onError: (err: Error) => setModalError(err.message),
  });

  function handleIdeaSubmit(e: FormEvent) {
    e.preventDefault();
    setIdeaError(null);

    if (originMode === "brownfield") {
      if (!gitUrl.trim() && ideaPrompt.trim().length < 5) {
        setIdeaError(
          "Informe a URL do repositório Git ou descreva o projeto existente."
        );
        return;
      }
      const message =
        ideaPrompt.trim() ||
        `Importar e analisar o repositório ${gitUrl.trim()} para evolução arquitetural segura.`;
      startIdeaMutation.mutate({
        message,
        intent: "import_git_or_repo",
        projectName: ideaName.trim() || undefined,
        gitUrl: gitUrl.trim() || undefined,
      });
      return;
    }

    if (ideaPrompt.trim().length < 4 && ideaName.trim().length < 2) {
      setIdeaError("Descreva brevemente sua ideia para começarmos.");
      return;
    }

    const message =
      ideaPrompt.trim() ||
      `Criar sistema ${ideaName.trim()} com arquitetura limpa, protótipo visual e entregas estruturadas.`;

    startIdeaMutation.mutate({
      message,
      intent: "start_greenfield",
      projectName: ideaName.trim() || undefined,
    });
  }

  function handleCreateClient(e: FormEvent) {
    e.preventDefault();
    setModalError(null);
    if (clientName.trim().length < 2) {
      setModalError("Informe o nome do cliente (mínimo 2 caracteres).");
      return;
    }
    createClientMutation.mutate({
      name: clientName.trim(),
      notes: clientNotes.trim() || undefined,
    });
  }

  function handleCreateProject(e: FormEvent) {
    e.preventDefault();
    setModalError(null);
    const targetClientId = projectClientId || clientsList[0]?.id || "";
    if (projectName.trim().length < 2) {
      setModalError("Informe o nome do projeto (mínimo 2 caracteres).");
      return;
    }
    const repository =
      repoName.trim() && repoPath.trim()
        ? { name: repoName.trim(), localPath: repoPath.trim() }
        : undefined;

    createProjectMutation.mutate({
      clientId: targetClientId,
      name: projectName.trim(),
      defaultDevelopmentStrategy: "frontend_first_msw",
      repository,
    });
  }

  return (
    <div
      data-testid="ideas-hub-root"
      className={`mx-auto w-full max-w-5xl space-y-10 ${
        embedded ? "py-4" : "py-2 sm:py-4"
      }`}
    >
      {/* Bloco Central Amplo (Estilo Lovable / v0): Captura de Nova Ideia ou Repositório Git */}
      <section className="mx-auto max-w-3xl space-y-5">
        <div className="space-y-2 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-border-subtle bg-surface px-3 py-1 text-xs text-fg-secondary">
            <Lightbulb className="size-3.5 text-fg-secondary" strokeWidth={1.75} />
            <span>Estúdio de Ideias &amp; Arquitetura IA</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg-primary sm:text-3xl">
            O que vamos construir hoje?
          </h1>
          <p className="mx-auto max-w-xl text-sm leading-relaxed text-fg-secondary">
            Descreva sua ideia do zero ou conecte um repositório Git existente. O{" "}
            <strong className="font-medium text-fg-primary">
              Arquiteto de Software
            </strong>{" "}
            define a melhor estratégia, gera o protótipo visual e organiza as entregas.
          </p>
        </div>

        <form
          onSubmit={handleIdeaSubmit}
          className="space-y-4 rounded-xl border border-border-default bg-surface p-4 sm:p-6"
        >
          {/* Seletor Neutro: Ideia do Zero vs Repositório Existente */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-3">
            <div
              role="tablist"
              aria-label="Origem do projeto"
              className="inline-flex rounded-lg border border-border-subtle bg-inset p-1"
            >
              <button
                type="button"
                role="tab"
                aria-selected={originMode === "greenfield"}
                data-testid="ideas-mode-greenfield"
                onClick={() => setOriginMode("greenfield")}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-sm transition-colors ${
                  originMode === "greenfield"
                    ? "bg-surface font-medium text-fg-primary border border-border-subtle"
                    : "text-fg-secondary hover:text-fg-primary"
                }`}
              >
                <Sparkles className="size-3.5" strokeWidth={1.75} />
                <span>Nova Ideia do Zero</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={originMode === "brownfield"}
                data-testid="ideas-mode-brownfield"
                onClick={() => setOriginMode("brownfield")}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-sm transition-colors ${
                  originMode === "brownfield"
                    ? "bg-surface font-medium text-fg-primary border border-border-subtle"
                    : "text-fg-secondary hover:text-fg-primary"
                }`}
              >
                <GitBranch className="size-3.5" strokeWidth={1.75} />
                <span>Importar Repositório Git</span>
              </button>
            </div>

            <input
              aria-label="Nome sugerido do projeto (opcional)"
              data-testid="ideas-project-name"
              value={ideaName}
              onChange={(e) => setIdeaName(e.target.value)}
              placeholder="Nome do projeto (opcional)"
              className="min-h-9 w-full rounded-md border border-border-default bg-inset px-3 text-sm text-fg-primary placeholder:text-fg-muted focus:border-border-strong focus:outline-none sm:w-56"
            />
          </div>

          {originMode === "brownfield" && (
            <div className="space-y-1.5">
              <label
                htmlFor="ideas-git-url"
                className="block text-xs font-medium text-fg-secondary"
              >
                URL do Repositório Git (HTTPS)
              </label>
              <input
                id="ideas-git-url"
                data-testid="ideas-git-url"
                value={gitUrl}
                onChange={(e) => setGitUrl(e.target.value)}
                placeholder="https://github.com/sua-empresa/repositorio.git"
                className="min-h-10 w-full rounded-lg border border-border-default bg-inset px-3 font-mono text-sm text-fg-primary placeholder:text-fg-muted focus:border-border-strong focus:outline-none"
              />
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="ideas-prompt-input" className="sr-only">
              Descreva a ideia ou evolução desejada
            </label>
            <textarea
              id="ideas-prompt-input"
              data-testid="ideas-prompt-input"
              rows={4}
              value={ideaPrompt}
              onChange={(e) => setIdeaPrompt(e.target.value)}
              placeholder={
                originMode === "greenfield"
                  ? "Ex.: Quero criar uma plataforma de gestão financeira para clínicas com agenda integrada, relatórios de receita e portal do paciente..."
                  : "Explique o que o repositório faz hoje e o que precisa evoluir, refatorar ou adicionar..."
              }
              className="w-full resize-y rounded-lg border border-border-default bg-inset p-3.5 text-[15px] leading-relaxed text-fg-primary placeholder:text-fg-muted focus:border-border-strong focus:outline-none"
            />
          </div>

          {originMode === "greenfield" && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-fg-muted">Exemplos rápidos:</span>
              {INSPIRATION_CHIPS.map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  onClick={() => setIdeaPrompt(chip.prompt)}
                  className="inline-flex min-h-8 items-center rounded-full border border-border-subtle bg-inset px-3 text-xs text-fg-secondary transition-colors hover:border-border-strong hover:text-fg-primary"
                >
                  {chip.label}
                </button>
              ))}
            </div>
          )}

          {ideaError && (
            <p role="alert" className="text-sm text-status-danger">
              {ideaError}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-3">
            <span className="text-xs text-fg-muted">
              A estratégia técnica e o protótipo inicial são criados automaticamente.
            </span>

            {/* Único CTA primário destacado da página */}
            <button
              type="submit"
              data-testid="ideas-submit-btn"
              disabled={startIdeaMutation.isPending}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-accent px-5 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {startIdeaMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowRight className="size-4" strokeWidth={2} />
              )}
              <span>
                {startIdeaMutation.isPending
                  ? "Estruturando Projeto..."
                  : "Iniciar Projeto com o Arquiteto"}
              </span>
            </button>
          </div>
        </form>
      </section>

      {/* Portfólio de Projetos & Clientes (Espaçoso, neutro, sem poluição) */}
      <section className="space-y-4 border-t border-border-subtle pt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-fg-primary">
              Portfólio de Projetos ({visibleProjects.length})
            </h2>
            <p className="text-sm text-fg-secondary">
              Selecione um projeto para continuar no Chat, revisar no Estúdio Visual ou acompanhar Entregas.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="ideas-filter-client" className="sr-only">
              Filtrar por cliente
            </label>
            <select
              id="ideas-filter-client"
              value={selectedClientId}
              onChange={(e) => setActiveContext({ clientId: e.target.value })}
              className="min-h-9 rounded-md border border-border-default bg-surface px-3 text-sm text-fg-primary"
            >
              <option value="all">Todos os clientes</option>
              {clientsList.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.isDefaultInternal ? " (Padrão)" : ""}
                </option>
              ))}
            </select>

            <button
              type="button"
              data-testid="btn-new-client"
              onClick={() => {
                setModalError(null);
                setClientModalOpen(true);
              }}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border-default bg-surface px-3 text-sm text-fg-secondary transition-colors hover:border-border-strong hover:text-fg-primary"
            >
              <UserPlus className="size-4" strokeWidth={1.75} />
              <span>Novo Cliente</span>
            </button>

            <button
              type="button"
              data-testid="btn-new-project"
              onClick={() => {
                setModalError(null);
                setProjectClientId(clientsList[0]?.id ?? "");
                setProjectModalOpen(true);
              }}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border-default bg-surface px-3 text-sm text-fg-secondary transition-colors hover:border-border-strong hover:text-fg-primary"
            >
              <FolderPlus className="size-4" strokeWidth={1.75} />
              <span>Cadastro Rápido</span>
            </button>
          </div>
        </div>

        {projectsQuery.isLoading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-44 animate-pulse rounded-xl border border-border-subtle bg-surface"
              />
            ))}
          </div>
        ) : visibleProjects.length === 0 ? (
          <div
            data-testid="empty-projects-state"
            className="rounded-xl border border-dashed border-border-default bg-surface p-8 text-center"
          >
            <p className="text-sm font-medium text-fg-primary">
              Nenhum projeto criado ainda.
            </p>
            <p className="mt-1 text-sm text-fg-secondary">
              Use a caixa acima para descrever sua primeira ideia ou clique em Cadastro Rápido.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {visibleProjects.map((proj) => {
              const st = projectStates.find((s) => s.projectId === proj.id);
              const cli = clientsList.find((c) => c.id === proj.clientId);
              return (
                <article
                  key={proj.id}
                  data-testid={`project-portfolio-card-${proj.id}`}
                  className="flex flex-col justify-between gap-4 rounded-xl border border-border-subtle bg-surface p-5 transition-colors hover:border-border-strong"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2 text-xs text-fg-secondary">
                      <span className="inline-flex min-w-0 items-center gap-1.5">
                        <span className="size-1.5 shrink-0 rounded-full bg-status-ok" />
                        <span className="truncate">
                          {st?.phaseLabel ?? "Ativo"}
                        </span>
                      </span>
                      {st && (
                        <span className="shrink-0 font-mono text-fg-muted tabular-nums">
                          Ciclo #{st.cycleNumber}
                        </span>
                      )}
                    </div>

                    <div className="min-w-0">
                      <h3 className="truncate text-base font-semibold text-fg-primary">
                        {proj.name}
                      </h3>
                      <p className="mt-0.5 text-xs text-fg-muted">
                        {cli?.name ?? "Internos"}
                      </p>
                    </div>

                    {proj.description && (
                      <p className="line-clamp-2 text-sm leading-relaxed text-fg-secondary">
                        {proj.description}
                      </p>
                    )}

                    <p className="text-xs text-fg-muted">
                      Estratégia:{" "}
                      <span className="font-mono text-fg-secondary">
                        {st?.architectDecision?.strategyLabel ??
                          proj.defaultDevelopmentStrategy}
                      </span>
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-3">
                    <Link
                      href={`/app?projectId=${encodeURIComponent(proj.id)}`}
                      onClick={() =>
                        setActiveContext({
                          clientId: proj.clientId,
                          projectId: proj.id,
                        })
                      }
                      className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border-default bg-elevated px-2.5 text-xs font-medium text-fg-primary transition-colors hover:border-border-strong"
                    >
                      <MessageSquare className="size-3.5" strokeWidth={1.75} />
                      <span>Abrir Chat</span>
                    </Link>
                    <Link
                      href={`/app/studio?projectId=${encodeURIComponent(proj.id)}`}
                      onClick={() =>
                        setActiveContext({
                          clientId: proj.clientId,
                          projectId: proj.id,
                        })
                      }
                      className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border-subtle bg-inset px-2.5 text-xs text-fg-secondary transition-colors hover:text-fg-primary"
                    >
                      <Palette className="size-3.5" strokeWidth={1.75} />
                      <span>Estúdio</span>
                    </Link>
                    <Link
                      href={`/app/deliverables?projectId=${encodeURIComponent(proj.id)}`}
                      onClick={() =>
                        setActiveContext({
                          clientId: proj.clientId,
                          projectId: proj.id,
                        })
                      }
                      className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border-subtle bg-inset px-2.5 text-xs text-fg-secondary transition-colors hover:text-fg-primary"
                    >
                      <Layers className="size-3.5" strokeWidth={1.75} />
                      <span>
                        Entregas ({st?.totalDeliverables ?? 0})
                      </span>
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Modal: Novo Cliente */}
      <Dialog.Root open={clientModalOpen} onOpenChange={setClientModalOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,440px)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border-default bg-surface p-5 shadow-2xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <Dialog.Title className="text-base font-semibold text-fg-primary">
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
                  className="h-10 w-full rounded-md border border-border-default bg-inset px-3 text-sm text-fg-primary"
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
              {modalError && (
                <p role="alert" className="text-xs text-status-danger">
                  {modalError}
                </p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="min-h-9 rounded-md border border-border-default px-3 text-sm text-fg-secondary"
                  >
                    Cancelar
                  </button>
                </Dialog.Close>
                <button
                  type="submit"
                  disabled={createClientMutation.isPending}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-accent px-3.5 text-sm font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-60"
                >
                  {createClientMutation.isPending && (
                    <Loader2 className="size-4 animate-spin" />
                  )}
                  <span>Salvar Cliente</span>
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Modal: Cadastro Rápido de Projeto */}
      <Dialog.Root open={projectModalOpen} onOpenChange={setProjectModalOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,480px)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border-default bg-surface p-5 shadow-2xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <Dialog.Title className="text-base font-semibold text-fg-primary">
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
                  className="h-10 w-full rounded-md border border-border-default bg-inset px-3 text-sm text-fg-primary"
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
                  className="h-10 w-full rounded-md border border-border-default bg-inset px-3 text-sm text-fg-primary"
                />
              </div>
              <p className="rounded-md border border-border-subtle bg-inset p-3 text-xs leading-relaxed text-fg-secondary">
                A estratégia técnica ideal será decidida pelo Agente Arquiteto automaticamente ao iniciar a conversa.
              </p>
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
                    className="h-10 w-full rounded-md border border-border-default bg-inset px-3 text-sm text-fg-primary"
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
                    className="h-10 w-full rounded-md border border-border-default bg-inset px-3 text-sm text-fg-primary"
                  />
                </div>
              </div>
              {modalError && (
                <p role="alert" className="text-xs text-status-danger">
                  {modalError}
                </p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="min-h-9 rounded-md border border-border-default px-3 text-sm text-fg-secondary"
                  >
                    Cancelar
                  </button>
                </Dialog.Close>
                <button
                  type="submit"
                  disabled={createProjectMutation.isPending}
                  data-testid="submit-project"
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-accent px-3.5 text-sm font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-60"
                >
                  {createProjectMutation.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                  <span>Criar Projeto</span>
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
