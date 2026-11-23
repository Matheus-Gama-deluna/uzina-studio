"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  EvidencePackSchema,
  type Decision,
  type DecisionListResponse,
  type DecisionStatus,
  type EvidencePack,
  type ExecutionEvent,
} from "@uzina/contracts";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  GitBranch,
  Loader2,
  MessageSquareWarning,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type StatusFilter = "all" | DecisionStatus;

const GATE_LABELS: Record<string, string> = {
  discovery_confirm: "Discovery",
  blueprint_approve: "Blueprint",
  visual_approve: "Estúdio Visual",
  pr_evidence_approve: "PR & Evidências",
  stuck_intervention: "Intervenção Stuck",
};

const STATUS_BADGE: Record<
  DecisionStatus,
  { label: string; className: string }
> = {
  pending: {
    label: "Pendente",
    className: "border-status-warn/40 bg-status-warn/10 text-status-warn",
  },
  approved: {
    label: "Aprovada",
    className: "border-status-ok/40 bg-status-ok/10 text-status-ok",
  },
  changes_requested: {
    label: "Ajustes Solicitados",
    className: "border-status-info/40 bg-status-info/10 text-status-info",
  },
  rejected: {
    label: "Rejeitada",
    className: "border-status-error/40 bg-status-error/10 text-status-error",
  },
};

async function fetchDecisions(
  filter: StatusFilter
): Promise<DecisionListResponse> {
  const qs = filter === "all" ? "" : `?status=${encodeURIComponent(filter)}`;
  const res = await fetch(`/api/decisions${qs}`);
  if (!res.ok) {
    throw new Error("Não foi possível carregar a Caixa de Decisões.");
  }
  return (await res.json()) as DecisionListResponse;
}

function parseEvidencePack(decision: Decision | null): EvidencePack | null {
  if (!decision) return null;
  const raw = decision.payloadJson?.evidencePack;
  if (!raw) return null;
  const parsed = EvidencePackSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function DecisionsWorkbench() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [eventsState, setEventsState] = useState<{
    deliverableId: string | null;
    items: ExecutionEvent[];
  }>({ deliverableId: null, items: [] });

  const decisionsQuery = useQuery({
    queryKey: ["decisions", statusFilter],
    queryFn: () => fetchDecisions(statusFilter),
  });

  const items = useMemo(
    () => decisionsQuery.data?.items ?? [],
    [decisionsQuery.data]
  );

  const selectedDecision = useMemo(() => {
    if (items.length === 0) return null;
    return items.find((item) => item.id === selectedId) ?? items[0] ?? null;
  }, [items, selectedId]);

  const liveEvents = useMemo(() => {
    if (!selectedDecision) return [];
    return eventsState.deliverableId === selectedDecision.deliverableId
      ? eventsState.items
      : [];
  }, [selectedDecision, eventsState]);

  const evidencePack = useMemo(
    () => parseEvidencePack(selectedDecision),
    [selectedDecision]
  );

  useEffect(() => {
    if (!selectedDecision) {
      return;
    }

    const activeDeliverableId = selectedDecision.deliverableId;
    let cancelled = false;

    const source = new EventSource(
      `/api/deliverables/${activeDeliverableId}/events`
    );

    const handleEvent = (rawEvent: MessageEvent<string>) => {
      if (cancelled) return;
      try {
        const parsed = JSON.parse(rawEvent.data) as ExecutionEvent;
        if (parsed?.id) {
          setEventsState((prev) => {
            const base =
              prev.deliverableId === activeDeliverableId ? prev.items : [];
            if (base.some((e) => e.id === parsed.id)) return prev;
            return {
              deliverableId: activeDeliverableId,
              items: [...base.slice(-29), parsed],
            };
          });
        }
      } catch {
        // Ignora frames não-JSON como snapshot_end
      }
    };

    for (const evType of [
      "stage_change",
      "tool_call",
      "stuck_alert",
      "verify_result",
      "token_usage",
      "error",
    ]) {
      source.addEventListener(evType, handleEvent as EventListener);
    }

    return () => {
      cancelled = true;
      source.close();
    };
  }, [selectedDecision]);

  const resolveMutation = useMutation({
    mutationFn: async (params: {
      decisionId: string;
      status: "approved" | "changes_requested" | "rejected";
      humanFeedback?: string;
    }) => {
      const res = await fetch(
        `/api/decisions/${params.decisionId}/resolve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            status: params.status,
            ...(params.humanFeedback?.trim()
              ? { humanFeedback: params.humanFeedback.trim() }
              : {}),
          }),
        }
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? "Falha ao resolver decisão.");
      }
      return data;
    },
    onSuccess: async (_data, vars) => {
      setActionError(null);
      setActionSuccess(
        vars.status === "approved"
          ? "Decisão aprovada e workflow retomado."
          : vars.status === "changes_requested"
            ? "Ajustes solicitados e entregável retornado para correção."
            : "Entrega rejeitada e worktree encerrado."
      );
      setFeedbackText("");
      await queryClient.invalidateQueries({ queryKey: ["decisions"] });
    },
    onError: (err: Error) => {
      setActionSuccess(null);
      setActionError(err.message);
    },
  });

  function handleResolve(status: "approved" | "changes_requested" | "rejected") {
    if (!selectedDecision) return;
    setActionError(null);
    setActionSuccess(null);

    if (status === "changes_requested" && feedbackText.trim().length < 3) {
      setActionError(
        "Informe uma orientação de ajuste com pelo menos 3 caracteres."
      );
      return;
    }

    resolveMutation.mutate({
      decisionId: selectedDecision.id,
      status,
      humanFeedback: feedbackText.trim() || undefined,
    });
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header className="flex flex-col gap-3 border-b border-border-subtle pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-fg-muted">
            <ClipboardCheck className="size-4 text-fg-secondary" strokeWidth={1.75} />
            <span>Governança HITL</span>
          </div>
          <h1 className="mt-1.5 text-xl font-semibold tracking-tight text-fg-primary">
            Caixa de Decisões &amp; Pacote de Evidências
          </h1>
          <p className="mt-1 text-sm text-fg-secondary">
            Revise relatórios de verificação, postura AppSec e aprove merges ou
            retomadas de workflow.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div
            role="tablist"
            aria-label="Filtrar decisões por status"
            className="inline-flex flex-wrap rounded-md border border-border-default bg-inset p-0.5"
          >
            {(
              [
                { id: "pending", label: "Pendentes" },
                { id: "approved", label: "Aprovadas" },
                { id: "changes_requested", label: "Ajustes" },
                { id: "rejected", label: "Rejeitadas" },
                { id: "all", label: "Todas" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={statusFilter === tab.id}
                onClick={() => setStatusFilter(tab.id)}
                className={`min-h-8 rounded px-3 text-xs font-medium transition-colors ${
                  statusFilter === tab.id
                    ? "border border-border-subtle bg-surface text-fg-primary"
                    : "text-fg-secondary hover:text-fg-primary"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => decisionsQuery.refetch()}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border-default bg-surface px-3 text-xs font-medium text-fg-secondary transition-colors hover:border-border-strong hover:text-fg-primary"
            aria-label="Atualizar decisões"
          >
            <RefreshCw className="size-3.5" strokeWidth={1.75} />
            <span>Atualizar</span>
          </button>
        </div>
      </header>

      {decisionsQuery.isLoading ? (
        <div
          className="grid gap-4 lg:grid-cols-12"
          aria-label="Carregando decisões"
        >
          <div className="space-y-2 lg:col-span-4">
            <div className="h-24 animate-pulse rounded-lg border border-border-subtle bg-surface" />
            <div className="h-24 animate-pulse rounded-lg border border-border-subtle bg-surface" />
          </div>
          <div className="h-80 animate-pulse rounded-lg border border-border-subtle bg-surface lg:col-span-8" />
        </div>
      ) : decisionsQuery.isError ? (
        <div className="flex items-center justify-between rounded-lg border border-status-error/40 bg-status-error/10 p-4 text-sm text-status-error">
          <div className="flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0" strokeWidth={1.75} />
            <span>
              {decisionsQuery.error instanceof Error
                ? decisionsQuery.error.message
                : "Erro ao carregar fila de decisões."}
            </span>
          </div>
          <button
            type="button"
            onClick={() => decisionsQuery.refetch()}
            className="rounded border border-status-error/40 px-2.5 py-1 text-xs font-medium hover:bg-status-error/15"
          >
            Tentar novamente
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border-default bg-surface px-6 py-14 text-center">
          <CheckCircle2
            className="size-8 text-fg-muted"
            strokeWidth={1.5}
          />
          <h2 className="mt-3 text-sm font-medium text-fg-primary">
            Nenhuma decisão encontrada neste filtro
          </h2>
          <p className="mt-1 max-w-md text-xs text-fg-secondary">
            Quando um entregável pausar em Discovery, Blueprint, Estúdio Visual,
            Stuck ou PR & Evidências, a solicitação aparecerá aqui.
          </p>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-12">
          <section
            aria-label="Fila de decisões"
            className="space-y-2 lg:col-span-4"
          >
            {items.map((item) => {
              const isSelected = selectedDecision?.id === item.id;
              const badge = STATUS_BADGE[item.status];
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(item.id);
                    setActionError(null);
                    setActionSuccess(null);
                  }}
                  className={`uzina-card w-full rounded-xl border p-4 text-left transition-colors ${
                    isSelected
                      ? "border-border-strong bg-elevated"
                      : "border-border-subtle bg-surface hover:border-border-default hover:bg-elevated/50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded border border-border-default bg-inset px-2 py-0.5 font-mono text-xs text-fg-secondary">
                      {GATE_LABELS[item.decisionType] ?? item.decisionType}
                    </span>
                    <span
                      className={`rounded border px-2 py-0.5 text-xs font-medium ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm font-medium text-fg-primary">
                    {item.deliverableTitle ?? item.summary}
                  </p>
                  <p className="mt-1 line-clamp-1 text-xs text-fg-secondary">
                    {item.projectName ?? item.summary}
                  </p>
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-fg-muted tabular-nums">
                    <Clock className="size-3.5" strokeWidth={1.75} />
                    <span>
                      {new Date(item.createdAt).toLocaleString("pt-BR")}
                    </span>
                  </div>
                </button>
              );
            })}
          </section>

          {selectedDecision && (
            <section
              aria-label="Detalhes da decisão selecionada"
              className="uzina-card space-y-5 rounded-xl border border-border-subtle bg-surface p-5 lg:col-span-8"
            >
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border-subtle pb-4">
                <div>
                  <span className="font-mono text-xs uppercase text-fg-muted">
                    {GATE_LABELS[selectedDecision.decisionType] ??
                      selectedDecision.decisionType}
                  </span>
                  <h2 className="mt-1 text-lg font-semibold text-fg-primary">
                    {selectedDecision.summary}
                  </h2>
                  <p className="mt-0.5 text-xs text-fg-muted tabular-nums">
                    Step: {selectedDecision.mastraStepId} • Entregável:{" "}
                    {selectedDecision.deliverableId}
                  </p>
                </div>
                <span
                  className={`rounded border px-2.5 py-1 text-xs font-medium ${STATUS_BADGE[selectedDecision.status].className}`}
                >
                  {STATUS_BADGE[selectedDecision.status].label}
                </span>
              </div>

              {evidencePack ? (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-md border border-border-subtle bg-inset p-3">
                      <span className="text-xs font-medium text-fg-muted">
                        Branch
                      </span>
                      <div className="mt-1 flex items-center gap-1.5 truncate font-mono text-xs text-fg-primary">
                        <GitBranch className="size-3.5 shrink-0 text-fg-secondary" />
                        <span className="truncate">
                          {evidencePack.branchName}
                        </span>
                      </div>
                    </div>
                    <div className="rounded-md border border-border-subtle bg-inset p-3">
                      <span className="text-xs font-medium text-fg-muted">
                        Verify (.uzina/verify)
                      </span>
                      <p className="mt-1 font-mono text-sm font-semibold text-fg-primary tabular-nums">
                        {evidencePack.verifyPassed ? "APROVADO" : "REPROVADO"} •{" "}
                        {evidencePack.verifyAttempts}x
                      </p>
                    </div>
                    <div className="rounded-md border border-border-subtle bg-inset p-3">
                      <span className="text-xs font-medium text-fg-muted">
                        AppSec Gate
                      </span>
                      <p className="mt-1 font-mono text-sm font-semibold text-fg-primary tabular-nums">
                        C:{evidencePack.securitySummary.critical} H:
                        {evidencePack.securitySummary.high} M:
                        {evidencePack.securitySummary.medium}
                      </p>
                    </div>
                    <div className="rounded-md border border-border-subtle bg-inset p-3">
                      <span className="text-xs font-medium text-fg-muted">
                        Tokens / Custo
                      </span>
                      <p className="mt-1 font-mono text-sm font-semibold text-fg-primary tabular-nums">
                        {(
                          evidencePack.tokenSummary.totalInputTokens +
                          evidencePack.tokenSummary.totalOutputTokens
                        ).toLocaleString("pt-BR")}{" "}
                        • \${evidencePack.tokenSummary.estimatedCostUsd.toFixed(4)}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-md border border-border-subtle bg-inset p-3.5">
                    <div className="flex items-center justify-between">
                      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-fg-secondary">
                        <ShieldCheck className="size-3.5 text-accent" />
                        <span>Checks Determinísticos & Verifier</span>
                      </h3>
                      <span className="font-mono text-xs text-fg-muted tabular-nums">
                        {evidencePack.diffSummary.filesChanged} arquivo(s) •{" "}
                        {evidencePack.diffSummary.diffBytes} bytes
                      </span>
                    </div>
                    <ul className="mt-2.5 space-y-1.5">
                      {evidencePack.verifyChecks.map((chk) => (
                        <li
                          key={chk.name}
                          className="flex items-center justify-between rounded border border-border-subtle bg-surface px-2.5 py-1.5 text-xs"
                        >
                          <span className="flex items-center gap-2 font-mono text-fg-primary">
                            <span
                              className={
                                chk.passed
                                  ? "text-status-ok"
                                  : "text-status-error"
                              }
                            >
                              {chk.passed ? "PASS" : "FAIL"}
                            </span>
                            <span>{chk.name}</span>
                          </span>
                          <span className="truncate pl-4 text-fg-secondary tabular-nums">
                            {chk.summary} ({chk.durationMs}ms)
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2.5 text-xs text-fg-secondary">
                      <strong className="text-fg-primary">
                        Verifier ({evidencePack.verifierVerdict}):
                      </strong>{" "}
                      {evidencePack.verifierNotes}
                    </p>
                    {evidencePack.diffSummary.preview && (
                      <pre className="mt-3 max-h-44 overflow-auto rounded border border-border-subtle bg-canvas p-2.5 font-mono text-xs text-fg-secondary">
                        {evidencePack.diffSummary.preview}
                      </pre>
                    )}
                  </div>
                </div>
              ) : (
                <pre className="max-h-60 overflow-auto rounded-md border border-border-subtle bg-canvas p-3 font-mono text-xs text-fg-secondary">
                  {JSON.stringify(selectedDecision.payloadJson, null, 2)}
                </pre>
              )}

              <div className="rounded-md border border-border-subtle bg-inset p-3.5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-secondary">
                  Timeline de Execução (SSE)
                </h3>
                {liveEvents.length === 0 ? (
                  <p className="mt-2 text-xs text-fg-muted">
                    Nenhum evento registrado ou stream aguardando novos eventos.
                  </p>
                ) : (
                  <ul className="mt-2 max-h-36 space-y-1 overflow-auto font-mono text-xs">
                    {liveEvents.map((ev) => (
                      <li
                        key={ev.id}
                        className="flex items-center justify-between text-fg-secondary tabular-nums"
                      >
                        <span>
                          [{ev.stage}] {ev.eventType} ({ev.actorRole})
                        </span>
                        <span className="text-fg-muted">
                          {new Date(ev.createdAt).toLocaleTimeString("pt-BR")}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {selectedDecision.status === "pending" && (
                <div className="space-y-3 border-t border-border-subtle pt-4">
                  <label
                    htmlFor="decision-feedback"
                    className="block text-xs font-medium text-fg-secondary"
                  >
                    Orientação / Racional (obrigatório ao solicitar ajustes)
                  </label>
                  <textarea
                    id="decision-feedback"
                    rows={3}
                    value={feedbackText}
                    onChange={(e) => setFeedbackText(e.target.value)}
                    placeholder="Ex.: Cobrir cenário de timeout no endpoint ou aprovar merge na main..."
                    className="w-full rounded-md border border-border-default bg-inset px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-border-strong focus:outline-none"
                  />

                  {selectedDecision.decisionType === "pr_evidence_approve" && (
                    <p className="text-xs text-fg-muted">
                      Governança RBAC: apenas perfis{" "}
                      <code className="font-mono text-fg-secondary">owner</code>{" "}
                      ou{" "}
                      <code className="font-mono text-fg-secondary">admin</code>{" "}
                      podem concluir o portão de PR &amp; Evidências.
                    </p>
                  )}

                  {actionError && (
                    <div
                      role="alert"
                      className="flex items-center gap-2 rounded-md border border-status-error/40 bg-status-error/10 px-3 py-2 text-xs text-status-error"
                    >
                      <AlertCircle className="size-4 shrink-0" />
                      <span>{actionError}</span>
                    </div>
                  )}

                  {actionSuccess && (
                    <div
                      role="status"
                      className="flex items-center gap-2 rounded-md border border-status-ok/40 bg-status-ok/10 px-3 py-2 text-xs text-status-ok"
                    >
                      <CheckCircle2 className="size-4 shrink-0" />
                      <span>{actionSuccess}</span>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={resolveMutation.isPending}
                      onClick={() => handleResolve("approved")}
                      className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-2 text-xs font-semibold text-base transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {resolveMutation.isPending ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="size-3.5" />
                      )}
                      <span>Aprovar & Prosseguir</span>
                    </button>

                    <button
                      type="button"
                      disabled={resolveMutation.isPending}
                      onClick={() => handleResolve("changes_requested")}
                      className="inline-flex items-center gap-1.5 rounded-md border border-status-info/40 bg-status-info/10 px-3.5 py-2 text-xs font-semibold text-status-info hover:bg-status-info/15 disabled:opacity-50"
                    >
                      <MessageSquareWarning className="size-3.5" />
                      <span>Solicitar Ajustes</span>
                    </button>

                    <button
                      type="button"
                      disabled={resolveMutation.isPending}
                      onClick={() => handleResolve("rejected")}
                      className="inline-flex items-center gap-1.5 rounded-md border border-status-error/40 bg-status-error/10 px-3.5 py-2 text-xs font-semibold text-status-error hover:bg-status-error/15 disabled:opacity-50"
                    >
                      <XCircle className="size-3.5" />
                      <span>Rejeitar Entrega</span>
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
