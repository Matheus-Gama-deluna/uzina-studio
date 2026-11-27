"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ExecutiveProjectOverviewSchema,
  type ExecutiveProjectOverview,
  type ExecutiveStage,
  type OrgRole,
} from "@uzina/contracts";
import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Eye,
  FileText,
  Layers,
  PauseCircle,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { FontScaleToggle } from "./font-scale-toggle";
import { MarkdownProse } from "./markdown-prose";
import { MessageAudioPlayer } from "./message-audio-player";
import { NotificationsCenter } from "./notifications-center";
import { ThemeToggle } from "./theme-toggle";

interface ExecutiveActor {
  name: string;
  email: string;
  role: OrgRole;
}

const STAGE_STYLES: Record<
  ExecutiveStage,
  { dot: string; badge: string }
> = {
  ideacao: {
    dot: "bg-status-info",
    badge: "border-border-subtle bg-inset text-fg-secondary",
  },
  design_visual: {
    dot: "bg-accent",
    badge: "border-accent/35 bg-accent-subtle text-accent",
  },
  construcao: {
    dot: "bg-status-info",
    badge: "border-border-subtle bg-inset text-fg-secondary",
  },
  validacao_qualidade: {
    dot: "bg-status-info",
    badge: "border-border-subtle bg-inset text-fg-secondary",
  },
  aguardando_aprovacao: {
    dot: "bg-status-warn",
    badge: "border-status-warn/40 bg-status-warn/10 text-status-warn",
  },
  entregue: {
    dot: "bg-status-ok",
    badge: "border-status-ok/40 bg-status-ok/10 text-status-ok",
  },
  pausado: {
    dot: "bg-fg-muted",
    badge: "border-border-subtle bg-inset text-fg-muted",
  },
  atencao: {
    dot: "bg-status-danger",
    badge: "border-status-danger/40 bg-status-danger/10 text-status-danger",
  },
};

async function fetchExecutiveOverview(
  projectId: string | null
): Promise<ExecutiveProjectOverview> {
  const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  const res = await fetch(`/api/exec/overview${qs}`);
  if (!res.ok) {
    throw new Error("Não foi possível carregar o painel executivo.");
  }
  return ExecutiveProjectOverviewSchema.parse(await res.json());
}

export function ExecutiveCockpit({ actor }: { actor: ExecutiveActor }) {
  const queryClient = useQueryClient();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null
  );
  const [feedbackOk, setFeedbackOk] = useState<string | null>(null);
  const [feedbackErr, setFeedbackErr] = useState<string | null>(null);

  const overviewQuery = useQuery({
    queryKey: ["executive-overview", selectedProjectId ?? "default"],
    queryFn: () => fetchExecutiveOverview(selectedProjectId),
  });

  const canApprove = actor.role === "owner" || actor.role === "admin" || actor.role === "developer";

  const approveMutation = useMutation({
    mutationFn: async (decisionId: string) => {
      const res = await fetch(`/api/decisions/${decisionId}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "approved",
          humanFeedback: "Aprovado pela Superfície Executiva.",
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? "Falha ao registrar aprovação.");
      }
      return body;
    },
    onSuccess: async () => {
      setFeedbackErr(null);
      setFeedbackOk("Aprovação registrada com sucesso.");
      await queryClient.invalidateQueries({ queryKey: ["executive-overview"] });
    },
    onError: (err: Error) => {
      setFeedbackOk(null);
      setFeedbackErr(err.message);
    },
  });

  const data = overviewQuery.data;

  return (
    <div
      data-testid="executive-cockpit-root"
      className="min-h-screen bg-canvas text-fg-primary"
    >
      <header className="sticky top-0 z-30 border-b border-border-subtle bg-sidebar/95 backdrop-blur-md">
        <div className="mx-auto flex h-12 max-w-[1040px] items-center justify-between gap-2 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="truncate text-sm font-semibold tracking-tight text-fg-primary">
              Uzina Studio · Visão Executiva
            </span>
            <span className="hidden rounded border border-border-subtle bg-inset px-1.5 py-0.5 font-mono text-xs uppercase text-fg-muted sm:inline">
              {actor.role}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <div className="hidden sm:inline-flex">
              <FontScaleToggle />
            </div>
            <NotificationsCenter />
            <ThemeToggle />
            <Link
              href="/app"
              data-testid="exec-to-technical-link"
              className="inline-flex h-8 items-center gap-1 rounded-md border border-border-default bg-surface px-2.5 text-xs font-medium text-fg-secondary transition-colors hover:border-border-strong hover:text-fg-primary"
            >
              <span>Torre Técnica</span>
              <ArrowUpRight className="size-3.5" strokeWidth={1.75} />
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1040px] space-y-6 px-4 py-6 sm:px-6">
        {feedbackOk && (
          <div
            role="status"
            className="flex items-center gap-2 rounded-lg border border-status-ok/40 bg-status-ok/10 px-4 py-2.5 text-xs text-status-ok"
          >
            <CheckCircle2 className="size-4 shrink-0" />
            <span>{feedbackOk}</span>
          </div>
        )}
        {feedbackErr && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg border border-status-danger/40 bg-status-danger/10 px-4 py-2.5 text-xs text-status-danger"
          >
            <AlertCircle className="size-4 shrink-0" />
            <span>{feedbackErr}</span>
          </div>
        )}

        {overviewQuery.isLoading ? (
          <div
            data-testid="exec-loading-skeleton"
            className="space-y-4"
            aria-label="Carregando visão executiva"
          >
            <div className="h-28 animate-pulse rounded-xl border border-border-subtle bg-surface" />
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="h-24 animate-pulse rounded-xl border border-border-subtle bg-surface" />
              <div className="h-24 animate-pulse rounded-xl border border-border-subtle bg-surface" />
              <div className="h-24 animate-pulse rounded-xl border border-border-subtle bg-surface" />
            </div>
            <div className="h-56 animate-pulse rounded-xl border border-border-subtle bg-surface" />
          </div>
        ) : overviewQuery.isError ? (
          <div
            data-testid="exec-error-state"
            role="alert"
            className="uzina-card flex flex-wrap items-center justify-between gap-3 rounded-xl border border-status-danger/40 bg-status-danger/10 p-5"
          >
            <div className="flex items-center gap-2.5 text-sm text-status-danger">
              <AlertCircle className="size-5 shrink-0" />
              <span>
                {overviewQuery.error instanceof Error
                  ? overviewQuery.error.message
                  : "Erro ao carregar resumo executivo."}
              </span>
            </div>
            <button
              type="button"
              onClick={() => void overviewQuery.refetch()}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border-default bg-surface px-3.5 text-xs font-medium text-fg-primary hover:border-border-strong"
            >
              <RefreshCw className="size-3.5" />
              <span>Tentar novamente</span>
            </button>
          </div>
        ) : !data?.project ? (
          <section
            data-testid="exec-empty-state"
            className="uzina-card rounded-xl border border-border-subtle bg-surface p-8 text-center"
          >
            <Sparkles
              className="mx-auto size-7 text-accent"
              strokeWidth={1.75}
            />
            <h1 className="mt-3 text-lg font-semibold text-fg-primary">
              Nenhum produto ativo ainda
            </h1>
            <p className="mx-auto mt-1.5 max-w-md text-sm text-fg-secondary">
              Inicie uma nova ideia para acompanhar aqui o plano de produto,
              protótipos interativos e aprovações em linguagem simples.
            </p>
            <Link
              href="/app/ideas"
              className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-lg bg-accent px-5 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover"
            >
              <span>Iniciar Nova Ideia</span>
            </Link>
          </section>
        ) : (
          <>
            {/* Cabeçalho do Produto + Seletor Executivo */}
            <section className="uzina-card flex flex-wrap items-start justify-between gap-4 rounded-xl border border-border-subtle bg-surface p-5">
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="text-xs font-medium text-fg-muted">
                  Cliente: {data.project.clientName}
                </p>
                <h1 className="text-xl font-semibold tracking-tight text-fg-primary">
                  {data.project.name}
                </h1>
                {data.project.description && (
                  <p className="text-sm leading-relaxed text-fg-secondary">
                    {data.project.description}
                  </p>
                )}
              </div>

              {data.projects.length > 1 && (
                <div className="w-full sm:w-64">
                  <label
                    htmlFor="exec-project-select"
                    className="block text-xs font-medium text-fg-muted"
                  >
                    Produto exibido
                  </label>
                  <select
                    id="exec-project-select"
                    data-testid="exec-project-select"
                    value={data.project.id}
                    onChange={(e) => setSelectedProjectId(e.target.value)}
                    className="mt-1 h-9 w-full rounded-lg border border-border-default bg-inset px-3 text-xs text-fg-primary focus:border-border-strong focus:outline-none"
                  >
                    {data.projects.map((proj) => (
                      <option key={proj.id} value={proj.id}>
                        {proj.name} ({proj.clientName})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </section>

            {/* KPIs Executivos */}
            <section className="grid gap-3 sm:grid-cols-3">
              <div className="uzina-card rounded-xl border border-border-subtle bg-surface p-4">
                <p className="text-xs font-medium text-fg-muted">
                  Progresso Geral
                </p>
                <p
                  data-testid="exec-progress-percent"
                  className="mt-1 text-2xl font-semibold text-fg-primary tabular-nums"
                >
                  {data.progressPercent}%
                </p>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-inset">
                  <div
                    className="h-full rounded-full bg-status-ok transition-all"
                    style={{ width: `${data.progressPercent}%` }}
                  />
                </div>
              </div>

              <div className="uzina-card rounded-xl border border-border-subtle bg-surface p-4">
                <p className="text-xs font-medium text-fg-muted">
                  Entregas Concluídas
                </p>
                <p className="mt-1 text-2xl font-semibold text-fg-primary tabular-nums">
                  {data.counts.delivered} / {data.counts.total}
                </p>
                <p className="mt-1 text-xs text-fg-secondary tabular-nums">
                  {data.counts.inProgress} em andamento
                </p>
              </div>

              <div className="uzina-card rounded-xl border border-border-subtle bg-surface p-4">
                <p className="text-xs font-medium text-fg-muted">
                  Aguardando Sua Decisão
                </p>
                <p
                  data-testid="exec-pending-count"
                  className="mt-1 text-2xl font-semibold text-fg-primary tabular-nums"
                >
                  {data.counts.awaitingApproval}
                </p>
                <p className="mt-1 text-xs text-fg-secondary">
                  {data.counts.awaitingApproval > 0
                    ? "Pronto para revisão abaixo"
                    : "Nenhuma pendência no momento"}
                </p>
              </div>
            </section>

            {/* Aprovações Pendentes */}
            {data.pendingApprovals.length > 0 && (
              <section
                data-testid="exec-approvals-section"
                className="uzina-card space-y-3 rounded-xl border border-border-subtle bg-surface p-5"
              >
                <div className="flex items-center gap-2 text-sm font-semibold text-fg-primary">
                  <Clock className="size-4 text-status-warn" strokeWidth={1.75} />
                  <span>Aprovações Pendentes</span>
                </div>
                <div className="space-y-3">
                  {data.pendingApprovals.map((item, idx) => (
                    <div
                      key={item.decisionId}
                      data-testid={`exec-approval-card-${item.decisionId}`}
                      className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-inset p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-semibold text-fg-primary">
                          {item.deliverableTitle}
                        </p>
                        <p className="text-sm text-fg-secondary">
                          {item.summary}
                        </p>
                        <div className="flex flex-wrap items-center gap-3 pt-1">
                          {item.confidenceScore !== null && (
                            <span className="font-mono text-xs text-fg-muted tabular-nums">
                              Confiança:{" "}
                              {Math.round(item.confidenceScore * 100)}%
                            </span>
                          )}
                          <MessageAudioPlayer
                            text={item.spokenSummary}
                            title={item.deliverableTitle}
                            label="Ouvir resumo"
                          />
                        </div>
                      </div>

                      {canApprove && (
                        <button
                          type="button"
                          data-testid={`exec-approve-btn-${item.decisionId}`}
                          disabled={approveMutation.isPending}
                          onClick={() => approveMutation.mutate(item.decisionId)}
                          className={
                            idx === 0
                              ? "inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-accent px-4 text-xs font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-50"
                              : "inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border-default bg-surface px-4 text-xs font-semibold text-fg-primary hover:border-border-strong disabled:opacity-50"
                          }
                        >
                          <CheckCircle2 className="size-4" strokeWidth={1.75} />
                          <span>Aprovar Entrega</span>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Preview Visual & PRD Vivo */}
            <div className="grid gap-5 lg:grid-cols-2">
              <section className="uzina-card space-y-3 rounded-xl border border-border-subtle bg-surface p-5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-semibold text-fg-primary">
                    <FileText
                      className="size-4 text-fg-secondary"
                      strokeWidth={1.75}
                    />
                    <span>Visão de Produto (PRD)</span>
                  </div>
                </div>
                {data.prdExcerptMarkdown ? (
                  <div className="max-h-80 overflow-y-auto rounded-lg border border-border-subtle bg-inset p-4 text-sm">
                    <MarkdownProse content={data.prdExcerptMarkdown} />
                  </div>
                ) : (
                  <p className="rounded-lg border border-dashed border-border-subtle bg-inset p-4 text-sm text-fg-muted">
                    O documento de requisitos será preenchido automaticamente
                    conforme o escopo avançar.
                  </p>
                )}
              </section>

              <section className="uzina-card space-y-3 rounded-xl border border-border-subtle bg-surface p-5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-semibold text-fg-primary">
                    <Eye
                      className="size-4 text-fg-secondary"
                      strokeWidth={1.75}
                    />
                    <span>Protótipo Interativo</span>
                  </div>
                  {data.latestPrototype && (
                    <span className="font-mono text-xs text-fg-muted tabular-nums">
                      v{data.latestPrototype.version} ·{" "}
                      {data.latestPrototype.approved
                        ? "Aprovado"
                        : "Em revisão"}
                    </span>
                  )}
                </div>

                {data.latestPrototype ? (
                  <div className="overflow-hidden rounded-lg border border-border-subtle bg-inset">
                    <iframe
                      title={data.latestPrototype.title}
                      src={data.latestPrototype.previewUrl}
                      sandbox=""
                      className="h-72 w-full border-0 bg-white"
                    />
                  </div>
                ) : (
                  <p className="rounded-lg border border-dashed border-border-subtle bg-inset p-4 text-sm text-fg-muted">
                    Nenhum protótipo visual gerado para este produto ainda.
                  </p>
                )}
              </section>
            </div>

            {/* Linha do Tempo de Entregas */}
            <section
              data-testid="exec-timeline-section"
              className="uzina-card space-y-3 rounded-xl border border-border-subtle bg-surface p-5"
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-fg-primary">
                <Layers
                  className="size-4 text-fg-secondary"
                  strokeWidth={1.75}
                />
                <span>Linha do Tempo de Entregas</span>
              </div>

              {data.timeline.length === 0 ? (
                <p className="text-sm text-fg-muted">
                  Nenhuma entrega cadastrada neste produto até o momento.
                </p>
              ) : (
                <div className="divide-y divide-border-subtle rounded-lg border border-border-subtle bg-inset">
                  {data.timeline.map((item) => {
                    const st = STAGE_STYLES[item.executiveStage];
                    return (
                      <div
                        key={item.id}
                        data-testid={`exec-timeline-item-${item.id}`}
                        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <p className="truncate text-sm font-medium text-fg-primary">
                            {item.title}
                          </p>
                          {item.description && (
                            <p className="line-clamp-1 text-xs text-fg-secondary">
                              {item.description}
                            </p>
                          )}
                        </div>
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${st.badge}`}
                        >
                          {item.executiveStage === "pausado" ? (
                            <PauseCircle className="size-3" />
                          ) : (
                            <span
                              className={`size-1.5 rounded-full ${st.dot}`}
                            />
                          )}
                          <span>{item.stageLabel}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
