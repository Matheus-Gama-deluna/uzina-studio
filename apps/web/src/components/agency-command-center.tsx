"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgencyActionExecuted,
  AgencyAgentRole,
  AgencyChatIntent,
  AgencyChatResponse,
  AgencyControllerModeId,
  AgencyOverviewResponse,
  AgencyStreamEvent,
  AgencyThreadListResponse,
  AutonomyMode,
  BackgroundTaskSummary,
  ObservationalMemoryStatus,
  TeamTopologyMode,
} from "@uzina/contracts";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Compass,
  Layers,
  Loader2,
  Palette,
  Play,
  RotateCcw,
  Send,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { setActiveContext } from "@/lib/active-project-store";
import {
  useOfflineDraftQueue,
  useVisibilityReconnect,
  useVisualViewportKeyboard,
} from "@/lib/mobile-resilience";
import { IdeasHub } from "./ideas-hub";
import { MarkdownProse } from "./markdown-prose";
import { MessageAudioPlayer } from "./message-audio-player";
import { VoiceComposerControls } from "./voice-composer-controls";

const emptySubscribe = () => () => {};

interface ChatTurnItem {
  id: string;
  role: "user" | "assistant";
  content: string;
  spokenSummary?: string;
  agentName?: string;
  agentRole?: AgencyAgentRole;
  tierLabel?: string;
  boundModelId?: string;
  executionMode?: "live_llm" | "local_assisted";
  llmLatencyMs?: number | null;
  cycleNumber?: number;
  handedOffFrom?: AgencyAgentRole | null;
  actionsExecuted?: AgencyActionExecuted[];
  toolsUsed?: string[];
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
  activeProjectName = "",
  bootReady = true,
  hasAnyProjects = true,
}: {
  selectedClientId: string;
  activeProjectId: string;
  activeProjectName?: string;
  bootReady?: boolean;
  hasAnyProjects?: boolean;
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
  const [voiceMode, setVoiceMode] = useState(false);
  const [autoPlayTurnId, setAutoPlayTurnId] = useState<string | null>(null);
  const { keyboardHeight } = useVisualViewportKeyboard();
  const { drafts, isOnline, enqueueDraft, removeDraft } = useOfflineDraftQueue(
    `agency-chat:${activeProjectId || "global"}`
  );

  const storageKey = useMemo(
    () => `uzina:agency-chat-turns:${activeProjectId || "global"}`,
    [activeProjectId]
  );

  const [turnsByKey, setTurnsByKey] = useState<Record<string, ChatTurnItem[]>>(
    {}
  );
  const [threadIdByKey, setThreadIdByKey] = useState<
    Record<string, string | null>
  >({});
  const [omStatus, setOmStatus] = useState<ObservationalMemoryStatus | null>(
    null
  );
  const [controllerMode, setControllerMode] =
    useState<AgencyControllerModeId | null>(null);
  const [controllerSessionId, setControllerSessionId] = useState<string | null>(
    null
  );
  const [backgroundTaskEvents, setBackgroundTaskEvents] = useState<
    BackgroundTaskSummary[]
  >([]);
  const [planApproval, setPlanApproval] = useState<{
    sessionId: string;
    toolCallId: string;
    planSummary: string;
    transitionModeId: AgencyControllerModeId | null;
  } | null>(null);
  const [controllerNotice, setControllerNotice] = useState<string | null>(null);

  const activeThreadId = threadIdByKey[storageKey] ?? null;
  const effectiveSessionId = controllerSessionId ?? activeThreadId;
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!bootReady || !isHydrated) return;
    let cancelled = false;
    const ac = new AbortController();

    const params = new URLSearchParams();
    if (activeProjectId) {
      params.set("projectId", activeProjectId);
    }
    const threadsUrl = `/api/agency/threads${
      params.toString() ? `?${params.toString()}` : ""
    }`;

    void (async () => {
      try {
        const res = await fetch(threadsUrl, { signal: ac.signal });
        if (!res.ok || cancelled) return;
        const payload = (await res.json()) as AgencyThreadListResponse;
        if (cancelled) return;

        if (payload.activeThreadId) {
          setThreadIdByKey((prev) => ({
            ...prev,
            [storageKey]: prev[storageKey] ?? payload.activeThreadId,
          }));
        }

        if (payload.messages.length > 0) {
          const serverTurns: ChatTurnItem[] = payload.messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            agentName: m.agentName,
            agentRole: m.agentRole,
            executionMode: m.executionMode,
            boundModelId: m.boundModelId,
            llmLatencyMs: m.llmLatencyMs ?? null,
            cycleNumber: m.cycleNumber ?? undefined,
            toolsUsed: m.toolsUsed,
            actionsExecuted: m.actionsExecuted,
          }));
          setTurnsByKey((prev) => {
            const existing = prev[storageKey];
            const onlyInitialGreeting =
              Boolean(existing) &&
              existing!.length === 1 &&
              existing![0]?.id === INITIAL_GREETING_TURN.id;
            if (
              existing &&
              existing.length > 0 &&
              !onlyInitialGreeting &&
              serverTurns.length <= existing.length
            ) {
              return prev;
            }
            return { ...prev, [storageKey]: serverTurns };
          });
          try {
            window.localStorage.setItem(
              storageKey,
              JSON.stringify(serverTurns.slice(-30))
            );
          } catch {
            // ignore storage errors
          }
        }
      } catch {
        // Ignora falha silenciosa de hidratação (ex.: offline ou boot inicial)
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [bootReady, isHydrated, activeProjectId, storageKey]);

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

  useVisibilityReconnect(() => {
    if (!bootReady) return;
    void agencyQuery.refetch();
    void queryClient.invalidateQueries({ queryKey: ["deliverables"] });
    void queryClient.invalidateQueries({ queryKey: ["notifications"] });
  }, bootReady);

  const chatMutation = useMutation({
    mutationFn: async (payload: {
      message: string;
      intent: AgencyChatIntent;
      projectId?: string;
      targetAgentRole?: AgencyAgentRole;
    }) => {
      const userTurnId = crypto.randomUUID();
      const assistantTurnId = crypto.randomUUID();
      const baseTurns = [...chatTurns];
      const patchAssistantTurn = (
        updater: (prev: ChatTurnItem) => ChatTurnItem
      ) => {
        setTurnsByKey((prev) => {
          const list = prev[storageKey] ?? baseTurns;
          const exists = list.some((t) => t.id === assistantTurnId);
          if (!exists) return prev;
          return {
            ...prev,
            [storageKey]: list.map((t) =>
              t.id === assistantTurnId ? updater(t) : t
            ),
          };
        });
      };

      setTurnsByKey((prev) => ({
        ...prev,
        [storageKey]: [
          ...baseTurns,
          {
            id: userTurnId,
            role: "user",
            content: payload.message,
          },
          {
            id: assistantTurnId,
            role: "assistant",
            content: "",
            actionsExecuted: [],
            toolsUsed: [],
          },
        ],
      }));

      const res = await fetch("/api/agency/chat/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: payload.message,
          intent: payload.intent,
          teamTopology,
          autonomyMode,
          ...(selectedClientId !== "all" ? { clientId: selectedClientId } : {}),
          ...(payload.projectId ? { projectId: payload.projectId } : {}),
          ...(activeThreadId ? { threadId: activeThreadId } : {}),
          ...(payload.targetAgentRole
            ? { targetAgentRole: payload.targetAgentRole }
            : {}),
          ...(voiceMode ? { voiceMode: true } : {}),
        }),
      });

      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(err?.error ?? "Falha ao executar turno com agente.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalResponse: AgencyChatResponse | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";

        for (const block of blocks) {
          const dataLine = block
            .split("\n")
            .find((line) => line.startsWith("data: "));
          if (!dataLine) continue;
          const ev = JSON.parse(dataLine.slice(6)) as AgencyStreamEvent;

          if (ev.type === "thread_ready") {
            setThreadIdByKey((prev) => ({
              ...prev,
              [storageKey]: ev.threadId,
            }));
            patchAssistantTurn((turn) => ({
              ...turn,
              agentName: ev.activeAgent.name,
              agentRole: ev.activeAgent.role,
              tierLabel: ev.activeAgent.tierLabel,
              boundModelId: ev.activeAgent.boundModelId,
              executionMode: ev.executionMode,
              handedOffFrom: ev.handedOffFrom,
            }));
          } else if (ev.type === "action_executed") {
            patchAssistantTurn((turn) => ({
              ...turn,
              actionsExecuted: [...(turn.actionsExecuted ?? []), ev.action],
            }));
          } else if (ev.type === "tool_call") {
            patchAssistantTurn((turn) => {
              const current = turn.toolsUsed ?? [];
              return current.includes(ev.toolName)
                ? turn
                : { ...turn, toolsUsed: [...current, ev.toolName] };
            });
          } else if (ev.type === "token") {
            patchAssistantTurn((turn) => ({
              ...turn,
              content: `${turn.content}${ev.text}`,
            }));
          } else if (ev.type === "om_status") {
            setOmStatus(ev.status);
          } else if (ev.type === "controller_mode") {
            setControllerMode(ev.mode);
            setControllerSessionId(ev.sessionId);
          } else if (ev.type === "background_task") {
            setBackgroundTaskEvents((prev) =>
              [ev.task, ...prev.filter((t) => t.id !== ev.task.id)].slice(0, 6)
            );
          } else if (ev.type === "workflow_started") {
            setControllerNotice(
              `Workflow em 2º plano iniciado (entrega ${ev.deliverableId.slice(0, 8)}).`
            );
            void queryClient.invalidateQueries({
              queryKey: ["deliverables", activeProjectId],
            });
            void queryClient.invalidateQueries({
              queryKey: ["background-tasks", activeProjectId],
            });
          } else if (ev.type === "plan_approval_required") {
            setPlanApproval({
              sessionId: ev.sessionId,
              toolCallId: ev.toolCallId,
              planSummary: ev.planSummary,
              transitionModeId: ev.transitionModeId,
            });
          } else if (ev.type === "error") {
            throw new Error(ev.message);
          } else if (ev.type === "done") {
            finalResponse = ev.response;
          }
        }
      }

      if (!finalResponse) {
        throw new Error("Stream encerrado sem confirmação final da equipe.");
      }

      return { response: finalResponse, userTurnId, assistantTurnId };
    },
    onSuccess: async (
      { response: data, userTurnId, assistantTurnId },
      variables
    ) => {
      const resolvedProjId = data.projectState?.projectId ?? activeProjectId;
      if (data.threadId) {
        setThreadIdByKey((prev) => ({
          ...prev,
          [storageKey]: data.threadId ?? prev[storageKey] ?? null,
          ...(resolvedProjId
            ? {
                [`uzina:agency-chat-turns:${resolvedProjId}`]:
                  data.threadId ?? null,
              }
            : {}),
        }));
      }
      if (data.omStatus) {
        setOmStatus(data.omStatus);
      }

      const currentList = turnsByKey[storageKey] ?? chatTurns;
      const hasAssistant = currentList.some((t) => t.id === assistantTurnId);
      const completedTurn: ChatTurnItem = {
        id: assistantTurnId,
        role: "assistant",
        content: data.reply,
        spokenSummary: data.spokenSummary,
        agentName: data.activeAgent.name,
        agentRole: data.activeAgent.role,
        tierLabel: data.activeAgent.tierLabel,
        boundModelId: data.activeAgent.boundModelId,
        executionMode: data.executionMode,
        llmLatencyMs: data.llmLatencyMs,
        cycleNumber: data.cycleNumber,
        handedOffFrom: data.handedOffFrom,
        actionsExecuted: data.actionsExecuted,
        toolsUsed: data.toolsUsed,
      };
      const updatedTurns: ChatTurnItem[] = hasAssistant
        ? currentList.map((t) =>
            t.id === assistantTurnId ? completedTurn : t
          )
        : [
            ...currentList,
            {
              id: userTurnId,
              role: "user",
              content: variables.message,
            },
            completedTurn,
          ];
      persistTurns(updatedTurns, resolvedProjId);

      if (resolvedProjId && resolvedProjId !== activeProjectId) {
        setActiveContext({ projectId: resolvedProjId });
      }

      setChatInput("");
      if (voiceMode) {
        setAutoPlayTurnId(assistantTurnId);
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["deliverables"] }),
        queryClient.invalidateQueries({ queryKey: ["agency-status"] }),
      ]);
    },
    onError: (err: Error, variables) => {
      setChatInput((prev) => prev || variables.message);
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        void enqueueDraft({ kind: "text", text: variables.message });
      }
      setControllerNotice(
        err.message || "Falha ao enviar mensagem para a equipe."
      );
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

  const steerMutation = useMutation({
    mutationFn: async (message: string) => {
      if (!effectiveSessionId) {
        throw new Error("Nenhuma sessão ativa para redirecionar.");
      }
      const res = await fetch(
        `/api/agency/sessions/${encodeURIComponent(effectiveSessionId)}/steer`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            message,
            ...(activeProjectId ? { projectId: activeProjectId } : {}),
          }),
        }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(
          body?.error ?? "Falha ao enviar redirecionamento (Steer)."
        );
      }
      return res.json();
    },
    onSuccess: () => {
      setChatInput("");
      setControllerNotice("Orientação enviada ao AgentController (Steer).");
    },
    onError: (err: Error) => {
      setControllerNotice(err.message);
    },
  });

  const abortSessionMutation = useMutation({
    mutationFn: async () => {
      if (!effectiveSessionId) {
        throw new Error("Nenhuma sessão ativa para abortar.");
      }
      const res = await fetch(
        `/api/agency/sessions/${encodeURIComponent(effectiveSessionId)}/abort`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            reason: "Interrompido manualmente pelo operador no Chat.",
            ...(activeProjectId ? { projectId: activeProjectId } : {}),
          }),
        }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Falha ao abortar sessão.");
      }
      return res.json();
    },
    onSuccess: () => {
      setPlanApproval(null);
      setControllerNotice("Sessão interrompida com segurança pelo kill switch.");
    },
    onError: (err: Error) => {
      setControllerNotice(err.message);
    },
  });

  const planDecisionMutation = useMutation({
    mutationFn: async (params: {
      sessionId: string;
      toolCallId: string;
      approved: boolean;
    }) => {
      const res = await fetch(
        `/api/agency/sessions/${encodeURIComponent(params.sessionId)}/plan`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            toolCallId: params.toolCallId,
            approved: params.approved,
          }),
        }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Falha ao decidir aprovação de plano.");
      }
      return res.json();
    },
    onSuccess: (_data, vars) => {
      setPlanApproval(null);
      setControllerNotice(
        vars.approved
          ? "Plano aprovado e transição de modo liberada."
          : "Revisão do plano solicitada ao arquiteto."
      );
    },
    onError: (err: Error) => {
      setControllerNotice(err.message);
    },
  });

  const lastTurnContentLen =
    chatTurns[chatTurns.length - 1]?.content.length ?? 0;

  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chatTurns.length, lastTurnContentLen]);

  // Se o boot terminou e não há nenhum projeto cadastrado ainda, exibe diretamente a tela ampla de Ideias & Novo Projeto (Decisão A2)
  if (bootReady && !hasAnyProjects && !projectState) {
    return <IdeasHub embedded />;
  }

  function submitCurrentChat() {
    const trimmedMsg = chatInput.trim();
    if (!trimmedMsg || chatMutation.isPending) return;

    const chosenRole =
      selectedAgentRole === "auto" ? undefined : selectedAgentRole;

    setChatInput("");
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
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitCurrentChat();
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 lg:h-[calc(100dvh-5.25rem)]">
      {/* Barra de Contexto em 1 Linha Calma (projeto gerenciado pela Sidebar) */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2.5 border-b border-border-subtle pb-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <h1
            data-testid="chat-active-project-title"
            className="truncate text-base font-semibold text-fg-primary sm:text-lg"
          >
            {activeProjectName || "Chat da Engenharia"}
          </h1>

          {projectState && (
            <span
              data-testid="project-cycle-badge"
              className="inline-flex items-center gap-1.5 text-xs text-fg-secondary sm:text-sm"
            >
              <span className="size-1.5 rounded-full bg-fg-muted" />
              <span className="truncate tabular-nums">
                Ciclo #{projectState.cycleNumber} · {projectState.phaseLabel}
              </span>
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            data-testid="controller-mode-badge"
            className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border-subtle bg-surface px-2.5 text-xs font-medium text-fg-secondary"
          >
            <Compass className="size-3.5 text-fg-muted" strokeWidth={1.75} />
            <span>Modo: {controllerMode ?? "architect"}</span>
          </span>

          <span
            data-om-status={omStatus?.bufferingStatus ?? "idle"}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border-subtle bg-surface px-2.5 text-xs text-fg-secondary tabular-nums"
          >
            <span
              className={`size-1.5 rounded-full ${
                omStatus?.bufferingStatus === "running"
                  ? "bg-accent"
                  : "bg-fg-muted"
              }`}
            />
            <span>
              {omStatus
                ? `OM · Gen ${omStatus.generationCount} (${omStatus.activeMessageTokens} tok)`
                : "Memória OM"}
            </span>
          </span>

          <Link
            href="/app/providers"
            data-testid="llm-execution-mode-badge"
            className="inline-flex min-h-8 items-center gap-2 rounded-md border border-border-subtle bg-surface px-2.5 text-xs font-medium text-fg-secondary transition-colors hover:border-border-strong hover:text-fg-primary"
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
                ? `LLM Real Ativo (${readiness.activeProviderNames.join(", ")})`
                : "Assistido Local"}
            </span>
          </Link>

          <button
            type="button"
            data-testid="toggle-session-settings-btn"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((prev) => !prev)}
            className={`inline-flex min-h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors ${
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

      {/* Drawer Lateral de Configurações da Sessão (Equipe, Autonomia, Setup & Estratégia do Arquiteto) */}
      <Dialog.Root open={settingsOpen} onOpenChange={setSettingsOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs" />
          <Dialog.Content
            data-testid="session-settings-panel"
            aria-describedby={undefined}
            className="fixed right-0 top-0 z-50 flex h-full w-full max-w-xl flex-col gap-4 overflow-y-auto border-l border-border-default bg-surface p-5 shadow-2xl focus:outline-none"
          >
            <div className="flex items-center justify-between border-b border-border-subtle pb-3">
              <Dialog.Title className="text-sm font-semibold text-fg-primary">
                Configurações da Sessão &amp; Orquestração
              </Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="Fechar configurações da sessão"
                  className="rounded p-1.5 text-fg-muted transition-colors hover:bg-inset hover:text-fg-primary"
                >
                  <X className="size-4" strokeWidth={1.75} />
                </button>
              </Dialog.Close>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                  className="h-10 w-full rounded-md border border-border-default bg-inset px-3 py-1.5 text-sm leading-normal text-fg-primary"
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
                className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-inset p-3.5"
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

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    data-testid="btn-run-autonomous-cycle"
                    disabled={chatMutation.isPending}
                    onClick={() => {
                      setSettingsOpen(false);
                      chatMutation.mutate({
                        message:
                          "Executar ciclo autônomo avançando os slices pelas fases permitidas até o próximo portão visual ou HITL.",
                        intent: "advance_cycle",
                        projectId: projectState.projectId,
                      });
                    }}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border-default bg-surface px-3 text-xs font-medium text-fg-primary hover:border-border-strong disabled:opacity-50"
                  >
                    <Play className="size-3.5" />
                    <span>Executar Ciclo Autônomo</span>
                  </button>
                  <button
                    type="button"
                    data-testid="btn-cycle-architect"
                    disabled={chatMutation.isPending}
                    onClick={() => {
                      setSettingsOpen(false);
                      chatMutation.mutate({
                        message:
                          "Iniciar novo ciclo evolutivo com o Agente Arquiteto para reavaliar a arquitetura e atualizar os artefatos.",
                        intent: "revisit_architecture",
                        projectId: projectState.projectId,
                        targetAgentRole: "software_architect",
                      });
                    }}
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
              <div className="grid grid-cols-1 gap-2.5 border-t border-border-subtle pt-3">
                {readiness.steps.map((step) => (
                  <Link
                    key={step.id}
                    href={
                      step.id === "first_project_chat"
                        ? "/app/ideas"
                        : step.actionHref
                    }
                    onClick={() => setSettingsOpen(false)}
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
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Feed Amplo & Confortável de Mensagens (15px, leading-7, sem scroll duplo no desktop) */}
      <section
        data-testid="agency-chat-panel"
        className="uzina-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border-subtle bg-surface"
      >
        <div
          ref={chatScrollRef}
          data-testid="agency-chat-history"
          className="min-h-[260px] flex-1 space-y-4 overflow-y-auto p-4 sm:p-6 select-text"
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
                      {(turn.executionMode
                        ? turn.executionMode === "live_llm"
                        : Boolean(readiness?.llmProviderConfigured)) ? (
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

                {turn.role === "assistant" && turn.content && (
                  <div className="pt-1">
                    <MessageAudioPlayer
                      text={turn.spokenSummary ?? turn.content}
                      title={turn.agentName ?? "Agência Uzina"}
                      autoPlaySignal={
                        voiceMode && autoPlayTurnId === turn.id ? turn.id : null
                      }
                    />
                  </div>
                )}

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

                {turn.toolsUsed && turn.toolsUsed.length > 0 && (
                  <p className="font-mono text-[11px] text-fg-muted">
                    Ferramentas: {turn.toolsUsed.join(", ")}
                  </p>
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

        {/* Faixa de Próximo Passo Guiado + Seletor de Especialista + Composer Limpo */}
        <form
          onSubmit={handleSendChat}
          className="shrink-0 space-y-2.5 border-t border-border-subtle bg-inset/60 p-3.5 sm:px-6 sm:py-4"
        >
          {controllerNotice && (
            <div
              role="status"
              className="flex items-center justify-between gap-2 rounded-md border border-border-default bg-surface px-3 py-1.5 text-xs text-fg-secondary"
            >
              <span>{controllerNotice}</span>
              <button
                type="button"
                onClick={() => setControllerNotice(null)}
                className="text-fg-muted hover:text-fg-primary"
              >
                Fechar
              </button>
            </div>
          )}

          {backgroundTaskEvents.length > 0 && (
            <div
              data-testid="chat-background-tasks-strip"
              className="flex flex-wrap items-center gap-2 rounded-md border border-border-subtle bg-surface px-3 py-1.5 text-xs text-fg-secondary"
            >
              <span className="font-medium text-fg-primary">Segundo plano:</span>
              {backgroundTaskEvents.slice(0, 3).map((t) => (
                <span
                  key={t.id}
                  className="inline-flex items-center gap-1 rounded border border-border-subtle bg-inset px-2 py-0.5 font-mono text-xs tabular-nums"
                >
                  <span>{t.summary}</span>
                  <span className="text-fg-muted">({t.status})</span>
                </span>
              ))}
            </div>
          )}

          {planApproval && (
            <div
              data-testid="plan-approval-card"
              className="flex flex-col gap-2.5 rounded-lg border border-status-warn/40 bg-status-warn/10 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="space-y-0.5 text-xs">
                <p className="font-semibold text-fg-primary">
                  Aprovação de Plano Solicitada (
                  {planApproval.transitionModeId ?? "build"})
                </p>
                <p className="text-fg-secondary">{planApproval.planSummary}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  data-testid="btn-approve-plan"
                  disabled={planDecisionMutation.isPending}
                  onClick={() =>
                    planDecisionMutation.mutate({
                      sessionId: planApproval.sessionId,
                      toolCallId: planApproval.toolCallId,
                      approved: true,
                    })
                  }
                  className="inline-flex min-h-8 items-center rounded-md bg-accent px-3 text-xs font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-50"
                >
                  Aprovar Plano
                </button>
                <button
                  type="button"
                  data-testid="btn-reject-plan"
                  disabled={planDecisionMutation.isPending}
                  onClick={() =>
                    planDecisionMutation.mutate({
                      sessionId: planApproval.sessionId,
                      toolCallId: planApproval.toolCallId,
                      approved: false,
                    })
                  }
                  className="inline-flex min-h-8 items-center rounded-md border border-border-default bg-surface px-3 text-xs font-medium text-fg-secondary hover:text-fg-primary disabled:opacity-50"
                >
                  Solicitar Revisão
                </button>
              </div>
            </div>
          )}
          {/* 1 Próximo Passo Guiado (sem duplicar os links da sidebar) */}
          {(projectState || chatTurns.length > 1) && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-secondary">
              {projectState ? (
                visualFlow?.approvedForCodeHandoff ? (
                  <Link
                    href={`/app/deliverables?projectId=${encodeURIComponent(
                      projectState.projectId
                    )}`}
                    data-testid="chat-next-step-link"
                    className="inline-flex items-center gap-1.5 text-xs text-fg-secondary transition-colors hover:text-fg-primary"
                  >
                    <span className="size-1.5 rounded-full bg-status-ok" />
                    <span>
                      Fluxo visual aprovado · Acompanhar Entregas (
                      {projectState.sliceArtifacts.length})
                    </span>
                    <ArrowRight className="size-3.5" strokeWidth={1.75} />
                  </Link>
                ) : (
                  <Link
                    href={`/app/studio?projectId=${encodeURIComponent(
                      projectState.projectId
                    )}`}
                    data-testid="chat-next-step-link"
                    className="inline-flex items-center gap-1.5 text-xs text-fg-secondary transition-colors hover:text-fg-primary"
                  >
                    <span className="size-1.5 rounded-full bg-accent" />
                    <span>
                      {visualFlow?.previewUrl
                        ? "Protótipo visual disponível · Revisar no Estúdio Visual"
                        : "Próximo passo · Gerar ou revisar protótipo no Estúdio Visual"}
                    </span>
                    <ArrowRight className="size-3.5" strokeWidth={1.75} />
                  </Link>
                )
              ) : (
                <span />
              )}

              {chatTurns.length > 1 && (
                <button
                  type="button"
                  data-testid="btn-clear-chat-history"
                  onClick={() => {
                    persistTurns([INITIAL_GREETING_TURN]);
                    setThreadIdByKey((prev) => ({
                      ...prev,
                      [storageKey]: null,
                    }));
                    setOmStatus(null);
                  }}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-fg-muted hover:text-fg-primary"
                >
                  <Trash2 className="size-3.5" />
                  <span>Limpar conversa</span>
                </button>
              )}
            </div>
          )}

          {/* Caixa de Texto Confortável + Sugestões Discretas */}
          <div
            style={
              keyboardHeight > 0
                ? { paddingBottom: `${keyboardHeight}px` }
                : undefined
            }
            className="space-y-2"
          >
            {(!isOnline || drafts.length > 0) && (
              <div
                data-testid="offline-drafts-banner"
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-status-warn/40 bg-status-warn/10 px-3 py-2 text-xs text-fg-primary"
              >
                <span>
                  {!isOnline
                    ? "Sem conexão — novos envios serão salvos na fila local."
                    : `${drafts.length} rascunho(s) aguardando envio na fila offline.`}
                </span>
                {isOnline && drafts.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const first = drafts[0];
                      if (!first) return;
                      void removeDraft(first.id);
                      if (first.kind === "text" && first.text.trim()) {
                        chatMutation.mutate({
                          message: first.text.trim(),
                          intent: "general_chat",
                          ...(activeProjectId ? { projectId: activeProjectId } : {}),
                          ...(selectedAgentRole !== "auto"
                            ? { targetAgentRole: selectedAgentRole }
                            : {}),
                        });
                      }
                    }}
                    className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg hover:bg-accent-hover"
                  >
                    Reenviar pendente
                  </button>
                )}
              </div>
            )}
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

              {/* Direita: Voz + Controles de Intervenção + Único CTA Primário da Tela */}
              <div className="flex flex-wrap items-center gap-2">
                <VoiceComposerControls
                  disabled={chatMutation.isPending}
                  voiceMode={voiceMode}
                  onVoiceModeChange={setVoiceMode}
                  onOfflineAudioQueued={(blob, mimeType) => {
                    void enqueueDraft({
                      kind: "audio",
                      text: "Nota de voz offline",
                      audioBlob: blob,
                      audioMimeType: mimeType,
                    });
                  }}
                  onTranscribed={(text, opts) => {
                    if (opts.autoSend) {
                      chatMutation.mutate({
                        message: text,
                        intent: "general_chat",
                        ...(activeProjectId ? { projectId: activeProjectId } : {}),
                        ...(selectedAgentRole !== "auto"
                          ? { targetAgentRole: selectedAgentRole }
                          : {}),
                      });
                    } else {
                      setChatInput((prev) =>
                        prev.trim() ? `${prev.trim()} ${text}` : text
                      );
                    }
                  }}
                />
                {effectiveSessionId && (
                  <>
                    <button
                      type="button"
                      data-testid="btn-session-steer"
                      disabled={
                        steerMutation.isPending || chatInput.trim().length === 0
                      }
                      onClick={() => steerMutation.mutate(chatInput.trim())}
                      title="Envia a mensagem digitada como redirecionamento imediato sem aguardar o fim da fila"
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border-default bg-surface px-3 text-xs font-medium text-fg-primary hover:border-border-strong disabled:opacity-50"
                    >
                      <Compass className="size-3.5" />
                      <span>Intervir (Steer)</span>
                    </button>
                    <button
                      type="button"
                      data-testid="btn-session-abort"
                      disabled={
                        abortSessionMutation.isPending ||
                        (!chatMutation.isPending &&
                          !backgroundTaskEvents.some(
                            (t) =>
                              t.status === "running" ||
                              t.status === "queued" ||
                              t.status === "queued_waiting_lock"
                          ))
                      }
                      onClick={() => abortSessionMutation.mutate()}
                      title={
                        chatMutation.isPending ||
                        backgroundTaskEvents.some(
                          (t) =>
                            t.status === "running" ||
                            t.status === "queued" ||
                            t.status === "queued_waiting_lock"
                        )
                          ? "Interrompe imediatamente a sessão ativa do controlador"
                          : "Nenhuma execução em andamento para abortar"
                      }
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-status-danger/35 bg-status-danger/10 px-3 text-xs font-medium text-status-danger hover:bg-status-danger/15 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <Square className="size-3.5" />
                      <span>Abortar</span>
                    </button>
                  </>
                )}

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
