"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgencyAgentRole,
  AgencyChatIntent,
  AgencyChatResponse,
  AgencyOverviewResponse,
  Deliverable,
  DeliverableListResponse,
  DeliverableStatus,
  ProjectListResponse,
  RiskLevel,
} from "@uzina/contracts";
import { getAllowedNextStatuses } from "@uzina/core/state-machine";
import {
  ArrowLeft,
  ArrowRight,
  FileText,
  Kanban,
  Layers,
  List,
  Loader2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  ShieldCheck,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import {
  setActiveContext,
  useActiveClientId,
  useActiveProjectId,
} from "@/lib/active-project-store";
import { MarkdownProse } from "./markdown-prose";

const STAGE_COLUMNS: Array<{ id: DeliverableStatus; label: string }> = [
  { id: "discovery", label: "Descoberta" },
  { id: "spec_review", label: "Spec Review" },
  { id: "visual_studio", label: "Estúdio Visual" },
  { id: "contract_tests", label: "Contratos & TDD" },
  { id: "building", label: "Build Isolado" },
  { id: "verifying", label: "Verify & AppSec" },
  { id: "decision_pending", label: "Decisão HITL" },
  { id: "approved", label: "Aprovado" },
  { id: "merged", label: "Entregue" },
  { id: "paused", label: "Pausado" },
  { id: "failed", label: "Falhou" },
];

const STAGE_LABELS = Object.fromEntries(
  STAGE_COLUMNS.map((c) => [c.id, c.label])
) as Record<DeliverableStatus, string>;

function statusDotColor(status: DeliverableStatus): string {
  if (status === "approved" || status === "merged") return "bg-status-ok";
  if (status === "decision_pending" || status === "verifying")
    return "bg-status-warn";
  if (status === "failed") return "bg-status-danger";
  return "bg-fg-muted";
}

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

export function DeliverablesDocsHub() {
  const queryClient = useQueryClient();
  const selectedClientId = useActiveClientId();
  const storedProjectId = useActiveProjectId();
  const [localProjectId, setLocalProjectId] = useState("");

  const [mainTab, setMainTab] = useState<"slices" | "docs">(() => {
    if (typeof window !== "undefined") {
      const q = new URLSearchParams(window.location.search).get("tab");
      if (q === "docs") return "docs";
    }
    return "slices";
  });
  const [viewMode, setViewMode] = useState<"list" | "kanban">("list");
  const [selectedSliceId, setSelectedSliceId] = useState("");
  const [sliceSubTab, setSliceSubTab] = useState<
    "spec" | "blueprint" | "evidence"
  >("spec");
  const [selectedDocId, setSelectedDocId] = useState("");

  const [revisionFeedback, setRevisionFeedback] = useState("");
  const [revisionTargetAgent, setRevisionTargetAgent] =
    useState<AgencyAgentRole>("software_architect");

  const [deliverableModalOpen, setDeliverableModalOpen] = useState(false);
  const [delivTitle, setDelivTitle] = useState("");
  const [delivDesc, setDelivDesc] = useState("");
  const [delivHasUi, setDelivHasUi] = useState(true);
  const [delivRisk, setDelivRisk] = useState<RiskLevel>("medium");
  const [formError, setFormError] = useState<string | null>(null);
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => fetchJson<ProjectListResponse>("/api/projects"),
  });

  const projectsList = useMemo(
    () => projectsQuery.data?.items ?? [],
    [projectsQuery.data?.items]
  );

  const activeProject = useMemo(() => {
    if (projectsList.length === 0) return null;
    const id = localProjectId || storedProjectId;
    return projectsList.find((p) => p.id === id) ?? projectsList[0] ?? null;
  }, [projectsList, localProjectId, storedProjectId]);

  const deliverablesQuery = useQuery({
    queryKey: ["deliverables", activeProject?.id ?? "none"],
    enabled: Boolean(activeProject?.id),
    queryFn: () =>
      fetchJson<DeliverableListResponse>(
        `/api/projects/${activeProject?.id}/deliverables`
      ),
  });

  const agencyQuery = useQuery({
    queryKey: ["agency-status", selectedClientId, activeProject?.id ?? ""],
    enabled: Boolean(activeProject?.id),
    queryFn: () =>
      fetchJson<AgencyOverviewResponse>(
        `/api/agency/status?clientId=${encodeURIComponent(
          selectedClientId
        )}&projectId=${encodeURIComponent(activeProject?.id ?? "")}`
      ),
  });

  const deliverablesList = useMemo(
    () => deliverablesQuery.data?.items ?? [],
    [deliverablesQuery.data?.items]
  );

  const projectState = agencyQuery.data?.activeProjectState ?? null;
  const sliceArtifacts = projectState?.sliceArtifacts ?? [];
  const longTermArtifacts = projectState?.longTermArtifacts ?? [];

  const activeSlice =
    sliceArtifacts.find((s) => s.deliverableId === selectedSliceId) ??
    sliceArtifacts[0] ??
    null;

  const activeDoc =
    longTermArtifacts.find((d) => d.id === selectedDocId) ??
    longTermArtifacts[0] ??
    null;

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
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Falha ao atualizar estágio");
      }
      return (await res.json()) as Deliverable;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["deliverables", activeProject?.id ?? "none"],
        }),
        queryClient.invalidateQueries({ queryKey: ["agency-status"] }),
      ]);
    },
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
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Falha ao criar entrega");
      }
      return (await res.json()) as Deliverable;
    },
    onSuccess: async () => {
      setDelivTitle("");
      setDelivDesc("");
      setFormError(null);
      setDeliverableModalOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["deliverables", activeProject?.id ?? "none"],
        }),
        queryClient.invalidateQueries({ queryKey: ["agency-status"] }),
      ]);
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const agencyActionMutation = useMutation({
    mutationFn: async (payload: {
      intent: AgencyChatIntent;
      message: string;
      deliverableId?: string;
      targetAgentRole?: AgencyAgentRole;
    }) => {
      if (!activeProject) throw new Error("Nenhum projeto ativo.");
      const res = await fetch("/api/agency/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: activeProject.id,
          intent: payload.intent,
          message: payload.message,
          ...(payload.deliverableId
            ? { deliverableId: payload.deliverableId }
            : {}),
          ...(payload.targetAgentRole
            ? { targetAgentRole: payload.targetAgentRole }
            : {}),
          teamTopology: "lean_mvp",
          autonomyMode: "semi_autonomous",
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(err?.error ?? "Falha na operação do ciclo.");
      }
      return (await res.json()) as AgencyChatResponse;
    },
    onSuccess: async (data) => {
      setRevisionFeedback("");
      setBannerMsg(
        data.actionsExecuted[0]?.label ?? "Ação executada no projeto."
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["deliverables"] }),
        queryClient.invalidateQueries({ queryKey: ["agency-status"] }),
      ]);
    },
  });

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

  if (projectsQuery.isLoading) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="h-12 animate-pulse rounded-lg border border-border-subtle bg-surface" />
        <div className="h-96 animate-pulse rounded-xl border border-border-subtle bg-surface" />
      </div>
    );
  }

  if (!activeProject) {
    return (
      <div className="mx-auto max-w-xl rounded-xl border border-dashed border-border-default bg-surface p-10 text-center">
        <h1 className="text-lg font-semibold text-fg-primary">
          Sem Projeto Selecionado
        </h1>
        <p className="mt-2 text-sm text-fg-secondary">
          Crie ou selecione um projeto na tela de Ideias para visualizar entregas e documentos.
        </p>
        <Link
          href="/app/ideas"
          className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-lg bg-accent px-5 text-sm font-semibold text-accent-fg"
        >
          <span>Ir para Ideias &amp; Projetos</span>
        </Link>
      </div>
    );
  }

  return (
    <div
      data-testid="deliverables-docs-hub"
      className="mx-auto flex w-full max-w-6xl flex-col gap-5"
    >
      {/* Topo Limpo de 1 Linha */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            href={`/app?projectId=${encodeURIComponent(activeProject.id)}`}
            data-testid="back-to-chat-link"
            className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border-subtle bg-surface px-3 text-xs font-medium text-fg-secondary hover:border-border-strong hover:text-fg-primary"
          >
            <ArrowLeft className="size-3.5" strokeWidth={1.75} />
            <span>Chat</span>
          </Link>

          <label htmlFor="deliverables-project-select" className="sr-only">
            Projeto selecionado
          </label>
          <select
            id="deliverables-project-select"
            value={activeProject.id}
            onChange={(e) => {
              const id = e.target.value;
              const found = projectsList.find((p) => p.id === id);
              setLocalProjectId(id);
              setActiveContext({
                ...(found ? { clientId: found.clientId } : {}),
                projectId: id,
              });
            }}
            className="min-h-9 rounded-md border border-border-default bg-surface px-3 text-sm font-semibold text-fg-primary"
          >
            {projectsList.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <div
            role="tablist"
            aria-label="Alternar entre Entregas e Documentos"
            className="inline-flex rounded-md border border-border-default bg-inset p-0.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mainTab === "slices"}
              data-testid="tab-deliverables-slices"
              onClick={() => setMainTab("slices")}
              className={`inline-flex min-h-8 items-center gap-1.5 rounded px-3 text-xs font-medium ${
                mainTab === "slices"
                  ? "border border-border-subtle bg-surface text-fg-primary"
                  : "text-fg-secondary hover:text-fg-primary"
              }`}
            >
              <Layers className="size-3.5" />
              <span>Entregas &amp; Slices ({deliverablesList.length})</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mainTab === "docs"}
              data-testid="tab-project-docs"
              onClick={() => setMainTab("docs")}
              className={`inline-flex min-h-8 items-center gap-1.5 rounded px-3 text-xs font-medium ${
                mainTab === "docs"
                  ? "border border-border-subtle bg-surface text-fg-primary"
                  : "text-fg-secondary hover:text-fg-primary"
              }`}
            >
              <FileText className="size-3.5" />
              <span>Documentos ({longTermArtifacts.length})</span>
            </button>
          </div>
        </div>

        {mainTab === "slices" && (
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="tablist"
              aria-label="Modo de visualização das entregas"
              className="inline-flex rounded-md border border-border-default bg-inset p-0.5"
            >
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === "list"}
                data-testid="view-list"
                onClick={() => setViewMode("list")}
                className={`inline-flex min-h-8 items-center gap-1.5 rounded px-2.5 text-xs font-medium ${
                  viewMode === "list"
                    ? "border border-border-subtle bg-surface text-fg-primary"
                    : "text-fg-secondary hover:text-fg-primary"
                }`}
              >
                <List className="size-3.5" />
                <span>Lista</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === "kanban"}
                data-testid="view-kanban"
                onClick={() => setViewMode("kanban")}
                className={`inline-flex min-h-8 items-center gap-1.5 rounded px-2.5 text-xs font-medium ${
                  viewMode === "kanban"
                    ? "border border-border-subtle bg-surface text-fg-primary"
                    : "text-fg-secondary hover:text-fg-primary"
                }`}
              >
                <Kanban className="size-3.5" />
                <span>Kanban</span>
              </button>
            </div>

            <button
              type="button"
              data-testid="btn-new-deliverable"
              onClick={() => {
                setFormError(null);
                setDeliverableModalOpen(true);
              }}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border-default bg-surface px-3 text-xs font-medium text-fg-primary hover:border-border-strong"
            >
              <Plus className="size-3.5" />
              <span>Nova Entrega</span>
            </button>

            <button
              type="button"
              data-testid="btn-run-autonomous-cycle"
              disabled={agencyActionMutation.isPending}
              onClick={() =>
                agencyActionMutation.mutate({
                  intent: "advance_cycle",
                  message:
                    "Executar ciclo autônomo avançando os slices pelas fases permitidas até o próximo portão.",
                })
              }
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-xs font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-50"
            >
              {agencyActionMutation.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5" />
              )}
              <span>Executar Ciclo Autônomo</span>
            </button>
          </div>
        )}
      </header>

      {bannerMsg && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-status-ok/35 bg-status-ok/10 px-4 py-2.5 text-sm text-status-ok">
          <span>{bannerMsg}</span>
          <button
            type="button"
            onClick={() => setBannerMsg(null)}
            className="text-xs underline"
          >
            Fechar
          </button>
        </div>
      )}

      {mainTab === "docs" ? (
        /* ABA 2: Documentos de Longo Prazo — Leitor Estilo Notion/Linear (15px) */
        <div
          data-testid="long-term-docs-reader"
          className="flex flex-col gap-6 lg:flex-row"
        >
          <aside className="w-full shrink-0 space-y-2 lg:w-72">
            <p className="px-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">
              Documentos do Projeto
            </p>
            {longTermArtifacts.length === 0 ? (
              <p className="rounded-lg border border-border-subtle bg-surface p-4 text-sm text-fg-secondary">
                Nenhum documento gerado ainda.
              </p>
            ) : (
              <div className="space-y-1.5">
                {longTermArtifacts.map((doc) => {
                  const selected = activeDoc?.id === doc.id;
                  return (
                    <button
                      key={doc.id}
                      type="button"
                      data-testid={`long-term-artifact-${doc.kind}`}
                      onClick={() => setSelectedDocId(doc.id)}
                      className={`flex w-full flex-col gap-1 rounded-lg border px-3.5 py-3 text-left transition-colors ${
                        selected
                          ? "border-border-strong bg-elevated text-fg-primary"
                          : "border-border-subtle bg-surface text-fg-secondary hover:border-border-default hover:text-fg-primary"
                      }`}
                    >
                      <span className="text-sm font-medium leading-snug text-fg-primary">
                        {doc.title}
                      </span>
                      <span className="text-xs text-fg-muted">
                        Ciclo #{doc.cycleNumber} · {doc.ownerAgentName}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </aside>

          <article
            data-testid="long-term-artifact-viewer"
            className="min-w-0 flex-1 rounded-xl border border-border-subtle bg-surface p-6 sm:p-8"
          >
            {activeDoc ? (
              <div className="mx-auto max-w-3xl space-y-4">
                <div className="border-b border-border-subtle pb-4">
                  <h2 className="text-xl font-semibold tracking-tight text-fg-primary">
                    {activeDoc.title}
                  </h2>
                  <p className="mt-1 text-sm text-fg-secondary">
                    Responsável: {activeDoc.ownerAgentName} · Ciclo #
                    {activeDoc.cycleNumber}
                  </p>
                </div>
                <MarkdownProse content={activeDoc.contentMarkdown} />
              </div>
            ) : (
              <p className="py-12 text-center text-sm text-fg-muted">
                Selecione um documento ao lado para leitura.
              </p>
            )}
          </article>
        </div>
      ) : deliverablesList.length === 0 ? (
        <div
          data-testid="empty-deliverables-state"
          className="rounded-xl border border-dashed border-border-default bg-surface p-10 text-center"
        >
          <p className="text-sm font-medium text-fg-primary">
            Projeto {activeProject.name} sem entregas ainda.
          </p>
          <p className="mt-1 text-sm text-fg-secondary">
            Adicione a primeira entrega ou peça ao Arquiteto no Chat para gerar os slices.
          </p>
          <button
            type="button"
            onClick={() => {
              setFormError(null);
              setDeliverableModalOpen(true);
            }}
            className="mt-4 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border-default bg-elevated px-4 text-sm font-medium text-fg-primary"
          >
            <Plus className="size-4" />
            <span>Adicionar Entrega</span>
          </button>
        </div>
      ) : (
        /* ABA 1: Lista ou Kanban + Leitor Amplo de Slice */
        <div className="space-y-6">
          {viewMode === "kanban" ? (
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
                    className="flex w-72 shrink-0 flex-col rounded-xl border border-border-subtle bg-surface"
                  >
                    <header className="flex items-center justify-between border-b border-border-subtle px-3.5 py-2.5">
                      <span className="inline-flex items-center gap-2 text-xs font-semibold text-fg-primary">
                        <span
                          className={`size-2 rounded-full ${statusDotColor(
                            col.id
                          )}`}
                        />
                        <span>{col.label}</span>
                      </span>
                      <span className="tabular-nums font-mono text-xs text-fg-muted">
                        {colItems.length}
                      </span>
                    </header>

                    <div className="flex max-h-[420px] flex-1 flex-col gap-2.5 overflow-y-auto p-3">
                      {colItems.length === 0 ? (
                        <p className="py-6 text-center text-xs text-fg-muted">
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
                              className="space-y-2.5 rounded-lg border border-border-default bg-canvas p-3"
                            >
                              <button
                                type="button"
                                onClick={() => setSelectedSliceId(item.id)}
                                className="text-left text-sm font-medium leading-snug text-fg-primary hover:underline"
                              >
                                {item.title}
                              </button>
                              <div className="flex items-center justify-between border-t border-border-subtle pt-2 text-xs text-fg-muted">
                                <span>{item.hasUi ? "UI + API" : "API"}</span>
                                <div className="flex items-center gap-1.5">
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
                                      className="inline-flex min-h-7 items-center gap-1 rounded border border-border-default bg-surface px-2 text-xs text-fg-primary hover:border-border-strong"
                                    >
                                      <span>Avançar</span>
                                      <ArrowRight className="size-3" />
                                    </button>
                                  )}
                                  {item.status !== "paused" &&
                                    nextAllowed.includes("paused") && (
                                      <button
                                        type="button"
                                        aria-label={`Pausar ${item.title}`}
                                        disabled={transitionMutation.isPending}
                                        onClick={() =>
                                          transitionMutation.mutate({
                                            id: item.id,
                                            status: "paused",
                                          })
                                        }
                                        className="rounded border border-border-subtle p-1.5 text-fg-muted hover:text-fg-primary"
                                      >
                                        <Pause className="size-3" />
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
            /* Visão Lista Calma & Leitor de Slice */
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
              <div
                data-testid="list-board"
                className="space-y-2 lg:col-span-5"
              >
                {deliverablesList.map((item) => {
                  const isSelected = activeSlice?.deliverableId === item.id;
                  const nextAllowed = getAllowedNextStatuses(item.status, {
                    hasUi: item.hasUi,
                    pausedFromStatus: item.pausedFromStatus,
                    verifyAttempts: item.verifyAttempts,
                    maxVerifyAttempts: item.maxVerifyAttempts,
                  });
                  const primaryNext = nextAllowed.find(
                    (s) => s !== "paused" && s !== "failed"
                  );
                  return (
                    <article
                      key={item.id}
                      data-testid={`deliverable-card-${item.id}`}
                      className={`space-y-2 rounded-xl border p-4 transition-colors ${
                        isSelected
                          ? "border-border-strong bg-elevated"
                          : "border-border-subtle bg-surface hover:border-border-default"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedSliceId(item.id)}
                          className="text-left text-sm font-semibold text-fg-primary hover:underline"
                        >
                          {item.title}
                        </button>
                        <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-fg-secondary">
                          <span
                            className={`size-2 rounded-full ${statusDotColor(
                              item.status
                            )}`}
                          />
                          <span>{STAGE_LABELS[item.status]}</span>
                        </span>
                      </div>
                      {item.description && (
                        <p className="line-clamp-2 text-xs leading-relaxed text-fg-secondary">
                          {item.description}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-fg-muted">
                        <span>
                          {item.hasUi ? "UI + API" : "API/Core"} · Risco{" "}
                          {item.riskLevel}
                        </span>
                        <div className="flex items-center gap-1.5">
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
                              className="inline-flex min-h-8 items-center gap-1 rounded-md border border-border-default bg-surface px-2.5 text-xs font-medium text-fg-primary hover:border-border-strong"
                            >
                              <span>Avançar</span>
                              <ArrowRight className="size-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>

              {/* Leitor Amplo de Dossiê, Blueprint & Retorno Cíclico */}
              <div
                data-testid="slice-artifact-inspector"
                className="rounded-xl border border-border-subtle bg-surface p-5 sm:p-6 lg:col-span-7"
              >
                {activeSlice ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border-subtle pb-3">
                      <div>
                        <h2 className="text-base font-semibold text-fg-primary">
                          {activeSlice.title}
                        </h2>
                        <p className="mt-1 text-xs text-fg-secondary">
                          Estágio: {activeSlice.statusLabel} · Estratégia:{" "}
                          <span className="font-mono">
                            {activeSlice.strategy}
                          </span>{" "}
                          · Ciclo #{activeSlice.cycleNumber}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-1">
                        <button
                          type="button"
                          data-testid="slice-subtab-spec"
                          onClick={() => setSliceSubTab("spec")}
                          className={`min-h-8 rounded-md px-3 text-xs font-medium ${
                            sliceSubTab === "spec"
                              ? "border border-border-subtle bg-elevated text-fg-primary"
                              : "text-fg-secondary hover:text-fg-primary"
                          }`}
                        >
                          Dossiê (Spec)
                        </button>
                        <button
                          type="button"
                          data-testid="slice-subtab-blueprint"
                          onClick={() => setSliceSubTab("blueprint")}
                          className={`min-h-8 rounded-md px-3 text-xs font-medium ${
                            sliceSubTab === "blueprint"
                              ? "border border-border-subtle bg-elevated text-fg-primary"
                              : "text-fg-secondary hover:text-fg-primary"
                          }`}
                        >
                          Blueprint
                        </button>
                        <button
                          type="button"
                          data-testid="slice-subtab-evidence"
                          onClick={() => setSliceSubTab("evidence")}
                          className={`min-h-8 rounded-md px-3 text-xs font-medium ${
                            sliceSubTab === "evidence"
                              ? "border border-border-subtle bg-elevated text-fg-primary"
                              : "text-fg-secondary hover:text-fg-primary"
                          }`}
                        >
                          Evidências
                        </button>
                      </div>
                    </div>

                    <div className="max-h-[380px] overflow-y-auto rounded-lg border border-border-subtle bg-inset p-4 select-text">
                      {sliceSubTab === "spec" && (
                        <MarkdownProse content={activeSlice.specMarkdown} />
                      )}
                      {sliceSubTab === "blueprint" && (
                        <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-fg-primary">
                          {JSON.stringify(activeSlice.blueprintJson, null, 2)}
                        </pre>
                      )}
                      {sliceSubTab === "evidence" && (
                        <div className="space-y-3 text-sm text-fg-primary">
                          <p>{activeSlice.evidenceSummary}</p>
                          <p className="font-mono text-xs text-fg-secondary">
                            Tentativas do Verify Gate:{" "}
                            {activeSlice.verifyAttempts}/
                            {activeSlice.maxVerifyAttempts}
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="space-y-3 border-t border-border-subtle pt-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-medium text-fg-secondary">
                          Governança do Slice
                        </span>
                        <button
                          type="button"
                          data-testid="btn-approve-slice-artifact"
                          disabled={
                            agencyActionMutation.isPending ||
                            activeSlice.status === "merged"
                          }
                          onClick={() =>
                            agencyActionMutation.mutate({
                              intent: "approve_slice_artifact",
                              deliverableId: activeSlice.deliverableId,
                              message: `Aprovar artefato e avançar o slice '${activeSlice.title}'.`,
                            })
                          }
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border-default bg-elevated px-3 text-xs font-medium text-fg-primary hover:border-border-strong disabled:opacity-50"
                        >
                          <ShieldCheck className="size-3.5 text-status-ok" />
                          <span>Aprovar Artefato &amp; Avançar</span>
                        </button>
                      </div>

                      <div className="flex flex-col gap-2 sm:flex-row">
                        <select
                          aria-label="Agente para revisão em ciclo"
                          value={revisionTargetAgent}
                          onChange={(e) =>
                            setRevisionTargetAgent(
                              e.target.value as AgencyAgentRole
                            )
                          }
                          className="min-h-9 rounded-md border border-border-default bg-inset px-2.5 text-xs text-fg-primary"
                        >
                          <option value="software_architect">
                            Voltar ao Arquiteto
                          </option>
                          <option value="product_discovery">
                            Voltar ao Produto
                          </option>
                          <option value="ux_designer">Voltar ao Design</option>
                          <option value="tech_lead">
                            Voltar ao Tech Lead
                          </option>
                        </select>
                        <input
                          aria-label="Feedback de correção para retorno em ciclo"
                          value={revisionFeedback}
                          onChange={(e) => setRevisionFeedback(e.target.value)}
                          placeholder="O que ajustar ou refazer neste slice?"
                          className="min-h-9 flex-1 rounded-md border border-border-default bg-inset px-3 text-sm text-fg-primary"
                        />
                        <button
                          type="button"
                          disabled={agencyActionMutation.isPending}
                          onClick={() =>
                            agencyActionMutation.mutate({
                              intent: "request_slice_revision",
                              deliverableId: activeSlice.deliverableId,
                              targetAgentRole: revisionTargetAgent,
                              message:
                                revisionFeedback.trim() ||
                                `Revisar arquitetura e especificações do slice '${activeSlice.title}' em novo ciclo.`,
                            })
                          }
                          className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-border-default bg-surface px-3 text-xs font-medium text-fg-primary hover:border-border-strong disabled:opacity-50"
                        >
                          <RotateCcw className="size-3.5" />
                          <span>Corrigir em Ciclo</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="py-10 text-center text-sm text-fg-muted">
                    Selecione uma entrega ao lado para ler seu Dossiê e Blueprint.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

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
              <Dialog.Title className="text-base font-semibold text-fg-primary">
                Nova Entrega ({activeProject.name})
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
                  className="h-10 w-full rounded-md border border-border-default bg-inset px-3 text-sm text-fg-primary"
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
                    className="h-10 w-full rounded-md border border-border-default bg-inset px-3 text-sm text-fg-primary"
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
                    className="min-h-9 rounded-md border border-border-default px-3 text-sm text-fg-secondary"
                  >
                    Cancelar
                  </button>
                </Dialog.Close>
                <button
                  type="submit"
                  disabled={createDeliverableMutation.isPending}
                  data-testid="submit-deliverable"
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-accent px-3.5 text-sm font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-60"
                >
                  {createDeliverableMutation.isPending && (
                    <Loader2 className="size-4 animate-spin" />
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
