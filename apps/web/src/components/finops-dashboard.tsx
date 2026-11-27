"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FinopsSummarySchema,
  type TokenSavingsTechnique,
} from "@uzina/contracts";
import {
  ChevronDown,
  ChevronRight,
  Coins,
  Cpu,
  Gauge,
  RefreshCw,
  TrendingDown,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { AgentEffectivenessPanel } from "./agent-effectiveness-panel";
import { EngineConfigPanel } from "./engine-config-panel";
import { SkillsCatalogPanel } from "./skills-catalog-panel";

const TECHNIQUE_LABELS: Record<TokenSavingsTechnique, string> = {
  prompt_cache: "Prompt Cache",
  qmd: "QMD Híbrido",
  ast_graph: "Grafo AST & Slices",
  skeleton: "Esqueleto AST",
  observational_memory: "Memória Observacional",
};

export function FinopsDashboard() {
  const queryClient = useQueryClient();
  const [technique, setTechnique] =
    useState<TokenSavingsTechnique>("skeleton");
  const [baselineInput, setBaselineInput] = useState("12000");
  const [actualInput, setActualInput] = useState("1100");
  const [manualOpen, setManualOpen] = useState(false);
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
    <div
      className="mx-auto w-full max-w-6xl min-w-0 space-y-6"
      data-testid="finops-root"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-medium text-fg-muted">
            <Coins className="size-4 text-fg-secondary" strokeWidth={1.75} />
            <span>Economia de Tokens &amp; Telemetria</span>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-fg-primary">
            FinOps de Tokens &amp; Isolamento
          </h1>
          <p className="text-sm text-fg-secondary">
            Economia medida por técnica (Prompt Cache, QMD, Grafo AST, Esqueleto) e taxa de retrabalho.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span
            data-testid="finops-workspace-badge"
            className="inline-flex items-center gap-1.5 font-mono text-xs text-fg-muted"
          >
            <span className="size-1.5 rounded-full bg-status-ok" />
            <span>workspace: {summary?.workspaceKind ?? "worktree"}</span>
          </span>
          <button
            type="button"
            data-testid="finops-refresh-btn"
            onClick={() => {
              void queryClient.invalidateQueries({ queryKey: ["finops-summary"] });
              void queryClient.invalidateQueries({ queryKey: ["finops-effectiveness"] });
              void queryClient.invalidateQueries({ queryKey: ["engine-config"] });
            }}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border-default bg-surface px-3 text-xs font-medium text-fg-secondary transition-colors hover:border-border-strong hover:text-fg-primary"
          >
            <RefreshCw className="size-3.5" strokeWidth={1.75} />
            <span>Atualizar</span>
          </button>
        </div>
      </header>

      {statusMsg && (
        <div className="rounded-lg border border-status-ok/40 bg-status-ok/10 px-4 py-2.5 text-xs text-status-ok">
          {statusMsg}
        </div>
      )}
      {statusErr && (
        <div className="rounded-lg border border-status-danger/40 bg-status-danger/10 px-4 py-2.5 text-xs text-status-danger">
          {statusErr}
        </div>
      )}

      {/* KPIs Principais */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div
          data-testid="finops-kpi-saved"
          className="uzina-card rounded-xl border border-border-subtle bg-surface p-4"
        >
          <div className="flex items-center justify-between text-fg-muted">
            <span className="text-xs font-medium text-fg-secondary">
              Tokens Economizados
            </span>
            <TrendingDown className="size-4 text-status-ok" strokeWidth={1.75} />
          </div>
          <p className="mt-1.5 font-mono text-2xl font-semibold text-fg-primary tabular-nums">
            {(summary?.totalTokensSaved ?? 0).toLocaleString("pt-BR")}
          </p>
          <p className="mt-1 font-mono text-xs text-status-ok tabular-nums">
            {summary?.overallSavingsPercent ?? 0}% vs baseline
          </p>
        </div>

        <div
          data-testid="finops-kpi-cache"
          className="uzina-card rounded-xl border border-border-subtle bg-surface p-4"
        >
          <div className="flex items-center justify-between text-fg-muted">
            <span className="text-xs font-medium text-fg-secondary">
              Cache Hit Rate
            </span>
            <Cpu className="size-4 text-fg-secondary" strokeWidth={1.75} />
          </div>
          <p className="mt-1.5 font-mono text-2xl font-semibold text-fg-primary tabular-nums">
            {summary?.cacheHitRate ?? 0}%
          </p>
          <p className="mt-1 font-mono text-xs text-fg-muted tabular-nums">
            Esqueleto + Prompt Cache
          </p>
        </div>

        <div
          data-testid="finops-kpi-rework"
          className="uzina-card rounded-xl border border-border-subtle bg-surface p-4"
        >
          <div className="flex items-center justify-between text-fg-muted">
            <span className="text-xs font-medium text-fg-secondary">
              Rework Rate
            </span>
            <Gauge className="size-4 text-status-warn" strokeWidth={1.75} />
          </div>
          <p className="mt-1.5 font-mono text-2xl font-semibold text-fg-primary tabular-nums">
            {summary?.reworkRate ?? 0}%
          </p>
          <p className="mt-1 font-mono text-xs text-fg-muted tabular-nums">
            Verify &gt; 1 ou falhas
          </p>
        </div>

        <div
          data-testid="finops-kpi-usd"
          className="uzina-card rounded-xl border border-border-subtle bg-surface p-4"
        >
          <div className="flex items-center justify-between text-fg-muted">
            <span className="text-xs font-medium text-fg-secondary">
              Economia vs Gasto Real
            </span>
            <Coins className="size-4 text-status-ok" strokeWidth={1.75} />
          </div>
          <p className="mt-1.5 font-mono text-lg font-semibold whitespace-nowrap text-status-ok tabular-nums sm:text-2xl">
            US$ {(summary?.estimatedCostSavedUsd ?? 0).toFixed(4)}
          </p>
          <p className="mt-1 font-mono text-xs text-fg-muted tabular-nums">
            Gasto real: US$ {(summary?.totalLlmCostUsd ?? 0).toFixed(4)} ·{" "}
            {(summary?.totalLlmTokens ?? 0).toLocaleString("pt-BR")} tok
          </p>
        </div>
      </section>

      {/* Breakdown por Técnica + Eventos & Medição Recolhível */}
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <section className="uzina-card min-w-0 space-y-3 rounded-xl border border-border-subtle bg-surface p-5">
          <h2 className="text-sm font-semibold text-fg-primary">
            Economia por Técnica
          </h2>
          {!(summary?.byTechnique ?? []).some(
            (item) =>
              item.eventsCount > 0 ||
              item.tokensSaved > 0 ||
              item.tokensBaseline > 0
          ) ? (
            <p
              data-testid="finops-by-technique-empty"
              className="rounded-lg border border-dashed border-border-default bg-inset px-4 py-6 text-center text-sm text-fg-secondary"
            >
              Sem economia registrada por técnica ainda. As barras aparecerão após execuções com Prompt Cache, QMD, Grafo AST ou Esqueleto.
            </p>
          ) : (
            <div className="space-y-2.5">
              {(summary?.byTechnique ?? []).map((item) => (
                <div
                  key={item.technique}
                  data-testid="finops-technique-row"
                  className="space-y-1.5 rounded-lg border border-border-subtle bg-inset p-3.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-medium text-fg-primary">
                      {TECHNIQUE_LABELS[item.technique]}
                    </span>
                    <span className="font-mono text-xs text-status-ok tabular-nums">
                      {item.tokensSaved.toLocaleString("pt-BR")} tokens (
                      {item.savingsPercent}%)
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-canvas">
                    <div
                      className="h-full bg-status-ok transition-all"
                      style={{ width: `${Math.min(100, item.savingsPercent)}%` }}
                    />
                  </div>
                  <p className="font-mono text-xs text-fg-muted tabular-nums">
                    {item.eventsCount} evento(s) · baseline{" "}
                    {item.tokensBaseline.toLocaleString("pt-BR")} → real{" "}
                    {item.tokensActual.toLocaleString("pt-BR")}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="uzina-card min-w-0 space-y-4 rounded-xl border border-border-subtle bg-surface p-5">
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-fg-primary">
              Eventos Recentes de Economia
            </h2>
            {(summary?.recentEvents ?? []).length === 0 ? (
              <p className="rounded-lg border border-dashed border-border-default bg-inset px-4 py-6 text-center text-sm text-fg-secondary">
                Nenhum evento FinOps registrado ainda. Os eventos são gravados automaticamente durante execuções de agentes.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {(summary?.recentEvents ?? []).slice(0, 8).map((ev) => (
                  <li
                    key={ev.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-subtle bg-inset px-3 py-2 text-xs"
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

          <div className="border-t border-border-subtle pt-3">
            <button
              type="button"
              data-testid="toggle-manual-finops"
              aria-expanded={manualOpen}
              onClick={() => setManualOpen((prev) => !prev)}
              className="flex w-full items-center justify-between rounded-md px-1 py-1 text-xs font-medium text-fg-secondary transition-colors hover:text-fg-primary"
            >
              <span>Registrar medição manual / telemetria</span>
              {manualOpen ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
            </button>

            {manualOpen && (
              <form onSubmit={handleRecord} className="mt-3 space-y-3">
                <div className="grid gap-2.5 sm:grid-cols-3">
                  <div>
                    <label className="block text-xs text-fg-secondary">
                      Técnica
                    </label>
                    <select
                      value={technique}
                      onChange={(e) =>
                        setTechnique(e.target.value as TokenSavingsTechnique)
                      }
                      className="mt-1 min-h-9 w-full rounded-md border border-border-default bg-inset px-2.5 text-xs text-fg-primary focus:border-border-strong focus:outline-none"
                    >
                      {Object.entries(TECHNIQUE_LABELS).map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-fg-secondary">
                      Baseline (tokens)
                    </label>
                    <input
                      type="number"
                      min={0}
                      data-testid="finops-baseline-input"
                      value={baselineInput}
                      onChange={(e) => setBaselineInput(e.target.value)}
                      className="mt-1 min-h-9 w-full rounded-md border border-border-default bg-inset px-2.5 font-mono text-xs text-fg-primary tabular-nums focus:border-border-strong focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-fg-secondary">
                      Real (tokens)
                    </label>
                    <input
                      type="number"
                      min={0}
                      data-testid="finops-actual-input"
                      value={actualInput}
                      onChange={(e) => setActualInput(e.target.value)}
                      className="mt-1 min-h-9 w-full rounded-md border border-border-default bg-inset px-2.5 font-mono text-xs text-fg-primary tabular-nums focus:border-border-strong focus:outline-none"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  data-testid="finops-record-submit"
                  disabled={recordMutation.isPending}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border-default bg-elevated px-3.5 text-xs font-medium text-fg-primary hover:border-border-strong disabled:opacity-50"
                >
                  {recordMutation.isPending ? "Salvando..." : "Registrar Medição"}
                </button>
              </form>
            )}
          </div>
        </section>
      </div>

      <section
        data-testid="finops-llm-calls-section"
        className="uzina-card space-y-3 rounded-xl border border-border-subtle bg-surface p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-fg-primary">
              Consumo Real de LLM (Chamadas Recentes)
            </h2>
            <p className="text-xs text-fg-secondary">
              Tokens e custo calculados a partir dos eventos reais de execução dos workflows.
            </p>
          </div>
          <span className="font-mono text-xs text-fg-secondary tabular-nums">
            Total: {(summary?.totalLlmTokens ?? 0).toLocaleString("pt-BR")} tokens · US${" "}
            {(summary?.totalLlmCostUsd ?? 0).toFixed(4)}
          </span>
        </div>

        {(summary?.recentLlmCalls ?? []).length === 0 ? (
          <p className="rounded-lg border border-dashed border-border-default bg-inset px-4 py-6 text-center text-sm text-fg-secondary">
            Nenhuma chamada LLM de workflow registrada ainda. Execute um ciclo para acompanhar tokens e custo por modelo.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border-subtle text-fg-muted">
                  <th className="py-2 pr-3 font-medium">Etapa / Papel</th>
                  <th className="py-2 pr-3 font-medium">Modelo</th>
                  <th className="py-2 pr-3 font-medium">Entrada / Saída</th>
                  <th className="py-2 text-right font-medium">Custo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle font-mono tabular-nums">
                {(summary?.recentLlmCalls ?? []).slice(0, 10).map((call) => (
                  <tr key={call.id}>
                    <td className="py-2 pr-3 text-fg-primary">
                      {call.stage} · {call.actorRole}
                    </td>
                    <td className="py-2 pr-3 text-fg-secondary">
                      {call.modelId ?? "padrão"}
                    </td>
                    <td className="py-2 pr-3 text-fg-secondary">
                      {call.inputTokens.toLocaleString("pt-BR")} /{" "}
                      {call.outputTokens.toLocaleString("pt-BR")}
                    </td>
                    <td className="py-2 text-right text-fg-primary">
                      US$ {call.estimatedCostUsd.toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <AgentEffectivenessPanel />

      <SkillsCatalogPanel />

      <EngineConfigPanel />
    </div>
  );
}
