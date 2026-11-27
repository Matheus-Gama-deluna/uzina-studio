"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AgencyAgentRoleSchema,
  AgentEffectivenessMetricsSchema,
  type AgencyAgentRole,
  type AgentEffectivenessMetrics,
} from "@uzina/contracts";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Gauge,
  RotateCcw,
  Sparkles,
} from "lucide-react";

const ROLE_LABELS: Record<AgencyAgentRole, string> = {
  orchestrator: "Supervisor Executivo",
  product_discovery: "Descoberta & Produto",
  software_architect: "Arquiteto de Software",
  ux_designer: "UX & Estúdio Visual",
  tech_lead: "Tech Lead & Builder",
  qa_appsec: "QA & Auditor AppSec",
};

export interface AgentEffectivenessPanelProps {
  projectId?: string;
  initialData?: AgentEffectivenessMetrics | null;
}

export function AgentEffectivenessPanel({
  projectId,
  initialData,
}: AgentEffectivenessPanelProps) {
  const effectivenessQuery = useQuery({
    queryKey: ["finops-effectiveness", projectId ?? "org"],
    queryFn: async () => {
      const qs = projectId
        ? `?projectId=${encodeURIComponent(projectId)}`
        : "";
      const res = await fetch(`/api/finops/effectiveness${qs}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(
          body?.error ?? "Falha ao carregar métricas de efetividade agêntica."
        );
      }
      return AgentEffectivenessMetricsSchema.parse(await res.json());
    },
    ...(initialData ? { initialData } : {}),
  });

  const metrics = effectivenessQuery.data;
  const totalRuns = metrics
    ? Object.values(metrics.byRole).reduce((acc, item) => acc + item.runs, 0)
    : 0;

  return (
    <section
      data-testid="agent-effectiveness-panel"
      aria-label="Efetividade dos Agentes"
      className="uzina-card min-w-0 space-y-4 rounded-xl border border-border-subtle bg-surface p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle pb-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 text-xs font-medium text-fg-muted">
            <Activity className="size-4 text-fg-secondary" strokeWidth={1.75} />
            <span>Qualidade de Trajetória &amp; Retrabalho</span>
          </div>
          <h2 className="text-sm font-semibold text-fg-primary">
            Efetividade Agêntica por Papel
          </h2>
        </div>
      </div>

      {effectivenessQuery.isLoading ? (
        <div
          data-testid="effectiveness-loading"
          aria-label="Carregando métricas de efetividade"
          className="space-y-3"
        >
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="h-20 animate-pulse rounded-lg border border-border-subtle bg-inset" />
            <div className="h-20 animate-pulse rounded-lg border border-border-subtle bg-inset" />
            <div className="h-20 animate-pulse rounded-lg border border-border-subtle bg-inset" />
            <div className="h-20 animate-pulse rounded-lg border border-border-subtle bg-inset" />
          </div>
          <div className="h-36 animate-pulse rounded-lg border border-border-subtle bg-inset" />
        </div>
      ) : effectivenessQuery.isError ? (
        <div
          data-testid="effectiveness-error"
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-status-danger/40 bg-status-danger/10 p-3.5 text-xs text-status-danger"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0" strokeWidth={1.75} />
            <span>
              {effectivenessQuery.error instanceof Error
                ? effectivenessQuery.error.message
                : "Erro ao carregar efetividade agêntica."}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void effectivenessQuery.refetch()}
            className="min-h-8 rounded border border-status-danger/40 px-2.5 text-xs font-medium hover:bg-status-danger/15"
          >
            Tentar novamente
          </button>
        </div>
      ) : !metrics ||
        (totalRuns === 0 && metrics.averageVerifyAttempts === 0) ? (
        <div
          data-testid="effectiveness-empty"
          className="rounded-lg border border-dashed border-border-default bg-inset px-4 py-8 text-center text-xs text-fg-secondary"
        >
          Nenhuma execução agêntica contabilizada ainda. Execute um entregável para medir First-Pass Verify Rate, aderência a skills e custo de retrabalho.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div
              data-testid="effectiveness-first-pass"
              className="rounded-lg border border-border-subtle bg-inset p-3.5"
            >
              <div className="flex items-center justify-between text-fg-muted">
                <span className="text-xs font-medium text-fg-secondary">
                  First-Pass Verify
                </span>
                <CheckCircle2 className="size-4 text-status-ok" strokeWidth={1.75} />
              </div>
              <p className="mt-1 font-mono text-xl font-semibold text-fg-primary tabular-nums">
                {metrics.firstPassVerifyRate.toFixed(1)}%
              </p>
              <p className="mt-0.5 font-mono text-xs text-fg-muted tabular-nums">
                Média {metrics.averageVerifyAttempts.toFixed(2)} tentativa(s)
              </p>
            </div>

            <div
              data-testid="effectiveness-skill-adherence"
              className="rounded-lg border border-border-subtle bg-inset p-3.5"
            >
              <div className="flex items-center justify-between text-fg-muted">
                <span className="text-xs font-medium text-fg-secondary">
                  Aderência a Skills
                </span>
                <Sparkles className="size-4 text-fg-secondary" strokeWidth={1.75} />
              </div>
              <p className="mt-1 font-mono text-xl font-semibold text-fg-primary tabular-nums">
                {metrics.skillAdherenceRate.toFixed(1)}%
              </p>
              <p className="mt-0.5 text-xs text-fg-muted">
                Uso de playbooks e tools Step 0
              </p>
            </div>

            <div
              data-testid="effectiveness-confidence"
              className="rounded-lg border border-border-subtle bg-inset p-3.5"
            >
              <div className="flex items-center justify-between text-fg-muted">
                <span className="text-xs font-medium text-fg-secondary">
                  Confidence Médio
                </span>
                <Gauge className="size-4 text-status-info" strokeWidth={1.75} />
              </div>
              <p className="mt-1 font-mono text-xl font-semibold text-fg-primary tabular-nums">
                {Math.round(metrics.averageConfidenceScore)}/100
              </p>
              <p className="mt-0.5 text-xs text-fg-muted">
                Two-Stage Verifier
              </p>
            </div>

            <div
              data-testid="effectiveness-rework-cost"
              className="rounded-lg border border-border-subtle bg-inset p-3.5"
            >
              <div className="flex items-center justify-between text-fg-muted">
                <span className="text-xs font-medium text-fg-secondary">
                  Custo de Retrabalho
                </span>
                <RotateCcw className="size-4 text-status-warn" strokeWidth={1.75} />
              </div>
              <p className="mt-1 font-mono text-xl font-semibold text-fg-primary tabular-nums">
                US$ {metrics.reworkCostUsd.toFixed(4)}
              </p>
              <p className="mt-0.5 font-mono text-xs text-fg-muted tabular-nums">
                {totalRuns} execução(ões) totais
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table
              data-testid="effectiveness-by-role-table"
              className="w-full min-w-[540px] text-left text-xs"
            >
              <thead>
                <tr className="border-b border-border-subtle text-fg-muted">
                  <th className="py-2 pr-3 font-medium">Papel do Agente</th>
                  <th className="py-2 pr-3 text-right font-medium">Execuções</th>
                  <th className="py-2 pr-3 text-right font-medium">Tokens Médios</th>
                  <th className="py-2 pr-3 text-right font-medium">Latência Média</th>
                  <th className="py-2 text-right font-medium">Taxa de Falha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {AgencyAgentRoleSchema.options.map((role) => {
                  const stats = metrics.byRole[role];
                  const failurePct = (stats.failureRate * 100).toFixed(1);
                  return (
                    <tr key={role} data-testid={`effectiveness-role-${role}`}>
                      <td className="py-2 pr-3 font-medium text-fg-primary">
                        {ROLE_LABELS[role]}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-fg-secondary tabular-nums">
                        {stats.runs}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-fg-secondary tabular-nums">
                        {Math.round(stats.avgTokens).toLocaleString("pt-BR")}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-fg-secondary tabular-nums">
                        {Math.round(stats.avgLatencyMs).toLocaleString("pt-BR")} ms
                      </td>
                      <td
                        className={`py-2 text-right font-mono tabular-nums ${
                          stats.failureRate >= 0.25
                            ? "text-status-danger"
                            : stats.failureRate > 0
                              ? "text-status-warn"
                              : "text-status-ok"
                        }`}
                      >
                        {failurePct}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
