"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_TOOL_POLICIES,
  EngineConfigResponseSchema,
  type AstEngineMode,
  type CodingExecutorMode,
  type EmbeddingEngineMode,
  type ToolPoliciesMap,
  type ToolPolicyAction,
  type WorkspaceKind,
} from "@uzina/contracts";
import { Check, Cpu, HardDrive, Save, Sliders, Zap } from "lucide-react";
import { useState, type FormEvent } from "react";

interface EngineDraft {
  embeddingMode?: EmbeddingEngineMode;
  astMode?: AstEngineMode;
  workspaceKind?: WorkspaceKind;
  codingExecutorMode?: CodingExecutorMode;
  skeletonMaxTokens?: string;
  qmdTopK?: string;
  autoInjectInRunner?: boolean;
  ollamaBaseUrl?: string;
  ollamaEmbeddingModel?: string;
  dockerCpuLimit?: string;
  dockerMemoryLimit?: string;
  toolPolicies?: ToolPoliciesMap;
}

const TOOL_POLICY_ITEMS: Array<{
  key: keyof ToolPoliciesMap;
  label: string;
}> = [
  { key: "readCode", label: "Leitura de Código" },
  { key: "runTests", label: "Execução de Testes" },
  { key: "writeFiles", label: "Escrita em Arquivos" },
  { key: "gitFinalize", label: "Finalização Git (Merge / PR)" },
];

export function EngineConfigPanel() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<EngineDraft>({});
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const configQuery = useQuery({
    queryKey: ["engine-config"],
    queryFn: async () => {
      const res = await fetch("/api/finops/config");
      if (!res.ok) {
        throw new Error("Falha ao carregar configuração dos motores.");
      }
      return EngineConfigResponseSchema.parse(await res.json());
    },
  });

  const cfg = configQuery.data?.config;
  const embeddingMode = draft.embeddingMode ?? cfg?.embeddingMode ?? "deterministic";
  const astMode = draft.astMode ?? cfg?.astMode ?? "polyglot";
  const workspaceKind = draft.workspaceKind ?? cfg?.workspaceKind ?? "worktree";
  const codingExecutorMode =
    draft.codingExecutorMode ?? cfg?.codingExecutorMode ?? "opencode";
  const skeletonMaxTokens =
    draft.skeletonMaxTokens ?? String(cfg?.skeletonMaxTokens ?? 2000);
  const qmdTopK = draft.qmdTopK ?? String(cfg?.qmdTopK ?? 5);
  const autoInjectInRunner =
    draft.autoInjectInRunner ?? cfg?.autoInjectInRunner ?? true;
  const ollamaBaseUrl =
    draft.ollamaBaseUrl ?? cfg?.ollamaBaseUrl ?? "http://127.0.0.1:11434";
  const ollamaEmbeddingModel =
    draft.ollamaEmbeddingModel ?? cfg?.ollamaEmbeddingModel ?? "bge-m3";
  const dockerCpuLimit = draft.dockerCpuLimit ?? cfg?.dockerCpuLimit ?? "1.0";
  const dockerMemoryLimit =
    draft.dockerMemoryLimit ?? cfg?.dockerMemoryLimit ?? "512m";
  const toolPolicies: ToolPoliciesMap =
    draft.toolPolicies ?? cfg?.toolPolicies ?? DEFAULT_TOOL_POLICIES;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/finops/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          embeddingMode,
          astMode,
          workspaceKind,
          codingExecutorMode,
          skeletonMaxTokens: Number(skeletonMaxTokens),
          qmdTopK: Number(qmdTopK),
          autoInjectInRunner,
          ollamaBaseUrl,
          ollamaEmbeddingModel,
          dockerCpuLimit,
          dockerMemoryLimit,
          toolPolicies,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Falha ao atualizar motores.");
      }
      return EngineConfigResponseSchema.parse(await res.json());
    },
    onSuccess: async (res) => {
      setDraft({});
      setSaveErr(null);
      setSaveMsg(
        `Motores atualizados em tempo real (sem restart): ${res.activeEmbeddingProviderId} · AST ${res.config.astMode} · Workspace ${res.config.workspaceKind} · Executor ${res.config.codingExecutorMode}.`
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["engine-config"] }),
        queryClient.invalidateQueries({ queryKey: ["finops-summary"] }),
      ]);
    },
    onError: (err: Error) => {
      setSaveMsg(null);
      setSaveErr(err.message);
    },
  });

  function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaveErr(null);
    saveMutation.mutate();
  }

  const data = configQuery.data;
  const catalog = data?.catalog ?? [];

  return (
    <section
      className="min-w-0 max-w-full space-y-4 overflow-hidden rounded border border-border-subtle bg-surface p-4"
      data-testid="engine-config-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle pb-3">
        <div className="flex items-center gap-2">
          <Sliders className="size-4 text-accent" strokeWidth={1.75} />
          <div>
            <h2 className="text-sm font-semibold text-fg-primary">
              Configuração Dinâmica de Motores (Hot-Reload — Sem Restart do Docker)
            </h2>
            <p className="text-xs text-fg-muted">
              Ajuste Embeddings, AST multi-linguagem, Injeção Automática e Sandbox em tempo real.
            </p>
          </div>
        </div>

        {data && (
          <div className="flex flex-wrap items-center gap-2">
            <span
              data-testid="engine-docker-ready-badge"
              className={`rounded-md border px-2.5 py-1 font-mono text-xs ${
                data.dockerReady
                  ? "border-status-ok/40 bg-status-ok/10 text-status-ok"
                  : "border-border-subtle bg-inset text-fg-secondary"
              }`}
            >
              {data.dockerReady
                ? `Docker v${data.dockerVersion ?? "ativo"}`
                : "Docker indisponível · fallback Worktree"}
            </span>
            <span className="rounded-md border border-border-subtle bg-inset px-2.5 py-1 font-mono text-xs text-fg-secondary">
              provider ativo: {data.activeEmbeddingProviderId}
            </span>
          </div>
        )}
      </div>

      {saveMsg && (
        <div className="flex items-center gap-1.5 rounded-lg border border-status-ok/40 bg-status-ok/10 px-3 py-2 text-xs text-status-ok">
          <Check className="size-3.5 shrink-0" strokeWidth={1.75} />
          <span>{saveMsg}</span>
        </div>
      )}
      {saveErr && (
        <div className="rounded-lg border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-xs text-status-danger">
          {saveErr}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="min-w-0">
            <label
              htmlFor="engine-embedding-select"
              className="block text-xs font-medium text-fg-secondary"
            >
              Motor de Embeddings (QMD)
            </label>
            <select
              id="engine-embedding-select"
              data-testid="engine-embedding-select"
              value={embeddingMode}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  embeddingMode: e.target.value as EmbeddingEngineMode,
                }))
              }
              className="mt-1 min-h-9 w-full rounded-md border border-border-default bg-inset px-2.5 text-xs text-fg-primary focus:border-border-strong focus:outline-none"
            >
              <option value="deterministic">deterministic (0 MB · Offline)</option>
              <option value="onnx_e5_small">
                onnx_e5_small (Bilíngue PT-BR/EN)
              </option>
              <option value="ollama">ollama (Servidor Local)</option>
            </select>
          </div>

          <div className="min-w-0">
            <label
              htmlFor="engine-ast-select"
              className="block text-xs font-medium text-fg-secondary"
            >
              Indexador AST
            </label>
            <select
              id="engine-ast-select"
              data-testid="engine-ast-select"
              value={astMode}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  astMode: e.target.value as AstEngineMode,
                }))
              }
              className="mt-1 min-h-9 w-full rounded-md border border-border-default bg-inset px-2.5 text-xs text-fg-primary focus:border-border-strong focus:outline-none"
            >
              <option value="ts_native">ts_native (TS/TSX/JS)</option>
              <option value="polyglot">
                polyglot (TS + Py, Go, Rust, SQL, Java, C#)
              </option>
            </select>
          </div>

          <div className="min-w-0">
            <label
              htmlFor="engine-workspace-select"
              className="block text-xs font-medium text-fg-secondary"
            >
              Workspace de Execução
            </label>
            <select
              id="engine-workspace-select"
              data-testid="engine-workspace-select"
              value={workspaceKind}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  workspaceKind: e.target.value as WorkspaceKind,
                }))
              }
              className="mt-1 min-h-9 w-full rounded-md border border-border-default bg-inset px-2.5 text-xs text-fg-primary focus:border-border-strong focus:outline-none"
            >
              <option value="worktree">worktree (Git Local Rápido)</option>
              <option value="docker">docker (Container Hardened)</option>
            </select>
          </div>

          <div className="min-w-0">
            <label
              htmlFor="engine-coding-executor-select"
              className="block text-xs font-medium text-fg-secondary"
            >
              Executor de Codificação
            </label>
            <select
              id="engine-coding-executor-select"
              data-testid="engine-coding-executor-select"
              value={codingExecutorMode}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  codingExecutorMode: e.target.value as CodingExecutorMode,
                }))
              }
              className="mt-1 min-h-9 w-full rounded-md border border-border-default bg-inset px-2.5 text-xs text-fg-primary focus:border-border-strong focus:outline-none"
            >
              <option value="opencode">opencode (OpenCode SDK + Worktree)</option>
              <option value="mastra_coding_agent">
                mastra_coding_agent (Mastra AgentWorkspace)
              </option>
            </select>
          </div>

          <div className="min-w-0">
            <label
              htmlFor="engine-skeleton-tokens-input"
              className="block text-xs font-medium text-fg-secondary"
            >
              Orçamento Esqueleto (tokens)
            </label>
            <input
              id="engine-skeleton-tokens-input"
              type="number"
              min={200}
              max={8000}
              data-testid="engine-skeleton-tokens-input"
              value={skeletonMaxTokens}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  skeletonMaxTokens: e.target.value,
                }))
              }
              className="mt-1 min-h-9 w-full rounded-md border border-border-default bg-inset px-2.5 font-mono text-xs text-fg-primary tabular-nums focus:border-border-strong focus:outline-none"
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="min-w-0">
            <label
              htmlFor="engine-qmd-topk-input"
              className="block text-xs font-medium text-fg-secondary"
            >
              QMD Top-K Contexto
            </label>
            <input
              id="engine-qmd-topk-input"
              type="number"
              min={1}
              max={10}
              value={qmdTopK}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, qmdTopK: e.target.value }))
              }
              className="mt-1 min-h-9 w-full rounded-md border border-border-default bg-inset px-2.5 font-mono text-xs text-fg-primary tabular-nums focus:border-border-strong focus:outline-none"
            />
          </div>

          <div className="min-w-0">
            <label
              htmlFor="engine-docker-cpu"
              className="block text-xs font-medium text-fg-secondary"
            >
              Docker CPU / Memória
            </label>
            <div className="mt-1 flex gap-1.5">
              <input
                id="engine-docker-cpu"
                type="text"
                value={dockerCpuLimit}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    dockerCpuLimit: e.target.value,
                  }))
                }
                aria-label="Docker CPU"
                className="min-h-9 w-1/2 rounded-md border border-border-default bg-inset px-2 font-mono text-xs text-fg-primary focus:border-border-strong focus:outline-none"
              />
              <input
                id="engine-docker-mem"
                type="text"
                value={dockerMemoryLimit}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    dockerMemoryLimit: e.target.value,
                  }))
                }
                aria-label="Docker Memória"
                className="min-h-9 w-1/2 rounded-md border border-border-default bg-inset px-2 font-mono text-xs text-fg-primary focus:border-border-strong focus:outline-none"
              />
            </div>
          </div>

          <div className="min-w-0 sm:col-span-2">
            <label
              htmlFor="engine-ollama-url"
              className="block text-xs font-medium text-fg-secondary"
            >
              Ollama Endpoint &amp; Modelo (se ativo)
            </label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <input
                id="engine-ollama-url"
                type="url"
                value={ollamaBaseUrl}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    ollamaBaseUrl: e.target.value,
                  }))
                }
                aria-label="URL base do servidor Ollama"
                className="min-w-0 flex-1 rounded border border-border-subtle bg-inset px-2.5 py-1.5 font-mono text-xs text-fg-primary focus:border-accent focus:outline-none"
              />
              <input
                id="engine-ollama-model"
                type="text"
                value={ollamaEmbeddingModel}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    ollamaEmbeddingModel: e.target.value,
                  }))
                }
                aria-label="Modelo de embedding Ollama"
                className="w-28 rounded border border-border-subtle bg-inset px-2.5 py-1.5 font-mono text-xs text-fg-primary focus:border-accent focus:outline-none"
              />
            </div>
          </div>
        </div>

        <div className="space-y-2 rounded-lg border border-border-subtle bg-inset/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-fg-primary">
              Políticas Granulares por Classe de Ferramenta (allow · ask · deny)
            </h3>
            <span className="text-xs text-fg-muted">
              Aplicado imediatamente no Mastra Workspace e gates HITL.
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {TOOL_POLICY_ITEMS.map((item) => {
              const selectId = `tool-policy-${item.key}`;
              return (
                <div key={item.key} className="min-w-0">
                  <label
                    htmlFor={selectId}
                    className="block text-xs font-medium text-fg-secondary"
                  >
                    {item.label}
                  </label>
                  <select
                    id={selectId}
                    data-testid={selectId}
                    value={toolPolicies[item.key]}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        toolPolicies: {
                          ...(prev.toolPolicies ?? toolPolicies),
                          [item.key]: e.target.value as ToolPolicyAction,
                        },
                      }))
                    }
                    className="mt-1 min-h-9 w-full rounded-md border border-border-default bg-inset px-2.5 text-xs text-fg-primary focus:border-border-strong focus:outline-none"
                  >
                    <option value="allow">Permitir (allow)</option>
                    <option value="ask">Solicitar aprovação (ask)</option>
                    <option value="deny">Bloquear (deny)</option>
                  </select>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-fg-primary">
            <input
              type="checkbox"
              data-testid="engine-auto-inject-checkbox"
              checked={autoInjectInRunner}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  autoInjectInRunner: e.target.checked,
                }))
              }
              className="size-4 rounded border-border-default bg-inset accent-accent"
            />
            <span>
              Injeção Automática de Esqueleto AST + QMD no Prompt Cache dos Agentes
            </span>
          </label>

          <button
            type="submit"
            data-testid="engine-config-save-btn"
            disabled={saveMutation.isPending}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            <Save className="size-3.5" strokeWidth={1.75} />
            <span>
              {saveMutation.isPending ? "Aplicando..." : "Aplicar Sem Restart"}
            </span>
          </button>
        </div>
      </form>

      {catalog.length > 0 && (
        <div className="space-y-2.5 border-t border-border-subtle pt-4">
          <h3 className="text-xs font-semibold text-fg-secondary">
            Consumo Estimado × Benefício por Motor
          </h3>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {catalog.map((opt) => {
              const isSelected =
                opt.id === embeddingMode ||
                opt.id === astMode ||
                opt.id === workspaceKind;
              return (
                <div
                  key={opt.id}
                  data-testid="engine-telemetry-card"
                  className={`min-w-0 space-y-1.5 rounded-lg border p-3 text-xs ${
                    isSelected
                      ? "border-border-strong bg-elevated"
                      : "border-border-subtle bg-inset"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <span className="inline-flex min-w-0 items-center gap-1.5 font-semibold text-fg-primary">
                      {isSelected && (
                        <span className="size-1.5 shrink-0 rounded-full bg-status-ok" />
                      )}
                      <span className="break-words">{opt.label}</span>
                    </span>
                    <span className="shrink-0 rounded border border-border-subtle bg-surface px-1.5 py-0.5 font-mono text-xs text-fg-muted">
                      {opt.category}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 font-mono text-xs text-fg-secondary tabular-nums">
                    <span className="inline-flex items-center gap-1">
                      <HardDrive className="size-3" /> {opt.diskMb} MB
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Cpu className="size-3" /> {opt.ramMb} MB RAM
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Zap className="size-3" /> {opt.cpuImpact}
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed text-fg-secondary">
                    {opt.benefitSummary}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
