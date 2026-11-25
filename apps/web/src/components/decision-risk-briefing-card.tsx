"use client";

import {
  DecisionRiskBriefingSchema,
  VerifierTwoStageOutputSchema,
  type DecisionRiskBriefing,
  type RiskLevel,
  type SpecComplianceStatus,
  type VerifierTwoStageOutput,
} from "@uzina/contracts";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Database,
  FileCode2,
  Gauge,
  KeyRound,
  PackagePlus,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  TerminalSquare,
  XCircle,
} from "lucide-react";

export interface DecisionRiskBriefingCardProps {
  payloadJson?: Record<string, unknown> | null;
  riskBriefing?: DecisionRiskBriefing | null;
  twoStageVerifierOutput?: VerifierTwoStageOutput | null;
  isLoading?: boolean;
  errorMessage?: string | null;
  onRetry?: () => void;
}

const RISK_META: Record<
  RiskLevel,
  { label: string; dotClass: string; badgeClass: string }
> = {
  low: {
    label: "Risco Baixo",
    dotClass: "bg-status-ok",
    badgeClass: "border-status-ok/40 bg-status-ok/10 text-status-ok",
  },
  medium: {
    label: "Risco Médio",
    dotClass: "bg-status-warn",
    badgeClass: "border-status-warn/40 bg-status-warn/10 text-status-warn",
  },
  high: {
    label: "Risco Alto",
    dotClass: "bg-status-danger",
    badgeClass: "border-status-danger/40 bg-status-danger/10 text-status-danger",
  },
};

const COMPLIANCE_META: Record<
  SpecComplianceStatus,
  { label: string; badgeClass: string }
> = {
  covered: {
    label: "Coberto",
    badgeClass: "border-status-ok/40 bg-status-ok/10 text-status-ok",
  },
  missing: {
    label: "Ausente",
    badgeClass: "border-status-danger/40 bg-status-danger/10 text-status-danger",
  },
  divergent: {
    label: "Divergente",
    badgeClass: "border-status-warn/40 bg-status-warn/10 text-status-warn",
  },
};

function parsePayloadBriefing(
  payloadJson?: Record<string, unknown> | null
): DecisionRiskBriefing | null {
  if (!payloadJson) return null;
  const parsed = DecisionRiskBriefingSchema.safeParse(payloadJson.riskBriefing);
  return parsed.success ? parsed.data : null;
}

function parsePayloadVerifier(
  payloadJson?: Record<string, unknown> | null
): VerifierTwoStageOutput | null {
  if (!payloadJson) return null;
  const parsed = VerifierTwoStageOutputSchema.safeParse(
    payloadJson.twoStageVerifierOutput
  );
  return parsed.success ? parsed.data : null;
}

export function DecisionRiskBriefingCard({
  payloadJson,
  riskBriefing: riskBriefingProp,
  twoStageVerifierOutput: verifierProp,
  isLoading = false,
  errorMessage = null,
  onRetry,
}: DecisionRiskBriefingCardProps) {
  if (isLoading) {
    return (
      <section
        data-testid="risk-briefing-loading"
        aria-label="Carregando Risk Briefing"
        className="space-y-3 rounded-md border border-border-subtle bg-inset p-3.5"
      >
        <div className="h-5 w-48 animate-pulse rounded bg-elevated" />
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="h-14 animate-pulse rounded bg-surface" />
          <div className="h-14 animate-pulse rounded bg-surface" />
          <div className="h-14 animate-pulse rounded bg-surface" />
        </div>
        <div className="h-24 animate-pulse rounded bg-surface" />
      </section>
    );
  }

  if (errorMessage) {
    return (
      <section
        data-testid="risk-briefing-error"
        role="alert"
        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-status-danger/40 bg-status-danger/10 p-3.5 text-xs text-status-danger"
      >
        <div className="flex items-center gap-2">
          <AlertCircle className="size-4 shrink-0" strokeWidth={1.75} />
          <span>{errorMessage}</span>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="min-h-8 rounded border border-status-danger/40 px-2.5 text-xs font-medium hover:bg-status-danger/15"
          >
            Tentar novamente
          </button>
        )}
      </section>
    );
  }

  const riskBriefing = riskBriefingProp ?? parsePayloadBriefing(payloadJson);
  const verifierOutput = verifierProp ?? parsePayloadVerifier(payloadJson);

  if (!riskBriefing && !verifierOutput) {
    return (
      <section
        data-testid="risk-briefing-empty"
        className="rounded-md border border-dashed border-border-default bg-inset px-4 py-5 text-center text-xs text-fg-secondary"
      >
        Risk Briefing e Matriz de Rastreabilidade indisponíveis para esta decisão.
      </section>
    );
  }

  const confidenceScore =
    riskBriefing?.confidenceScore ?? verifierOutput?.confidenceScore ?? 0;
  const riskMeta = RISK_META[riskBriefing?.riskLevel ?? "medium"];
  const matrix = verifierOutput?.stage1SpecCompliance.matrix ?? [];
  const stage2 = verifierOutput?.stage2QualityAndSecurity;

  return (
    <section
      data-testid="decision-risk-briefing-card"
      aria-label="Risk Briefing e Matriz de Rastreabilidade"
      className="min-w-0 space-y-4 rounded-md border border-border-subtle bg-inset p-3.5 sm:p-4"
    >
      {/* Cabeçalho: Confidence Score + Nível de Risco */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-3">
        <div className="flex items-center gap-2">
          <Gauge className="size-4 shrink-0 text-fg-secondary" strokeWidth={1.75} />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-secondary">
            Risk Briefing &amp; Rastreabilidade
          </h3>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {riskBriefing && (
            <span
              data-testid="risk-briefing-level"
              className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium ${riskMeta.badgeClass}`}
            >
              <span className={`size-1.5 rounded-full ${riskMeta.dotClass}`} />
              <span>{riskMeta.label}</span>
            </span>
          )}
          <span
            data-testid="risk-briefing-confidence"
            className="inline-flex items-center gap-1.5 rounded border border-border-default bg-surface px-2.5 py-0.5 font-mono text-xs font-semibold text-fg-primary tabular-nums"
          >
            <ShieldCheck className="size-3.5 text-status-ok" strokeWidth={1.75} />
            <span>Confidence {confidenceScore}/100</span>
          </span>
        </div>
      </div>

      {/* Checklist de Superfície Alterada + FinOps & Rollback */}
      {riskBriefing && (
        <div className="grid min-w-0 gap-3 lg:grid-cols-2">
          <div className="min-w-0 space-y-2 rounded border border-border-subtle bg-surface p-3">
            <p className="text-xs font-semibold text-fg-primary">
              Checklist de Superfície Alterada
            </p>
            <ul
              data-testid="risk-surface-checklist"
              className="space-y-1.5 text-xs"
            >
              <li className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-fg-secondary">
                  <Database className="size-3.5 shrink-0" strokeWidth={1.75} />
                  <span>Migrações de Banco (DDL)</span>
                </span>
                <span
                  className={`font-mono font-medium ${
                    riskBriefing.changedSurface.dbMigrations
                      ? "text-status-warn"
                      : "text-fg-muted"
                  }`}
                >
                  {riskBriefing.changedSurface.dbMigrations ? "Alterado" : "Sem alterações"}
                </span>
              </li>

              <li className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-fg-secondary">
                  <ShieldAlert className="size-3.5 shrink-0" strokeWidth={1.75} />
                  <span>Autenticação &amp; RBAC</span>
                </span>
                <span
                  className={`font-mono font-medium ${
                    riskBriefing.changedSurface.authOrRbac
                      ? "text-status-warn"
                      : "text-fg-muted"
                  }`}
                >
                  {riskBriefing.changedSurface.authOrRbac ? "Alterado" : "Sem alterações"}
                </span>
              </li>

              <li className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-fg-secondary">
                  <KeyRound className="size-3.5 shrink-0" strokeWidth={1.75} />
                  <span>Criptografia &amp; Segredos</span>
                </span>
                <span
                  className={`font-mono font-medium ${
                    riskBriefing.changedSurface.cryptoOrSecrets
                      ? "text-status-danger"
                      : "text-fg-muted"
                  }`}
                >
                  {riskBriefing.changedSurface.cryptoOrSecrets
                    ? "Alterado"
                    : "Sem alterações"}
                </span>
              </li>

              <li className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-fg-secondary">
                  <PackagePlus className="size-3.5 shrink-0" strokeWidth={1.75} />
                  <span>Novas Dependências</span>
                </span>
                <span className="font-mono text-fg-primary tabular-nums">
                  {riskBriefing.changedSurface.newDependencies.length > 0
                    ? riskBriefing.changedSurface.newDependencies.join(", ")
                    : "0"}
                </span>
              </li>

              <li className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-fg-secondary">
                  <TerminalSquare className="size-3.5 shrink-0" strokeWidth={1.75} />
                  <span>Novas Env Vars</span>
                </span>
                <span className="font-mono text-fg-primary tabular-nums">
                  {riskBriefing.changedSurface.newEnvVars.length > 0
                    ? riskBriefing.changedSurface.newEnvVars.join(", ")
                    : "0"}
                </span>
              </li>
            </ul>
          </div>

          <div className="min-w-0 space-y-2.5 rounded border border-border-subtle bg-surface p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-fg-primary">
                <RotateCcw className="size-3.5 shrink-0 text-fg-secondary" strokeWidth={1.75} />
                <span>Plano de Rollback</span>
              </p>
              <span className="font-mono text-xs text-fg-muted tabular-nums">
                {riskBriefing.finopsSummary.tokensTotal.toLocaleString("pt-BR")} tok · US${" "}
                {riskBriefing.finopsSummary.estimatedCostUsd.toFixed(4)}
              </span>
            </div>
            <p
              data-testid="risk-rollback-plan"
              className="break-words text-xs leading-relaxed text-fg-secondary"
            >
              {riskBriefing.rollbackPlan}
            </p>
          </div>
        </div>
      )}

      {/* Matriz de Rastreabilidade Requisito ↔ Teste ↔ Diff */}
      <div className="min-w-0 space-y-2 rounded border border-border-subtle bg-surface p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-fg-primary">
            <FileCode2 className="size-3.5 shrink-0 text-fg-secondary" strokeWidth={1.75} />
            <span>Matriz de Rastreabilidade (Spec ↔ Teste ↔ Diff)</span>
          </p>
          <span className="font-mono text-xs text-fg-muted tabular-nums">
            {matrix.length} critério(s)
          </span>
        </div>

        {matrix.length === 0 ? (
          <p
            data-testid="spec-matrix-empty"
            className="rounded border border-dashed border-border-default bg-inset px-3 py-3 text-xs text-fg-secondary"
          >
            Nenhum critério mapeado na matriz para este portão.
          </p>
        ) : (
          <div className="max-h-64 overflow-x-auto overflow-y-auto">
            <table
              data-testid="spec-traceability-matrix"
              className="w-full min-w-[520px] text-left text-xs"
            >
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-border-subtle text-fg-muted">
                  <th className="py-1.5 pr-3 font-medium">Critério</th>
                  <th className="py-1.5 pr-3 font-medium">Status</th>
                  <th className="py-1.5 pr-3 font-medium">Teste</th>
                  <th className="py-1.5 font-medium">Código</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {matrix.map((row) => {
                  const meta = COMPLIANCE_META[row.status];
                  const testRef = row.testFile
                    ? `${row.testFile}${row.testLine ? `:${row.testLine}` : ""}`
                    : "—";
                  const srcRef = row.sourceFile
                    ? `${row.sourceFile}${row.sourceLine ? `:${row.sourceLine}` : ""}`
                    : "—";

                  return (
                    <tr key={row.criterionId}>
                      <td className="py-2 pr-3 align-top">
                        <span className="font-mono text-xs font-medium text-fg-primary">
                          {row.criterionId}
                        </span>
                        <p className="mt-0.5 line-clamp-2 break-words text-xs text-fg-secondary">
                          {row.criterionText}
                        </p>
                      </td>
                      <td className="py-2 pr-3 align-top">
                        <span
                          className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-medium ${meta.badgeClass}`}
                        >
                          {row.status === "covered" ? (
                            <CheckCircle2 className="size-3 shrink-0" />
                          ) : row.status === "missing" ? (
                            <XCircle className="size-3 shrink-0" />
                          ) : (
                            <AlertTriangle className="size-3 shrink-0" />
                          )}
                          <span>{meta.label}</span>
                        </span>
                      </td>
                      <td className="py-2 pr-3 align-top font-mono text-xs text-fg-secondary tabular-nums">
                        <span className="block max-w-[180px] truncate" title={testRef}>
                          {testRef}
                        </span>
                      </td>
                      <td className="py-2 align-top font-mono text-xs text-fg-secondary tabular-nums">
                        <span className="block max-w-[180px] truncate" title={srcRef}>
                          {srcRef}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {stage2 &&
        (stage2.refutingChecksPerformed.length > 0 ||
          stage2.survivingMutantRisks.length > 0) && (
          <details className="rounded border border-border-subtle bg-surface px-3 py-2 text-xs">
            <summary className="cursor-pointer font-medium text-fg-secondary hover:text-fg-primary">
              Estágio 2 Adversarial ({stage2.refutingChecksPerformed.length} checagens ·{" "}
              {stage2.survivingMutantRisks.length} risco(s) de mutante)
            </summary>
            <div className="mt-2 space-y-2 text-xs text-fg-secondary">
              {stage2.refutingChecksPerformed.length > 0 && (
                <div>
                  <p className="font-medium text-fg-primary">Checagens Executadas:</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {stage2.refutingChecksPerformed.map((chk) => (
                      <li key={chk}>{chk}</li>
                    ))}
                  </ul>
                </div>
              )}
              {stage2.survivingMutantRisks.length > 0 && (
                <div>
                  <p className="font-medium text-status-warn">Riscos de Mutantes:</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {stage2.survivingMutantRisks.map((risk) => (
                      <li key={risk}>{risk}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </details>
        )}
    </section>
  );
}
