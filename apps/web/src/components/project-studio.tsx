"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BrownfieldMapSchema,
  DeliverableListResponseSchema,
  DeliverableWorkflowStateSchema,
  DesignAssetListResponseSchema,
  GenerateDesignMdResponseSchema,
  ProjectListResponseSchema,
  type BrownfieldMap,
  type DeliverableWorkflowState,
  type DesignAsset,
  type DevelopmentStrategy,
  type DiscoveryAnswer,
  type DiscoveryRound,
  type StrategyRouterOutput,
  type StuckAlert,
  type WorkflowResumeDecision,
} from "@uzina/contracts";
import {
  Activity,
  ArrowLeft,
  Check,
  FileCode2,
  GitBranch,
  ImagePlus,
  Link2,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { StitchPrototypesPanel } from "./stitch-prototypes-panel";

interface ProjectStudioProps {
  projectId: string;
  initialProjectName?: string;
  embedded?: boolean;
}

const GATE_LABELS: Record<string, string> = {
  discovery_confirm: "Portão 1 — Confirmação de Discovery",
  blueprint_approve: "Portão 2 — Aprovação de Blueprint Tático",
  visual_approve: "Portão 3 — Aprovação do Contrato Visual (.uzina/DESIGN.md)",
  stuck_intervention: "Intervenção Humana — Detector de Loop (Stuck)",
};

const DEFAULT_STATUS_BADGE = {
  label: "Não iniciado",
  cls: "border-border-subtle bg-inset text-fg-secondary",
};

const WORKFLOW_STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  not_started: DEFAULT_STATUS_BADGE,
  running: {
    label: "Em execução",
    cls: "border-status-info/40 bg-status-info/10 text-status-info",
  },
  suspended: {
    label: "Aguardando aprovação",
    cls: "border-status-warn/40 bg-status-warn/10 text-status-warn",
  },
  completed: {
    label: "Concluído (Verifying)",
    cls: "border-status-ok/40 bg-status-ok/10 text-status-ok",
  },
  failed: {
    label: "Encerrado / Rejeitado",
    cls: "border-status-danger/40 bg-status-danger/10 text-status-danger",
  },
};

export function ProjectStudio({
  projectId,
  initialProjectName,
  embedded = false,
}: ProjectStudioProps) {
  const queryClient = useQueryClient();

  const [assetMode, setAssetMode] = useState<"reference" | "upload">("reference");
  const [assetTitle, setAssetTitle] = useState("");
  const [assetUrlInput, setAssetUrlInput] = useState("");
  const [assetTags, setAssetTags] = useState("copiar:densidade, tema-industrial");
  const [assetNotes, setAssetNotes] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);

  const [themePreference, setThemePreference] = useState<
    "dual_theme" | "industrial_dark" | "crisp_light"
  >("dual_theme");
  const [designNotes, setDesignNotes] = useState("");
  const [generatedMarkdown, setGeneratedMarkdown] = useState<string | null>(null);

  const [brownfieldResult, setBrownfieldResult] =
    useState<BrownfieldMap | null>(null);
  const [brownfieldError, setBrownfieldError] = useState<string | null>(null);

  const [selectedDeliverableId, setSelectedDeliverableId] = useState<string>("");
  const [workflowFeedback, setWorkflowFeedback] = useState("");
  const [overrideStrategy, setOverrideStrategy] = useState<
    DevelopmentStrategy | ""
  >("");
  const [answerMap, setAnswerMap] = useState<Record<string, string>>({});
  const [workflowError, setWorkflowError] = useState<string | null>(null);

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error("Falha ao carregar projetos.");
      return ProjectListResponseSchema.parse(await res.json());
    },
  });

  const activeProject = projectsQuery.data?.items.find(
    (p) => p.id === projectId
  );
  const projectName = activeProject?.name ?? initialProjectName ?? "Projeto";

  const deliverablesQuery = useQuery({
    queryKey: ["deliverables", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/deliverables`);
      if (!res.ok) throw new Error("Falha ao carregar entregáveis.");
      return DeliverableListResponseSchema.parse(await res.json());
    },
  });

  const deliverablesList = deliverablesQuery.data?.items ?? [];
  const activeDeliverableId =
    selectedDeliverableId &&
    deliverablesList.some((d) => d.id === selectedDeliverableId)
      ? selectedDeliverableId
      : (deliverablesList[0]?.id ?? "");

  const assetsQuery = useQuery({
    queryKey: ["design-assets", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/design-assets`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Erro ao carregar moodboard visual.");
      }
      return DesignAssetListResponseSchema.parse(await res.json());
    },
  });

  const workflowQuery = useQuery({
    queryKey: ["deliverable-workflow", activeDeliverableId],
    enabled: activeDeliverableId.length > 0,
    queryFn: async () => {
      const res = await fetch(
        `/api/deliverables/${activeDeliverableId}/workflow`
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Erro ao consultar estado do workflow.");
      }
      return DeliverableWorkflowStateSchema.parse(await res.json());
    },
  });

  const addAssetMutation = useMutation({
    mutationFn: async () => {
      setAssetError(null);
      const parsedTags = assetTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      if (assetMode === "upload") {
        if (!uploadFile) {
          throw new Error("Selecione um arquivo PNG, JPEG ou WEBP.");
        }
        const form = new FormData();
        form.append("title", assetTitle.trim() || uploadFile.name);
        form.append("assetType", "moodboard_image");
        if (activeDeliverableId) {
          form.append("deliverableId", activeDeliverableId);
        }
        form.append("intentionTags", JSON.stringify(parsedTags));
        if (assetNotes.trim()) {
          form.append("notes", assetNotes.trim());
        }
        form.append("file", uploadFile);

        const res = await fetch(`/api/projects/${projectId}/design-assets`, {
          method: "POST",
          body: form,
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(body?.error ?? "Falha ao enviar imagem.");
        }
        return res.json();
      }

      const res = await fetch(`/api/projects/${projectId}/design-assets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          assetType: "reference_url",
          title: assetTitle.trim(),
          sourceUrl: assetUrlInput.trim(),
          deliverableId: activeDeliverableId || null,
          intentionTags: parsedTags,
          notes: assetNotes.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Falha ao salvar referência.");
      }
      return res.json();
    },
    onSuccess: async () => {
      setAssetTitle("");
      setAssetUrlInput("");
      setAssetNotes("");
      setUploadFile(null);
      await queryClient.invalidateQueries({
        queryKey: ["design-assets", projectId],
      });
    },
    onError: (err: Error) => setAssetError(err.message),
  });

  const toggleApproveMutation = useMutation({
    mutationFn: async (asset: DesignAsset) => {
      const res = await fetch(
        `/api/projects/${projectId}/design-assets/${asset.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ approved: !asset.approved }),
        }
      );
      if (!res.ok) throw new Error("Falha ao atualizar aprovação.");
      return res.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["design-assets", projectId],
      });
    },
  });

  const deleteAssetMutation = useMutation({
    mutationFn: async (assetId: string) => {
      const res = await fetch(
        `/api/projects/${projectId}/design-assets/${assetId}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Falha ao excluir asset.");
      return res.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["design-assets", projectId],
      });
    },
  });

  const generateDesignMdMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/projects/${projectId}/design-assets/generate-design-md`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            deliverableId: activeDeliverableId || null,
            themePreference,
            notes: designNotes.trim() || undefined,
          }),
        }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Falha ao gerar DESIGN.md.");
      }
      return GenerateDesignMdResponseSchema.parse(await res.json());
    },
    onSuccess: async (data) => {
      setGeneratedMarkdown(data.markdown);
      await queryClient.invalidateQueries({
        queryKey: ["design-assets", projectId],
      });
    },
    onError: (err: Error) => setAssetError(err.message),
  });

  const brownfieldMutation = useMutation({
    mutationFn: async () => {
      setBrownfieldError(null);
      const res = await fetch(`/api/projects/${projectId}/brownfield-scan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(
          body?.error ?? "Falha ao executar leitura brownfield."
        );
      }
      return BrownfieldMapSchema.parse(await res.json());
    },
    onSuccess: (data) => setBrownfieldResult(data),
    onError: (err: Error) => setBrownfieldError(err.message),
  });

  const startWorkflowMutation = useMutation({
    mutationFn: async () => {
      setWorkflowError(null);
      const res = await fetch(
        `/api/deliverables/${activeDeliverableId}/workflow/start`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            overrideStrategy ? { overrideStrategy } : {}
          ),
        }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Falha ao iniciar workflow.");
      }
      return DeliverableWorkflowStateSchema.parse(await res.json());
    },
    onSuccess: async (data) => {
      queryClient.setQueryData(
        ["deliverable-workflow", activeDeliverableId],
        data
      );
      await queryClient.invalidateQueries({
        queryKey: ["deliverables", projectId],
      });
    },
    onError: (err: Error) => setWorkflowError(err.message),
  });

  const resumeWorkflowMutation = useMutation({
    mutationFn: async (decision: WorkflowResumeDecision) => {
      setWorkflowError(null);
      const wfState = workflowQuery.data;
      const roundPayload = extractDiscoveryRound(wfState);
      const answers: DiscoveryAnswer[] = [];

      if (roundPayload) {
        for (const q of roundPayload.questions) {
          const val = answerMap[q.id]?.trim();
          if (val) {
            answers.push({
              questionId: q.id,
              pillar: q.pillar,
              answer: val,
            });
          }
        }
      }

      const res = await fetch(
        `/api/deliverables/${activeDeliverableId}/workflow/resume`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            decision,
            feedback: workflowFeedback.trim() || undefined,
            ...(answers.length > 0 ? { answers } : {}),
            ...(overrideStrategy ? { overrideStrategy } : {}),
            ...(wfState?.gate === "visual_approve" && decision === "approved"
              ? { approveDesignMd: true }
              : {}),
          }),
        }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Falha ao retomar workflow.");
      }
      return DeliverableWorkflowStateSchema.parse(await res.json());
    },
    onSuccess: async (data) => {
      setWorkflowFeedback("");
      queryClient.setQueryData(
        ["deliverable-workflow", activeDeliverableId],
        data
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["deliverables", projectId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["design-assets", projectId],
        }),
      ]);
    },
    onError: (err: Error) => setWorkflowError(err.message),
  });

  function handleAssetSubmit(e: FormEvent) {
    e.preventDefault();
    addAssetMutation.mutate();
  }

  const allAssets = assetsQuery.data?.items ?? [];
  const moodboardAssets = allAssets.filter((a) => a.assetType !== "design_md");
  const latestDesignAsset = allAssets.find((a) => a.assetType === "design_md");
  const displayedMarkdown = generatedMarkdown ?? latestDesignAsset?.notes ?? null;

  const wfState = workflowQuery.data;
  const discoveryRound = extractDiscoveryRound(wfState);
  const suspendedBlueprint = extractSuspendedBlueprint(wfState);
  const stuckAlert = extractStuckAlert(wfState);
  const statusMeta =
    WORKFLOW_STATUS_BADGE[wfState?.workflowStatus ?? "not_started"] ??
    DEFAULT_STATUS_BADGE;

  return (
    <div className="space-y-5" data-testid="project-studio-root">
      {/* Cabeçalho compacto de contexto */}
      <section className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-fg-secondary">
            <Link
              href={`/app?projectId=${encodeURIComponent(projectId)}`}
              data-testid="back-to-chat-link"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border-default bg-surface px-3 text-xs font-medium text-fg-secondary transition-colors hover:border-accent hover:text-fg-primary"
            >
              <ArrowLeft className="size-3.5" strokeWidth={1.75} />
              <span>Voltar ao Chat do Projeto</span>
            </Link>
            <span>/</span>
            <span className="font-mono text-[11px] uppercase tracking-wider text-fg-muted">
              Estúdio Visual &amp; Orquestrador
            </span>
          </div>
          {embedded ? (
            <h2 className="text-lg font-semibold tracking-tight text-fg-primary">
              {projectName}
            </h2>
          ) : (
            <h1 className="text-lg font-semibold tracking-tight text-fg-primary">
              {projectName}
            </h1>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/app/projects/${projectId}/code`}
            className="inline-flex items-center gap-1.5 rounded border border-border-subtle bg-surface px-2.5 py-1 text-xs font-medium text-fg-secondary transition-colors hover:border-border-default hover:text-fg-primary"
          >
            <FileCode2 className="size-3.5" strokeWidth={1.75} />
            <span>Mapa do Código</span>
          </Link>
          {activeProject && (
            <span className="rounded border border-border-subtle bg-inset px-2.5 py-1 font-mono text-[11px] text-fg-secondary tabular-nums">
              Maturidade {activeProject.maturityScore ?? "—"} / 100
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              void queryClient.invalidateQueries({
                queryKey: ["design-assets", projectId],
              });
              if (activeDeliverableId) {
                void queryClient.invalidateQueries({
                  queryKey: ["deliverable-workflow", activeDeliverableId],
                });
              }
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-default bg-surface px-3 text-xs font-medium text-fg-primary transition-colors hover:border-border-strong"
          >
            <RefreshCw className="size-3.5 text-fg-secondary" strokeWidth={1.75} />
            <span>Atualizar</span>
          </button>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Coluna Esquerda: Estúdio Visual Lite + DESIGN.md */}
        <div className="space-y-5 lg:col-span-7">
          {/* Bloco 1: Moodboard & Referências */}
          <section className="rounded-md border border-border-subtle bg-surface p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle pb-3">
              <div>
                <h2 className="text-sm font-semibold text-fg-primary">
                  Moodboard & Referências Visuais
                </h2>
                <p className="text-xs text-fg-secondary">
                  Anexe imagens PNG/JPEG/WEBP (máx. 5 MiB) ou URLs com tags de intenção.
                </p>
              </div>
              <div
                role="tablist"
                className="inline-flex rounded-md border border-border-default bg-inset p-0.5"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={assetMode === "reference"}
                  onClick={() => setAssetMode("reference")}
                  className={`inline-flex h-7 items-center gap-1 rounded px-2.5 text-xs font-medium transition-colors ${
                    assetMode === "reference"
                      ? "bg-surface text-fg-primary border border-border-subtle"
                      : "text-fg-secondary hover:text-fg-primary"
                  }`}
                >
                  <Link2 className="size-3.5" strokeWidth={1.75} />
                  <span>URL Referência</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={assetMode === "upload"}
                  onClick={() => setAssetMode("upload")}
                  className={`inline-flex h-7 items-center gap-1 rounded px-2.5 text-xs font-medium transition-colors ${
                    assetMode === "upload"
                      ? "bg-surface text-fg-primary border border-border-subtle"
                      : "text-fg-secondary hover:text-fg-primary"
                  }`}
                >
                  <ImagePlus className="size-3.5" strokeWidth={1.75} />
                  <span>Upload Imagem</span>
                </button>
              </div>
            </div>

            <form onSubmit={handleAssetSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label
                  htmlFor="asset-title"
                  className="text-xs font-medium text-fg-secondary"
                >
                  Título da Referência
                </label>
                <input
                  id="asset-title"
                  data-testid="input-asset-title"
                  value={assetTitle}
                  onChange={(e) => setAssetTitle(e.target.value)}
                  required={assetMode === "reference"}
                  placeholder="Ex.: Linear Cockpit Sidebar"
                  className="h-8 w-full rounded-md border border-border-default bg-inset px-2.5 text-xs text-fg-primary placeholder:text-fg-muted"
                />
              </div>

              {assetMode === "reference" ? (
                <div className="space-y-1">
                  <label
                    htmlFor="asset-url"
                    className="text-xs font-medium text-fg-secondary"
                  >
                    URL Externa (HTTP/HTTPS)
                  </label>
                  <input
                    id="asset-url"
                    data-testid="input-asset-url"
                    type="url"
                    required
                    value={assetUrlInput}
                    onChange={(e) => setAssetUrlInput(e.target.value)}
                    placeholder="https://linear.app"
                    className="h-8 w-full rounded-md border border-border-default bg-inset px-2.5 text-xs text-fg-primary placeholder:text-fg-muted"
                  />
                </div>
              ) : (
                <div className="space-y-1">
                  <label
                    htmlFor="asset-file"
                    className="text-xs font-medium text-fg-secondary"
                  >
                    Arquivo PNG / JPEG / WEBP
                  </label>
                  <input
                    id="asset-file"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                    className="h-8 w-full rounded-md border border-border-default bg-inset px-2 py-1 text-xs text-fg-secondary"
                  />
                </div>
              )}

              <div className="space-y-1">
                <label
                  htmlFor="asset-tags"
                  className="text-xs font-medium text-fg-secondary"
                >
                  Tags de Intenção (vírgula)
                </label>
                <input
                  id="asset-tags"
                  value={assetTags}
                  onChange={(e) => setAssetTags(e.target.value)}
                  placeholder="copiar:densidade, ignorar:sombra"
                  className="h-8 w-full rounded-md border border-border-default bg-inset px-2.5 font-mono text-xs text-fg-primary"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="asset-notes"
                  className="text-xs font-medium text-fg-secondary"
                >
                  Notas de Design
                </label>
                <input
                  id="asset-notes"
                  value={assetNotes}
                  onChange={(e) => setAssetNotes(e.target.value)}
                  placeholder="Manter contraste alto e zero blur"
                  className="h-8 w-full rounded-md border border-border-default bg-inset px-2.5 text-xs text-fg-primary"
                />
              </div>

              {assetError && (
                <p className="sm:col-span-2 rounded border border-status-danger/40 bg-status-danger/10 px-2.5 py-1.5 text-xs text-status-danger">
                  {assetError}
                </p>
              )}

              <div className="sm:col-span-2 flex justify-end">
                <button
                  type="submit"
                  data-testid="btn-save-asset"
                  disabled={addAssetMutation.isPending}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-semibold text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-50"
                >
                  <Sparkles className="size-3.5" strokeWidth={1.75} />
                  <span>
                    {addAssetMutation.isPending
                      ? "Salvando..."
                      : "Adicionar ao Moodboard"}
                  </span>
                </button>
              </div>
            </form>

            {/* 5 Estados do Moodboard: Skeleton / Error / Empty / Sparse / Dense */}
            {assetsQuery.isLoading ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label="Carregando moodboard">
                {[1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-24 animate-pulse rounded-md border border-border-subtle bg-inset"
                  />
                ))}
              </div>
            ) : assetsQuery.isError ? (
              <div className="flex items-center justify-between rounded-md border border-status-danger/40 bg-status-danger/10 p-3 text-xs text-status-danger">
                <span>{(assetsQuery.error as Error).message}</span>
                <button
                  type="button"
                  onClick={() => void assetsQuery.refetch()}
                  className="rounded border border-status-danger/40 px-2 py-1 font-medium hover:bg-status-danger/20"
                >
                  Tentar novamente
                </button>
              </div>
            ) : moodboardAssets.length === 0 ? (
              <div className="rounded-md border border-dashed border-border-default bg-inset p-6 text-center text-xs text-fg-secondary">
                Nenhuma referência visual cadastrada ainda. Cadastre uma URL ou envie um mockup acima.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {moodboardAssets.map((asset) => (
                  <article
                    key={asset.id}
                    className="flex flex-col justify-between gap-2 rounded-md border border-border-subtle bg-inset p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="truncate text-xs font-semibold text-fg-primary">
                          {asset.title}
                        </h3>
                        <p className="truncate font-mono text-[11px] text-fg-muted">
                          {asset.sourceUrl ?? asset.mimeType ?? asset.assetType}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                          asset.approved
                            ? "border-status-ok/40 bg-status-ok/10 text-status-ok"
                            : "border-border-subtle bg-surface text-fg-muted"
                        }`}
                      >
                        {asset.approved ? "Aprovado" : "Pendente"}
                      </span>
                    </div>

                    {asset.assetUrl && (
                      <div className="overflow-hidden rounded border border-border-subtle bg-canvas">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={asset.assetUrl}
                          alt={asset.title}
                          className="h-28 w-full object-cover"
                        />
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2 pt-1">
                      <div className="flex flex-wrap gap-1">
                        {asset.intentionTags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="rounded border border-border-subtle bg-surface px-1.5 py-0.5 font-mono text-[10px] text-fg-secondary"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => toggleApproveMutation.mutate(asset)}
                          aria-label={`Aprovar ${asset.title}`}
                          className="inline-flex h-7 items-center rounded border border-border-default bg-surface px-2 text-[11px] text-fg-secondary hover:text-fg-primary"
                        >
                          <Check className="size-3" strokeWidth={2} />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteAssetMutation.mutate(asset.id)}
                          aria-label={`Excluir ${asset.title}`}
                          className="inline-flex h-7 items-center rounded border border-border-default bg-surface px-2 text-[11px] text-status-danger hover:border-status-danger/50"
                        >
                          <Trash2 className="size-3" strokeWidth={1.75} />
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* Bloco 2: Contrato Visual .uzina/DESIGN.md */}
          <section className="rounded-md border border-border-subtle bg-surface p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle pb-3">
              <div className="flex items-center gap-2">
                <FileCode2 className="size-4 text-accent" strokeWidth={1.75} />
                <div>
                  <h2 className="text-sm font-semibold text-fg-primary">
                    Contrato Visual (.uzina/DESIGN.md)
                  </h2>
                  <p className="text-xs text-fg-secondary">
                    Consolida paleta OKLCH e tags do moodboard para os agentes executores.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <select
                  aria-label="Preferência de tema do contrato"
                  value={themePreference}
                  onChange={(e) =>
                    setThemePreference(
                      e.target.value as
                        | "dual_theme"
                        | "industrial_dark"
                        | "crisp_light"
                    )
                  }
                  className="h-8 rounded-md border border-border-default bg-inset px-2 text-xs text-fg-primary"
                >
                  <option value="dual_theme">Dual Theme (Dark + Light)</option>
                  <option value="industrial_dark">Industrial Dark</option>
                  <option value="crisp_light">Crisp Light</option>
                </select>
                <button
                  type="button"
                  data-testid="btn-generate-design-md"
                  disabled={generateDesignMdMutation.isPending}
                  onClick={() => generateDesignMdMutation.mutate()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-semibold text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-50"
                >
                  <Sparkles className="size-3.5" strokeWidth={1.75} />
                  <span>
                    {generateDesignMdMutation.isPending
                      ? "Gerando..."
                      : "Gerar DESIGN.md"}
                  </span>
                </button>
              </div>
            </div>

            <input
              type="text"
              value={designNotes}
              onChange={(e) => setDesignNotes(e.target.value)}
              placeholder="Diretriz adicional opcional para o contrato visual..."
              className="h-8 w-full rounded-md border border-border-default bg-inset px-2.5 text-xs text-fg-primary"
            />

            {displayedMarkdown ? (
              <pre
                data-testid="design-md-preview"
                className="max-h-64 overflow-auto rounded-md border border-border-subtle bg-inset p-3 font-mono text-[11px] leading-relaxed text-fg-secondary whitespace-pre-wrap"
              >
                {displayedMarkdown}
              </pre>
            ) : (
              <div className="rounded-md border border-dashed border-border-default bg-inset p-4 text-xs text-fg-secondary">
                Clique em <strong>Gerar DESIGN.md</strong> para sintetizar o contrato visual oficial do projeto.
              </div>
            )}
          </section>
        </div>

        {/* Coluna Direita: Brownfield Scorecard + Workflow Durável */}
        <div className="space-y-5 lg:col-span-5">
          {/* Bloco 3: Arqueologia Brownfield */}
          <section className="rounded-md border border-border-subtle bg-surface p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 border-b border-border-subtle pb-3">
              <div className="flex items-center gap-2">
                <GitBranch className="size-4 text-accent" strokeWidth={1.75} />
                <div>
                  <h2 className="text-sm font-semibold text-fg-primary">
                    Raio-X Brownfield (0–100)
                  </h2>
                  <p className="text-xs text-fg-secondary">
                    Audita o repositório local vinculado ao projeto.
                  </p>
                </div>
              </div>
              <button
                type="button"
                data-testid="btn-brownfield-scan"
                disabled={brownfieldMutation.isPending}
                onClick={() => brownfieldMutation.mutate()}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-default bg-inset px-3 text-xs font-medium text-fg-primary transition-colors hover:border-border-strong disabled:opacity-50"
              >
                <Activity className="size-3.5 text-accent" strokeWidth={1.75} />
                <span>
                  {brownfieldMutation.isPending ? "Analisando..." : "Escanear"}
                </span>
              </button>
            </div>

            {brownfieldError && (
              <p className="rounded border border-status-warn/40 bg-status-warn/10 px-2.5 py-2 text-xs text-status-warn">
                {brownfieldError}
              </p>
            )}

            {brownfieldResult ? (
              <div className="space-y-3" data-testid="brownfield-scorecard">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-fg-secondary">
                    Maturidade Técnica
                  </span>
                  <span className="font-mono text-lg font-semibold text-fg-primary tabular-nums">
                    {brownfieldResult.maturityScore}/100
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <DimensionStat
                    label="CI & Verify"
                    value={brownfieldResult.dimensions.ciAndVerify}
                  />
                  <DimensionStat
                    label="Qualidade de Testes"
                    value={brownfieldResult.dimensions.testQuality}
                  />
                  <DimensionStat
                    label="Docs & Steering"
                    value={brownfieldResult.dimensions.documentationAndSteering}
                  />
                  <DimensionStat
                    label="Postura Segurança"
                    value={brownfieldResult.dimensions.securityPosture}
                  />
                  <DimensionStat
                    label="Arquitetura"
                    value={brownfieldResult.dimensions.architectureModularity}
                  />
                  <div className="rounded border border-border-subtle bg-inset px-2.5 py-1.5">
                    <span className="block text-[10px] text-fg-muted">
                      Estratégia Sugerida
                    </span>
                    <span className="font-mono text-[11px] font-medium text-accent">
                      {brownfieldResult.recommendedStrategy}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-fg-secondary">
                Execute o scanner para diagnosticar maturidade de testes, CI e segurança antes do Blueprint.
              </p>
            )}
          </section>

          {/* Bloco 4: Orquestrador Durável (Mastra Workflow) */}
          <section className="rounded-md border border-border-subtle bg-surface p-4 space-y-4">
            <div className="flex items-center justify-between gap-2 border-b border-border-subtle pb-3">
              <div>
                <h2 className="text-sm font-semibold text-fg-primary">
                  Orquestrador Durável (Mastra)
                </h2>
                <p className="text-xs text-fg-secondary">
                  Discovery → Blueprint → Estúdio Visual → Contratos → Build
                </p>
              </div>
              <span
                className={`rounded border px-2 py-0.5 text-[11px] font-medium ${statusMeta.cls}`}
              >
                {statusMeta.label}
              </span>
            </div>

            {deliverablesQuery.isLoading ? (
              <div className="space-y-2" aria-label="Carregando entregáveis">
                <div className="h-8 animate-pulse rounded-md border border-border-subtle bg-inset" />
                <div className="h-24 animate-pulse rounded-md border border-border-subtle bg-inset" />
              </div>
            ) : deliverablesQuery.isError ? (
              <div className="flex items-center justify-between rounded-md border border-status-danger/40 bg-status-danger/10 p-3 text-xs text-status-danger">
                <span>{(deliverablesQuery.error as Error).message}</span>
                <button
                  type="button"
                  onClick={() => void deliverablesQuery.refetch()}
                  className="rounded border border-status-danger/40 px-2 py-1 font-medium hover:bg-status-danger/20"
                >
                  Tentar novamente
                </button>
              </div>
            ) : deliverablesList.length === 0 ? (
              <div className="rounded-md border border-dashed border-border-default bg-inset p-4 text-xs text-fg-secondary">
                Nenhuma entrega cadastrada neste projeto. Crie uma entrega no Painel Técnico para iniciar o workflow.
              </div>
            ) : (
              <>
                <div className="space-y-1">
                  <label
                    htmlFor="select-deliverable-wf"
                    className="text-xs font-medium text-fg-secondary"
                  >
                    Entregável em Orquestração
                  </label>
                  <select
                    id="select-deliverable-wf"
                    value={activeDeliverableId}
                    onChange={(e) => {
                      setSelectedDeliverableId(e.target.value);
                      setOverrideStrategy("");
                      setAnswerMap({});
                      setWorkflowFeedback("");
                      setWorkflowError(null);
                    }}
                    className="h-8 w-full rounded-md border border-border-default bg-inset px-2.5 text-xs text-fg-primary"
                  >
                    {deliverablesList.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title} ({d.status})
                      </option>
                    ))}
                  </select>
                </div>

                {workflowError && (
                  <p className="rounded border border-status-danger/40 bg-status-danger/10 px-2.5 py-2 text-xs text-status-danger">
                    {workflowError}
                  </p>
                )}

                {workflowQuery.isLoading ? (
                  <div className="space-y-2" aria-label="Carregando estado do workflow">
                    <div className="h-24 animate-pulse rounded-md border border-border-subtle bg-inset" />
                  </div>
                ) : workflowQuery.isError ? (
                  <div className="flex items-center justify-between rounded-md border border-status-danger/40 bg-status-danger/10 p-3 text-xs text-status-danger">
                    <span>{(workflowQuery.error as Error).message}</span>
                    <button
                      type="button"
                      onClick={() => void workflowQuery.refetch()}
                      className="rounded border border-status-danger/40 px-2 py-1 font-medium hover:bg-status-danger/20"
                    >
                      Tentar novamente
                    </button>
                  </div>
                ) : wfState?.workflowStatus === "not_started" ? (
                  <div className="space-y-2 rounded-md border border-border-subtle bg-inset p-3">
                    <p className="text-xs text-fg-secondary">
                      Inicie o workflow durável para executar Discovery socrático e rotear a estratégia do entregável.
                    </p>
                    <button
                      type="button"
                      data-testid="btn-workflow-start"
                      disabled={startWorkflowMutation.isPending}
                      onClick={() => startWorkflowMutation.mutate()}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-semibold text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-50"
                    >
                      <Play className="size-3.5" strokeWidth={2} />
                      <span>
                        {startWorkflowMutation.isPending
                          ? "Iniciando..."
                          : "Iniciar Workflow"}
                      </span>
                    </button>
                  </div>
                ) : wfState?.workflowStatus === "completed" ? (
                  <div className="rounded-md border border-status-ok/40 bg-status-ok/10 p-3 text-xs text-status-ok">
                    Workflow durável concluído para este entregável (fase Verifying / Pronto para entrega).
                  </div>
                ) : wfState?.workflowStatus === "running" ? (
                  <div className="rounded-md border border-status-info/40 bg-status-info/10 p-3 text-xs text-status-info">
                    Workflow em execução ativa para o entregável selecionado.
                  </div>
                ) : wfState?.workflowStatus === "failed" ? (
                  <div className="space-y-2 rounded-md border border-status-danger/40 bg-status-danger/10 p-3 text-xs text-status-danger">
                    <p>O workflow anterior foi encerrado ou rejeitado.</p>
                    <button
                      type="button"
                      data-testid="btn-workflow-restart"
                      disabled={startWorkflowMutation.isPending}
                      onClick={() => startWorkflowMutation.mutate()}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-semibold text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-50"
                    >
                      <RotateCcw className="size-3.5" strokeWidth={2} />
                      <span>Reiniciar Workflow</span>
                    </button>
                  </div>
                ) : null}

                {!workflowQuery.isLoading &&
                  !workflowQuery.isError &&
                  wfState &&
                  wfState.workflowStatus === "suspended" && (
                  <div
                    className="space-y-3 rounded-md border border-status-warn/40 bg-inset p-3"
                    data-testid="workflow-gate-panel"
                  >
                    <div className="flex items-center gap-2 text-xs font-semibold text-status-warn">
                      <ShieldAlert className="size-4 shrink-0" strokeWidth={1.75} />
                      <span>
                        {GATE_LABELS[wfState.gate ?? ""] ??
                          `Portão Ativo (${wfState.suspendedStep ?? "—"})`}
                      </span>
                    </div>

                    {stuckAlert && (
                      <div
                        data-testid="stuck-alert-details"
                        className="space-y-1.5 rounded border border-status-danger/40 bg-status-danger/10 p-2.5 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-semibold text-status-danger">
                            {stuckAlert.pattern}
                          </span>
                          <span className="font-mono text-[10px] text-fg-muted tabular-nums">
                            Turnos: {stuckAlert.evidenceTurns.join(", ")}
                          </span>
                        </div>
                        <p className="text-[11px] text-fg-primary">
                          {stuckAlert.reason}
                        </p>
                      </div>
                    )}

                    {discoveryRound && (
                      <div className="space-y-2">
                        <p className="font-mono text-[11px] text-fg-muted">
                          Rodada {discoveryRound.roundNumber} / 3
                        </p>
                        {discoveryRound.questions.map((q) => (
                          <div key={q.id} className="space-y-1">
                            <label
                              htmlFor={`ans-${q.id}`}
                              className="block text-xs font-medium text-fg-primary"
                            >
                              {q.prompt}
                            </label>
                            <input
                              id={`ans-${q.id}`}
                              value={answerMap[q.id] ?? ""}
                              onChange={(e) =>
                                setAnswerMap((prev) => ({
                                  ...prev,
                                  [q.id]: e.target.value,
                                }))
                              }
                              placeholder={`Sugestão: ${q.recommendedOption}`}
                              className="h-8 w-full rounded border border-border-default bg-surface px-2 text-xs text-fg-primary placeholder:text-fg-muted"
                            />
                          </div>
                        ))}
                      </div>
                    )}

                    {suspendedBlueprint && (
                      <div className="space-y-2 rounded border border-border-subtle bg-surface p-2.5 text-xs">
                        <div className="flex justify-between">
                          <span className="text-fg-secondary">Estratégia:</span>
                          <span className="font-mono font-semibold text-accent">
                            {suspendedBlueprint.developmentStrategy}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-fg-secondary">Padrão Tático:</span>
                          <span className="font-mono text-fg-primary">
                            {suspendedBlueprint.tacticalPattern}
                          </span>
                        </div>
                        <p className="text-[11px] text-fg-secondary">
                          {suspendedBlueprint.rationale}
                        </p>
                        <select
                          aria-label="Sobrescrever estratégia"
                          value={overrideStrategy}
                          onChange={(e) =>
                            setOverrideStrategy(
                              e.target.value as DevelopmentStrategy | ""
                            )
                          }
                          className="h-7 w-full rounded border border-border-default bg-inset px-2 text-[11px] text-fg-primary"
                        >
                          <option value="">Manter estratégia recomendada</option>
                          <option value="frontend_first_msw">frontend_first_msw</option>
                          <option value="api_contract_first">api_contract_first</option>
                          <option value="domain_first">domain_first</option>
                          <option value="data_schema_first">data_schema_first</option>
                          <option value="characterization_strangler">
                            characterization_strangler
                          </option>
                          <option value="spike_first">spike_first</option>
                        </select>
                      </div>
                    )}

                    <div className="space-y-1">
                      <label
                        htmlFor="wf-feedback"
                        className="text-xs font-medium text-fg-secondary"
                      >
                        Feedback / Instrução Humana (opcional)
                      </label>
                      <textarea
                        id="wf-feedback"
                        rows={2}
                        value={workflowFeedback}
                        onChange={(e) => setWorkflowFeedback(e.target.value)}
                        placeholder="Observações para o próximo passo..."
                        className="w-full rounded border border-border-default bg-surface p-2 text-xs text-fg-primary"
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        data-testid="btn-workflow-approve"
                        disabled={resumeWorkflowMutation.isPending}
                        onClick={() => resumeWorkflowMutation.mutate("approved")}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-semibold text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-50"
                      >
                        <Check className="size-3.5" strokeWidth={2} />
                        <span>Aprovar & Avançar</span>
                      </button>
                      <button
                        type="button"
                        data-testid="btn-workflow-changes"
                        disabled={resumeWorkflowMutation.isPending}
                        onClick={() =>
                          resumeWorkflowMutation.mutate("changes_requested")
                        }
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-default bg-surface px-2.5 text-xs font-medium text-fg-primary hover:border-border-strong disabled:opacity-50"
                      >
                        <RotateCcw className="size-3.5" strokeWidth={1.75} />
                        <span>Pedir Ajustes</span>
                      </button>
                      <button
                        type="button"
                        data-testid="btn-workflow-reject"
                        disabled={resumeWorkflowMutation.isPending}
                        onClick={() => resumeWorkflowMutation.mutate("rejected")}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-status-danger/40 bg-status-danger/10 px-2.5 text-xs font-medium text-status-danger hover:bg-status-danger/20 disabled:opacity-50"
                      >
                        <XCircle className="size-3.5" strokeWidth={1.75} />
                        <span>Rejeitar</span>
                      </button>
                    </div>
                  </div>
                )}

                {wfState && wfState.stageHistory.length > 0 && (
                  <div className="space-y-1 border-t border-border-subtle pt-3">
                    <span className="text-[11px] font-medium text-fg-muted">
                      Estágios percorridos
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {wfState.stageHistory.map((st) => (
                        <span
                          key={st}
                          className="rounded border border-border-subtle bg-inset px-2 py-0.5 font-mono text-[10px] text-fg-secondary"
                        >
                          {st}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </div>

      <StitchPrototypesPanel projectId={projectId} />
    </div>
  );
}

function DimensionStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-border-subtle bg-inset px-2.5 py-1.5">
      <span className="block text-[10px] text-fg-muted">{label}</span>
      <span className="font-mono text-xs font-semibold text-fg-primary tabular-nums">
        {value}/20
      </span>
    </div>
  );
}

function extractDiscoveryRound(
  state: DeliverableWorkflowState | undefined
): DiscoveryRound | null {
  if (!state?.suspendPayload || state.gate !== "discovery_confirm") {
    return null;
  }
  const raw = state.suspendPayload.round;
  if (!raw || typeof raw !== "object") return null;
  return raw as DiscoveryRound;
}

function extractSuspendedBlueprint(
  state: DeliverableWorkflowState | undefined
): StrategyRouterOutput | null {
  if (!state) return null;
  if (state.gate === "blueprint_approve" && state.suspendPayload?.blueprint) {
    return state.suspendPayload.blueprint as StrategyRouterOutput;
  }
  return state.blueprint ?? null;
}

function extractStuckAlert(
  state: DeliverableWorkflowState | undefined
): StuckAlert | null {
  if (!state?.suspendPayload || state.gate !== "stuck_intervention") {
    return null;
  }
  const raw = state.suspendPayload.stuckAlert;
  if (!raw || typeof raw !== "object") return null;
  return raw as StuckAlert;
}
