"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgencyActionExecuted,
  AgencyAgentRole,
  AgencyChatIntent,
  AgencyChatResponse,
  AgencyOverviewResponse,
  AutonomyMode,
  TeamTopologyMode,
} from "@uzina/contracts";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  FileText,
  Layers,
  Lightbulb,
  Loader2,
  Palette,
  Play,
  RotateCcw,
  Send,
  Settings2,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  useMemo,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { setActiveContext } from "@/lib/active-project-store";
import { IdeasHub } from "./ideas-hub";
import { MarkdownProse } from "./markdown-prose";

const emptySubscribe = () => () => {};

interface ChatTurnItem {
  id: string;
  role: "user" | "assistant";
  content: string;
  agentName?: string;
  agentRole?: AgencyAgentRole;
  tierLabel?: string;
  boundModelId?: string;
  executionMode?: "live_llm" | "local_assisted";
  llmLatencyMs?: number | null;
  cycleNumber?: number;
  handedOffFrom?: AgencyAgentRole | null;
  actionsExecuted?: AgencyActionExecuted[];
}

const INITIAL_GREETING_TURN: ChatTurnItem = {
  id: "initial-greeting",
  role: "assistant",
  agentName: "Equipe de Engenharia Uzina",
  agentRole: "orchestrator",
  tierLabel: "Raciocínio & Planejamento",
  cycleNumber: 1,
  content:
    "Converse diretamente com o especialista responsável por este projeto. Você pode refinar requisitos, pedir ajustes no **Protótipo Visual**, revisar a estratégia com o **Arquiteto** ou avançar os **Slices**.",
};

const AUTONOMY_LABELS: Record<AutonomyMode, string> = {
  guided: "Guiado (Passo a Passo)",
  semi_autonomous: "Semi-Autônomo (Pausa nos Portões)",
  full_autonomous: "Contínuo (Ciclo Completo)",
};

export function AgencyCommandCenter({
  selectedClientId,
  activeProjectId,
  bootReady = true,
  hasAnyProjects = true,
  onSelectProject,
  availableProjects = [],
}: {
  selectedClientId: string;
  activeProjectId: string;
  bootReady?: boolean;
  hasAnyProjects?: boolean;
  onSelectProject: (projectId: string) => void;
  availableProjects?: Array<{ id: string; name: string; clientId: string }>;
}) {
  const queryClient = useQueryClient();

  const isHydrated = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [teamTopology, setTeamTopology] =
    useState<TeamTopologyMode>("lean_mvp");
  const [autonomyMode, setAutonomyMode] =
    useState<AutonomyMode>("semi_autonomous");
  const [selectedAgentRole, setSelectedAgentRole] = useState<
    AgencyAgentRole | "auto"
  >("auto");
  const [chatInput, setChatInput] = useState("");

  const storageKey = useMemo(
    () => `uzina:agency-chat-turns:${activeProjectId || "global"}`,
    [activeProjectId]
  );

  const [turnsByKey, setTurnsByKey] = useState<Record<string, ChatTurnItem[]>>(
    {}
  );

  const chatTurns = useMemo<ChatTurnItem[]>(() => {
    const inMemory = turnsByKey[storageKey];
    if (inMemory && inMemory.length > 0) {
      return inMemory;
    }
    if (isHydrated && typeof window !== "undefined") {
      try {
        const saved = window.localStorage.getItem(storageKey);
        if (saved) {
          const parsed = JSON.parse(saved) as ChatTurnItem[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed;
          }
        }
      } catch {
        // ignore storage errors
      }
    }
    return [INITIAL_GREETING_TURN];
  }, [turnsByKey, storageKey, isHydrated]);

  function persistTurns(nextTurns: ChatTurnItem[], targetProjectId?: string) {
    const key = `uzina:agency-chat-turns:${
      targetProjectId || activeProjectId || "global"
    }`;
    setTurnsByKey((prev) => ({
      ...prev,
      [storageKey]: nextTurns,
      [key]: nextTurns,
    }));
    try {
      window.localStorage.setItem(key, JSON.stringify(nextTurns.slice(-30)));
    } catch {
      // ignore storage errors
    }
  }

  const statusUrl = `/api/agency/status?clientId=${encodeURIComponent(
    selectedClientId
  )}&projectId=${encodeURIComponent(activeProjectId)}`;

  const agencyQuery = useQuery({
    queryKey: ["agency-status", selectedClientId, activeProjectId],
    enabled: bootReady,
    queryFn: async () => {
      const res = await fetch(statusUrl);
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(err?.error ?? `Erro HTTP ${res.status}`);
      }
      return (await res.json()) as AgencyOverviewResponse;
    },
  });

  const chatMutation = useMutation({
    mutationFn: async (payload: {
      message: string;
      intent: AgencyChatIntent;
      projectId?: string;
      targetAgentRole?: AgencyAgentRole;
    }) => {
      const res = await fetch("/api/agency/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: payload.message,
          intent: payload.intent,
          teamTopology,
          autonomyMode,
          ...(selectedClientId !== "all" ? { clientId: selectedClientId } : {}),
          ...(payload.projectId ? { projectId: payload.projectId } : {}),
          ...(payload.targetAgentRole
            ? { targetAgentRole: payload.targetAgentRole }
            : {}),
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(err?.error ?? "Falha ao executar turno com agente.");
      }
      return (await res.json()) as AgencyChatResponse;
    },
    onSuccess: async (data, variables) => {
      const resolvedProjId = data.projectState?.projectId ?? activeProjectId;
      const updatedTurns: ChatTurnItem[] = [
        ...chatTurns,
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
      persistTurns(updatedTurns, resolvedProjId);

      if (resolvedProjId && resolvedProjId !== activeProjectId) {
        onSelectProject(resolvedProjId);
      }

      setChatInput("");

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["deliverables"] }),
        queryClient.invalidateQueries({ queryKey: ["agency-status"] }),
      ]);
    },
  });

  const readiness = agencyQuery.data?.readiness;
  const allAgents = agencyQuery.data?.agents ?? [];
  const visibleAgents =
    teamTopology === "lean_mvp"
      ? allAgents.filter((a) => a.includedInLeanTeam)
      : allAgents;
  const projectState = agencyQuery.data?.activeProjectState ?? null;
  const visualFlow = projectState?.visualFlow ?? null;
  const architectDecision = projectState?.architectDecision ?? null;

  const quickPrompts = useMemo(
    () => [
      {
        label: "Revisar Estratégia",
        prompt:
          "Arquiteto, revise a estratégia de desenvolvimento atual e detalhe os próximos contratos Zod e testes necessários.",
      },
      {
        label: "Ajustar Protótipo",
        prompt:
          "Designer, ajuste o protótipo visual para melhorar a hierarquia das telas e indicadores principais.",
      },
      {
        label: "Avançar Ciclo",
        prompt:
          "Executar ciclo autônomo avançando os slices pelas fases permitidas até o próximo portão.",
      },
    ],
    []
  );

  // Se o boot terminou e não há nenhum projeto cadastrado ainda, exibe diretamente a tela ampla de Ideias & Novo Projeto (Decisão A2)
  if (bootReady && !hasAnyProjects && !projectState) {
    return <IdeasHub embedded />;
  }

  function submitCurrentChat() {
    const trimmedMsg = chatInput.trim();
    if (!trimmedMsg) return;

    const chosenRole =
      selectedAgentRole === "auto" ? undefined : selectedAgentRole;

    chatMutation.mutate({
      message: trimmedMsg,
      intent: "general_chat",
      projectId: projectState?.projectId,
      targetAgentRole: chosenRole,
    });
  }

  function handleSendChat(e: FormEvent) {
    e.preventDefault();
    submitCurrentChat();
  }

  function handleTextareaKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitCurrentChat();
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      {/* Barra de Contexto Minimalista (1 linha neutra, zero poluição laranja) */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          {availableProjects.length > 0 ? (
            <>
              <label htmlFor="chat-project-select" className="sr-only">
                Projeto ativo
              </label>
              <select
                id="chat-project-select"
                data-testid="chat-project-select"
                value={projectState?.projectId ?? activeProjectId}
                onChange={(e) => {
                  const id = e.target.value;
                  const proj = availableProjects.find((p) => p.id === id);
                  setActiveContext({
                    ...(proj ? { clientId: proj.clientId } : {}),
                    projectId: id,
                  });
                  onSelectProject(id);
                }}
                className="min-h-9 rounded-md border border-border-default bg-surface px-3 text-sm font-semibold text-fg-primary focus:border-border-strong focus:outline-none"
              >
                {availableProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <h1 className="text-lg font-semibold text-fg-primary">
              Chat da Engenharia
            </h1>
          )}

          {projectState && (
            <span
              data-testid="project-cycle-badge"
              className="inline-flex items-center gap-2 text-sm text-fg-secondary"
            >
              <span className="size-1.5 rounded-full bg-fg-muted" />
              <span className="tabular-nums">
                Ciclo #{projectState.cycleNumber} · {projectState.phaseLabel}
              </span>
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/app/providers"
            data-testid="llm-execution-mode-badge"
            className="inline-flex min-h-9 items-center gap-2 rounded-md border border-border-subtle bg-surface px-3 text-xs font-medium text-fg-secondary transition-colors hover:border-border-strong hover:text-fg-primary"
          >
            <span
              className={`size-2 rounded-full ${
                readiness?.llmProviderConfigured
                  ? "bg-status-ok"
                  : "bg-status-warn"
              }`}
            />
            <span>
              {readiness?.llmProviderConfigured
                ? `LLM Real (${readiness.activeProviderNames.join(", ")})`
                : "Modo Simulado Local"}
            </span>
          </Link>

          <Link
            href="/app/ideas"
            data-testid="btn-new-idea-shortcut"
            className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border-subtle bg-surface px-3 text-xs font-medium text-fg-secondary transition-colors hover:border-border-strong hover:text-fg-primary"
          >
            <Lightbulb className="size-3.5" strokeWidth={1.75} />
            <span className="hidden sm:inline">Nova Ideia</span>
          </Link>

          <button
            type="button"
            data-testid="toggle-session-settings-btn"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((prev) => !prev)}
            className={`inline-flex min-h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors ${
              settingsOpen
                ? "border-border-strong bg-elevated text-fg-primary"
                : "border-border-subtle bg-surface text-fg-secondary hover:border-border-strong hover:text-fg-primary"
            }`}
          >
            <Settings2 className="size-3.5" strokeWidth={1.75} />
            <span>Configurações</span>
          </button>
        </div>
      </header>

      {/* Painel Discreto & Retrátil de Configurações da Sessão (Equipe, Autonomia, Setup & Estratégia do Arquiteto) */}
      {settingsOpen && (
        <section
          data-testid="session-settings-panel"
          className="space-y-4 rounded-xl border border-border-default bg-surface p-4 sm:p-5"
        >
          <div className="flex items-center justify-between border-b border-border-subtle pb-2.5">
            <h2 className="text-sm font-semibold text-fg-primary">
              Configurações da Sessão &amp; Orquestração
            </h2>
            <button
              type="button"
              onClick={() => setSettingsOpen(false)}
              aria-label="Fechar configurações da sessão"
              className="rounded p-1 text-fg-muted hover:text-fg-primary"
            >
              <X className="size-4" strokeWidth={1.75} />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Topologia da Equipe */}
            <div className="space-y-1.5">
              <span className="block text-xs font-medium text-fg-secondary">
                Topologia da Equipe Visível
              </span>
              <div
                role="group"
                aria-label="Topologia da equipe de agentes"
                data-testid="team-topology-toggle"
                className="inline-flex w-full rounded-md border border-border-default bg-inset p-1"
              >
                <button
                  type="button"
                  data-testid="topology-lean-mvp"
                  onClick={() => setTeamTopology("lean_mvp")}
                  className={`inline-flex min-h-8 flex-1 items-center justify-center gap-1.5 rounded px-2.5 text-xs font-medium ${
                    teamTopology === "lean_mvp"
                      ? "border border-border-subtle bg-surface text-fg-primary"
                      : "text-fg-secondary hover:text-fg-primary"
                  }`}
                >
                  <Sparkles className="size-3.5" />
                  <span>Equipe Enxuta (3)</span>
                </button>
                <button
                  type="button"
                  data-testid="topology-full-enterprise"
                  onClick={() => setTeamTopology("full_enterprise")}
                  className={`inline-flex min-h-8 flex-1 items-center justify-center gap-1.5 rounded px-2.5 text-xs font-medium ${
                    teamTopology === "full_enterprise"
                      ? "border border-border-subtle bg-surface text-fg-primary"
                      : "text-fg-secondary hover:text-fg-primary"
                  }`}
                >
                  <Users className="size-3.5" />
                  <span>Completa (6)</span>
                </button>
              </div>
            </div>

            {/* Modo de Autonomia */}
            <div className="space-y-1.5">
              <label
                htmlFor="autonomy-mode-select"
                className="block text-xs font-medium text-fg-secondary"
              >
                Modo de Autonomia do Ciclo
              </label>
              <select
                id="autonomy-mode-select"
                data-testid="autonomy-mode-select"
                value={autonomyMode}
                onChange={(e) =>
                  setAutonomyMode(e.target.value as AutonomyMode)
                }
                className="min-h-10 w-full rounded-md border border-border-default bg-inset px-3 text-sm text-fg-primary"
              >
                {(Object.keys(AUTONOMY_LABELS) as AutonomyMode[]).map((m) => (
                  <option key={m} value={m}>
                    {AUTONOMY_LABELS[m]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Estratégia do Arquiteto & Ações de Ciclo */}
          {projectState && (
            <div
              data-testid="architect-strategy-banner"
              className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-inset p-3.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="space-y-1">
                <p className="text-xs font-medium text-fg-secondary">
                  Estratégia definida pelo Arquiteto:{" "}
                  <strong className="font-mono text-fg-primary">
                    {architectDecision?.strategyLabel ??
                      projectState.defaultStrategy}
                  </strong>
                </p>
                {architectDecision?.rationale && (
                  <p className="text-xs leading-relaxed text-fg-muted">
                    {architectDecision.rationale}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-testid="btn-run-autonomous-cycle"
                  disabled={chatMutation.isPending}
                  onClick={() =>
                    chatMutation.mutate({
                      message:
                        "Executar ciclo autônomo avançando os slices pelas fases permitidas até o próximo portão visual ou HITL.",
                      intent: "advance_cycle",
                      projectId: projectState.projectId,
                    })
                  }
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border-default bg-surface px-3 text-xs font-medium text-fg-primary hover:border-border-strong disabled:opacity-50"
                >
                  <Play className="size-3.5" />
                  <span>Executar Ciclo Autônomo</span>
                </button>
                <button
                  type="button"
                  data-testid="btn-cycle-architect"
                  disabled={chatMutation.isPending}
                  onClick={() =>
                    chatMutation.mutate({
                      message:
                        "Iniciar novo ciclo evolutivo com o Agente Arquiteto para reavaliar a arquitetura e atualizar os artefatos.",
                      intent: "revisit_architecture",
                      projectId: projectState.projectId,
                      targetAgentRole: "software_architect",
                    })
                  }
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border-subtle bg-surface px-3 text-xs text-fg-secondary hover:text-fg-primary disabled:opacity-50"
                >
                  <RotateCcw className="size-3.5" />
                  <span>Ciclo #{projectState.cycleNumber + 1}</span>
                </button>
              </div>
            </div>
          )}

          {/* Setup & Prontidão Compacto */}
          {readiness && (
            <div className="grid grid-cols-1 gap-2.5 border-t border-border-subtle pt-3 md:grid-cols-3">
              {readiness.steps.map((step) => (
                <Link
                  key={step.id}
                  href={step.id === "first_project_chat" ? "/app/ideas" : step.actionHref}
                  className="flex flex-col justify-between rounded-lg border border-border-subtle bg-inset p-3 transition-colors hover:border-border-strong"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-medium text-fg-primary">
                      {step.title}
                    </span>
                    <span
                      className={`mt-1 size-2 shrink-0 rounded-full ${
                        step.completed ? "bg-status-ok" : "bg-status-warn"
                      }`}
                    />
                  </div>
                  <span className="mt-2 font-mono text-xs text-fg-muted">
                    {step.statusBadge}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Feed Amplo & Confortável de Mensagens (15px, leading-7, zero poluição visual) */}
      <section
        data-testid="agency-chat-panel"
        className="flex flex-col rounded-xl border border-border-subtle bg-surface"
      >
        <div
          data-testid="agency-chat-history"
          className="min-h-[340px] max-h-[calc(100vh-22rem)] space-y-4 overflow-y-auto p-4 sm:p-6 select-text"
        >
          {chatTurns.map((turn) => {
            const hasPrototypeAction = turn.actionsExecuted?.some(
              (a) =>
                a.type === "generated_visual_prototype" ||
                a.type === "approved_visual_flow"
            );
            const hasSlicesAction = turn.actionsExecuted?.some(
              (a) =>
                a.type === "created_deliverables_wave" ||
                a.type === "advanced_deliverable_stage" ||
                a.type === "approved_slice_artifact" ||
                a.type === "revised_slice_artifact"
            );

            return (
              <article
                key={turn.id}
                className={
                  turn.role === "user"
                    ? "ml-auto max-w-[85%] rounded-xl border border-border-default bg-elevated px-4 py-3 text-fg-primary"
                    : "space-y-3 border-b border-border-subtle/70 pb-5 last:border-b-0 last:pb-1"
                }
              >
                {turn.role === "assistant" && (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Bot
                        className="size-4 text-fg-secondary"
                        strokeWidth={1.75}
                      />
                      <span className="text-sm font-semibold text-fg-primary">
                        {turn.agentName ?? "Equipe Uzina"}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                      {turn.cycleNumber && (
                        <span className="tabular-nums">
                          Ciclo #{turn.cycleNumber}
                        </span>
                      )}
                      <span>·</span>
                      {turn.executionMode === "live_llm" ||
                      readiness?.llmProviderConfigured ? (
                        <span className="inline-flex items-center gap-1.5 text-fg-secondary">
                          <span className="size-1.5 rounded-full bg-status-ok" />
                          <span>{turn.boundModelId ?? "LLM Real"}</span>
                          {turn.llmLatencyMs ? (
                            <span className="tabular-nums">
                              ({turn.llmLatencyMs}ms)
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span>Modo Assistido Local</span>
                      )}
                    </div>
                  </div>
                )}

                <MarkdownProse content={turn.content} />

                {/* Cartões Inline estilo Claude Artifacts (ligando o Chat diretamente ao Estúdio e às Entregas) */}
                {(hasPrototypeAction || hasSlicesAction) && projectState && (
                  <div className="grid grid-cols-1 gap-2.5 pt-1 sm:grid-cols-2">
                    {hasPrototypeAction && (
                      <Link
                        href={`/app/studio?projectId=${encodeURIComponent(
                          projectState.projectId
                        )}`}
                        data-testid="inline-artifact-studio-card"
                        className="flex items-center justify-between gap-3 rounded-lg border border-border-default bg-inset px-4 py-3 transition-colors hover:border-border-strong"
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <Palette
                            className="size-4 shrink-0 text-fg-secondary"
                            strokeWidth={1.75}
                          />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-fg-primary">
                              Protótipo Visual Pronto
                            </p>
                            <p className="truncate text-xs text-fg-muted">
                              Abrir em tela cheia para revisar
                            </p>
                          </div>
                        </div>
                        <ArrowRight className="size-4 shrink-0 text-fg-muted" />
                      </Link>
                    )}

                    {hasSlicesAction && (
                      <Link
                        href={`/app/deliverables?projectId=${encodeURIComponent(
                          projectState.projectId
                        )}`}
                        data-testid="inline-artifact-deliverables-card"
                        className="flex items-center justify-between gap-3 rounded-lg border border-border-default bg-inset px-4 py-3 transition-colors hover:border-border-strong"
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <Layers
                            className="size-4 shrink-0 text-fg-secondary"
                            strokeWidth={1.75}
                          />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-fg-primary">
                              Entregas &amp; Documentos ({projectState.totalDeliverables})
                            </p>
                            <p className="truncate text-xs text-fg-muted">
                              Ver Slices, Kanban e PRD
                            </p>
                          </div>
                        </div>
                        <ArrowRight className="size-4 shrink-0 text-fg-muted" />
                      </Link>
                    )}
                  </div>
                )}

                {turn.actionsExecuted && turn.actionsExecuted.length > 0 && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs text-fg-muted">
                    {turn.actionsExecuted.map((act, idx) => (
                      <span
                        key={`${turn.id}-act-${idx}`}
                        data-testid={`agent-action-${act.type}`}
                        className="inline-flex items-center gap-1.5"
                      >
                        <CheckCircle2 className="size-3.5 shrink-0 text-status-ok" />
                        <span>{act.label}</span>
                      </span>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>

        {/* Faixa Discreta de Atalhos do Projeto + Seletor de Especialista + Composer Limpo */}
        <form
          onSubmit={handleSendChat}
          className="space-y-3 border-t border-border-subtle bg-inset/50 p-4 sm:px-6"
        >
          {/* Atalhos diretos para os outros momentos do projeto */}
          {projectState && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-secondary">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/app/studio?projectId=${encodeURIComponent(
                    projectState.projectId
                  )}`}
                  data-testid="chat-footer-open-studio"
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border-subtle bg-surface px-2.5 text-xs text-fg-secondary transition-colors hover:border-border-strong hover:text-fg-primary"
                >
                  <Palette className="size-3.5" strokeWidth={1.75} />
                  <span>
                    Estúdio Visual{" "}
                    {visualFlow?.approvedForCodeHandoff
                      ? "(Aprovado)"
                      : "(Revisar)"}
                  </span>
                </Link>
                <Link
                  href={`/app/deliverables?projectId=${encodeURIComponent(
                    projectState.projectId
                  )}`}
                  data-testid="chat-footer-open-deliverables"
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border-subtle bg-surface px-2.5 text-xs text-fg-secondary transition-colors hover:border-border-strong hover:text-fg-primary"
                >
                  <Layers className="size-3.5" strokeWidth={1.75} />
                  <span>
                    Entregas ({projectState.sliceArtifacts.length})
                  </span>
                </Link>
                <Link
                  href={`/app/deliverables?projectId=${encodeURIComponent(
                    projectState.projectId
                  )}&tab=docs`}
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border-subtle bg-surface px-2.5 text-xs text-fg-secondary transition-colors hover:border-border-strong hover:text-fg-primary"
                >
                  <FileText className="size-3.5" strokeWidth={1.75} />
                  <span>Docs ({projectState.longTermArtifacts.length})</span>
                </Link>
              </div>

              {chatTurns.length > 1 && (
                <button
                  type="button"
                  data-testid="btn-clear-chat-history"
                  onClick={() => persistTurns([INITIAL_GREETING_TURN])}
                  className="inline-flex min-h-8 items-center gap-1 rounded px-2 text-xs text-fg-muted hover:text-fg-primary"
                >
                  <Trash2 className="size-3.5" />
                  <span>Limpar conversa</span>
                </button>
              )}
            </div>
          )}

          {/* Caixa de Texto Confortável + Sugestões Discretas */}
          <div className="space-y-2">
            <label htmlFor="agency-chat-input" className="sr-only">
              Mensagem para o Agente Responsável
            </label>
            <textarea
              id="agency-chat-input"
              data-testid="agency-chat-input"
              rows={2}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={handleTextareaKeyDown}
              placeholder="Converse com o agente responsável, peça ajustes visuais ou novos slices (Enter envia · Shift+Enter quebra linha)..."
              className="w-full resize-y rounded-lg border border-border-default bg-inset p-3.5 text-[15px] leading-relaxed text-fg-primary placeholder:text-fg-muted focus:border-border-strong focus:outline-none"
            />

            <div className="flex flex-wrap items-center justify-between gap-2.5">
              {/* Esquerda: Seletor Discreto de Agente + Chips Neutros */}
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="select-chat-agent" className="sr-only">
                  Especialista respondendo
                </label>
                <select
                  id="select-chat-agent"
                  data-testid="select-chat-agent"
                  value={selectedAgentRole}
                  onChange={(e) =>
                    setSelectedAgentRole(
                      e.target.value as AgencyAgentRole | "auto"
                    )
                  }
                  className="min-h-9 rounded-md border border-border-default bg-surface px-2.5 text-xs font-medium text-fg-primary"
                >
                  <option value="auto">
                    Agente: Automático ({projectState?.activeAgentName ?? "Pela Fase"})
                  </option>
                  {visibleAgents.map((ag) => (
                    <option key={ag.role} value={ag.role}>
                      {teamTopology === "lean_mvp" && ag.leanDisplayName
                        ? ag.leanDisplayName
                        : ag.name}
                    </option>
                  ))}
                </select>

                <div
                  data-testid="quick-prompts-bar"
                  className="hidden flex-wrap items-center gap-1.5 sm:flex"
                >
                  {quickPrompts.map((qp, idx) => (
                    <button
                      key={idx}
                      type="button"
                      data-testid={`quick-prompt-chip-${idx}`}
                      onClick={() => setChatInput(qp.prompt)}
                      className="inline-flex min-h-8 items-center rounded-full border border-border-subtle bg-surface px-2.5 text-xs text-fg-secondary transition-colors hover:border-border-strong hover:text-fg-primary"
                    >
                      {qp.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Direita: Único CTA Primário da Tela */}
              <button
                type="submit"
                data-testid="agency-chat-submit"
                disabled={chatMutation.isPending}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-accent px-5 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-50"
              >
                {chatMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                <span>Enviar Mensagem</span>
              </button>
            </div>
          </div>

          {chatMutation.error && (
            <p role="alert" className="text-sm text-status-danger">
              {(chatMutation.error as Error).message}
            </p>
          )}
        </form>
      </section>
    </div>
  );
}
