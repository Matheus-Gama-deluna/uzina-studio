"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgencyAgentRole,
  AgencyChatIntent,
  AgencyChatResponse,
  AgencyOverviewResponse,
  AutonomousCycleResponse,
  BackgroundTaskListResponse,
  CleanupDeliverableWorktreeResponse,
  Deliverable,
  DeliverableListResponse,
  DeliverableStatus,
  MergeDeliverableBranchResponse,
  ProjectFinalizePolicy,
  ProjectListResponse,
  ProjectStageAutomation,
  RiskLevel,
  UpdateProjectStageAutomation,
} from "@uzina/contracts";
import { getAllowedNextStatuses } from "@uzina/core/state-machine";
import {
  Activity,
  ArrowRight,
  FileText,
  Kanban,
  Layers,
  List,
  Loader2,
  Lock,
  Pause,
  Play,
  Plus,
  RotateCcw,
  ShieldCheck,
  Square,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import {
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

type ControllableStageKey = Exclude<
  keyof ProjectStageAutomation,
  "decision_pending"
>;

const CONTROLLABLE_STAGES = new Set<string>([
  "discovery",
  "spec_review",
  "visual_studio",
  "contract_tests",
  "building",
  "verifying",
]);

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
  const [actionErrMsg, setActionErrMsg] = useState<string | null>(null);
  const [budgetDraft, setBudgetDraft] = useState<string | null>(null);
  const [budgetTokensDraft, setBudgetTokensDraft] = useState<string | null>(null);

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
    return (
      projectsList.find((p) => p.id === storedProjectId) ??
      projectsList[0] ??
      null
    );
  }, [projectsList, storedProjectId]);

  const deliverablesQuery = useQuery({
    queryKey: ["deliverables", activeProject?.id ?? "none"],
    enabled: Boolean(activeProject?.id),
    queryFn: () =>
      fetchJson<DeliverableListResponse>(
        `/api/projects/${activeProject?.id}/deliverables`
      ),
  });

  const backgroundTasksQuery = useQuery({
    queryKey: ["background-tasks", activeProject?.id ?? "none"],
    enabled: Boolean(activeProject?.id),
    queryFn: () =>
      fetchJson<BackgroundTaskListResponse>(
        `/api/projects/${activeProject?.id}/background-tasks`
      ),
    refetchInterval: (query) =>
      query.state.data?.items.some(
        (t) => t.status === "running" || t.status === "queued"
      )
        ? 4000
        : false,
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

  function selectSliceAndScroll(sliceId: string) {
    setSelectedSliceId(sliceId);
    if (typeof document !== "undefined") {
      requestAnimationFrame(() => {
        document
          .getElementById("slice-detail-panel")
          ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    }
  }

  const updateProjectConfigMutation = useMutation({
    mutationFn: async (payload: {
      stageAutomation?: UpdateProjectStageAutomation;
      budgetCapUsd?: number | null;
      budgetCapTokens?: number | null;
      finalizePolicy?: ProjectFinalizePolicy;
    }) => {
      if (!activeProject) throw new Error("Nenhum projeto ativo.");
      const res = await fetch(`/api/projects/${activeProject.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Falha ao atualizar configuração do projeto.");
      }
      return res.json();
    },
    onSuccess: async (_data, vars) => {
      setActionErrMsg(null);
      if (vars.budgetCapUsd !== undefined || vars.budgetCapTokens !== undefined) {
        setBudgetDraft(null);
        setBudgetTokensDraft(null);
        setBannerMsg(
          vars.budgetCapUsd === null && vars.budgetCapTokens === null
            ? "Tetos de orçamento do projeto removidos."
            : "Teto(s) de orçamento do projeto atualizados."
        );
      } else if (vars.finalizePolicy) {
        setBannerMsg("Política de entrega Git atualizada.");
      } else if (vars.stageAutomation) {
        setBannerMsg("Automação de fase do Kanban atualizada.");
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({
          queryKey: ["deliverables", activeProject?.id ?? "none"],
        }),
        queryClient.invalidateQueries({ queryKey: ["agency-status"] }),
      ]);
    },
    onError: (err: Error) => {
      setActionErrMsg(err.message);
    },
  });

  const autonomousCycleMutation = useMutation({
    mutationFn: async () => {
      if (!activeProject) throw new Error("Nenhum projeto ativo.");
      const res = await fetch(`/api/projects/${activeProject.id}/autonomous-cycle`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Falha ao iniciar ciclo autônomo.");
      }
      return (await res.json()) as AutonomousCycleResponse;
    },
    onSuccess: async (data) => {
      setActionErrMsg(null);
      setBannerMsg(data.message);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["background-tasks", activeProject?.id ?? "none"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["deliverables", activeProject?.id ?? "none"],
        }),
        queryClient.invalidateQueries({ queryKey: ["agency-status"] }),
      ]);
    },
    onError: (err: Error) => {
      setActionErrMsg(err.message);
    },
  });

  const mergeBranchMutation = useMutation({
    mutationFn: async (deliverableId: string) => {
      const res = await fetch(`/api/deliverables/${deliverableId}/merge`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Falha ao mesclar branch.");
      }
      return (await res.json()) as MergeDeliverableBranchResponse;
    },
    onSuccess: async (data) => {
      if (!data.ok) {
        setActionErrMsg(data.message);
      } else {
        setActionErrMsg(null);
        setBannerMsg(data.message);
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["deliverables", activeProject?.id ?? "none"],
        }),
        queryClient.invalidateQueries({ queryKey: ["agency-status"] }),
      ]);
    },
    onError: (err: Error) => {
      setActionErrMsg(err.message);
    },
  });

  const cleanupWorktreeMutation = useMutation({
    mutationFn: async (deliverableId: string) => {
      const res = await fetch(`/api/deliverables/${deliverableId}/worktree`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Falha ao limpar worktree.");
      }
      return (await res.json()) as CleanupDeliverableWorktreeResponse;
    },
    onSuccess: async (data) => {
      setActionErrMsg(null);
      setBannerMsg(data.message);
      await queryClient.invalidateQueries({
        queryKey: ["deliverables", activeProject?.id ?? "none"],
      });
    },
    onError: (err: Error) => {
      setActionErrMsg(err.message);
    },
  });

  const abortWorkflowMutation = useMutation({
    mutationFn: async (deliverableId: string) => {
      const res = await fetch(`/api/deliverables/${deliverableId}/workflow/abort`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason: "Abortado manualmente pelo operador no painel de Entregas.",
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(
          body?.error ?? "Falha ao abortar execução da entrega."
        );
      }
      return res.json();
    },
    onSuccess: async () => {
      setActionErrMsg(null);
      setBannerMsg("Execução da entrega abortada e marcada como pausada.");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["deliverables", activeProject?.id ?? "none"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["background-tasks", activeProject?.id ?? "none"],
        }),
        queryClient.invalidateQueries({ queryKey: ["agency-status"] }),
      ]);
    },
    onError: (err: Error) => {
      setActionErrMsg(err.message);
    },
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
      {/* Topo Limpo de 1 Linha (projeto controlado pelo Switcher da Sidebar) */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-base font-semibold text-fg-primary sm:text-lg">
            {activeProject.name}
          </h1>

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
              disabled={
                autonomousCycleMutation.isPending ||
                (backgroundTasksQuery.data?.items ?? []).some(
                  (t) => t.status === "running" || t.status === "queued"
                )
              }
              onClick={() => autonomousCycleMutation.mutate()}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-xs font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-50"
            >
              {autonomousCycleMutation.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5" />
              )}
              <span>Executar Ciclo Autônomo</span>
            </button>
          </div>
        )}
      </header>

      {mainTab === "slices" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-subtle bg-surface px-3.5 py-2.5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-fg-secondary">
            <span
              data-testid="project-background-tasks-badge"
              className="inline-flex min-h-7 items-center gap-1.5 rounded-md border border-border-default bg-inset px-2.5 font-mono text-xs tabular-nums text-fg-primary"
            >
              <Activity className="size-3.5 text-fg-muted" />
              <span>
                Tarefas em 2º plano:{" "}
                {
                  (backgroundTasksQuery.data?.items ?? []).filter(
                    (t) => t.status === "running" || t.status === "queued"
                  ).length
                }{" "}
                ativas / {(backgroundTasksQuery.data?.items ?? []).length} total
              </span>
            </span>
            <span className="text-fg-muted">
              Fases em Auto avançam sem bloqueio humano; Decisão HITL permanece sempre Manual.
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label
              htmlFor="project-finalize-policy-select"
              className="text-xs font-medium text-fg-secondary"
            >
              Entrega Git
            </label>
            <select
              id="project-finalize-policy-select"
              data-testid="project-finalize-policy-select"
              disabled={updateProjectConfigMutation.isPending}
              value={activeProject.finalizePolicy ?? "local_merge"}
              onChange={(e) =>
                updateProjectConfigMutation.mutate({
                  finalizePolicy: e.target.value as ProjectFinalizePolicy,
                })
              }
              className="min-h-8 rounded-md border border-border-default bg-inset px-2 text-xs text-fg-primary focus:border-border-strong focus:outline-none"
            >
              <option value="local_merge">Merge Local em main</option>
              <option value="branch_only">Somente Branch</option>
              <option value="draft_pr">Draft PR (GitHub CLI)</option>
            </select>

            <label
              htmlFor="project-budget-cap-input"
              className="text-xs font-medium text-fg-secondary"
            >
              Teto Orçamento (USD)
            </label>
            <input
              id="project-budget-cap-input"
              data-testid="project-budget-cap-input"
              type="number"
              min={0.01}
              step="0.05"
              value={
                budgetDraft ??
                (activeProject.budgetCapUsd != null
                  ? String(activeProject.budgetCapUsd)
                  : "")
              }
              onChange={(e) => setBudgetDraft(e.target.value)}
              placeholder="Sem teto"
              className="min-h-8 w-24 rounded-md border border-border-default bg-inset px-2 font-mono text-xs text-fg-primary tabular-nums placeholder:text-fg-muted focus:border-border-strong focus:outline-none"
            />

            <label
              htmlFor="project-budget-cap-tokens-input"
              className="text-xs font-medium text-fg-secondary"
            >
              Teto Tokens
            </label>
            <input
              id="project-budget-cap-tokens-input"
              data-testid="project-budget-cap-tokens-input"
              type="number"
              min={1000}
              step="1000"
              value={
                budgetTokensDraft ??
                (activeProject.budgetCapTokens != null
                  ? String(activeProject.budgetCapTokens)
                  : "")
              }
              onChange={(e) => setBudgetTokensDraft(e.target.value)}
              placeholder="Sem teto"
              className="min-h-8 w-28 rounded-md border border-border-default bg-inset px-2 font-mono text-xs text-fg-primary tabular-nums placeholder:text-fg-muted focus:border-border-strong focus:outline-none"
            />

            <button
              type="button"
              data-testid="btn-save-budget-cap"
              disabled={updateProjectConfigMutation.isPending}
              onClick={() => {
                const rawUsd = (
                  budgetDraft ??
                  (activeProject.budgetCapUsd != null
                    ? String(activeProject.budgetCapUsd)
                    : "")
                ).trim();
                const rawTok = (
                  budgetTokensDraft ??
                  (activeProject.budgetCapTokens != null
                    ? String(activeProject.budgetCapTokens)
                    : "")
                ).trim();

                let nextUsd: number | null = null;
                if (rawUsd) {
                  const num = Number(rawUsd);
                  if (!Number.isFinite(num) || num <= 0) {
                    setActionErrMsg(
                      "Informe um teto de orçamento positivo em USD."
                    );
                    return;
                  }
                  nextUsd = num;
                }

                let nextTokens: number | null = null;
                if (rawTok) {
                  const numTok = Number(rawTok);
                  if (!Number.isInteger(numTok) || numTok <= 0) {
                    setActionErrMsg(
                      "Informe um teto de tokens inteiro positivo."
                    );
                    return;
                  }
                  nextTokens = numTok;
                }

                updateProjectConfigMutation.mutate({
                  budgetCapUsd: nextUsd,
                  budgetCapTokens: nextTokens,
                });
              }}
              className="inline-flex min-h-8 items-center rounded-md border border-border-default bg-inset px-2.5 text-xs font-medium text-fg-primary hover:border-border-strong disabled:opacity-50"
            >
              Salvar Teto
            </button>
          </div>
        </div>
      )}

      {actionErrMsg && (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 rounded-lg border border-status-danger/35 bg-status-danger/10 px-4 py-2.5 text-sm text-status-danger"
        >
          <span>{actionErrMsg}</span>
          <button
            type="button"
            onClick={() => setActionErrMsg(null)}
            className="text-xs underline"
          >
            Fechar
          </button>
        </div>
      )}

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
        <div
          className={
            viewMode === "kanban"
              ? "space-y-6"
              : "grid grid-cols-1 gap-5 lg:grid-cols-12"
          }
        >
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
                    <header className="flex flex-col gap-2 border-b border-border-subtle px-3.5 py-2.5">
                      <div className="flex items-center justify-between gap-2">
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
                      </div>

                      {col.id === "decision_pending" ? (
                        <div className="flex items-center justify-between">
                          <span
                            data-testid="kanban-stage-lock-decision_pending"
                            title="Portão humano obrigatório — nunca automatizado"
                            className="inline-flex items-center gap-1.5 rounded border border-border-default bg-inset px-2 py-0.5 text-xs font-medium text-fg-secondary"
                          >
                            <Lock className="size-3" />
                            <span>Manual (HITL)</span>
                          </span>
                        </div>
                      ) : CONTROLLABLE_STAGES.has(col.id) ? (
                        (() => {
                          const stageKey = col.id as ControllableStageKey;
                          const mode =
                            activeProject.stageAutomation?.[stageKey] ??
                            "manual";
                          const isAuto = mode === "auto";
                          return (
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs text-fg-muted">
                                Avanço da fase
                              </span>
                              <button
                                type="button"
                                role="switch"
                                aria-checked={isAuto}
                                aria-label={`Automação da fase ${col.label}`}
                                data-testid={`kanban-stage-mode-${col.id}`}
                                disabled={updateProjectConfigMutation.isPending}
                                onClick={() =>
                                  updateProjectConfigMutation.mutate({
                                    stageAutomation: {
                                      [stageKey]: isAuto ? "manual" : "auto",
                                    },
                                  })
                                }
                                className={`inline-flex min-h-8 items-center gap-2 rounded-full border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 ${
                                  isAuto
                                    ? "border-border-strong bg-elevated text-fg-primary"
                                    : "border-border-default bg-inset text-fg-secondary hover:text-fg-primary"
                                }`}
                              >
                                <span
                                  aria-hidden="true"
                                  className={`size-2 rounded-full ${
                                    isAuto ? "bg-status-ok" : "bg-fg-muted"
                                  }`}
                                />
                                <span>{isAuto ? "Auto" : "Manual"}</span>
                              </button>
                            </div>
                          );
                        })()
                      ) : null}
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
                          const isCardSelected =
                            activeSlice?.deliverableId === item.id;
                          return (
                            <article
                              key={item.id}
                              data-testid={`deliverable-card-${item.id}`}
                              onClick={() => selectSliceAndScroll(item.id)}
                              className={`cursor-pointer space-y-2.5 rounded-lg border p-3 transition-colors ${
                                isCardSelected
                                  ? "border-accent/60 bg-elevated/40"
                                  : "border-border-default bg-canvas hover:border-border-strong"
                              }`}
                            >
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  selectSliceAndScroll(item.id);
                                }}
                                className="text-left text-sm font-medium leading-snug text-fg-primary hover:underline"
                              >
                                {item.title}
                              </button>
                              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle pt-2 text-xs text-fg-muted">
                                <span>{item.hasUi ? "UI + API" : "API"}</span>
                                <div className="flex items-center gap-1.5">
                                  {primaryNext && (
                                    <button
                                      type="button"
                                      disabled={transitionMutation.isPending}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        transitionMutation.mutate({
                                          id: item.id,
                                          status: primaryNext,
                                        });
                                      }}
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
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          transitionMutation.mutate({
                                            id: item.id,
                                            status: "paused",
                                          });
                                        }}
                                        className="rounded border border-border-subtle p-1.5 text-fg-muted hover:text-fg-primary"
                                      >
                                        <Pause className="size-3" />
                                      </button>
                                    )}
                                  {!["approved", "merged", "paused", "failed"].includes(
                                    item.status
                                  ) && (
                                    <button
                                      type="button"
                                      aria-label={`Abortar execução de ${item.title}`}
                                      data-testid={`btn-abort-deliverable-${item.id}`}
                                      disabled={abortWorkflowMutation.isPending}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        abortWorkflowMutation.mutate(item.id);
                                      }}
                                      className="inline-flex min-h-7 items-center gap-1 rounded border border-status-danger/35 bg-status-danger/10 px-2 text-xs font-medium text-status-danger hover:bg-status-danger/15 disabled:opacity-50"
                                    >
                                      <Square className="size-3" />
                                      <span>Abortar</span>
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
                          {!["approved", "merged", "paused", "failed"].includes(
                            item.status
                          ) && (
                            <button
                              type="button"
                              aria-label={`Abortar execução de ${item.title}`}
                              data-testid={`btn-abort-deliverable-${item.id}`}
                              disabled={abortWorkflowMutation.isPending}
                              onClick={() =>
                                abortWorkflowMutation.mutate(item.id)
                              }
                              className="inline-flex min-h-8 items-center gap-1 rounded-md border border-status-danger/35 bg-status-danger/10 px-2.5 text-xs font-medium text-status-danger hover:bg-status-danger/15 disabled:opacity-50"
                            >
                              <Square className="size-3" />
                              <span>Abortar</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
          )}

              {/* Leitor Amplo de Dossiê, Blueprint & Retorno Cíclico */}
              <div
                id="slice-detail-panel"
                data-testid="slice-artifact-inspector"
                className={`rounded-xl border border-border-subtle bg-surface p-5 sm:p-6 ${
                  viewMode === "kanban" ? "" : "lg:col-span-7"
                }`}
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
                      {sliceSubTab === "evidence" && (() => {
                        const activeDeliverable =
                          deliverablesList.find(
                            (d) => d.id === activeSlice.deliverableId
                          ) ?? null;
                        const pack = activeDeliverable?.evidencePackJson ?? null;
                        const finInfo = pack?.finalizeInfo ?? null;
                        return (
                          <div className="space-y-3 text-sm text-fg-primary">
                            <p>{activeSlice.evidenceSummary}</p>
                            <p className="font-mono text-xs text-fg-secondary tabular-nums">
                              Tentativas do Verify Gate:{" "}
                              {activeSlice.verifyAttempts}/
                              {activeSlice.maxVerifyAttempts}
                            </p>

                            {pack && (
                              <div className="space-y-2 border-t border-border-subtle pt-2.5">
                                <p className="text-xs text-fg-secondary">
                                  <strong className="text-fg-primary">
                                    Verifier ({pack.verifierVerdict}):
                                  </strong>{" "}
                                  {pack.verifierNotes}
                                </p>
                                <ul className="space-y-1">
                                  {pack.verifyChecks.map((chk) => (
                                    <li
                                      key={chk.name}
                                      className="flex flex-wrap items-center justify-between gap-2 rounded border border-border-subtle bg-surface px-2.5 py-1.5 text-xs"
                                    >
                                      <span className="font-mono">
                                        <span
                                          className={
                                            chk.passed
                                              ? "text-status-ok"
                                              : "text-status-danger"
                                          }
                                        >
                                          {chk.passed ? "PASS" : "FAIL"}
                                        </span>{" "}
                                        {chk.name}
                                      </span>
                                      <span className="text-fg-secondary">
                                        {chk.summary}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {finInfo && (
                              <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-border-subtle bg-surface px-3 py-2 text-xs">
                                <div className="space-y-0.5 font-mono text-fg-secondary">
                                  <p>
                                    Entrega Git:{" "}
                                    <strong className="text-fg-primary">
                                      {finInfo.mode === "local_merge"
                                        ? "Mesclado na base"
                                        : finInfo.mode === "draft_pr"
                                          ? "Draft PR aberta"
                                          : "Branch pronta (merge pendente)"}
                                    </strong>
                                    {finInfo.commitSha
                                      ? ` · ${finInfo.commitSha.slice(0, 7)}`
                                      : ""}
                                  </p>
                                  {finInfo.mergeBlockedReason && (
                                    <p className="text-status-warn">
                                      {finInfo.mergeBlockedReason}
                                    </p>
                                  )}
                                </div>
                                {finInfo.mode === "local_branch_ready" &&
                                  activeDeliverable?.branchName && (
                                    <button
                                      type="button"
                                      data-testid="btn-merge-deliverable-branch"
                                      disabled={mergeBranchMutation.isPending}
                                      onClick={() =>
                                        mergeBranchMutation.mutate(
                                          activeDeliverable.id
                                        )
                                      }
                                      className="inline-flex min-h-8 items-center rounded border border-accent/40 bg-accent-subtle px-2.5 text-xs font-medium text-accent hover:border-accent disabled:opacity-50"
                                    >
                                      {mergeBranchMutation.isPending
                                        ? "Mesclando..."
                                        : "Mesclar na branch base"}
                                    </button>
                                  )}
                              </div>
                            )}

                            {activeDeliverable?.worktreePath &&
                              (activeDeliverable.status === "failed" ||
                                activeDeliverable.status === "paused") && (
                                <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-border-subtle bg-surface px-3 py-2 text-xs">
                                  <span className="font-mono text-fg-secondary">
                                    Worktree preservado p/ diagnóstico
                                  </span>
                                  <button
                                    type="button"
                                    data-testid="btn-cleanup-deliverable-worktree"
                                    disabled={cleanupWorktreeMutation.isPending}
                                    onClick={() =>
                                      cleanupWorktreeMutation.mutate(
                                        activeDeliverable.id
                                      )
                                    }
                                    className="inline-flex min-h-8 items-center rounded border border-border-default bg-inset px-2.5 text-xs font-medium text-fg-primary hover:border-border-strong disabled:opacity-50"
                                  >
                                    {cleanupWorktreeMutation.isPending
                                      ? "Limpando..."
                                      : "Limpar Worktree"}
                                  </button>
                                </div>
                              )}
                          </div>
                        );
                      })()}
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
                    Selecione uma entrega para ler seu Dossiê e Blueprint.
                  </p>
                )}
              </div>
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
