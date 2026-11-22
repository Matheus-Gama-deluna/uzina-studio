"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ProjectListResponse,
  SecurityFindingDTO,
  SecurityScanListResponse,
  SecurityScanResult,
  SecuritySeverity,
} from "@uzina/contracts";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

const SEVERITY_BADGE: Record<
  SecuritySeverity,
  { label: string; className: string }
> = {
  critical: {
    label: "CRÍTICA",
    className: "border-status-error/50 bg-status-error/15 text-status-error",
  },
  high: {
    label: "ALTA",
    className: "border-status-warn/50 bg-status-warn/15 text-status-warn",
  },
  medium: {
    label: "MÉDIA",
    className: "border-status-info/40 bg-status-info/10 text-status-info",
  },
  low: {
    label: "BAIXA",
    className: "border-border-default bg-inset text-fg-secondary",
  },
  info: {
    label: "INFO",
    className: "border-border-subtle bg-inset text-fg-muted",
  },
};

async function fetchScans(): Promise<SecurityScanListResponse> {
  const res = await fetch("/api/security/scans");
  if (!res.ok) throw new Error("Falha ao listar auditorias de segurança.");
  return (await res.json()) as SecurityScanListResponse;
}

async function fetchScanDetail(
  scanId: string,
  includeSarif: boolean
): Promise<SecurityScanResult> {
  const qs = includeSarif ? "?includeSarif=true" : "";
  const res = await fetch(`/api/security/scans/${scanId}${qs}`);
  if (!res.ok) throw new Error("Falha ao carregar detalhes da auditoria.");
  return (await res.json()) as SecurityScanResult;
}

async function fetchProjects(): Promise<ProjectListResponse> {
  const res = await fetch("/api/projects");
  if (!res.ok) throw new Error("Falha ao carregar projetos.");
  return (await res.json()) as ProjectListResponse;
}

export function SecurityAuditConsole() {
  const queryClient = useQueryClient();
  const [selectedScanId, setSelectedScanId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [targetType, setTargetType] = useState<"git_repo" | "git_diff">(
    "git_repo"
  );
  const [relativeSubpath, setRelativeSubpath] = useState("");
  const [severityFilter, setSeverityFilter] = useState<
    "all" | SecuritySeverity
  >("all");
  const [includeSarif, setIncludeSarif] = useState(false);
  const [rationaleDraft, setRationaleDraft] = useState<Record<string, string>>(
    {}
  );
  const [suppressDraft, setSuppressDraft] = useState<Record<string, boolean>>(
    {}
  );
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [bannerInfo, setBannerInfo] = useState<string | null>(null);

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: fetchProjects,
  });

  const scansQuery = useQuery({
    queryKey: ["security-scans"],
    queryFn: fetchScans,
  });

  const projects = useMemo(
    () => projectsQuery.data?.items ?? [],
    [projectsQuery.data]
  );
  const scans = useMemo(
    () => scansQuery.data?.items ?? [],
    [scansQuery.data]
  );

  const activeProjectId = selectedProjectId || projects[0]?.id || "";
  const activeScanId = selectedScanId || scans[0]?.id || null;

  const detailQuery = useQuery({
    queryKey: ["security-scan-detail", activeScanId, includeSarif],
    queryFn: () => fetchScanDetail(activeScanId!, includeSarif),
    enabled: Boolean(activeScanId),
  });

  const runScanMutation = useMutation({
    mutationFn: async () => {
      if (!activeProjectId) {
        throw new Error("Selecione um projeto antes de executar a auditoria.");
      }
      const res = await fetch("/api/security/scans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: activeProjectId,
          targetType,
          ...(relativeSubpath.trim()
            ? { relativeSubpath: relativeSubpath.trim() }
            : {}),
          triage: true,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as
        | SecurityScanResult
        | { error?: string };
      if (!res.ok) {
        throw new Error(
          "error" in data && data.error
            ? data.error
            : "Falha ao executar auditoria de segurança."
        );
      }
      return data as SecurityScanResult;
    },
    onSuccess: async (created) => {
      setBannerError(null);
      setBannerInfo(
        `Auditoria concluída: ${created.summaryCountsJson.total} achado(s) e ${created.summaryCountsJson.skippedScannersCount} scanner(s) com binário ausente.`
      );
      setSelectedScanId(created.id);
      await queryClient.invalidateQueries({ queryKey: ["security-scans"] });
      await queryClient.invalidateQueries({
        queryKey: ["security-scan-detail", created.id],
      });
    },
    onError: (err: Error) => {
      setBannerInfo(null);
      setBannerError(err.message);
    },
  });

  const triageMutation = useMutation({
    mutationFn: async (params: {
      findingId: string;
      verdict: "confirmed" | "false_positive" | "unknown";
      rationale?: string;
      suppressedInMemory?: boolean;
    }) => {
      const res = await fetch(
        `/api/security/findings/${params.findingId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            triageVerdict: params.verdict,
            ...(params.rationale !== undefined
              ? { triageRationale: params.rationale }
              : {}),
            ...(params.suppressedInMemory !== undefined
              ? { suppressedInMemory: params.suppressedInMemory }
              : {}),
          }),
        }
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? "Falha ao atualizar triagem.");
      }
      return data as SecurityFindingDTO;
    },
    onSuccess: async () => {
      setBannerError(null);
      setBannerInfo("Triagem do achado atualizada com sucesso.");
      await queryClient.invalidateQueries({ queryKey: ["security-scans"] });
      if (activeScanId) {
        await queryClient.invalidateQueries({
          queryKey: ["security-scan-detail", activeScanId],
        });
      }
    },
    onError: (err: Error) => {
      setBannerInfo(null);
      setBannerError(err.message);
    },
  });

  function handleRunSubmit(e: FormEvent) {
    e.preventDefault();
    setBannerError(null);
    setBannerInfo(null);
    runScanMutation.mutate();
  }

  const activeScan = detailQuery.data ?? null;
  const filteredFindings = useMemo(() => {
    const list = activeScan?.findings ?? [];
    if (severityFilter === "all") return list;
    return list.filter((f) => f.severity === severityFilter);
  }, [activeScan, severityFilter]);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 border-b border-border-subtle pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-fg-muted">
            <ShieldAlert className="size-3.5 text-accent" strokeWidth={1.75} />
            <span>AppSec & SARIF 2.1.0</span>
          </div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-fg-primary">
            Auditoria de Segurança (@uzina/security-engine)
          </h1>
          <p className="mt-0.5 text-sm text-fg-secondary">
            Scanners nativos TS + Gitleaks, Opengrep/Semgrep, Trivy e
            OSV-Scanner sem falso verde quando binários estão ausentes.
          </p>
        </div>

        <button
          type="button"
          onClick={() => scansQuery.refetch()}
          className="inline-flex items-center gap-1.5 self-start rounded-md border border-border-default bg-surface px-3 py-1.5 text-xs font-medium text-fg-secondary hover:bg-elevated hover:text-fg-primary"
        >
          <RefreshCw className="size-3.5" strokeWidth={1.75} />
          <span>Atualizar</span>
        </button>
      </header>

      <form
        onSubmit={handleRunSubmit}
        className="grid gap-3 rounded-lg border border-border-subtle bg-surface p-4 sm:grid-cols-12"
      >
        <div className="sm:col-span-4">
          <label
            htmlFor="sec-project"
            className="block text-xs font-medium text-fg-secondary"
          >
            Projeto alvo
          </label>
          <select
            id="sec-project"
            value={activeProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            className="mt-1 w-full rounded-md border border-border-default bg-inset px-2.5 py-1.5 text-sm text-fg-primary focus:border-accent focus:outline-none"
          >
            {projects.length === 0 ? (
              <option value="">Nenhum projeto disponível</option>
            ) : (
              projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))
            )}
          </select>
        </div>

        <div className="sm:col-span-3">
          <label
            htmlFor="sec-target-type"
            className="block text-xs font-medium text-fg-secondary"
          >
            Modo de varredura
          </label>
          <select
            id="sec-target-type"
            value={targetType}
            onChange={(e) =>
              setTargetType(e.target.value as "git_repo" | "git_diff")
            }
            className="mt-1 w-full rounded-md border border-border-default bg-inset px-2.5 py-1.5 text-sm text-fg-primary focus:border-accent focus:outline-none"
          >
            <option value="git_repo">Repositório completo (git_repo)</option>
            <option value="git_diff">Alterações incrementais (git_diff)</option>
          </select>
        </div>

        <div className="sm:col-span-3">
          <label
            htmlFor="sec-subpath"
            className="block text-xs font-medium text-fg-secondary"
          >
            Subcaminho relativo (opcional)
          </label>
          <input
            id="sec-subpath"
            type="text"
            value={relativeSubpath}
            onChange={(e) => setRelativeSubpath(e.target.value)}
            placeholder="ex.: packages/core/src"
            className="mt-1 w-full rounded-md border border-border-default bg-inset px-2.5 py-1.5 font-mono text-sm text-fg-primary placeholder:text-fg-muted focus:border-accent focus:outline-none"
          />
        </div>

        <div className="flex items-end sm:col-span-2">
          <button
            type="submit"
            disabled={runScanMutation.isPending || !activeProjectId}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-2 text-xs font-semibold text-base transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {runScanMutation.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Play className="size-3.5" />
            )}
            <span>Executar Scan</span>
          </button>
        </div>
      </form>

      {bannerError && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg border border-status-error/40 bg-status-error/10 px-4 py-2.5 text-xs text-status-error"
        >
          <AlertCircle className="size-4 shrink-0" />
          <span>{bannerError}</span>
        </div>
      )}

      {bannerInfo && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-status-ok/40 bg-status-ok/10 px-4 py-2.5 text-xs text-status-ok"
        >
          <CheckCircle2 className="size-4 shrink-0" />
          <span>{bannerInfo}</span>
        </div>
      )}

      {scansQuery.isLoading ? (
        <div
          className="grid gap-4 lg:grid-cols-12"
          aria-label="Carregando auditorias"
        >
          <div className="h-64 animate-pulse rounded-lg border border-border-subtle bg-surface lg:col-span-4" />
          <div className="h-64 animate-pulse rounded-lg border border-border-subtle bg-surface lg:col-span-8" />
        </div>
      ) : scans.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border-default bg-surface px-6 py-14 text-center">
          <ShieldCheck className="size-8 text-fg-muted" strokeWidth={1.5} />
          <h2 className="mt-3 text-sm font-medium text-fg-primary">
            Nenhuma auditoria de segurança executada ainda
          </h2>
          <p className="mt-1 max-w-md text-xs text-fg-secondary">
            Dispare um scan sob demanda acima ou publique resultados via CLI
            stateless <code className="font-mono">uzina-sec scan</code>.
          </p>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-12">
          <aside className="space-y-2 lg:col-span-4">
            <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-fg-muted">
              Histórico de Scans ({scans.length})
            </h2>
            {scans.map((scan) => {
              const isSelected = activeScanId === scan.id;
              return (
                <button
                  key={scan.id}
                  type="button"
                  onClick={() => setSelectedScanId(scan.id)}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    isSelected
                      ? "border-accent bg-accent-subtle/40"
                      : "border-border-subtle bg-surface hover:border-border-default hover:bg-elevated"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded border border-border-default bg-inset px-1.5 py-0.5 font-mono text-[10px] uppercase text-fg-secondary">
                      {scan.mode} • {scan.targetType}
                    </span>
                    <span className="font-mono text-[11px] text-fg-muted tabular-nums">
                      Total: {scan.summaryCountsJson.total}
                    </span>
                  </div>
                  <p className="mt-1.5 truncate font-mono text-xs font-medium text-fg-primary">
                    {scan.targetRef}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2 font-mono text-[11px] tabular-nums">
                    <span className="text-status-error">
                      C:{scan.summaryCountsJson.critical}
                    </span>
                    <span className="text-status-warn">
                      H:{scan.summaryCountsJson.high}
                    </span>
                    <span className="text-status-info">
                      M:{scan.summaryCountsJson.medium}
                    </span>
                    <span className="text-fg-muted">
                      Pulados:{scan.summaryCountsJson.skippedScannersCount}
                    </span>
                  </div>
                </button>
              );
            })}
          </aside>

          <section className="space-y-4 rounded-lg border border-border-subtle bg-surface p-5 lg:col-span-8">
            {detailQuery.isLoading || !activeScan ? (
              <div className="h-48 animate-pulse rounded bg-elevated" />
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle pb-3">
                  <div>
                    <h2 className="font-mono text-sm font-semibold text-fg-primary">
                      {activeScan.targetRef}
                    </h2>
                    <p className="text-xs text-fg-muted tabular-nums">
                      Executado em{" "}
                      {new Date(activeScan.createdAt).toLocaleString("pt-BR")}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIncludeSarif((v) => !v)}
                    className="rounded border border-border-default bg-inset px-2.5 py-1 font-mono text-xs text-fg-secondary hover:text-fg-primary"
                  >
                    {includeSarif ? "Ocultar SARIF 2.1.0" : "Ver SARIF 2.1.0"}
                  </button>
                </div>

                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                    Matriz de Scanners (Sem Falso Verde)
                  </h3>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {activeScan.scannerStatuses.map((rec) => (
                      <div
                        key={rec.scanner}
                        className="flex items-start justify-between gap-2 rounded-md border border-border-subtle bg-inset p-2.5 text-xs"
                      >
                        <div>
                          <p className="font-mono font-medium text-fg-primary">
                            {rec.scanner}
                          </p>
                          {rec.status === "skipped_missing_binary" && (
                            <p className="mt-0.5 text-[11px] text-status-warn">
                              Binário ausente ({rec.binaryName}).{" "}
                              {rec.installHint}
                            </p>
                          )}
                          {rec.status === "failed" && (
                            <p className="mt-0.5 text-[11px] text-status-error">
                              {rec.errorMessage}
                            </p>
                          )}
                        </div>
                        <span
                          className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                            rec.status === "executed"
                              ? "border-status-ok/40 bg-status-ok/10 text-status-ok"
                              : rec.status === "skipped_missing_binary"
                                ? "border-status-warn/40 bg-status-warn/10 text-status-warn"
                                : "border-status-error/40 bg-status-error/10 text-status-error"
                          }`}
                        >
                          {rec.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {includeSarif && activeScan.sarifRawJson && (
                  <pre className="max-h-56 overflow-auto rounded-md border border-border-subtle bg-base p-3 font-mono text-[11px] text-fg-secondary">
                    {JSON.stringify(activeScan.sarifRawJson, null, 2)}
                  </pre>
                )}

                <div className="space-y-3 border-t border-border-subtle pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                      Achados ({filteredFindings.length})
                    </h3>
                    <div className="flex flex-wrap gap-1.5">
                      {(
                        [
                          "all",
                          "critical",
                          "high",
                          "medium",
                          "low",
                          "info",
                        ] as const
                      ).map((sev) => (
                        <button
                          key={sev}
                          type="button"
                          onClick={() => setSeverityFilter(sev)}
                          className={`rounded border px-2 py-0.5 font-mono text-[11px] uppercase ${
                            severityFilter === sev
                              ? "border-accent bg-accent-subtle text-accent"
                              : "border-border-subtle bg-inset text-fg-secondary"
                          }`}
                        >
                          {sev === "all" ? "Todos" : sev}
                        </button>
                      ))}
                    </div>
                  </div>

                  {filteredFindings.length === 0 ? (
                    <div className="rounded-md border border-dashed border-border-subtle bg-inset p-6 text-center text-xs text-fg-secondary">
                      <AlertTriangle className="mx-auto size-5 text-fg-muted" />
                      <p className="mt-2">
                        Nenhum achado corresponde ao filtro selecionado.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {filteredFindings.map((finding) => {
                        const sevBadge = SEVERITY_BADGE[finding.severity];
                        const draftReason =
                          rationaleDraft[finding.id] ??
                          finding.triageRationale ??
                          "";
                        const draftSuppress =
                          suppressDraft[finding.id] ??
                          finding.suppressedInMemory;
                        return (
                          <article
                            key={finding.id}
                            className="rounded-md border border-border-subtle bg-inset p-3.5"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${sevBadge.className}`}
                                >
                                  {sevBadge.label}
                                </span>
                                <span className="font-mono text-xs font-medium text-fg-primary">
                                  {finding.ruleId}
                                </span>
                                <span className="font-mono text-[11px] text-fg-muted">
                                  [{finding.scanner}]
                                </span>
                              </div>
                              <span className="font-mono text-[11px] text-fg-muted tabular-nums">
                                Veredito: {finding.triageVerdict}
                                {finding.suppressedInMemory
                                  ? " • suprimido"
                                  : ""}
                              </span>
                            </div>

                            <h4 className="mt-2 text-sm font-medium text-fg-primary">
                              {finding.title}
                            </h4>
                            <p className="mt-1 font-mono text-xs text-fg-secondary">
                              {finding.filePath ?? "repositório"}
                              {finding.lineStart
                                ? `:${finding.lineStart}`
                                : ""}{" "}
                              • sha256:{finding.fingerprint.slice(0, 12)}
                            </p>
                            <p className="mt-1.5 text-xs text-fg-secondary">
                              {finding.description}
                            </p>

                            <div className="mt-3 flex flex-col gap-2 border-t border-border-subtle pt-2.5 sm:flex-row sm:items-center">
                              <input
                                type="text"
                                value={draftReason}
                                onChange={(e) =>
                                  setRationaleDraft((prev) => ({
                                    ...prev,
                                    [finding.id]: e.target.value,
                                  }))
                                }
                                placeholder="Justificativa da triagem..."
                                aria-label={`Justificativa para ${finding.ruleId}`}
                                className="flex-1 rounded border border-border-default bg-surface px-2.5 py-1 text-xs text-fg-primary placeholder:text-fg-muted focus:border-accent focus:outline-none"
                              />
                              <label className="inline-flex items-center gap-1.5 text-[11px] text-fg-secondary">
                                <input
                                  type="checkbox"
                                  checked={draftSuppress}
                                  onChange={(e) =>
                                    setSuppressDraft((prev) => ({
                                      ...prev,
                                      [finding.id]: e.target.checked,
                                    }))
                                  }
                                  className="rounded border-border-default"
                                />
                                <span>Suprimir (owner/admin)</span>
                              </label>
                              <div className="flex items-center gap-1.5">
                                {(
                                  [
                                    {
                                      verdict: "confirmed",
                                      label: "Confirmar",
                                    },
                                    {
                                      verdict: "false_positive",
                                      label: "Falso Positivo",
                                    },
                                    { verdict: "unknown", label: "Indefinido" },
                                  ] as const
                                ).map((btn) => (
                                  <button
                                    key={btn.verdict}
                                    type="button"
                                    disabled={triageMutation.isPending}
                                    onClick={() =>
                                      triageMutation.mutate({
                                        findingId: finding.id,
                                        verdict: btn.verdict,
                                        rationale: draftReason || undefined,
                                        suppressedInMemory: draftSuppress,
                                      })
                                    }
                                    className="rounded border border-border-default bg-surface px-2 py-1 text-[11px] font-medium text-fg-primary hover:bg-elevated disabled:opacity-50"
                                  >
                                    {btn.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
