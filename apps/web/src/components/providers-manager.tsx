"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgentRole,
  ProviderProfileListResponse,
  ProviderProfilePublic,
  ProviderType,
  RoleBindings,
  TestProviderConnectionResponse,
} from "@uzina/contracts";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Volume2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";

const PROVIDER_LABELS: Record<ProviderType, string> = {
  google: "Google Gemini (AI Studio)",
  openai_compatible: "OpenAI / OpenRouter (Compatible)",
  anthropic: "Anthropic Direct (Claude)",
  omniroute: "OmniRoute Gateway",
  ollama: "Ollama Local (Sem Chave Externa)",
  github_pat: "GitHub PAT (Draft PR)",
};

const PROVIDER_PRESETS: Record<
  ProviderType,
  {
    defaultName: string;
    baseUrl: string;
    keyPlaceholder: string;
    tier3Model: string;
    tier2Model: string;
    suggestions: string[];
  }
> = {
  google: {
    defaultName: "Google Gemini Principal",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    keyPlaceholder: "AIzaSy...",
    tier3Model: "gemini-2.5-pro",
    tier2Model: "gemini-2.5-flash",
    suggestions: [
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-2.0-flash",
    ],
  },
  openai_compatible: {
    defaultName: "OpenAI / OpenRouter Principal",
    baseUrl: "https://api.openai.com/v1",
    keyPlaceholder: "sk-... ou sk-or-v1-...",
    tier3Model: "gpt-4o",
    tier2Model: "gpt-4o-mini",
    suggestions: [
      "gpt-4o",
      "gpt-4o-mini",
      "o3-mini",
      "google/gemini-2.5-pro",
      "anthropic/claude-sonnet-4",
    ],
  },
  anthropic: {
    defaultName: "Anthropic Claude Direct",
    baseUrl: "https://api.anthropic.com/v1",
    keyPlaceholder: "sk-ant-...",
    tier3Model: "claude-sonnet-4-5",
    tier2Model: "claude-haiku-4-5",
    suggestions: [
      "claude-sonnet-4-5",
      "claude-haiku-4-5",
      "claude-3-7-sonnet-latest",
    ],
  },
  omniroute: {
    defaultName: "OmniRoute Gateway",
    baseUrl: "http://localhost:8080/v1",
    keyPlaceholder: "sk-omni-...",
    tier3Model: "omni-pro",
    tier2Model: "omni-fast",
    suggestions: [
      "omni-pro",
      "omni-fast",
      "gemini-2.5-pro",
      "claude-sonnet-4",
      "gpt-4o",
    ],
  },
  ollama: {
    defaultName: "Ollama Local Workstation",
    baseUrl: "http://127.0.0.1:11434",
    keyPlaceholder: "Não requer chave (execução local)",
    tier3Model: "qwen2.5-coder:7b",
    tier2Model: "qwen2.5-coder:7b",
    suggestions: [
      "qwen2.5-coder:7b",
      "qwen2.5-coder:14b",
      "llama3.2",
      "deepseek-r1:8b",
    ],
  },
  github_pat: {
    defaultName: "GitHub PAT (Draft PR)",
    baseUrl: "https://api.github.com",
    keyPlaceholder: "ghp_... ou github_pat_...",
    tier3Model: "github-rest-v3",
    tier2Model: "github-rest-v3",
    suggestions: ["github-rest-v3"],
  },
};

const AGENT_ROLES: Array<{
  key: AgentRole;
  label: string;
  defaultTier: "tier3" | "tier2";
}> = [
  { key: "discovery", label: "Descoberta (Produto)", defaultTier: "tier3" },
  { key: "architect", label: "Arquiteto (Estratégia)", defaultTier: "tier3" },
  { key: "visual", label: "Visual (Estúdio/UX)", defaultTier: "tier2" },
  { key: "builder", label: "Builder (Tech Lead)", defaultTier: "tier2" },
  { key: "verifier", label: "Verifier (QA/Testes)", defaultTier: "tier2" },
  { key: "security", label: "AppSec (Segurança)", defaultTier: "tier2" },
  { key: "copilot", label: "Co-piloto Executivo", defaultTier: "tier2" },
];

function buildBindingsForPreset(
  type: ProviderType,
  mode: "recommended_tiering" | "fast_economy"
): Record<AgentRole, string> {
  const preset = PROVIDER_PRESETS[type];
  const t3 = mode === "fast_economy" ? preset.tier2Model : preset.tier3Model;
  const t2 = preset.tier2Model;
  return {
    discovery: t3,
    architect: t3,
    visual: t2,
    builder: t2,
    verifier: t2,
    security: t2,
    copilot: t2,
  };
}

async function fetchProviders(): Promise<ProviderProfileListResponse> {
  const res = await fetch("/api/providers");
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(err?.error ?? `Erro HTTP ${res.status}`);
  }
  return (await res.json()) as ProviderProfileListResponse;
}

export function ProvidersManager() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ProviderProfilePublic | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pingResult, setPingResult] =
    useState<TestProviderConnectionResponse | null>(null);
  const [cardPingResults, setCardPingResults] = useState<
    Record<string, TestProviderConnectionResponse>
  >({});

  const [name, setName] = useState("");
  const [providerType, setProviderType] = useState<ProviderType>("google");
  const [baseUrl, setBaseUrl] = useState(PROVIDER_PRESETS.google.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [isDefault, setIsDefault] = useState(true);
  const [roleModels, setRoleModels] = useState<Record<AgentRole, string>>(() =>
    buildBindingsForPreset("google", "recommended_tiering")
  );
  const [customPricingOpen, setCustomPricingOpen] = useState(false);
  const [customInputUsd, setCustomInputUsd] = useState("");
  const [customOutputUsd, setCustomOutputUsd] = useState("");

  const providersQuery = useQuery({
    queryKey: ["providers"],
    queryFn: fetchProviders,
  });

  const profiles = useMemo(
    () => providersQuery.data?.items ?? [],
    [providersQuery.data?.items]
  );

  function handleProviderTypeChange(nextType: ProviderType) {
    setProviderType(nextType);
    const preset = PROVIDER_PRESETS[nextType];
    setBaseUrl(preset.baseUrl);
    if (!editing && (!name.trim() || Object.values(PROVIDER_PRESETS).some((p) => p.defaultName === name.trim()))) {
      setName(preset.defaultName);
    }
    if (!editing && nextType === "github_pat") {
      setIsDefault(false);
    }
    setRoleModels(buildBindingsForPreset(nextType, "recommended_tiering"));
    setPingResult(null);
  }

  const pingMutation = useMutation({
    mutationFn: async (payload: {
      providerId?: string;
      providerType?: ProviderType;
      baseUrl?: string | null;
      apiKey?: string;
      modelId?: string;
    }) => {
      const res = await fetch("/api/providers/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(err?.error ?? `Falha HTTP ${res.status}`);
      }
      return (await res.json()) as TestProviderConnectionResponse;
    },
    onSuccess: (data, variables) => {
      if (variables.providerId && !modalOpen) {
        setCardPingResults((prev) => ({
          ...prev,
          [variables.providerId!]: data,
        }));
      } else {
        setPingResult(data);
      }
    },
    onError: (err: Error) => {
      setFormError(err.message);
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const isGithubPat = providerType === "github_pat";
      const roleBindings: RoleBindings = {};
      if (!isGithubPat) {
        for (const r of AGENT_ROLES) {
          const val = roleModels[r.key]?.trim();
          if (val) {
            roleBindings[r.key] = { modelId: val };
          }
        }
      }

      const parsedIn = Number(customInputUsd);
      const parsedOut = Number(customOutputUsd);
      const hasCustomRates =
        !isGithubPat &&
        customInputUsd.trim().length > 0 &&
        customOutputUsd.trim().length > 0 &&
        Number.isFinite(parsedIn) &&
        parsedIn >= 0 &&
        Number.isFinite(parsedOut) &&
        parsedOut >= 0;

      const nextCustomPricing = isGithubPat
        ? undefined
        : hasCustomRates
          ? {
              ...(editing?.customPricing ?? {}),
              "*": {
                inputPer1MUsd: parsedIn,
                outputPer1MUsd: parsedOut,
              },
            }
          : editing?.customPricing;

      if (editing) {
        const res = await fetch(`/api/providers/${editing.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            baseUrl: baseUrl.trim() || null,
            ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
            roleBindings,
            ...(nextCustomPricing !== undefined
              ? { customPricing: nextCustomPricing }
              : {}),
            isDefault,
          }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(err?.error ?? "Falha ao atualizar provedor");
        }
        return res.json();
      }

      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          providerType,
          baseUrl: baseUrl.trim() || null,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          roleBindings,
          ...(nextCustomPricing !== undefined
            ? { customPricing: nextCustomPricing }
            : {}),
          isDefault,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error ?? "Falha ao salvar provedor");
      }
      return res.json();
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["providers"] }),
        queryClient.invalidateQueries({ queryKey: ["agency-status"] }),
      ]);
      setApiKey("");
      setFormError(null);
      setPingResult(null);
      setEditing(null);
      setModalOpen(false);
    },
    onError: (err: Error) => setFormError(err.message),
  });

  function openCreateModal(initialType: ProviderType = "google") {
    setEditing(null);
    const preset = PROVIDER_PRESETS[initialType];
    setName(preset.defaultName);
    setProviderType(initialType);
    setBaseUrl(preset.baseUrl);
    setApiKey("");
    setIsDefault(initialType === "github_pat" ? false : profiles.length === 0);
    setRoleModels(buildBindingsForPreset(initialType, "recommended_tiering"));
    setCustomPricingOpen(false);
    setCustomInputUsd("");
    setCustomOutputUsd("");
    setFormError(null);
    setPingResult(null);
    setModalOpen(true);
  }

  function openEditModal(profile: ProviderProfilePublic) {
    setEditing(profile);
    setName(profile.name);
    setProviderType(profile.providerType);
    setBaseUrl(
      profile.baseUrl ?? PROVIDER_PRESETS[profile.providerType].baseUrl
    );
    setApiKey("");
    setIsDefault(profile.isDefault);
    const defaults = buildBindingsForPreset(
      profile.providerType,
      "recommended_tiering"
    );
    setRoleModels({
      discovery: profile.roleBindings.discovery?.modelId ?? defaults.discovery,
      architect: profile.roleBindings.architect?.modelId ?? defaults.architect,
      visual: profile.roleBindings.visual?.modelId ?? defaults.visual,
      builder: profile.roleBindings.builder?.modelId ?? defaults.builder,
      verifier: profile.roleBindings.verifier?.modelId ?? defaults.verifier,
      security: profile.roleBindings.security?.modelId ?? defaults.security,
      copilot: profile.roleBindings.copilot?.modelId ?? defaults.copilot,
    });
    const wildcardRate = profile.customPricing?.["*"];
    setCustomPricingOpen(Boolean(wildcardRate));
    setCustomInputUsd(wildcardRate ? String(wildcardRate.inputPer1MUsd) : "");
    setCustomOutputUsd(wildcardRate ? String(wildcardRate.outputPer1MUsd) : "");
    setFormError(null);
    setPingResult(null);
    setModalOpen(true);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (name.trim().length < 2) {
      setFormError("Informe o nome do perfil (mínimo 2 caracteres).");
      return;
    }
    if (!editing && providerType !== "ollama" && apiKey.trim().length < 4) {
      setFormError("Informe uma chave de API válida para cifragem no cofre.");
      return;
    }
    saveMutation.mutate();
  }

  function handleTestModalConnection() {
    setFormError(null);
    setPingResult(null);
    if (!editing && providerType !== "ollama" && apiKey.trim().length < 4) {
      setFormError(
        "Cole sua API Key no campo acima antes de testar a conexão real."
      );
      return;
    }
    pingMutation.mutate({
      ...(editing ? { providerId: editing.id } : {}),
      providerType,
      baseUrl: baseUrl.trim() || null,
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      modelId:
        roleModels.discovery?.trim() ||
        roleModels.architect?.trim() ||
        PROVIDER_PRESETS[providerType].tier2Model,
    });
  }

  const currentPreset = PROVIDER_PRESETS[providerType];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <section className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-4">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-elevated px-2.5 py-0.5 font-mono text-xs font-medium text-fg-secondary">
              <ShieldCheck className="size-3.5 text-status-ok" strokeWidth={1.75} />
              <span>AES-256-GCM · Prompt Cache Fixo por Papel</span>
            </span>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-fg-primary">
            Provedores &amp; Cofre Criptográfico
          </h1>
          <p className="text-sm text-fg-secondary">
            Conecte sua API Key (Google Gemini, OpenAI/OpenRouter, Anthropic ou Ollama) e teste a resposta real do modelo antes de usar no Chat.
          </p>
        </div>

        <button
          type="button"
          data-testid="btn-new-provider"
          onClick={() => openCreateModal("google")}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover"
        >
          <Plus className="size-4" strokeWidth={2} />
          <span>Adicionar Provedor</span>
        </button>
      </section>

      {/* Guia Rápido de Provedores (1 clique para abrir modal pré-configurado) */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(
          [
            {
              type: "google" as const,
              title: "Google Gemini (AI Studio)",
              desc: "Gemini 2.5 Pro (Tier 3) + 2.5 Flash (Tier 2). Camada gratuita disponível.",
            },
            {
              type: "openai_compatible" as const,
              title: "OpenAI / OpenRouter",
              desc: "GPT-4o + GPT-4o-mini ou qualquer modelo via endpoint OpenRouter.",
            },
            {
              type: "anthropic" as const,
              title: "Anthropic Direct",
              desc: "Claude Sonnet 4.5 (Arquiteto) + Claude Haiku 4.5 (Execução Rápida).",
            },
            {
              type: "omniroute" as const,
              title: "OmniRoute Gateway",
              desc: "Gateway unificado OpenAI-compatible (ex.: omni-fast e roteamento por papel).",
            },
            {
              type: "ollama" as const,
              title: "Ollama 100% Local",
              desc: "Sem chave externa: conecta em http://127.0.0.1:11434 (Qwen/Llama).",
            },
            {
              type: "github_pat" as const,
              title: "GitHub PAT (Draft PR)",
              desc: "Token cifrado para git push HTTPS e abertura automática de Draft PR via REST API.",
            },
          ] as const
        ).map((card) => (
          <button
            key={card.type}
            type="button"
            data-testid={`quick-provider-preset-${card.type}`}
            onClick={() => openCreateModal(card.type)}
            className="uzina-card group flex flex-col justify-between rounded-xl border border-border-subtle bg-surface p-4 text-left transition-colors hover:border-border-strong hover:bg-elevated/40"
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-fg-primary">
                  {card.title}
                </span>
                <Sparkles className="size-4 shrink-0 text-fg-muted transition-colors group-hover:text-fg-primary" />
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-fg-secondary">
                {card.desc}
              </p>
            </div>
            <span className="mt-3 inline-block font-mono text-xs font-medium text-fg-secondary transition-colors group-hover:text-fg-primary">
              Configurar em 1 clique →
            </span>
          </button>
        ))}
      </section>

      {/* Presets Rápidos de Voz (STT / TTS) via OpenAI-compatible */}
      <section className="uzina-card flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-subtle bg-surface p-4">
        <div className="min-w-0 space-y-1">
          <p className="flex items-center gap-2 text-sm font-semibold text-fg-primary">
            <Volume2 className="size-4 text-accent" strokeWidth={1.75} />
            <span>Presets de Voz (STT &amp; TTS via Cofre AES-256-GCM)</span>
          </p>
          <p className="text-xs text-fg-secondary">
            Adicione um provedor compatível para transcrição rápida e narração
            natural, ou configure voz nativa gratuita em{" "}
            <Link href="/app/settings" className="text-accent hover:underline">
              Celular &amp; Alertas
            </Link>
            .
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="preset-voice-groq"
            onClick={() => {
              openCreateModal("openai_compatible");
              setName("Groq Whisper Turbo (STT)");
              setBaseUrl("https://api.groq.com/openai/v1");
            }}
            className="inline-flex min-h-9 items-center rounded-md border border-border-default bg-inset px-3 text-xs font-medium text-fg-primary hover:border-border-strong"
          >
            + Groq Whisper Turbo
          </button>
          <button
            type="button"
            data-testid="preset-voice-openai"
            onClick={() => {
              openCreateModal("openai_compatible");
              setName("OpenAI Áudio (STT + TTS)");
              setBaseUrl("https://api.openai.com/v1");
            }}
            className="inline-flex min-h-9 items-center rounded-md border border-border-default bg-inset px-3 text-xs font-medium text-fg-primary hover:border-border-strong"
          >
            + OpenAI STT/TTS
          </button>
          <button
            type="button"
            data-testid="preset-voice-kokoro"
            onClick={() => {
              openCreateModal("openai_compatible");
              setName("Kokoro-82M TTS Local (VPS)");
              setBaseUrl("http://kokoro-tts:8880/v1");
            }}
            className="inline-flex min-h-9 items-center rounded-md border border-border-default bg-inset px-3 text-xs font-medium text-fg-primary hover:border-border-strong"
          >
            + Kokoro Local (Grátis)
          </button>
        </div>
      </section>

      {providersQuery.isLoading && (
        <div className="space-y-2.5" aria-label="Carregando provedores">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-lg border border-border-subtle bg-surface"
            />
          ))}
        </div>
      )}

      {!providersQuery.isLoading && providersQuery.error && (
        <div
          role="alert"
          className="flex items-center justify-between rounded-lg border border-status-danger/40 bg-status-danger/10 p-4 text-xs text-status-danger"
        >
          <span className="flex items-center gap-2">
            <AlertCircle className="size-4" strokeWidth={1.75} />
            <span>{(providersQuery.error as Error).message}</span>
          </span>
          <button
            type="button"
            onClick={() => void providersQuery.refetch()}
            className="inline-flex min-h-9 items-center gap-1 rounded border border-border-default bg-surface px-3 text-fg-primary"
          >
            <RefreshCw className="size-3.5" strokeWidth={1.75} />
            <span>Tentar novamente</span>
          </button>
        </div>
      )}

      {!providersQuery.isLoading &&
        !providersQuery.error &&
        profiles.length === 0 && (
          <div
            data-testid="empty-providers-state"
            className="uzina-card flex flex-col items-center justify-center rounded-xl border border-dashed border-border-default bg-surface px-6 py-10 text-center"
          >
            <KeyRound className="mb-3 size-7 text-fg-muted" strokeWidth={1.5} />
            <h2 className="text-base font-semibold text-fg-primary">
              Nenhum provedor de LLM configurado ainda
            </h2>
            <p className="mt-1.5 max-w-lg text-sm text-fg-secondary">
              Enquanto nenhum provedor estiver salvo no Cofre, o Chat opera em{" "}
              <strong className="text-fg-primary">Modo Assistido Local</strong>.
              Escolha um dos 6 cartões acima ou abra o assistente de configuração.
            </p>
            <button
              type="button"
              onClick={() => openCreateModal("google")}
              className="mt-4 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border-default bg-elevated px-4 text-sm font-medium text-fg-primary transition-colors hover:border-border-strong"
            >
              <Plus className="size-4" strokeWidth={1.75} />
              <span>Configurar Primeiro Provedor</span>
            </button>
          </div>
        )}

      {!providersQuery.isLoading &&
        !providersQuery.error &&
        profiles.length > 0 && (
          <div className="space-y-3" data-testid="providers-list">
            {profiles.map((profile) => {
              const cardPing = cardPingResults[profile.id];
              return (
                <article
                  key={profile.id}
                  data-testid={`provider-card-${profile.id}`}
                  className="uzina-card rounded-xl border border-border-subtle bg-surface p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-semibold text-fg-primary">
                          {profile.name}
                        </h2>
                        <span className="rounded border border-border-subtle bg-inset px-2 py-0.5 font-mono text-xs text-fg-secondary">
                          {PROVIDER_LABELS[profile.providerType]}
                        </span>
                        {profile.isDefault && (
                          <span className="inline-flex items-center gap-1.5 rounded border border-status-ok/35 bg-status-ok/10 px-2 py-0.5 text-xs font-medium text-status-ok">
                            <CheckCircle2
                              className="size-3.5"
                              strokeWidth={1.75}
                            />
                            <span>
                              {profile.providerType === "github_pat"
                                ? "GitHub PAT Padrão"
                                : "Padrão Ativo no Chat"}
                            </span>
                          </span>
                        )}
                      </div>
                      {profile.baseUrl && (
                        <p className="break-all font-mono text-xs text-fg-muted">
                          {profile.baseUrl}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        data-testid="provider-key-preview"
                        className="inline-flex min-h-9 items-center gap-1.5 rounded border border-border-subtle bg-inset px-2.5 py-1 font-mono text-xs text-fg-primary"
                      >
                        <ShieldCheck
                          className="size-3.5 text-status-ok"
                          strokeWidth={1.75}
                        />
                        <span>
                          {profile.hasApiKey
                            ? profile.keyPreview ?? "Cifrada"
                            : "Sem chave (local)"}
                        </span>
                      </span>

                      <button
                        type="button"
                        data-testid={`btn-test-provider-${profile.id}`}
                        disabled={pingMutation.isPending}
                        onClick={() =>
                          pingMutation.mutate({ providerId: profile.id })
                        }
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-accent/40 bg-accent-subtle px-3 text-xs font-semibold text-accent hover:border-accent disabled:opacity-50"
                      >
                        <Activity className="size-3.5" strokeWidth={1.75} />
                        <span>Testar Conexão Real</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => openEditModal(profile)}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border-default bg-canvas px-3 text-xs text-fg-secondary hover:border-border-strong hover:text-fg-primary"
                      >
                        <Pencil className="size-3.5" strokeWidth={1.75} />
                        <span>Editar</span>
                      </button>
                    </div>
                  </div>

                  {cardPing && (
                    <div
                      data-testid={`provider-ping-banner-${profile.id}`}
                      className={`mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs ${
                        cardPing.ok
                          ? "border-status-ok/40 bg-status-ok/10 text-status-ok"
                          : "border-status-danger/40 bg-status-danger/10 text-status-danger"
                      }`}
                    >
                      <span className="font-medium">
                        {cardPing.ok
                          ? `🟢 Conexão Real Validada (${cardPing.modelId} · ${cardPing.latencyMs}ms): ${cardPing.replyPreview}`
                          : `🔴 Falha no teste (${cardPing.modelId} · ${cardPing.latencyMs}ms): ${cardPing.error}`}
                      </span>
                    </div>
                  )}

                  {profile.providerType === "github_pat" ? (
                    <div className="mt-3 rounded-md border border-border-subtle bg-inset px-3 py-2 text-xs text-fg-secondary">
                      Escopo: Automação de <code className="font-mono text-fg-primary">git push</code> HTTPS e abertura de Draft PR via GitHub REST API (não participa da escala de LLMs).
                    </div>
                  ) : (
                    <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border-subtle pt-3 sm:grid-cols-4 lg:grid-cols-7">
                      {AGENT_ROLES.map((r) => {
                        const bound = profile.roleBindings[r.key];
                        return (
                          <div
                            key={r.key}
                            className="rounded-md border border-border-subtle bg-inset px-2.5 py-2"
                          >
                            <p className="truncate text-xs text-fg-muted">
                              {r.label}
                            </p>
                            <p className="truncate font-mono text-xs text-fg-primary">
                              {bound?.modelId ?? "—"}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}

      {/* Modal Criar / Editar Provedor */}
      <Dialog.Root open={modalOpen} onOpenChange={setModalOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[min(94vw,560px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border-default bg-surface p-5 shadow-2xl"
          >
            <div className="mb-3 flex items-center justify-between">
              <Dialog.Title className="text-sm font-semibold text-fg-primary">
                {editing ? `Editar ${editing.name}` : "Novo Perfil de Provedor LLM"}
              </Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="Fechar modal de provedor"
                  className="inline-flex size-8 items-center justify-center rounded text-fg-muted hover:text-fg-primary"
                >
                  <X className="size-4" strokeWidth={1.75} />
                </button>
              </Dialog.Close>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div className="space-y-1">
                  <label
                    htmlFor="provider-type"
                    className="block text-xs font-medium text-fg-secondary"
                  >
                    Tipo de Provedor
                  </label>
                  <select
                    id="provider-type"
                    disabled={Boolean(editing)}
                    value={providerType}
                    onChange={(e) =>
                      handleProviderTypeChange(e.target.value as ProviderType)
                    }
                    className="min-h-9 w-full rounded-md border border-border-default bg-inset px-3 text-xs text-fg-primary disabled:opacity-60"
                  >
                    {(Object.keys(PROVIDER_LABELS) as ProviderType[]).map(
                      (key) => (
                        <option key={key} value={key}>
                          {PROVIDER_LABELS[key]}
                        </option>
                      )
                    )}
                  </select>
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="provider-name"
                    className="block text-xs font-medium text-fg-secondary"
                  >
                    Nome do Perfil
                  </label>
                  <input
                    id="provider-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={currentPreset.defaultName}
                    className="min-h-9 w-full rounded-md border border-border-default bg-inset px-3 text-xs text-fg-primary"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div className="space-y-1">
                  <label
                    htmlFor="provider-url"
                    className="block text-xs font-medium text-fg-secondary"
                  >
                    Base URL (preenchida automaticamente)
                  </label>
                  <input
                    id="provider-url"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder={currentPreset.baseUrl}
                    className="min-h-9 w-full rounded-md border border-border-default bg-inset px-3 font-mono text-xs text-fg-primary"
                  />
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="provider-key"
                    className="block text-xs font-medium text-fg-secondary"
                  >
                    {editing
                      ? "Nova API Key (vazio mantém atual)"
                      : "API Key (cifrada em AES-256-GCM)"}
                  </label>
                  <input
                    id="provider-key"
                    type="password"
                    autoComplete="off"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={
                      editing ? "••••••••••••" : currentPreset.keyPlaceholder
                    }
                    className="min-h-9 w-full rounded-md border border-border-default bg-inset px-3 font-mono text-xs text-fg-primary"
                  />
                </div>
              </div>

              {/* Presets de 1 Clique para Model Tiering nos 7 Papéis */}
              {providerType !== "github_pat" && (
                <div className="space-y-2 border-t border-border-subtle pt-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-fg-primary">
                      Modelos por Papel de Agente (7 especialistas):
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        data-testid="btn-preset-recommended-tiering"
                        onClick={() =>
                          setRoleModels(
                            buildBindingsForPreset(
                              providerType,
                              "recommended_tiering"
                            )
                          )
                        }
                        className="rounded border border-border-default bg-elevated px-2.5 py-1 text-xs font-medium text-fg-primary hover:border-border-strong"
                      >
                        Preset Tiering (Pro + Flash)
                      </button>
                      <button
                        type="button"
                        data-testid="btn-preset-fast-economy"
                        onClick={() =>
                          setRoleModels(
                            buildBindingsForPreset(providerType, "fast_economy")
                          )
                        }
                        className="rounded border border-border-subtle bg-inset px-2.5 py-1 text-xs font-medium text-fg-secondary hover:text-fg-primary"
                      >
                        Preset 100% Rápido / Free Tier
                      </button>
                    </div>
                  </div>

                  <datalist id="provider-models-suggestions">
                    {currentPreset.suggestions.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {AGENT_ROLES.map((r) => (
                      <div key={r.key} className="space-y-1">
                        <label
                          htmlFor={`bind-${r.key}`}
                          className="flex items-center justify-between text-xs font-medium text-fg-secondary"
                        >
                          <span>{r.label}</span>
                          <span className="font-mono text-xs text-fg-muted">
                            {r.defaultTier === "tier3" ? "Tier 3" : "Tier 2"}
                          </span>
                        </label>
                        <input
                          id={`bind-${r.key}`}
                          list="provider-models-suggestions"
                          value={roleModels[r.key] ?? ""}
                          onChange={(e) =>
                            setRoleModels((prev) => ({
                              ...prev,
                              [r.key]: e.target.value,
                            }))
                          }
                          className="min-h-8 w-full rounded border border-border-default bg-inset px-2.5 font-mono text-xs text-fg-primary"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <label className="flex items-center gap-2 pt-1 text-xs text-fg-primary">
                <input
                  type="checkbox"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                  className="size-4 accent-accent"
                />
                <span>
                  {providerType === "github_pat"
                    ? "Definir como GitHub PAT padrão da organização"
                    : "Definir como provedor padrão da Central Conversacional"}
                </span>
              </label>

              {providerType !== "github_pat" && (
                <div className="rounded-md border border-border-subtle bg-inset/50 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setCustomPricingOpen((prev) => !prev)}
                    className="flex w-full items-center justify-between text-xs font-medium text-fg-secondary hover:text-fg-primary"
                  >
                    <span>Tarifa customizada FinOps (opcional — USD por 1M tokens)</span>
                    <span>{customPricingOpen ? "−" : "+"}</span>
                  </button>
                  {customPricingOpen && (
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label
                          htmlFor="provider-custom-input-usd"
                          className="block text-xs text-fg-secondary"
                        >
                          Input (USD / 1M tok)
                        </label>
                        <input
                          id="provider-custom-input-usd"
                          data-testid="provider-custom-input-usd"
                          type="number"
                          min={0}
                          step="0.01"
                          value={customInputUsd}
                          onChange={(e) => setCustomInputUsd(e.target.value)}
                          placeholder="Ex.: 0.40"
                          className="min-h-8 w-full rounded border border-border-default bg-surface px-2.5 font-mono text-xs text-fg-primary tabular-nums"
                        />
                      </div>
                      <div className="space-y-1">
                        <label
                          htmlFor="provider-custom-output-usd"
                          className="block text-xs text-fg-secondary"
                        >
                          Output (USD / 1M tok)
                        </label>
                        <input
                          id="provider-custom-output-usd"
                          data-testid="provider-custom-output-usd"
                          type="number"
                          min={0}
                          step="0.01"
                          value={customOutputUsd}
                          onChange={(e) => setCustomOutputUsd(e.target.value)}
                          placeholder="Ex.: 1.20"
                          className="min-h-8 w-full rounded border border-border-default bg-surface px-2.5 font-mono text-xs text-fg-primary tabular-nums"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {pingResult && (
                <div
                  data-testid="modal-ping-result"
                  className={`rounded-md border px-3 py-2 text-xs ${
                    pingResult.ok
                      ? "border-status-ok/40 bg-status-ok/10 text-status-ok"
                      : "border-status-danger/40 bg-status-danger/10 text-status-danger"
                  }`}
                >
                  {pingResult.ok
                    ? `🟢 Conexão Real Validada (${pingResult.modelId} · ${pingResult.latencyMs}ms): ${pingResult.replyPreview}`
                    : `🔴 Falha na conexão (${pingResult.modelId} · ${pingResult.latencyMs}ms): ${pingResult.error}`}
                </div>
              )}

              {formError && (
                <p role="alert" className="text-xs text-status-danger">
                  {formError}
                </p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle pt-3">
                {providerType !== "github_pat" ? (
                  <button
                    type="button"
                    data-testid="btn-test-provider-modal"
                    disabled={pingMutation.isPending}
                    onClick={handleTestModalConnection}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-accent/50 bg-accent-subtle px-3 text-xs font-semibold text-accent hover:border-accent disabled:opacity-50"
                  >
                    {pingMutation.isPending ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Activity className="size-3.5" />
                    )}
                    <span>Testar Conexão Real (Ping LLM)</span>
                  </button>
                ) : (
                  <span className="text-xs text-fg-muted">
                    PAT usado no push HTTPS e Draft PR via{" "}
                    <code className="font-mono">api.github.com</code>
                  </span>
                )}

                <div className="flex items-center gap-2">
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      className="min-h-9 rounded-md border border-border-default px-3 text-xs text-fg-secondary"
                    >
                      Cancelar
                    </button>
                  </Dialog.Close>
                  <button
                    type="submit"
                    disabled={saveMutation.isPending}
                    data-testid="submit-provider"
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-accent px-3.5 text-xs font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-60"
                  >
                    {saveMutation.isPending && (
                      <Loader2 className="size-3.5 animate-spin" />
                    )}
                    <span>Salvar no Cofre</span>
                  </button>
                </div>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
