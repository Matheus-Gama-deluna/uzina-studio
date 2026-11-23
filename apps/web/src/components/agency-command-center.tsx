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
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cpu,
  ExternalLink,
  Eye,
  FileCode2,
  FileText,
  GitBranch,
  Layers,
  Loader2,
  Palette,
  Play,
  PlusCircle,
  RotateCcw,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent, type KeyboardEvent } from "react";

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

const AUTONOMY_LABELS: Record<AutonomyMode, string> = {
  guided: "Autonomia: Guiado (Passo a Passo)",
  semi_autonomous: "Autonomia: Semi-Autônomo (Pausa nos Portões)",
  full_autonomous: "Autonomia: Contínuo (Ciclo Completo)",
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

  const [setupExpanded, setSetupExpanded] = useState(false);
  const [teamTopology, setTeamTopology] =
    useState<TeamTopologyMode>("lean_mvp");
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

  const [artifactTab, setArtifactTab] = useState<
    "visual_studio" | "slices" | "long_term"
  >("visual_studio");
  const [selectedLongTermId, setSelectedLongTermId] = useState<string>("");
  const [selectedSliceId, setSelectedSliceId] = useState<string>("");
  const [sliceSubTab, setSliceSubTab] = useState<
    "spec" | "blueprint" | "evidence"
  >("spec");
  const [revisionFeedback, setRevisionFeedback] = useState("");
  const [visualRevisionFeedback, setVisualRevisionFeedback] = useState("");
  const [revisionTargetAgent, setRevisionTargetAgent] =
    useState<AgencyAgentRole>("software_architect");

  const [chatTurns, setChatTurns] = useState<ChatTurnItem[]>([
    {
      id: "initial-greeting",
      role: "assistant",
      agentName: "Equipe de Engenharia Uzina",
      agentRole: "orchestrator",
      tierLabel: "Tier 3 · Raciocínio & Planejamento (Pro)",
      boundModelId: "google/gemini-2.5-pro",
      cycleNumber: 1,
      content:
        "Olá! Descreva sua ideia de sistema (ou cole a URL de um repositório Git existente) direto na caixa abaixo. Você não precisa escolher estratégia técnica nem criar entregas manualmente: nosso Arquiteto de Software analisa a conversa, decide a melhor estratégia para os agentes de IA, gera o Protótipo Visual inicial e organiza os Slices automaticamente.",
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
          ...(payload.deliverableId
            ? { deliverableId: payload.deliverableId }
            : {}),
          ...(payload.targetAgentRole
            ? { targetAgentRole: payload.targetAgentRole }
            : {}),
          ...(payload.projectName ? { projectName: payload.projectName } : {}),
          ...(payload.gitUrl ? { gitUrl: payload.gitUrl } : {}),
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
      setRevisionFeedback("");
      setVisualRevisionFeedback("");
      setChatMode("conversation");

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

  function submitCurrentChat() {
    const trimmedMsg = chatInput.trim();
    if (!trimmedMsg && chatMode === "conversation") return;

    const chosenRole =
      selectedAgentRole === "auto" ? undefined : selectedAgentRole;

    if (chatMode === "greenfield") {
      const prompt =
        trimmedMsg ||
        `Criar sistema ${newProjectName.trim() || "Novo Produto"} com arquitetura modular, fluxo visual validado e contratos Zod.`;
      chatMutation.mutate({
        message: prompt,
        intent: "start_greenfield",
        projectName: newProjectName.trim() || undefined,
        targetAgentRole: "product_discovery",
      });
      return;
    }

    if (chatMode === "brownfield") {
      const prompt =
        trimmedMsg ||
        `Importar e analisar repositório ${gitUrlInput.trim() || "existente"} para evolução arquitetural.`;
      chatMutation.mutate({
        message: prompt,
        intent: "import_git_or_repo",
        projectName: newProjectName.trim() || undefined,
        gitUrl: gitUrlInput.trim() || undefined,
        targetAgentRole: "software_architect",
      });
      return;
    }

    // No modo conversa normal: se não houver projeto ativo ou se o usuário colou uma URL Git, o backend detecta automaticamente!
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
    <div className="space-y-3">
      {/* Barra Superior Integrada: Prontidão Compacta + Topologia de Equipe (Enxuta vs Completa) + Autonomia */}
      <section
        data-testid="onboarding-readiness-guide"
        className="rounded-lg border border-border-default bg-surface px-3.5 py-2.5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {/* Esquerda: Status de Prontidão + Botão de Expandir Setup */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="toggle-setup-guide-btn"
              onClick={() => setSetupExpanded((prev) => !prev)}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-accent/40 bg-accent-subtle px-2.5 font-mono text-xs font-semibold text-accent hover:border-accent"
            >
              <Settings2 className="size-3.5" strokeWidth={1.75} />
              <span>
                Setup &amp; Prontidão:{" "}
                <strong className="tabular-nums">
                  {readiness?.readinessPercent ?? 67}%
                </strong>
              </span>
              {setupExpanded ? (
                <ChevronUp className="size-3.5" />
              ) : (
                <ChevronDown className="size-3.5" />
              )}
            </button>

            <span className="hidden text-xs text-fg-secondary xl:inline">
              {readiness?.llmProviderConfigured
                ? `Cofre LLM ativo · Motores ${readiness.embeddingMode} + AST ${readiness.astMode}`
                : "Modo Assistido Local ativo · Clique em Setup para conectar chave LLM ou calibrar motores"}
            </span>
          </div>

          {/* Direita: Alternância Equipe Enxuta (MVP) vs Equipe Completa (6) + Modo de Autonomia */}
          <div
            data-testid="agency-team-bar"
            className="flex flex-wrap items-center gap-2"
          >
            {projectState && (
              <span
                data-testid="project-cycle-badge"
                className="tabular-nums rounded border border-accent/40 bg-accent-subtle px-2 py-0.5 font-mono text-xs font-semibold text-accent"
              >
                Ciclo #{projectState.cycleNumber} · {projectState.phaseLabel}
              </span>
            )}

            <div
              role="group"
              aria-label="Topologia da equipe de agentes"
              data-testid="team-topology-toggle"
              className="inline-flex rounded-md border border-border-default bg-inset p-0.5"
            >
              <button
                type="button"
                data-testid="topology-lean-mvp"
                onClick={() => setTeamTopology("lean_mvp")}
                className={`inline-flex h-6 items-center gap-1 rounded px-2 text-[11px] font-medium ${
                  teamTopology === "lean_mvp"
                    ? "bg-surface text-fg-primary shadow-2xs"
                    : "text-fg-secondary hover:text-fg-primary"
                }`}
              >
                <Sparkles className="size-3 text-accent" />
                <span>Equipe Enxuta (MVP · 3)</span>
              </button>
              <button
                type="button"
                data-testid="topology-full-enterprise"
                onClick={() => setTeamTopology("full_enterprise")}
                className={`inline-flex h-6 items-center gap-1 rounded px-2 text-[11px] font-medium ${
                  teamTopology === "full_enterprise"
                    ? "bg-surface text-fg-primary shadow-2xs"
                    : "text-fg-secondary hover:text-fg-primary"
                }`}
              >
                <Users className="size-3 text-status-info" />
                <span>Completa (6)</span>
              </button>
            </div>

            <label htmlFor="autonomy-mode-select" className="sr-only">
              Modo de Autonomia
            </label>
            <select
              id="autonomy-mode-select"
              data-testid="autonomy-mode-select"
              value={autonomyMode}
              onChange={(e) => setAutonomyMode(e.target.value as AutonomyMode)}
              className="h-7 rounded-md border border-border-default bg-inset px-2 text-xs text-fg-primary"
            >
              {(Object.keys(AUTONOMY_LABELS) as AutonomyMode[]).map((m) => (
                <option key={m} value={m}>
                  {AUTONOMY_LABELS[m]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Painel Expansível de Configuração & Guia Ideal (recolhido por padrão para manter o Chat no topo!) */}
        {setupExpanded && readiness && (
          <div className="mt-3 grid grid-cols-1 gap-2.5 border-t border-border-subtle pt-3 md:grid-cols-3">
            {readiness.steps.map((step) => (
              <article
                key={step.id}
                data-testid={`onboarding-step-${step.id}`}
                className={`flex flex-col justify-between rounded-md border p-2.5 ${
                  step.completed
                    ? "border-status-ok/35 bg-status-ok/5"
                    : "border-status-warn/40 bg-status-warn/5"
                }`}
              >
                <div>
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
                      {step.completed ? "OK" : "Pendente"}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-fg-secondary">
                    {step.description}
                  </p>
                </div>
                <div className="mt-2 flex items-center justify-between border-t border-border-subtle pt-2">
                  <span className="font-mono text-[10px] text-fg-muted">
                    {step.statusBadge}
                  </span>
                  {step.id === "first_project_chat" ? (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        data-testid="guide-btn-start-greenfield"
                        onClick={() => {
                          setChatMode("greenfield");
                          setSetupExpanded(false);
                        }}
                        className="rounded bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-fg"
                      >
                        Do Zero
                      </button>
                      <button
                        type="button"
                        data-testid="guide-btn-start-brownfield"
                        onClick={() => {
                          setChatMode("brownfield");
                          setSetupExpanded(false);
                        }}
                        className="rounded border border-border-default bg-surface px-2 py-0.5 text-[11px] text-fg-primary"
                      >
                        URL Git
                      </button>
                    </div>
                  ) : (
                    <Link
                      href={step.actionHref}
                      prefetch={false}
                      className="rounded border border-border-default bg-surface px-2 py-0.5 text-[11px] font-medium text-fg-primary hover:border-accent"
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

      {/* WORKSPACE PRINCIPAL NO TOPO: Chat Amplo (7 colunas) + Estúdio Visual / Slices / Artefatos (5 colunas) */}
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-12">
        {/* COLUNA ESQUERDA (7/12): Chat Principal com a Equipe de Agentes */}
        <section
          data-testid="agency-chat-panel"
          className="flex flex-col justify-between rounded-lg border border-border-default bg-surface p-4 lg:col-span-7"
        >
          <div>
            {/* Cabeçalho do Chat + Pílulas dos Agentes Ativos (Sem truncamento!) */}
            <div className="space-y-2.5 border-b border-border-subtle pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Bot className="size-4 text-accent" strokeWidth={1.75} />
                  <h2 className="text-sm font-semibold text-fg-primary">
                    Central Conversacional de Engenharia
                  </h2>
                </div>

                {/* Ações rápidas de conversa / novo projeto / ciclo */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    data-testid="chat-mode-conversation"
                    onClick={() => setChatMode("conversation")}
                    className={`rounded px-2 py-1 text-xs font-medium ${
                      chatMode === "conversation"
                        ? "bg-accent text-accent-fg"
                        : "border border-border-default bg-inset text-fg-secondary hover:text-fg-primary"
                    }`}
                  >
                    Conversa Principal
                  </button>
                  <button
                    type="button"
                    data-testid="chat-mode-greenfield"
                    onClick={() => setChatMode("greenfield")}
                    className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium ${
                      chatMode === "greenfield"
                        ? "bg-accent text-accent-fg"
                        : "border border-border-default bg-inset text-fg-secondary hover:text-fg-primary"
                    }`}
                  >
                    <PlusCircle className="size-3" />
                    <span>Novo Projeto (Ideia)</span>
                  </button>
                  <button
                    type="button"
                    data-testid="chat-mode-brownfield"
                    onClick={() => setChatMode("brownfield")}
                    className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium ${
                      chatMode === "brownfield"
                        ? "bg-accent text-accent-fg"
                        : "border border-border-default bg-inset text-fg-secondary hover:text-fg-primary"
                    }`}
                  >
                    <GitBranch className="size-3" />
                    <span>Importar URL Git</span>
                  </button>
                </div>
              </div>

              {/* Pílulas de Seleção Consistente de Agente (Roteamento Automático + Equipe Enxuta ou Completa) */}
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  data-testid="agent-pill-auto"
                  onClick={() => setSelectedAgentRole("auto")}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                    selectedAgentRole === "auto"
                      ? "border-accent bg-accent-subtle text-accent"
                      : "border-border-subtle bg-inset text-fg-secondary hover:text-fg-primary"
                  }`}
                >
                  <Sparkles className="size-3" />
                  <span>
                    Automático ({projectState?.activeAgentName ?? "Pela Fase"})
                  </span>
                </button>

                {visibleAgents.map((ag) => {
                  const isLeader = projectState?.activeAgentRole === ag.role;
                  const isSelected = selectedAgentRole === ag.role;
                  const label =
                    teamTopology === "lean_mvp" && ag.leanDisplayName
                      ? ag.leanDisplayName
                      : ag.name;
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
                      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ${
                        isSelected
                          ? "border-accent bg-accent text-accent-fg font-semibold"
                          : isLeader
                            ? "border-status-ok/50 bg-status-ok/10 text-fg-primary font-medium"
                            : "border-border-subtle bg-canvas text-fg-secondary hover:border-border-strong hover:text-fg-primary"
                      }`}
                    >
                      <span>{label}</span>
                      <span
                        className={`rounded px-1 py-0.2 font-mono text-[9px] ${
                          isSelected
                            ? "bg-black/20 text-accent-fg"
                            : ag.recommendedTier === "tier3_deep_reasoning"
                              ? "bg-accent/15 text-accent"
                              : "bg-status-info/15 text-status-info"
                        }`}
                      >
                        {ag.recommendedTier === "tier3_deep_reasoning"
                          ? "Pro"
                          : "Flash"}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Decisão de Estratégia do Arquiteto + Botões de Ciclo Autônomo (quando há projeto ativo) */}
              {projectState && (
                <div
                  data-testid="architect-strategy-banner"
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-subtle bg-inset px-3 py-2"
                >
                  <div className="space-y-0.5 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-fg-primary">
                        {projectState.projectName}
                      </span>
                      <span className="rounded border border-accent/35 bg-accent-subtle px-1.5 py-0.5 font-mono text-[10px] text-accent">
                        Estratégia do Arquiteto:{" "}
                        {architectDecision?.strategyLabel ??
                          projectState.defaultStrategy}
                      </span>
                    </div>
                    {architectDecision?.rationale && (
                      <p className="line-clamp-1 text-[11px] text-fg-secondary">
                        {architectDecision.rationale}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
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
                      className="inline-flex h-7 items-center gap-1 rounded border border-border-default bg-surface px-2 text-xs font-medium text-fg-primary hover:border-accent"
                    >
                      <RotateCcw className="size-3" />
                      <span>Ciclo #{projectState.cycleNumber + 1}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Área de Mensagens do Chat (Mais Alta e Confortável para Leitura e Seleção) */}
            <div
              data-testid="agency-chat-history"
              className="mt-3 min-h-[340px] max-h-[450px] space-y-3 overflow-y-auto pr-1 select-text"
            >
              {chatTurns.map((turn) => (
                <article
                  key={turn.id}
                  className={`rounded-lg border p-3.5 text-xs ${
                    turn.role === "user"
                      ? "ml-8 border-accent/35 bg-accent-subtle/25 text-fg-primary"
                      : "border-border-subtle bg-canvas text-fg-primary"
                  }`}
                >
                  {turn.role === "assistant" && (
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle pb-1.5">
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
                    <div className="mt-3 space-y-1.5 border-t border-border-subtle pt-2">
                      <span className="block font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                        Ações executadas pelos agentes:
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

          {/* Composer Único Multilinha Consistente (Sem pedir Estratégia Manual!) */}
          <form
            onSubmit={handleSendChat}
            className="mt-3 space-y-2 border-t border-border-subtle pt-3"
          >
            {chatMode === "greenfield" && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-accent/30 bg-accent-subtle/20 px-3 py-2">
                <span className="text-xs font-medium text-accent">
                  Novo Projeto do Zero:
                </span>
                <input
                  id="greenfield-project-name"
                  data-testid="input-greenfield-project-name"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="Nome sugerido (opcional — o agente pode batizar)"
                  className="h-7 flex-1 rounded border border-border-default bg-inset px-2.5 text-xs text-fg-primary"
                />
                <span className="font-mono text-[10px] text-fg-secondary">
                  O Arquiteto decidirá a melhor estratégia para IA.
                </span>
              </div>
            )}

            {chatMode === "brownfield" && (
              <div className="grid grid-cols-1 gap-2 rounded-md border border-accent/30 bg-accent-subtle/20 p-2.5 sm:grid-cols-2">
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
                    Nome do Projeto (opcional)
                  </label>
                  <input
                    id="brownfield-project-name"
                    data-testid="input-brownfield-project-name"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="Ex.: Core Platform IA"
                    className="h-8 w-full rounded border border-border-default bg-inset px-2.5 text-xs text-fg-primary"
                  />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="agency-chat-input" className="sr-only">
                Mensagem para o Agente Responsável
              </label>
              <textarea
                id="agency-chat-input"
                data-testid="agency-chat-input"
                rows={3}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={handleTextareaKeyDown}
                placeholder={
                  chatMode === "greenfield"
                    ? "Conte toda a ideia do sistema, público, fluxos visuais e regras. O Agente de Produto e o Arquiteto vão decidir a estratégia ideal para IA, gerar o protótipo visual e criar os slices..."
                    : chatMode === "brownfield"
                      ? "Explique o que deseja analisar, refatorar ou evoluir nesse repositório Git..."
                      : "Converse com o agente responsável, descreva um novo sistema do zero, cole uma URL do Git ou peça ajustes no protótipo visual (Enter envia · Shift+Enter quebra linha)..."
                }
                className="w-full resize-y rounded-md border border-border-default bg-inset p-3 text-xs leading-relaxed text-fg-primary focus:border-accent focus:outline-none"
              />

              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-[11px] text-fg-muted">
                  Respondendo:{" "}
                  <strong className="text-fg-secondary">
                    {selectedAgentRole === "auto"
                      ? `Roteamento Automático (${projectState?.activeAgentName ?? "Supervisor"})`
                      : (allAgents.find((a) => a.role === selectedAgentRole)
                          ?.name ?? selectedAgentRole)}
                  </strong>
                </span>

                <button
                  type="submit"
                  data-testid="agency-chat-submit"
                  disabled={chatMutation.isPending}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-4 text-xs font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-50"
                >
                  {chatMutation.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Send className="size-3.5" />
                  )}
                  <span>
                    {chatMode === "greenfield"
                      ? "Iniciar Projeto & Definir Estratégia"
                      : chatMode === "brownfield"
                        ? "Importar Git & Analisar Arquitetura"
                        : "Enviar Mensagem"}
                  </span>
                </button>
              </div>
            </div>

            {chatMutation.error && (
              <p role="alert" className="text-xs text-status-danger">
                {(chatMutation.error as Error).message}
              </p>
            )}
          </form>
        </section>

        {/* COLUNA DIREITA (5/12): Estúdio & Protótipo Visual · Dossiês de Slices · Artefatos de Longo Prazo */}
        <section
          data-testid="agency-artifacts-panel"
          className="flex flex-col justify-between rounded-lg border border-border-default bg-surface p-4 lg:col-span-5"
        >
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle pb-3">
              <div
                role="tablist"
                aria-label="Camada de artefatos e prototipação"
                className="inline-flex w-full justify-between rounded-md border border-border-default bg-inset p-0.5"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={artifactTab === "visual_studio"}
                  data-testid="tab-visual-studio-flow"
                  onClick={() => setArtifactTab("visual_studio")}
                  className={`inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded px-2 text-xs font-medium ${
                    artifactTab === "visual_studio"
                      ? "border border-border-subtle bg-surface text-fg-primary"
                      : "text-fg-secondary hover:text-fg-primary"
                  }`}
                >
                  <Palette className="size-3.5 text-accent" />
                  <span>Estúdio &amp; Protótipo</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={artifactTab === "slices"}
                  data-testid="tab-slice-artifacts"
                  onClick={() => setArtifactTab("slices")}
                  className={`inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded px-2 text-xs font-medium ${
                    artifactTab === "slices"
                      ? "border border-border-subtle bg-surface text-fg-primary"
                      : "text-fg-secondary hover:text-fg-primary"
                  }`}
                >
                  <Layers className="size-3.5" />
                  <span>Slices ({sliceArtifacts.length})</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={artifactTab === "long_term"}
                  data-testid="tab-long-term-artifacts"
                  onClick={() => setArtifactTab("long_term")}
                  className={`inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded px-2 text-xs font-medium ${
                    artifactTab === "long_term"
                      ? "border border-border-subtle bg-surface text-fg-primary"
                      : "text-fg-secondary hover:text-fg-primary"
                  }`}
                >
                  <FileText className="size-3.5" />
                  <span>Longo Prazo ({longTermArtifacts.length})</span>
                </button>
              </div>
            </div>

            {!projectState ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <FileCode2
                  className="mb-2 size-8 text-fg-muted"
                  strokeWidth={1.5}
                />
                <p className="text-xs font-semibold text-fg-primary">
                  Aguardando Conversa Inicial no Chat
                </p>
                <p className="mt-1 max-w-xs text-[11px] leading-relaxed text-fg-secondary">
                  Assim que você descrever sua ideia ou colar a URL do Git no Chat à esquerda, o Arquiteto e o Designer exibirão aqui o Protótipo Visual, os Slices e o PRD Vivo.
                </p>
              </div>
            ) : artifactTab === "visual_studio" ? (
              /* ABA 1: Estúdio & Fase de Prototipação Visual Integrada (Portão Visual Antes do Código) */
              <div
                data-testid="visual-flow-inspector"
                className="mt-3 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-subtle bg-inset p-2.5">
                  <div>
                    <span className="text-xs font-semibold text-fg-primary">
                      {visualFlow?.latestPrototypeTitle ??
                        `Protótipo Visual — ${projectState.projectName}`}
                    </span>
                    <p className="font-mono text-[10px] text-fg-secondary">
                      {visualFlow?.fidelityLevel ?? "Nível 3 (HTML/Tailwind + W3C)"}
                    </p>
                  </div>
                  <span
                    data-testid="visual-flow-status-badge"
                    className={`rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${
                      visualFlow?.approvedForCodeHandoff
                        ? "border-status-ok/40 bg-status-ok/15 text-status-ok"
                        : "border-status-warn/40 bg-status-warn/15 text-status-warn"
                    }`}
                  >
                    {visualFlow?.approvedForCodeHandoff
                      ? "Fluxo Visual Aprovado p/ Código"
                      : "Portão Visual: Aguardando Aprovação"}
                  </span>
                </div>

                {/* Preview Sandboxed do Protótipo Visual */}
                {visualFlow?.previewUrl ? (
                  <div className="overflow-hidden rounded-md border border-border-default bg-canvas">
                    <div className="flex items-center justify-between border-b border-border-subtle bg-inset px-3 py-1.5 text-[11px] text-fg-secondary">
                      <span className="inline-flex items-center gap-1.5 font-mono">
                        <Eye className="size-3.5 text-accent" />
                        <span>Preview Visual Seguro (Sandbox CSP)</span>
                      </span>
                      <Link
                        href={visualFlow.studioHref}
                        prefetch={false}
                        className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
                      >
                        <span>Abrir Estúdio Completo &amp; Stitch</span>
                        <ExternalLink className="size-3" />
                      </Link>
                    </div>
                    <iframe
                      title="Preview do Protótipo Visual do Projeto"
                      data-testid="visual-prototype-iframe"
                      src={visualFlow.previewUrl}
                      sandbox=""
                      className="h-56 w-full border-0 bg-canvas"
                    />
                  </div>
                ) : null}

                {/* Fluxo de Telas & Tokens W3C */}
                {visualFlow && (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="rounded border border-border-subtle bg-inset p-2.5">
                      <span className="block font-mono text-[10px] uppercase text-fg-muted">
                        Fluxo de Telas Planejado:
                      </span>
                      <ul className="mt-1.5 space-y-1 text-[11px] text-fg-primary">
                        {visualFlow.screensFlow.map((scr, i) => (
                          <li key={i} className="truncate">
                            {scr}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="rounded border border-border-subtle bg-inset p-2.5">
                      <span className="block font-mono text-[10px] uppercase text-fg-muted">
                        Tokens Visuais (.uzina/DESIGN.md):
                      </span>
                      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                        {visualFlow.tokensPreview.map((tk) => (
                          <div
                            key={tk.name}
                            className="flex items-center gap-1.5 font-mono text-[10px] text-fg-secondary"
                          >
                            <span
                              className="size-3 shrink-0 rounded-xs border border-border-default"
                              style={{ backgroundColor: tk.value }}
                            />
                            <span className="truncate">{tk.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Ações do Portão Visual: Aprovar Fluxo Visual ou Pedir Ajuste ao Designer */}
                <div className="space-y-2 border-t border-border-subtle pt-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-fg-primary">
                      Garantir que o código nasça com este fluxo visual:
                    </span>
                    <button
                      type="button"
                      data-testid="btn-approve-visual-flow"
                      disabled={chatMutation.isPending}
                      onClick={() =>
                        chatMutation.mutate({
                          message:
                            "Aprovar o protótipo e o fluxo visual atual para liberar a codificação dos slices de interface.",
                          intent: "approve_visual_flow",
                          projectId: projectState.projectId,
                          targetAgentRole: "ux_designer",
                        })
                      }
                      className="inline-flex h-7 items-center gap-1 rounded bg-status-ok px-2.5 text-[11px] font-semibold text-canvas hover:opacity-90 disabled:opacity-50"
                    >
                      <ShieldCheck className="size-3.5" />
                      <span>Aprovar Fluxo Visual p/ Codificação</span>
                    </button>
                  </div>

                  <div className="flex gap-1.5">
                    <input
                      aria-label="Feedback para ajustar o protótipo visual"
                      data-testid="input-visual-revision"
                      value={visualRevisionFeedback}
                      onChange={(e) =>
                        setVisualRevisionFeedback(e.target.value)
                      }
                      placeholder="Pedir ajuste no layout, cores ou fluxo de telas..."
                      className="h-8 flex-1 rounded border border-border-default bg-inset px-2.5 text-xs text-fg-primary"
                    />
                    <button
                      type="button"
                      data-testid="btn-revise-visual-flow"
                      disabled={chatMutation.isPending}
                      onClick={() =>
                        chatMutation.mutate({
                          message:
                            visualRevisionFeedback.trim() ||
                            "Refinar o protótipo visual destacando indicadores principais no topo.",
                          intent: "revise_visual_flow",
                          projectId: projectState.projectId,
                          targetAgentRole: "ux_designer",
                        })
                      }
                      className="inline-flex h-8 items-center gap-1 rounded border border-accent bg-accent-subtle px-2.5 text-[11px] font-semibold text-accent hover:bg-accent hover:text-accent-fg disabled:opacity-50"
                    >
                      <RotateCcw className="size-3" />
                      <span>Ajustar Visual</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : artifactTab === "long_term" ? (
              /* ABA 3: Artefatos de Longo Prazo do Projeto */
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
                        {activeLongTerm.ownerAgentName}
                      </span>
                    </div>
                    <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-fg-primary select-text">
                      {activeLongTerm.contentMarkdown}
                    </pre>
                  </div>
                )}
              </div>
            ) : (
              /* ABA 2: Artefatos Táticos de Cada Slice (Dossiê, Blueprint, Evidências + Aprovação / Retorno Cíclico) */
              <div className="mt-3 space-y-3">
                {sliceArtifacts.length === 0 ? (
                  <p className="py-8 text-center text-xs text-fg-muted">
                    Este projeto ainda não possui slices gerados.
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <label
                        htmlFor="select-slice-inspector"
                        className="text-xs font-medium text-fg-secondary"
                      >
                        Slice:
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
                              · Estratégia: {activeSlice.strategy} · Ciclo #
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

                        <div className="max-h-56 overflow-y-auto rounded border border-border-subtle bg-inset p-2.5 select-text">
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

                        <div className="space-y-2 border-t border-border-subtle pt-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[11px] font-semibold text-fg-primary">
                              Governança do Slice:
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
                                Voltar ao Produto
                              </option>
                              <option value="ux_designer">
                                Voltar ao Design
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
                              placeholder="O que corrigir neste slice?"
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
                <span>AST Poliglota Ativo</span>
              </span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
