"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgencyActionExecuted,
  AgencyAgentRole,
  AgencyChatIntent,
  AgencyChatResponse,
  AgencyOverviewResponse,
  AutonomyMode,
  DevelopmentStrategy,
} from "@uzina/contracts";
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cpu,
  FileCode2,
  FileText,
  GitBranch,
  Layers,
  Loader2,
  Play,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";

interface ChatTurnItem {
  id: string;
  role: "user" | "assistant";
  content: string;
  agentName?: string;
  agentRole?: AgencyAgentRole;
  tierLabel?: string;
  boundModelId?: string;
  cycleNumber?: number;
  handedOffFrom?: AgencyAgentRole | null;
  actionsExecuted?: AgencyActionExecuted[];
}

const AUTONOMY_LABELS: Record<
  AutonomyMode,
  { label: string; hint: string }
> = {
  guided: {
    label: "Guiado (Passo a Passo)",
    hint: "Avança 1 fase por vez mediante seu comando.",
  },
  semi_autonomous: {
    label: "Semi-Autônomo (Recomendado)",
    hint: "Avança fases técnicas sozinho e pausa nos Portões HITL.",
  },
  full_autonomous: {
    label: "Autônomo Contínuo",
    hint: "Percorre toda a esteira até os portões obrigatórios e prepara o próximo ciclo.",
  },
};

export function AgencyCommandCenter({
  selectedClientId,
  activeProjectId,
  bootReady = true,
  onSelectProject,
}: {
  selectedClientId: string;
  activeProjectId: string;
  bootReady?: boolean;
  onSelectProject: (projectId: string) => void;
}) {
  const queryClient = useQueryClient();

  const [guideCollapsed, setGuideCollapsed] = useState(false);
  const [autonomyMode, setAutonomyMode] =
    useState<AutonomyMode>("semi_autonomous");
  const [selectedAgentRole, setSelectedAgentRole] = useState<
    AgencyAgentRole | "auto"
  >("auto");

  const [chatMode, setChatMode] = useState<
    "conversation" | "greenfield" | "brownfield"
  >("conversation");
  const [chatInput, setChatInput] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [gitUrlInput, setGitUrlInput] = useState("");
  const [localPathInput, setLocalPathInput] = useState("");
  const [preferredStrategy, setPreferredStrategy] =
    useState<DevelopmentStrategy>("frontend_first_msw");

  const [artifactTab, setArtifactTab] = useState<"long_term" | "slices">(
    "slices"
  );
  const [selectedLongTermId, setSelectedLongTermId] = useState<string>("");
  const [selectedSliceId, setSelectedSliceId] = useState<string>("");
  const [sliceSubTab, setSliceSubTab] = useState<
    "spec" | "blueprint" | "evidence"
  >("spec");
  const [revisionFeedback, setRevisionFeedback] = useState("");
  const [revisionTargetAgent, setRevisionTargetAgent] =
    useState<AgencyAgentRole>("software_architect");

  const [chatTurns, setChatTurns] = useState<ChatTurnItem[]>([
    {
      id: "initial-greeting",
      role: "assistant",
      agentName: "Supervisor Executivo",
      agentRole: "orchestrator",
      tierLabel: "Tier 3 · Raciocínio & Planejamento (Pro)",
      boundModelId: "google/gemini-2.5-pro",
      cycleNumber: 1,
      content:
        "Bem-vindo à Central de Comando da sua Empresa de Engenharia de Software. Você não precisa criar entregas manualmente: escolha iniciar um Sistema do Zero (com o Agente de Descoberta), enviar uma URL do Git existente (com o Agente Arquiteto) ou conversar com o Agente Responsável pelo momento atual do projeto.",
    },
  ]);

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
      deliverableId?: string;
      targetAgentRole?: AgencyAgentRole;
      projectName?: string;
      gitUrl?: string;
      localPath?: string;
      preferredStrategy?: DevelopmentStrategy;
    }) => {
      const res = await fetch("/api/agency/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: payload.message,
          intent: payload.intent,
          autonomyMode,
          ...(selectedClientId !== "all" ? { clientId: selectedClientId } : {}),
          ...(payload.projectId ? { projectId: payload.projectId } : {}),
          ...(payload.deliverableId
            ? { deliverableId: payload.deliverableId }
            : {}),
          ...(payload.targetAgentRole
            ? { targetAgentRole: payload.targetAgentRole }
            : {}),
          ...(payload.projectName ? { projectName: payload.projectName } : {}),
          ...(payload.gitUrl ? { gitUrl: payload.gitUrl } : {}),
          ...(payload.localPath ? { localPath: payload.localPath } : {}),
          ...(payload.preferredStrategy
            ? { preferredStrategy: payload.preferredStrategy }
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
      setChatTurns((prev) => [
        ...prev,
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
          cycleNumber: data.cycleNumber,
          handedOffFrom: data.handedOffFrom,
          actionsExecuted: data.actionsExecuted,
        },
      ]);

      if (
        data.projectState?.projectId &&
        data.projectState.projectId !== activeProjectId
      ) {
        onSelectProject(data.projectState.projectId);
      }

      setChatInput("");
      setNewProjectName("");
      setGitUrlInput("");
      setLocalPathInput("");
      setRevisionFeedback("");
      setChatMode("conversation");

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["deliverables"] }),
        queryClient.invalidateQueries({ queryKey: ["agency-status"] }),
      ]);
    },
  });

  const readiness = agencyQuery.data?.readiness;
  const agents = agencyQuery.data?.agents ?? [];
  const projectState = agencyQuery.data?.activeProjectState ?? null;

  const longTermArtifacts = projectState?.longTermArtifacts ?? [];
  const activeLongTerm =
    longTermArtifacts.find((a) => a.id === selectedLongTermId) ??
    longTermArtifacts[0] ??
    null;

  const sliceArtifacts = projectState?.sliceArtifacts ?? [];
  const activeSlice =
    sliceArtifacts.find((s) => s.deliverableId === selectedSliceId) ??
    sliceArtifacts[0] ??
    null;

  function handleSendChat(e: FormEvent) {
    e.preventDefault();
    const trimmedMsg = chatInput.trim();
    if (!trimmedMsg && chatMode === "conversation") return;

    const chosenRole =
      selectedAgentRole === "auto" ? undefined : selectedAgentRole;

    if (chatMode === "greenfield") {
      const prompt =
        trimmedMsg ||
        `Criar sistema ${newProjectName.trim() || "Novo Produto"} com arquitetura modular, contratos Zod e interface responsiva.`;
      chatMutation.mutate({
        message: prompt,
        intent: "start_greenfield",
        projectName: newProjectName.trim() || undefined,
        preferredStrategy,
        targetAgentRole: "product_discovery",
      });
      return;
    }

    if (chatMode === "brownfield") {
      const prompt =
        trimmedMsg ||
        `Importar e analisar repositório ${gitUrlInput.trim() || localPathInput.trim() || "existente"} para evolução arquitetural.`;
      chatMutation.mutate({
        message: prompt,
        intent: "import_git_or_repo",
        projectName: newProjectName.trim() || undefined,
        gitUrl: gitUrlInput.trim() || undefined,
        localPath: localPathInput.trim() || undefined,
        preferredStrategy: "characterization_strangler",
        targetAgentRole: "software_architect",
      });
      return;
    }

    chatMutation.mutate({
      message: trimmedMsg,
      intent: "general_chat",
      projectId: projectState?.projectId,
      targetAgentRole: chosenRole,
    });
  }

  return (
    <div className="space-y-4">
      {/* 1. Guia Interativo de Prontidão & Setup Inicial */}
      <section
        data-testid="onboarding-readiness-guide"
        className="rounded-lg border border-border-default bg-surface p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent-subtle px-2.5 py-1 font-mono text-xs font-semibold text-accent">
              <Sparkles className="size-3.5" strokeWidth={1.75} />
              <span>
                Guia de Prontidão ·{" "}
                <strong className="tabular-nums">
                  {readiness?.readinessPercent ?? 33}%
                </strong>
              </span>
            </span>
            <div>
              <h2 className="text-sm font-semibold text-fg-primary">
                Configuração &amp; Caminho Ideal de Uso da Fábrica
              </h2>
              <p className="text-xs text-fg-secondary">
                {readiness?.recommendedNextAction ??
                  "Verificando prontidão de provedores LLM, motores QMD/AST e projetos..."}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setGuideCollapsed((prev) => !prev)}
            className="inline-flex h-7 items-center gap-1 rounded border border-border-default bg-inset px-2.5 text-xs text-fg-secondary hover:text-fg-primary"
          >
            <span>{guideCollapsed ? "Expandir Guia" : "Recolher Guia"}</span>
            {guideCollapsed ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronUp className="size-3.5" />
            )}
          </button>
        </div>

        {!guideCollapsed && readiness && (
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            {readiness.steps.map((step) => (
              <article
                key={step.id}
                data-testid={`onboarding-step-${step.id}`}
                className={`flex flex-col justify-between rounded-md border p-3 ${
                  step.completed
                    ? "border-status-ok/35 bg-status-ok/5"
                    : "border-status-warn/40 bg-status-warn/5"
                }`}
              >
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-semibold text-fg-primary">
                      {step.title}
                    </span>
                    <span
                      className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                        step.completed
                          ? "border-status-ok/40 bg-status-ok/10 text-status-ok"
                          : "border-status-warn/40 bg-status-warn/10 text-status-warn"
                      }`}
                    >
                      {step.completed ? "OK" : "Recomendado"}
                    </span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-fg-secondary">
                    {step.description}
                  </p>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle pt-2">
                  <span className="font-mono text-[10px] text-fg-muted">
                    {step.statusBadge}
                  </span>
                  {step.id === "first_project_chat" ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        data-testid="guide-btn-start-greenfield"
                        onClick={() => {
                          setChatMode("greenfield");
                          setSelectedAgentRole("product_discovery");
                        }}
                        className="rounded border border-accent bg-accent px-2 py-1 text-[11px] font-semibold text-accent-fg hover:bg-accent-hover"
                      >
                        Do Zero
                      </button>
                      <button
                        type="button"
                        data-testid="guide-btn-start-brownfield"
                        onClick={() => {
                          setChatMode("brownfield");
                          setSelectedAgentRole("software_architect");
                        }}
                        className="rounded border border-border-default bg-surface px-2 py-1 text-[11px] font-medium text-fg-primary hover:border-accent"
                      >
                        URL Git / Repo
                      </button>
                    </div>
                  ) : (
                    <Link
                      href={step.actionHref}
                      prefetch={false}
                      className="rounded border border-border-default bg-surface px-2 py-1 text-[11px] font-medium text-fg-primary hover:border-accent hover:text-accent"
                    >
                      {step.actionLabel}
                    </Link>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* 2. Barra da Equipe de Agentes Especialistas + Model Tiering + Modo de Autonomia */}
      <section
        data-testid="agency-team-bar"
        className="rounded-lg border border-border-default bg-surface p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <Bot className="size-4 text-accent" strokeWidth={1.75} />
            <h2 className="text-sm font-semibold text-fg-primary">
              Equipe de Engenharia &amp; Roteamento Econômico (Mastra Supervisor + Model Tiering)
            </h2>
            {projectState && (
              <span
                data-testid="project-cycle-badge"
                className="tabular-nums rounded border border-accent/40 bg-accent-subtle px-2 py-0.5 font-mono text-xs font-semibold text-accent"
              >
                Ciclo #{projectState.cycleNumber} · {projectState.phaseLabel}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label
              htmlFor="autonomy-mode-select"
              className="text-xs font-medium text-fg-secondary"
            >
              Autonomia do Workflow:
            </label>
            <select
              id="autonomy-mode-select"
              data-testid="autonomy-mode-select"
              value={autonomyMode}
              onChange={(e) => setAutonomyMode(e.target.value as AutonomyMode)}
              className="h-8 rounded-md border border-border-default bg-inset px-2.5 text-xs text-fg-primary"
            >
              {(Object.keys(AUTONOMY_LABELS) as AutonomyMode[]).map((m) => (
                <option key={m} value={m}>
                  {AUTONOMY_LABELS[m].label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-6">
          {agents.map((ag) => {
            const isPhaseLeader = projectState?.activeAgentRole === ag.role;
            const isSelected = selectedAgentRole === ag.role;
            return (
              <button
                key={ag.role}
                type="button"
                data-testid={`agent-card-${ag.role}`}
                onClick={() =>
                  setSelectedAgentRole((prev) =>
                    prev === ag.role ? "auto" : ag.role
                  )
                }
                className={`flex flex-col justify-between rounded-md border p-2.5 text-left transition-colors ${
                  isSelected
                    ? "border-accent bg-accent-subtle/60"
                    : isPhaseLeader
                      ? "border-status-ok/50 bg-status-ok/5"
                      : "border-border-subtle bg-canvas hover:border-border-strong"
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-xs font-semibold text-fg-primary">
                      {ag.name}
                    </span>
                    {isPhaseLeader && (
                      <span className="shrink-0 rounded bg-status-ok/15 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-status-ok">
                        LÍDER ATUAL
                      </span>
                    )}
                  </div>
                  <p className="font-mono text-[10px] text-fg-muted">
                    {ag.title}
                  </p>
                </div>

                <div className="mt-2 space-y-1 border-t border-border-subtle pt-1.5">
                  <span
                    className={`inline-block rounded px-1.5 py-0.5 font-mono text-[9px] ${
                      ag.recommendedTier === "tier3_deep_reasoning"
                        ? "bg-accent/15 text-accent"
                        : "bg-status-info/15 text-status-info"
                    }`}
                  >
                    {ag.recommendedTier === "tier3_deep_reasoning"
                      ? "Tier 3 · Pro (Pensar)"
                      : "Tier 2 · Flash (Executar)"}
                  </span>
                  <p className="truncate font-mono text-[10px] text-fg-secondary">
                    {ag.boundModelId}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* 3. Painel Principal Lado a Lado: Chat com o Agente Responsável (Esquerda) + Artefatos Longo Prazo & Slices (Direita) */}
      <div
        id="agency-chat-anchor"
        className="grid grid-cols-1 gap-4 lg:grid-cols-12"
      >
        {/* Coluna Esquerda: Central Conversacional Multi-Agente */}
        <section
          data-testid="agency-chat-panel"
          className="flex flex-col justify-between rounded-lg border border-border-default bg-surface p-4 lg:col-span-6"
        >
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle pb-3">
              <div>
                <h3 className="text-sm font-semibold text-fg-primary">
                  Chat com o Agente Responsável
                </h3>
                <p className="text-xs text-fg-secondary">
                  {selectedAgentRole === "auto"
                    ? `Roteamento Automático → ${projectState?.activeAgentName ?? "Supervisor Executivo"}`
                    : `Conversando direto com: ${agents.find((a) => a.role === selectedAgentRole)?.name ?? selectedAgentRole}`}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  data-testid="chat-mode-conversation"
                  onClick={() => setChatMode("conversation")}
                  className={`rounded px-2 py-1 text-xs font-medium ${
                    chatMode === "conversation"
                      ? "bg-accent text-accent-fg"
                      : "border border-border-default bg-inset text-fg-secondary"
                  }`}
                >
                  Chat da Fase
                </button>
                <button
                  type="button"
                  data-testid="chat-mode-greenfield"
                  onClick={() => setChatMode("greenfield")}
                  className={`rounded px-2 py-1 text-xs font-medium ${
                    chatMode === "greenfield"
                      ? "bg-accent text-accent-fg"
                      : "border border-border-default bg-inset text-fg-secondary"
                  }`}
                >
                  + Sistema do Zero
                </button>
                <button
                  type="button"
                  data-testid="chat-mode-brownfield"
                  onClick={() => setChatMode("brownfield")}
                  className={`rounded px-2 py-1 text-xs font-medium ${
                    chatMode === "brownfield"
                      ? "bg-accent text-accent-fg"
                      : "border border-border-default bg-inset text-fg-secondary"
                  }`}
                >
                  + URL Git / Repo
                </button>
              </div>
            </div>

            {/* Controles Rápidos do Ciclo Autônomo (quando há projeto ativo) */}
            {projectState && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-subtle bg-inset p-2.5">
                <div className="text-xs text-fg-secondary">
                  <strong className="text-fg-primary">
                    {projectState.projectName}
                  </strong>{" "}
                  ({projectState.clientName}) ·{" "}
                  <span className="tabular-nums font-mono">
                    {projectState.completedDeliverables}/
                    {projectState.totalDeliverables} slices concluídos
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    data-testid="btn-run-autonomous-cycle"
                    disabled={chatMutation.isPending}
                    onClick={() =>
                      chatMutation.mutate({
                        message:
                          "Executar ciclo autônomo avançando os slices pelas fases permitidas até o próximo portão HITL.",
                        intent: "advance_cycle",
                        projectId: projectState.projectId,
                      })
                    }
                    className="inline-flex h-7 items-center gap-1 rounded bg-accent px-2.5 text-xs font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-50"
                  >
                    <Play className="size-3" />
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
                    className="inline-flex h-7 items-center gap-1 rounded border border-border-default bg-surface px-2.5 text-xs font-medium text-fg-primary hover:border-accent"
                  >
                    <RotateCcw className="size-3" />
                    <span>Voltar ao Arquiteto (Ciclo #{projectState.cycleNumber + 1})</span>
                  </button>
                </div>
              </div>
            )}

            {/* Histórico de Conversa e Ações Executadas pelos Agentes */}
            <div
              data-testid="agency-chat-history"
              className="mt-3 max-h-[340px] space-y-3 overflow-y-auto pr-1"
            >
              {chatTurns.map((turn) => (
                <article
                  key={turn.id}
                  className={`rounded-md border p-3 text-xs ${
                    turn.role === "user"
                      ? "ml-6 border-accent/30 bg-accent-subtle/30 text-fg-primary"
                      : "border-border-subtle bg-canvas text-fg-primary"
                  }`}
                >
                  {turn.role === "assistant" && (
                    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle pb-1.5">
                      <span className="font-semibold text-accent">
                        {turn.agentName ?? "Agente Uzina"}
                      </span>
                      <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-fg-muted">
                        {turn.cycleNumber && (
                          <span className="rounded border border-border-subtle bg-inset px-1.5 py-0.5">
                            Ciclo #{turn.cycleNumber}
                          </span>
                        )}
                        {turn.boundModelId && <span>{turn.boundModelId}</span>}
                      </div>
                    </div>
                  )}

                  <div className="whitespace-pre-line leading-relaxed">
                    {turn.content}
                  </div>

                  {turn.actionsExecuted && turn.actionsExecuted.length > 0 && (
                    <div className="mt-2.5 space-y-1 border-t border-border-subtle pt-2">
                      <span className="block font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                        Ações executadas automaticamente pelo agente:
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {turn.actionsExecuted.map((act, idx) => (
                          <span
                            key={`${turn.id}-act-${idx}`}
                            data-testid={`agent-action-${act.type}`}
                            className="inline-flex items-center gap-1 rounded border border-status-ok/35 bg-status-ok/10 px-2 py-0.5 font-mono text-[10px] text-status-ok"
                          >
                            <CheckCircle2 className="size-3 shrink-0" />
                            <span>{act.label}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </div>

          {/* Formulário de Entrada do Chat (adaptado ao modo selecionado) */}
          <form onSubmit={handleSendChat} className="mt-3 space-y-2.5 border-t border-border-subtle pt-3">
            {chatMode === "greenfield" && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="greenfield-project-name"
                    className="mb-1 block text-[11px] font-medium text-fg-secondary"
                  >
                    Nome do Novo Sistema (opcional — o PM pode sugerir)
                  </label>
                  <input
                    id="greenfield-project-name"
                    data-testid="input-greenfield-project-name"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="Ex.: Portal Logístico IA"
                    className="h-8 w-full rounded border border-border-default bg-inset px-2.5 text-xs text-fg-primary"
                  />
                </div>
                <div>
                  <label
                    htmlFor="greenfield-strategy"
                    className="mb-1 block text-[11px] font-medium text-fg-secondary"
                  >
                    Estratégia Inicial Preferida
                  </label>
                  <select
                    id="greenfield-strategy"
                    value={preferredStrategy}
                    onChange={(e) =>
                      setPreferredStrategy(
                        e.target.value as DevelopmentStrategy
                      )
                    }
                    className="h-8 w-full rounded border border-border-default bg-inset px-2.5 text-xs text-fg-primary"
                  >
                    <option value="frontend_first_msw">
                      Frontend-First + MSW
                    </option>
                    <option value="api_contract_first">
                      API Contract-First (Zod)
                    </option>
                    <option value="domain_first">Domain-First (TDD)</option>
                    <option value="data_schema_first">
                      Data / Schema-First
                    </option>
                  </select>
                </div>
              </div>
            )}

            {chatMode === "brownfield" && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="brownfield-git-url"
                    className="mb-1 block text-[11px] font-medium text-fg-secondary"
                  >
                    URL do Repositório Git (HTTPS)
                  </label>
                  <input
                    id="brownfield-git-url"
                    data-testid="input-brownfield-git-url"
                    value={gitUrlInput}
                    onChange={(e) => setGitUrlInput(e.target.value)}
                    placeholder="https://github.com/sua-empresa/repositorio.git"
                    className="h-8 w-full rounded border border-border-default bg-inset px-2.5 font-mono text-xs text-fg-primary"
                  />
                </div>
                <div>
                  <label
                    htmlFor="brownfield-project-name"
                    className="mb-1 block text-[11px] font-medium text-fg-secondary"
                  >
                    Nome do Projeto / Caminho Local (opcional)
                  </label>
                  <input
                    id="brownfield-project-name"
                    data-testid="input-brownfield-project-name"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="Ex.: ERP Core Refatoração"
                    className="h-8 w-full rounded border border-border-default bg-inset px-2.5 text-xs text-fg-primary"
                  />
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <label htmlFor="agency-chat-input" className="sr-only">
                Mensagem para o Agente Responsável
              </label>
              <input
                id="agency-chat-input"
                data-testid="agency-chat-input"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={
                  chatMode === "greenfield"
                    ? "Descreva a ideia, funcionalidades e público do sistema para o Agente de Descoberta..."
                    : chatMode === "brownfield"
                      ? "Explique o que deseja analisar, evoluir ou refatorar nesse repositório para o Agente Arquiteto..."
                      : "Converse com o agente responsável da fase, peça ajustes de escopo ou tire dúvidas..."
                }
                className="h-9 flex-1 rounded-md border border-border-default bg-inset px-3 text-xs text-fg-primary"
              />
              <button
                type="submit"
                data-testid="agency-chat-submit"
                disabled={chatMutation.isPending}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-3.5 text-xs font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-50"
              >
                {chatMutation.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Send className="size-3.5" />
                )}
                <span>
                  {chatMode === "greenfield"
                    ? "Estruturar do Zero"
                    : chatMode === "brownfield"
                      ? "Importar & Analisar Git"
                      : "Enviar"}
                </span>
              </button>
            </div>

            {chatMutation.error && (
              <p role="alert" className="text-xs text-status-danger">
                {(chatMutation.error as Error).message}
              </p>
            )}
          </form>
        </section>

        {/* Coluna Direita: Inspetor Visual de Artefatos (Longo Prazo do Projeto vs. Dossiês de Slices) */}
        <section
          data-testid="agency-artifacts-panel"
          className="flex flex-col justify-between rounded-lg border border-border-default bg-surface p-4 lg:col-span-6"
        >
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle pb-3">
              <div>
                <h3 className="text-sm font-semibold text-fg-primary">
                  Artefatos Vivos &amp; Dossiês de Slices
                </h3>
                <p className="text-xs text-fg-secondary">
                  Inspecione documentos de longo prazo ou aprove/corrija cada slice em ciclo.
                </p>
              </div>

              <div
                role="tablist"
                aria-label="Camada de artefatos"
                className="inline-flex rounded-md border border-border-default bg-inset p-0.5"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={artifactTab === "slices"}
                  data-testid="tab-slice-artifacts"
                  onClick={() => setArtifactTab("slices")}
                  className={`inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium ${
                    artifactTab === "slices"
                      ? "border border-border-subtle bg-surface text-fg-primary"
                      : "text-fg-secondary hover:text-fg-primary"
                  }`}
                >
                  <Layers className="size-3.5" />
                  <span>
                    Slices &amp; Entregas ({sliceArtifacts.length})
                  </span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={artifactTab === "long_term"}
                  data-testid="tab-long-term-artifacts"
                  onClick={() => setArtifactTab("long_term")}
                  className={`inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium ${
                    artifactTab === "long_term"
                      ? "border border-border-subtle bg-surface text-fg-primary"
                      : "text-fg-secondary hover:text-fg-primary"
                  }`}
                >
                  <FileText className="size-3.5" />
                  <span>
                    Longo Prazo ({longTermArtifacts.length})
                  </span>
                </button>
              </div>
            </div>

            {!projectState ? (
              <div className="flex flex-col items-center justify-center py-14 text-center">
                <FileCode2 className="mb-2 size-7 text-fg-muted" strokeWidth={1.5} />
                <p className="text-xs font-medium text-fg-primary">
                  Nenhum projeto selecionado ainda
                </p>
                <p className="mt-1 max-w-sm text-[11px] text-fg-secondary">
                  Inicie um sistema do zero ou envie uma URL do Git no chat ao lado para os agentes gerarem o PRD, o Blueprint Arquitetural e os Dossiês de Slices.
                </p>
              </div>
            ) : artifactTab === "long_term" ? (
              /* Visão A: Artefatos de Longo Prazo do Projeto */
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {longTermArtifacts.map((art) => {
                    const isSelected = activeLongTerm?.id === art.id;
                    return (
                      <button
                        key={art.id}
                        type="button"
                        data-testid={`long-term-artifact-${art.kind}`}
                        onClick={() => setSelectedLongTermId(art.id)}
                        className={`rounded-md border p-2.5 text-left transition-colors ${
                          isSelected
                            ? "border-accent bg-accent-subtle/40"
                            : "border-border-subtle bg-canvas hover:border-border-strong"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-semibold text-fg-primary">
                            {art.title}
                          </span>
                          <span className="shrink-0 rounded border border-border-subtle bg-inset px-1.5 py-0.5 font-mono text-[9px] text-fg-muted">
                            Ciclo #{art.cycleNumber}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-1 text-[11px] text-fg-secondary">
                          {art.summary}
                        </p>
                        <p className="mt-1 font-mono text-[10px] text-accent">
                          Dono: {art.ownerAgentName}
                        </p>
                      </button>
                    );
                  })}
                </div>

                {activeLongTerm && (
                  <div
                    data-testid="long-term-artifact-viewer"
                    className="rounded-md border border-border-subtle bg-inset p-3"
                  >
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle pb-2">
                      <span className="text-xs font-semibold text-fg-primary">
                        {activeLongTerm.title}
                      </span>
                      <span className="font-mono text-[10px] text-fg-muted">
                        Mantido por {activeLongTerm.ownerAgentName}
                      </span>
                    </div>
                    <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-fg-primary">
                      {activeLongTerm.contentMarkdown}
                    </pre>
                  </div>
                )}
              </div>
            ) : (
              /* Visão B: Artefatos Momentâneos / Táticos de Cada Slice (Dossiê, Blueprint, Evidências + Aprovação / Retorno Cíclico) */
              <div className="mt-3 space-y-3">
                {sliceArtifacts.length === 0 ? (
                  <p className="py-8 text-center text-xs text-fg-muted">
                    Este projeto ainda não possui slices gerados. Peça ao Agente Arquiteto no chat para quebrar o escopo em entregas.
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <label
                        htmlFor="select-slice-inspector"
                        className="text-xs font-medium text-fg-secondary"
                      >
                        Slice Ativo:
                      </label>
                      <select
                        id="select-slice-inspector"
                        data-testid="select-slice-inspector"
                        value={activeSlice?.deliverableId ?? ""}
                        onChange={(e) => setSelectedSliceId(e.target.value)}
                        className="h-8 flex-1 rounded-md border border-border-default bg-inset px-2.5 text-xs text-fg-primary"
                      >
                        {sliceArtifacts.map((s) => (
                          <option key={s.deliverableId} value={s.deliverableId}>
                            [{s.statusLabel}] {s.title} (Ciclo #{s.cycleNumber})
                          </option>
                        ))}
                      </select>
                    </div>

                    {activeSlice && (
                      <div
                        data-testid="slice-artifact-inspector"
                        className="space-y-3 rounded-md border border-border-subtle bg-canvas p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle pb-2">
                          <div>
                            <h4 className="text-xs font-semibold text-fg-primary">
                              {activeSlice.title}
                            </h4>
                            <p className="font-mono text-[10px] text-fg-secondary">
                              Estágio:{" "}
                              <strong className="text-accent">
                                {activeSlice.statusLabel}
                              </strong>{" "}
                              · Responsável: {activeSlice.ownerAgentName} · Ciclo #
                              {activeSlice.cycleNumber}
                            </p>
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              data-testid="slice-subtab-spec"
                              onClick={() => setSliceSubTab("spec")}
                              className={`rounded px-2 py-1 text-[11px] font-medium ${
                                sliceSubTab === "spec"
                                  ? "bg-accent text-accent-fg"
                                  : "bg-inset text-fg-secondary"
                              }`}
                            >
                              Dossiê (Spec)
                            </button>
                            <button
                              type="button"
                              data-testid="slice-subtab-blueprint"
                              onClick={() => setSliceSubTab("blueprint")}
                              className={`rounded px-2 py-1 text-[11px] font-medium ${
                                sliceSubTab === "blueprint"
                                  ? "bg-accent text-accent-fg"
                                  : "bg-inset text-fg-secondary"
                              }`}
                            >
                              Blueprint &amp; Tiers
                            </button>
                            <button
                              type="button"
                              data-testid="slice-subtab-evidence"
                              onClick={() => setSliceSubTab("evidence")}
                              className={`rounded px-2 py-1 text-[11px] font-medium ${
                                sliceSubTab === "evidence"
                                  ? "bg-accent text-accent-fg"
                                  : "bg-inset text-fg-secondary"
                              }`}
                            >
                              Evidências &amp; Gate
                            </button>
                          </div>
                        </div>

                        <div className="max-h-48 overflow-y-auto rounded border border-border-subtle bg-inset p-2.5">
                          {sliceSubTab === "spec" && (
                            <pre
                              data-testid="slice-spec-markdown"
                              className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-fg-primary"
                            >
                              {activeSlice.specMarkdown}
                            </pre>
                          )}
                          {sliceSubTab === "blueprint" && (
                            <pre
                              data-testid="slice-blueprint-json"
                              className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-fg-primary"
                            >
                              {JSON.stringify(activeSlice.blueprintJson, null, 2)}
                            </pre>
                          )}
                          {sliceSubTab === "evidence" && (
                            <div
                              data-testid="slice-evidence-summary"
                              className="space-y-2 text-xs text-fg-primary"
                            >
                              <p>{activeSlice.evidenceSummary}</p>
                              <p className="font-mono text-[11px] text-fg-secondary">
                                Tentativas do Verify Gate:{" "}
                                {activeSlice.verifyAttempts}/
                                {activeSlice.maxVerifyAttempts}
                              </p>
                              {activeSlice.pendingDecisionSummary && (
                                <div className="rounded border border-status-warn/40 bg-status-warn/10 p-2 text-[11px] text-status-warn">
                                  <strong>Portão HITL Ativo:</strong>{" "}
                                  {activeSlice.pendingDecisionSummary}
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Ações de Governança sobre o Slice: Aprovar & Avançar ou Devolver em Ciclo para Correção */}
                        <div className="space-y-2 border-t border-border-subtle pt-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[11px] font-semibold text-fg-primary">
                              Decisão sobre este Slice / Artefato:
                            </span>
                            <button
                              type="button"
                              data-testid="btn-approve-slice-artifact"
                              disabled={
                                chatMutation.isPending ||
                                activeSlice.status === "merged"
                              }
                              onClick={() =>
                                chatMutation.mutate({
                                  message: `Aprovar artefato e avançar o slice '${activeSlice.title}'.`,
                                  intent: "approve_slice_artifact",
                                  projectId: projectState.projectId,
                                  deliverableId: activeSlice.deliverableId,
                                })
                              }
                              className="inline-flex h-7 items-center gap-1 rounded bg-status-ok px-2.5 text-[11px] font-semibold text-canvas hover:opacity-90 disabled:opacity-50"
                            >
                              <ShieldCheck className="size-3.5" />
                              <span>Aprovar Artefato &amp; Avançar</span>
                            </button>
                          </div>

                          <div className="flex flex-wrap gap-1.5">
                            <select
                              aria-label="Agente para revisão em ciclo"
                              data-testid="select-revision-agent"
                              value={revisionTargetAgent}
                              onChange={(e) =>
                                setRevisionTargetAgent(
                                  e.target.value as AgencyAgentRole
                                )
                              }
                              className="h-8 rounded border border-border-default bg-inset px-2 text-[11px] text-fg-primary"
                            >
                              <option value="software_architect">
                                Voltar ao Arquiteto
                              </option>
                              <option value="product_discovery">
                                Voltar ao Agente de Produto
                              </option>
                              <option value="ux_designer">
                                Voltar ao Agente de Design
                              </option>
                              <option value="tech_lead">
                                Voltar ao Tech Lead
                              </option>
                            </select>
                            <input
                              aria-label="Feedback de correção para retorno em ciclo"
                              data-testid="input-slice-revision-feedback"
                              value={revisionFeedback}
                              onChange={(e) =>
                                setRevisionFeedback(e.target.value)
                              }
                              placeholder="O que precisa corrigir ou mudar neste slice?"
                              className="h-8 flex-1 rounded border border-border-default bg-inset px-2.5 text-xs text-fg-primary"
                            />
                            <button
                              type="button"
                              data-testid="btn-revise-slice-artifact"
                              disabled={chatMutation.isPending}
                              onClick={() =>
                                chatMutation.mutate({
                                  message:
                                    revisionFeedback.trim() ||
                                    `Revisar arquitetura e especificações do slice '${activeSlice.title}' em novo ciclo.`,
                                  intent: "request_slice_revision",
                                  projectId: projectState.projectId,
                                  deliverableId: activeSlice.deliverableId,
                                  targetAgentRole: revisionTargetAgent,
                                })
                              }
                              className="inline-flex h-8 items-center gap-1 rounded border border-accent bg-accent-subtle px-2.5 text-[11px] font-semibold text-accent hover:bg-accent hover:text-accent-fg disabled:opacity-50"
                            >
                              <RotateCcw className="size-3" />
                              <span>Corrigir em Ciclo</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {projectState?.repositoryUrl && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle pt-2.5 font-mono text-[11px] text-fg-secondary">
              <span className="inline-flex items-center gap-1.5 truncate">
                <GitBranch className="size-3.5 text-accent" />
                <span>Git: {projectState.repositoryUrl}</span>
              </span>
              <span className="inline-flex items-center gap-1 text-status-ok">
                <Cpu className="size-3.5" />
                <span>AST Poliglota Sincronizado</span>
              </span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
