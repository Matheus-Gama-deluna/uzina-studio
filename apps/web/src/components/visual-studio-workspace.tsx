"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgencyChatIntent,
  AgencyChatResponse,
  AgencyOverviewResponse,
  ProjectListResponse,
} from "@uzina/contracts";
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  Laptop,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  Tablet,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  useActiveClientId,
  useActiveProjectId,
} from "@/lib/active-project-store";
import { ProjectStudio } from "./project-studio";

type PreviewViewport = "desktop" | "tablet" | "mobile";
type StudioTopTab = "live_preview" | "references_stitch";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(err?.error ?? `Erro HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export function VisualStudioWorkspace() {
  const queryClient = useQueryClient();
  const selectedClientId = useActiveClientId();
  const storedProjectId = useActiveProjectId();
  const [studioTab, setStudioTab] = useState<StudioTopTab>("live_preview");
  const [viewport, setViewport] = useState<PreviewViewport>("desktop");
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [revisionText, setRevisionText] = useState("");
  const [actionBanner, setActionBanner] = useState<string | null>(null);

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => fetchJson<ProjectListResponse>("/api/projects"),
  });

  const projectsList = useMemo(
    () => projectsQuery.data?.items ?? [],
    [projectsQuery.data?.items]
  );

  const activeProject = useMemo(() => {
    if (projectsList.length === 0) return null;
    return (
      projectsList.find((p) => p.id === storedProjectId) ??
      projectsList[0] ??
      null
    );
  }, [projectsList, storedProjectId]);

  const agencyQuery = useQuery({
    queryKey: ["agency-status", selectedClientId, activeProject?.id ?? ""],
    enabled: Boolean(activeProject?.id),
    queryFn: () =>
      fetchJson<AgencyOverviewResponse>(
        `/api/agency/status?clientId=${encodeURIComponent(
          selectedClientId
        )}&projectId=${encodeURIComponent(activeProject?.id ?? "")}`
      ),
  });

  const studioMutation = useMutation({
    mutationFn: async (payload: {
      intent: AgencyChatIntent;
      message: string;
    }) => {
      if (!activeProject) throw new Error("Nenhum projeto ativo.");
      const res = await fetch("/api/agency/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: activeProject.id,
          intent: payload.intent,
          message: payload.message,
          targetAgentRole: "ux_designer",
          teamTopology: "lean_mvp",
          autonomyMode: "semi_autonomous",
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(err?.error ?? "Falha ao atualizar Estúdio Visual.");
      }
      return (await res.json()) as AgencyChatResponse;
    },
    onSuccess: async (data, vars) => {
      setRevisionText("");
      if (vars.intent === "approve_visual_flow") {
        setActionBanner(
          "Fluxo visual homologado! O código gerado nascerá com esta estrutura."
        );
      } else if (vars.intent === "revise_visual_flow") {
        setActionBanner("Nova revisão visual aplicada pelo Designer.");
      } else {
        setActionBanner(data.actionsExecuted[0]?.label ?? "Ciclo atualizado.");
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["agency-status"] }),
        queryClient.invalidateQueries({ queryKey: ["deliverables"] }),
        queryClient.invalidateQueries({ queryKey: ["design-assets"] }),
      ]);
    },
  });

  const projectState = agencyQuery.data?.activeProjectState ?? null;
  const visualFlow = projectState?.visualFlow ?? null;

  if (projectsQuery.isLoading) {
    return (
      <div className="space-y-4" aria-label="Carregando Estúdio Visual">
        <div className="h-12 animate-pulse rounded-lg border border-border-subtle bg-surface" />
        <div className="h-[520px] animate-pulse rounded-xl border border-border-subtle bg-surface" />
      </div>
    );
  }

  if (!activeProject) {
    return (
      <div className="mx-auto max-w-xl rounded-xl border border-dashed border-border-default bg-surface p-10 text-center">
        <h1 className="text-lg font-semibold text-fg-primary">
          Estúdio Visual sem Projeto Ativo
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-fg-secondary">
          Crie ou selecione um projeto na tela de Ideias para visualizar e aprovar o fluxo de telas antes da codificação.
        </p>
        <Link
          href="/app/ideas"
          className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-lg bg-accent px-5 text-sm font-semibold text-accent-fg hover:bg-accent-hover"
        >
          <span>Ir para Ideias &amp; Projetos</span>
          <ArrowRight className="size-4" />
        </Link>
      </div>
    );
  }

  const iframeFrameWidth =
    viewport === "mobile"
      ? "390px"
      : viewport === "tablet"
        ? "640px"
        : "100%";

  return (
    <div
      data-testid="visual-studio-workspace"
      className="mx-auto flex w-full max-w-[1440px] flex-col gap-4"
    >
      {/* Topo Limpo de 1 Linha: Projeto Ativo (trocado via Sidebar) + Abas + Switcher + 1 CTA */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-base font-semibold text-fg-primary sm:text-lg">
            {activeProject.name}
          </h1>

          <div
            role="tablist"
            aria-label="Modo do Estúdio Visual"
            className="inline-flex rounded-md border border-border-default bg-inset p-0.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={studioTab === "live_preview"}
              data-testid="studio-tab-preview"
              onClick={() => setStudioTab("live_preview")}
              className={`min-h-8 rounded px-3 text-xs font-medium transition-colors ${
                studioTab === "live_preview"
                  ? "border border-border-subtle bg-surface text-fg-primary"
                  : "text-fg-secondary hover:text-fg-primary"
              }`}
            >
              Protótipo ao Vivo
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={studioTab === "references_stitch"}
              data-testid="studio-tab-references"
              onClick={() => setStudioTab("references_stitch")}
              className={`min-h-8 rounded px-3 text-xs font-medium transition-colors ${
                studioTab === "references_stitch"
                  ? "border border-border-subtle bg-surface text-fg-primary"
                  : "text-fg-secondary hover:text-fg-primary"
              }`}
            >
              Referências, Stitch &amp; Workflow
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {studioTab === "live_preview" && (
            <>
              <div
                role="group"
                aria-label="Viewport do protótipo"
                data-testid="studio-viewport-switcher"
                className="inline-flex rounded-md border border-border-default bg-inset p-0.5"
              >
                <button
                  type="button"
                  data-testid="viewport-desktop"
                  aria-pressed={viewport === "desktop"}
                  onClick={() => setViewport("desktop")}
                  title="Visualização Desktop"
                  className={`inline-flex min-h-8 items-center gap-1.5 rounded px-2.5 text-xs font-medium ${
                    viewport === "desktop"
                      ? "bg-surface text-fg-primary border border-border-subtle"
                      : "text-fg-secondary hover:text-fg-primary"
                  }`}
                >
                  <Laptop className="size-3.5" />
                  <span className="hidden sm:inline">Desktop</span>
                </button>
                <button
                  type="button"
                  data-testid="viewport-tablet"
                  aria-pressed={viewport === "tablet"}
                  onClick={() => setViewport("tablet")}
                  title="Visualização Tablet (640px)"
                  className={`inline-flex min-h-8 items-center gap-1.5 rounded px-2.5 text-xs font-medium ${
                    viewport === "tablet"
                      ? "bg-surface text-fg-primary border border-border-subtle"
                      : "text-fg-secondary hover:text-fg-primary"
                  }`}
                >
                  <Tablet className="size-3.5" />
                  <span className="hidden sm:inline">Tablet</span>
                </button>
                <button
                  type="button"
                  data-testid="viewport-mobile"
                  aria-pressed={viewport === "mobile"}
                  onClick={() => setViewport("mobile")}
                  title="Visualização Celular (390px)"
                  className={`inline-flex min-h-8 items-center gap-1.5 rounded px-2.5 text-xs font-medium ${
                    viewport === "mobile"
                      ? "bg-surface text-fg-primary border border-border-subtle"
                      : "text-fg-secondary hover:text-fg-primary"
                  }`}
                >
                  <Smartphone className="size-3.5" />
                  <span className="hidden sm:inline">Celular</span>
                </button>
              </div>

              <button
                type="button"
                data-testid="toggle-studio-inspector"
                onClick={() => setInspectorOpen((prev) => !prev)}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border-subtle bg-surface px-2.5 text-xs text-fg-secondary hover:text-fg-primary"
              >
                {inspectorOpen ? (
                  <PanelRightClose className="size-4" />
                ) : (
                  <PanelRightOpen className="size-4" />
                )}
                <span className="hidden md:inline">
                  {inspectorOpen ? "Ocultar Painel" : "Ajustar"}
                </span>
              </button>

              {visualFlow?.approvedForCodeHandoff ? (
                <button
                  type="button"
                  data-testid="btn-advance-after-visual"
                  disabled={studioMutation.isPending}
                  onClick={() =>
                    studioMutation.mutate({
                      intent: "advance_cycle",
                      message:
                        "Com o fluxo visual aprovado, avançar os slices para Contratos Zod & TDD.",
                    })
                  }
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-50"
                >
                  <CheckCircle2 className="size-4" />
                  <span>Avançar p/ Código</span>
                </button>
              ) : (
                <button
                  type="button"
                  data-testid="btn-approve-visual-flow"
                  disabled={studioMutation.isPending}
                  onClick={() =>
                    studioMutation.mutate({
                      intent: "approve_visual_flow",
                      message:
                        "Aprovar o protótipo e o fluxo visual atual para liberar a codificação da interface.",
                    })
                  }
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-50"
                >
                  <ShieldCheck className="size-4" />
                  <span>Aprovar Fluxo Visual</span>
                </button>
              )}
            </>
          )}
        </div>
      </header>

      {actionBanner && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-status-ok/35 bg-status-ok/10 px-4 py-2.5 text-sm text-status-ok">
          <span>{actionBanner}</span>
          <button
            type="button"
            onClick={() => setActionBanner(null)}
            className="text-xs underline"
          >
            Fechar
          </button>
        </div>
      )}

      {studioMutation.error && (
        <div
          role="alert"
          className="rounded-lg border border-status-danger/40 bg-status-danger/10 px-4 py-2.5 text-sm text-status-danger"
        >
          {(studioMutation.error as Error).message}
        </div>
      )}

      {studioTab === "references_stitch" && (
        <ProjectStudio
          projectId={activeProject.id}
          initialProjectName={activeProject.name}
          embedded
        />
      )}

      {/* Visão Principal: Canvas Amplo + Painel Lateral Direito Retrátil (sempre montado p/ não recarregar iframe ao trocar aba) */}
      <div
        className={
          studioTab === "live_preview"
            ? "flex flex-col gap-4 lg:flex-row"
            : "hidden"
        }
      >
          {/* Canvas Principal */}
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-col items-center overflow-hidden rounded-xl border border-border-default bg-inset p-3 sm:p-5">
              <div className="mb-3 flex w-full flex-wrap items-center justify-between gap-2 text-xs text-fg-secondary">
                <span className="inline-flex items-center gap-2 font-medium text-fg-primary">
                  <Eye className="size-4 text-fg-secondary" />
                  <span>
                    {visualFlow?.latestPrototypeTitle ??
                      `Protótipo Visual — ${activeProject.name}`}
                  </span>
                </span>
                <span
                  data-testid="visual-flow-status-badge"
                  className="inline-flex items-center gap-1.5 text-xs text-fg-secondary"
                >
                  <span
                    className={`size-2 rounded-full ${
                      visualFlow?.approvedForCodeHandoff
                        ? "bg-status-ok"
                        : "bg-status-warn"
                    }`}
                  />
                  <span>
                    {visualFlow?.approvedForCodeHandoff
                      ? "Fluxo Visual Aprovado p/ Código"
                      : "Aguardando Aprovação Visual"}
                  </span>
                </span>
              </div>

              {visualFlow?.previewUrl ? (
                <div
                  data-testid="visual-prototype-frame"
                  style={{ width: iframeFrameWidth, maxWidth: "100%" }}
                  className="overflow-hidden rounded-lg border border-border-default bg-canvas shadow-lg"
                >
                  <iframe
                    title="Preview em Tela Ampla do Protótipo Visual"
                    data-testid="visual-prototype-iframe"
                    src={visualFlow.previewUrl}
                    sandbox=""
                    className="block h-[520px] w-full border-0 bg-canvas lg:h-[calc(100vh-18rem)]"
                  />
                </div>
              ) : (
                <div className="flex h-80 w-full flex-col items-center justify-center rounded-lg border border-dashed border-border-default bg-surface p-6 text-center">
                  <p className="text-sm font-medium text-fg-primary">
                    Nenhum protótipo gerado para este projeto ainda.
                  </p>
                  <p className="mt-1 max-w-md text-sm text-fg-secondary">
                    Clique abaixo para o UX Designer gerar a primeira proposta visual baseada no escopo do projeto.
                  </p>
                  <button
                    type="button"
                    data-testid="btn-generate-initial-prototype"
                    disabled={studioMutation.isPending}
                    onClick={() =>
                      studioMutation.mutate({
                        intent: "revise_visual_flow",
                        message: `Gerar protótipo visual inicial para o projeto ${activeProject.name}.`,
                      })
                    }
                    className="mt-4 inline-flex min-h-9 items-center gap-2 rounded-lg border border-border-default bg-elevated px-4 text-sm font-medium text-fg-primary hover:border-border-strong"
                  >
                    {studioMutation.isPending && (
                      <Loader2 className="size-4 animate-spin" />
                    )}
                    <span>Gerar Protótipo Inicial</span>
                  </button>
                </div>
              )}
            </div>

            {/* Fluxo de Telas Planejado (Legível em 14px) */}
            {visualFlow && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {visualFlow.screensFlow.map((scr, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg border border-border-subtle bg-surface px-4 py-3 text-sm text-fg-primary"
                  >
                    {scr}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Painel Lateral Direito Retrátil (Direção Visual & Tokens) */}
          {inspectorOpen && (
            <aside className="w-full shrink-0 space-y-4 lg:w-80">
              <div className="space-y-3 rounded-xl border border-border-subtle bg-surface p-4">
                <h2 className="text-sm font-semibold text-fg-primary">
                  Pedir Ajuste ao Designer
                </h2>
                <p className="text-xs leading-relaxed text-fg-secondary">
                  Descreva o que gostaria de mudar no layout, cores, métricas ou navegação das telas.
                </p>
                <label htmlFor="studio-visual-revision" className="sr-only">
                  Feedback para ajustar o protótipo visual
                </label>
                <textarea
                  id="studio-visual-revision"
                  data-testid="input-visual-revision"
                  rows={4}
                  value={revisionText}
                  onChange={(e) => setRevisionText(e.target.value)}
                  placeholder="Ex.: Destacar os indicadores de faturamento no topo e simplificar a tabela lateral..."
                  className="w-full resize-y rounded-lg border border-border-default bg-inset p-3 text-sm leading-relaxed text-fg-primary placeholder:text-fg-muted focus:border-border-strong focus:outline-none"
                />
                <button
                  type="button"
                  data-testid="btn-revise-visual-flow"
                  disabled={studioMutation.isPending}
                  onClick={() =>
                    studioMutation.mutate({
                      intent: "revise_visual_flow",
                      message:
                        revisionText.trim() ||
                        "Refinar o protótipo visual destacando indicadores principais no topo.",
                    })
                  }
                  className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-border-default bg-elevated px-4 text-sm font-medium text-fg-primary transition-colors hover:border-border-strong disabled:opacity-50"
                >
                  {studioMutation.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RotateCcw className="size-4" />
                  )}
                  <span>Aplicar Ajuste Visual</span>
                </button>
              </div>

              {visualFlow && (
                <div className="space-y-3 rounded-xl border border-border-subtle bg-surface p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                    Tokens Visuais (.uzina/DESIGN.md)
                  </h3>
                  <div className="space-y-2">
                    {visualFlow.tokensPreview.map((tk) => (
                      <div
                        key={tk.name}
                        className="flex items-center justify-between rounded-md border border-border-subtle bg-inset px-3 py-2 text-xs"
                      >
                        <span className="flex items-center gap-2.5 font-mono text-fg-primary">
                          <span
                            className="size-4 shrink-0 rounded border border-border-default"
                            style={{ backgroundColor: tk.value }}
                          />
                          <span>{tk.name}</span>
                        </span>
                        <span className="font-mono text-fg-muted">
                          {tk.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-surface p-4 text-sm">
                <Link
                  href={`/app/deliverables?projectId=${encodeURIComponent(
                    activeProject.id
                  )}`}
                  className="inline-flex min-h-9 items-center justify-between rounded-md border border-border-subtle bg-inset px-3 text-xs font-medium text-fg-secondary hover:text-fg-primary"
                >
                  <span>Ver Entregas &amp; Documentos</span>
                  <ArrowRight className="size-3.5" />
                </Link>
              </div>
            </aside>
          )}
      </div>
    </div>
  );
}
