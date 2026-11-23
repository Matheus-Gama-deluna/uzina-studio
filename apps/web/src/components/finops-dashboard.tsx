"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FinopsSummarySchema,
  type TokenSavingsTechnique,
} from "@uzina/contracts";
import {
  ArrowLeft,
  Coins,
  Cpu,
  Gauge,
  RefreshCw,
  TrendingDown,
} from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { EngineConfigPanel } from "./engine-config-panel";

const TECHNIQUE_LABELS: Record<TokenSavingsTechnique, string> = {
  prompt_cache: "Prompt Cache",
  qmd: "QMD Híbrido",
  ast_graph: "Grafo AST & Slices",
  skeleton: "Esqueleto AST",
};

export function FinopsDashboard() {
  const queryClient = useQueryClient();
  const [technique, setTechnique] =
    useState<TokenSavingsTechnique>("skeleton");
  const [baselineInput, setBaselineInput] = useState("12000");
  const [actualInput, setActualInput] = useState("1100");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);

  const summaryQuery = useQuery({
    queryKey: ["finops-summary"],
    queryFn: async () => {
      const res = await fetch("/api/finops/summary");
      if (!res.ok) {
        throw new Error("Falha ao carregar métricas FinOps.");
      }
      return FinopsSummarySchema.parse(await res.json());
    },
  });

  const recordMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/finops/summary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          technique,
          tokensBaseline: Number(baselineInput),
          tokensActual: Number(actualInput),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Falha ao registrar evento FinOps.");
      }
      return res.json();
    },
    onSuccess: async () => {
      setStatusErr(null);
      setStatusMsg("Medição FinOps registrada.");
      await queryClient.invalidateQueries({ queryKey: ["finops-summary"] });
    },
    onError: (err: Error) => {
      setStatusMsg(null);
      setStatusErr(err.message);
    },
  });

  function handleRecord(e: FormEvent) {
    e.preventDefault();
    setStatusErr(null);
    recordMutation.mutate();
  }

  const summary = summaryQuery.data;

  return (
    <div className="min-w-0 max-w-full space-y-5" data-testid="finops-root">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/app"
              data-testid="back-to-chat-link"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border-default bg-surface px-3 text-xs font-medium text-fg-secondary transition-colors hover:border-accent hover:text-fg-primary"
            >
              <ArrowLeft className="size-3.5" strokeWidth={1.75} />
              <span>Voltar ao Chat do Projeto</span>
            </Link>
          </div>
          <h1 className="text-lg font-semibold tracking-tight text-fg-primary">
            FinOps de Tokens &amp; Isolamento
          </h1>
          <p className="text-xs text-fg-secondary">
            Economia medida por técnica (Prompt Cache, QMD, Grafo AST, Esqueleto) e taxa de retrabalho.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span
            data-testid="finops-workspace-badge"
            className="inline-flex min-h-9 items-center rounded border border-border-default bg-surface px-2.5 py-1 font-mono text-[11px] text-fg-secondary"
          >
            workspace: {summary?.workspaceKind ?? "worktree"}
          </span>
          <button
            type="button"
            onClick={() =>
              void queryClient.invalidateQueries({ queryKey: ["finops-summary"] })
            }
            className="inline-flex min-h-9 items-center gap-1.5 rounded border border-border-default bg-surface px-3 py-1 text-xs font-medium text-fg-secondary hover:border-accent hover:text-fg-primary"
          >
            <RefreshCw className="size-3.5" strokeWidth={1.75} />
            <span>Atualizar</span>
          </button>
        </div>
      </header>

      {statusMsg && (
        <div className="rounded border border-status-ok/40 bg-status-ok/10 px-3 py-2 text-xs text-status-ok">
          {statusMsg}
        </div>
      )}
      {statusErr && (
        <div className="rounded border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-xs text-status-danger">
          {statusErr}
        </div>
      )}

      {/* KPIs Principais */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div
          data-testid="finops-kpi-saved"
          className="rounded border border-border-subtle bg-surface p-3.5"
        >
          <div className="flex items-center justify-between text-fg-muted">
            <span className="text-[11px] uppercase tracking-wider">
              Tokens Economizados
            </span>
            <TrendingDown className="size-4 text-status-ok" strokeWidth={1.75} />
          </div>
          <p className="mt-1 font-mono text-xl font-semibold text-fg-primary tabular-nums">
            {(summary?.totalTokensSaved ?? 0).toLocaleString("pt-BR")}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-status-ok tabular-nums">
            {summary?.overallSavingsPercent ?? 0}% vs baseline
          </p>
        </div>

        <div
          data-testid="finops-kpi-cache"
          className="rounded border border-border-subtle bg-surface p-3.5"
        >
          <div className="flex items-center justify-between text-fg-muted">
            <span className="text-[11px] uppercase tracking-wider">
              Cache Hit Rate
            </span>
            <Cpu className="size-4 text-accent" strokeWidth={1.75} />
          </div>
          <p className="mt-1 font-mono text-xl font-semibold text-fg-primary tabular-nums">
            {summary?.cacheHitRate ?? 0}%
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-fg-muted tabular-nums">
            Esqueleto + Prompt Cache
          </p>
        </div>

        <div
          data-testid="finops-kpi-rework"
          className="rounded border border-border-subtle bg-surface p-3.5"
        >
          <div className="flex items-center justify-between text-fg-muted">
            <span className="text-[11px] uppercase tracking-wider">
              Rework Rate
            </span>
            <Gauge className="size-4 text-status-warn" strokeWidth={1.75} />
          </div>
          <p className="mt-1 font-mono text-xl font-semibold text-fg-primary tabular-nums">
            {summary?.reworkRate ?? 0}%
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-fg-muted tabular-nums">
            Verify &gt; 1 ou falhas
          </p>
        </div>

        <div
          data-testid="finops-kpi-usd"
          className="rounded border border-border-subtle bg-surface p-3.5"
        >
          <div className="flex items-center justify-between text-fg-muted">
            <span className="text-[11px] uppercase tracking-wider">
              Economia Estimada
            </span>
            <Coins className="size-4 text-status-ok" strokeWidth={1.75} />
          </div>
          <p className="mt-1 font-mono text-xl font-semibold text-status-ok tabular-nums">
            US$ {(summary?.estimatedCostSavedUsd ?? 0).toFixed(4)}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-fg-muted tabular-nums">
            {summary?.totalEvents ?? 0} evento(s)
          </p>
        </div>
      </section>

      {/* Breakdown por Técnica + Registro de Medição */}
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <section className="min-w-0 space-y-3 rounded border border-border-subtle bg-surface p-4">
          <h2 className="text-sm font-semibold text-fg-primary">
            Economia por Técnica
          </h2>
          <div className="space-y-2.5">
            {(summary?.byTechnique ?? []).map((item) => (
              <div
                key={item.technique}
                data-testid="finops-technique-row"
                className="space-y-1 rounded border border-border-subtle bg-inset p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-fg-primary">
                    {TECHNIQUE_LABELS[item.technique]}
                  </span>
                  <span className="font-mono text-[11px] text-status-ok tabular-nums">
                    {item.tokensSaved.toLocaleString("pt-BR")} tokens (
                    {item.savingsPercent}%)
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-canvas">
                  <div
                    className="h-full bg-accent transition-all"
                    style={{ width: `${Math.min(100, item.savingsPercent)}%` }}
                  />
                </div>
                <p className="font-mono text-[10px] text-fg-muted tabular-nums">
                  {item.eventsCount} evento(s) · baseline{" "}
                  {item.tokensBaseline.toLocaleString("pt-BR")} → real{" "}
                  {item.tokensActual.toLocaleString("pt-BR")}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="min-w-0 space-y-3 rounded border border-border-subtle bg-surface p-4">
          <h2 className="text-sm font-semibold text-fg-primary">
            Registrar Medição Manual / Telemetria
          </h2>
          <form onSubmit={handleRecord} className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <div>
                <label className="block text-[11px] text-fg-secondary">
                  Técnica
                </label>
                <select
                  value={technique}
                  onChange={(e) =>
                    setTechnique(e.target.value as TokenSavingsTechnique)
                  }
                  className="mt-1 w-full rounded border border-border-subtle bg-inset px-2.5 py-1.5 text-xs text-fg-primary focus:border-accent focus:outline-none"
                >
                  {Object.entries(TECHNIQUE_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-fg-secondary">
                  Baseline (tokens)
                </label>
                <input
                  type="number"
                  min={0}
                  data-testid="finops-baseline-input"
                  value={baselineInput}
                  onChange={(e) => setBaselineInput(e.target.value)}
                  className="mt-1 w-full rounded border border-border-subtle bg-inset px-2.5 py-1.5 font-mono text-xs text-fg-primary tabular-nums focus:border-accent focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] text-fg-secondary">
                  Real (tokens)
                </label>
                <input
                  type="number"
                  min={0}
                  data-testid="finops-actual-input"
                  value={actualInput}
                  onChange={(e) => setActualInput(e.target.value)}
                  className="mt-1 w-full rounded border border-border-subtle bg-inset px-2.5 py-1.5 font-mono text-xs text-fg-primary tabular-nums focus:border-accent focus:outline-none"
                />
              </div>
            </div>
            <button
              type="submit"
              data-testid="finops-record-submit"
              disabled={recordMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded border border-accent/50 bg-accent/15 px-3 py-1.5 text-xs font-medium text-fg-primary hover:bg-accent/25 disabled:opacity-50"
            >
              {recordMutation.isPending ? "Salvando..." : "Registrar Medição"}
            </button>
          </form>

          <div className="space-y-2 pt-2">
            <h3 className="text-xs font-semibold text-fg-secondary">
              Eventos Recentes
            </h3>
            {(summary?.recentEvents ?? []).length === 0 ? (
              <p className="rounded border border-border-subtle bg-inset px-3 py-2 text-xs text-fg-muted">
                Nenhum evento FinOps registrado ainda.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {(summary?.recentEvents ?? []).slice(0, 8).map((ev) => (
                  <li
                    key={ev.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-border-subtle bg-inset px-2.5 py-1.5 text-[11px]"
                  >
                    <span className="font-mono text-fg-primary">
                      {TECHNIQUE_LABELS[ev.technique]}
                    </span>
                    <span className="font-mono text-status-ok tabular-nums">
                      -{ev.tokensSaved.toLocaleString("pt-BR")} ({ev.savingsPercent}%)
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <EngineConfigPanel />
    </div>
  );
}
