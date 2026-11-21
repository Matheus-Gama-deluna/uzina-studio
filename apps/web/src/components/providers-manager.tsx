"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgentRole,
  ProviderProfileListResponse,
  ProviderProfilePublic,
  ProviderType,
  RoleBindings,
} from "@uzina/contracts";
import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

const PROVIDER_LABELS: Record<ProviderType, string> = {
  omniroute: "OmniRoute Gateway",
  openai_compatible: "OpenAI-Compatible",
  anthropic: "Anthropic Direct",
  google: "Google Gemini",
  ollama: "Ollama Local",
};

const AGENT_ROLES: Array<{ key: AgentRole; label: string }> = [
  { key: "discovery", label: "Descoberta" },
  { key: "architect", label: "Arquiteto" },
  { key: "visual", label: "Visual" },
  { key: "builder", label: "Builder" },
  { key: "verifier", label: "Verifier" },
  { key: "security", label: "AppSec" },
  { key: "copilot", label: "Co-piloto" },
];

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

  const [name, setName] = useState("");
  const [providerType, setProviderType] = useState<ProviderType>("omniroute");
  const [baseUrl, setBaseUrl] = useState("http://localhost:8080/v1");
  const [apiKey, setApiKey] = useState("");
  const [isDefault, setIsDefault] = useState(true);
  const [builderModel, setBuilderModel] = useState("claude-sonnet-4");
  const [architectModel, setArchitectModel] = useState("gemini-2.5-pro");
  const [discoveryModel, setDiscoveryModel] = useState("gemini-2.5-flash");

  const providersQuery = useQuery({
    queryKey: ["providers"],
    queryFn: fetchProviders,
  });

  const profiles = useMemo(
    () => providersQuery.data?.items ?? [],
    [providersQuery.data?.items]
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const roleBindings: RoleBindings = {};
      if (discoveryModel.trim()) {
        roleBindings.discovery = { modelId: discoveryModel.trim() };
      }
      if (architectModel.trim()) {
        roleBindings.architect = { modelId: architectModel.trim() };
      }
      if (builderModel.trim()) {
        roleBindings.builder = { modelId: builderModel.trim() };
      }

      if (editing) {
        const res = await fetch(`/api/providers/${editing.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            baseUrl: baseUrl.trim() || null,
            ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
            roleBindings,
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
      await queryClient.invalidateQueries({ queryKey: ["providers"] });
      setApiKey("");
      setFormError(null);
      setEditing(null);
      setModalOpen(false);
    },
    onError: (err: Error) => setFormError(err.message),
  });

  function openCreateModal() {
    setEditing(null);
    setName("");
    setProviderType("omniroute");
    setBaseUrl("http://localhost:8080/v1");
    setApiKey("");
    setIsDefault(profiles.length === 0);
    setDiscoveryModel("gemini-2.5-flash");
    setArchitectModel("gemini-2.5-pro");
    setBuilderModel("claude-sonnet-4");
    setFormError(null);
    setModalOpen(true);
  }

  function openEditModal(profile: ProviderProfilePublic) {
    setEditing(profile);
    setName(profile.name);
    setProviderType(profile.providerType);
    setBaseUrl(profile.baseUrl ?? "");
    // Nunca pré-preencher segredo existente
    setApiKey("");
    setIsDefault(profile.isDefault);
    setDiscoveryModel(profile.roleBindings.discovery?.modelId ?? "");
    setArchitectModel(profile.roleBindings.architect?.modelId ?? "");
    setBuilderModel(profile.roleBindings.builder?.modelId ?? "");
    setFormError(null);
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

  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-center justify-between gap-4 border-b border-border-subtle pb-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-fg-primary">
            Provedores & Cofre Criptográfico
          </h1>
          <p className="text-sm text-fg-secondary">
            Chaves cifradas com AES-256-GCM (IV 12B, AuthTag 16B) e vinculação fixa
            por papel para higiene de Prompt Cache.
          </p>
        </div>

        <button
          type="button"
          data-testid="btn-new-provider"
          onClick={openCreateModal}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-semibold text-accent-fg transition-colors hover:bg-accent-hover"
        >
          <Plus className="size-3.5" strokeWidth={2} />
          <span>Adicionar Provedor</span>
        </button>
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
            className="inline-flex items-center gap-1 rounded border border-border-default bg-surface px-2.5 py-1 text-fg-primary"
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
            className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border-default bg-surface px-6 py-12 text-center"
          >
            <KeyRound className="mb-3 size-7 text-fg-muted" strokeWidth={1.5} />
            <h2 className="text-sm font-semibold text-fg-primary">
              Nenhum provedor de LLM configurado
            </h2>
            <p className="mt-1 max-w-md text-xs text-fg-secondary">
              Cadastre um gateway OmniRoute, OpenAI-compatible, Anthropic, Google
              ou Ollama local para habilitar as execuções dos agentes.
            </p>
            <button
              type="button"
              onClick={openCreateModal}
              className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3.5 text-xs font-semibold text-accent-fg hover:bg-accent-hover"
            >
              <Plus className="size-3.5" strokeWidth={2} />
              <span>Configurar Primeiro Provedor</span>
            </button>
          </div>
        )}

      {!providersQuery.isLoading &&
        !providersQuery.error &&
        profiles.length > 0 && (
          <div className="space-y-3" data-testid="providers-list">
            {profiles.map((profile) => (
              <article
                key={profile.id}
                data-testid={`provider-card-${profile.id}`}
                className="rounded-lg border border-border-default bg-surface p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-semibold text-fg-primary">
                        {profile.name}
                      </h2>
                      <span className="rounded border border-border-subtle bg-inset px-2 py-0.5 font-mono text-[11px] text-fg-secondary">
                        {PROVIDER_LABELS[profile.providerType]}
                      </span>
                      {profile.isDefault && (
                        <span className="inline-flex items-center gap-1 rounded border border-status-ok/35 bg-status-ok/10 px-2 py-0.5 text-[11px] font-medium text-status-ok">
                          <CheckCircle2 className="size-3" strokeWidth={1.75} />
                          <span>Padrão</span>
                        </span>
                      )}
                    </div>
                    {profile.baseUrl && (
                      <p className="font-mono text-xs text-fg-muted">
                        {profile.baseUrl}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      data-testid="provider-key-preview"
                      className="inline-flex items-center gap-1.5 rounded border border-border-subtle bg-inset px-2.5 py-1 font-mono text-xs text-fg-primary"
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
                      onClick={() => openEditModal(profile)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-default bg-canvas px-2.5 text-xs text-fg-secondary hover:border-border-strong hover:text-fg-primary"
                    >
                      <Pencil className="size-3.5" strokeWidth={1.75} />
                      <span>Editar</span>
                    </button>
                  </div>
                </div>

                {/* Tabela compacta de Role Bindings */}
                <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border-subtle pt-3 sm:grid-cols-4 lg:grid-cols-7">
                  {AGENT_ROLES.map((r) => {
                    const bound = profile.roleBindings[r.key];
                    return (
                      <div
                        key={r.key}
                        className="rounded border border-border-subtle bg-inset px-2 py-1.5"
                      >
                        <p className="text-[10px] uppercase tracking-wider text-fg-muted">
                          {r.label}
                        </p>
                        <p className="truncate font-mono text-[11px] text-fg-primary">
                          {bound?.modelId ?? "—"}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>
        )}

      {/* Modal Criar / Editar Provedor */}
      <Dialog.Root open={modalOpen} onOpenChange={setModalOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(92vw,500px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border-default bg-surface p-5 shadow-2xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <Dialog.Title className="text-sm font-semibold text-fg-primary">
                {editing ? `Editar ${editing.name}` : "Novo Perfil de Provedor"}
              </Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="Fechar modal de provedor"
                  className="rounded p-1 text-fg-muted hover:text-fg-primary"
                >
                  <X className="size-4" strokeWidth={1.75} />
                </button>
              </Dialog.Close>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
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
                  placeholder="Ex.: OmniRoute Principal"
                  className="h-9 w-full rounded-md border border-border-default bg-inset px-3 text-sm text-fg-primary"
                />
              </div>

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
                    setProviderType(e.target.value as ProviderType)
                  }
                  className="h-9 w-full rounded-md border border-border-default bg-inset px-3 text-sm text-fg-primary disabled:opacity-60"
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
                  htmlFor="provider-url"
                  className="block text-xs font-medium text-fg-secondary"
                >
                  Base URL
                </label>
                <input
                  id="provider-url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="http://localhost:8080/v1"
                  className="h-9 w-full rounded-md border border-border-default bg-inset px-3 font-mono text-xs text-fg-primary"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="provider-key"
                  className="block text-xs font-medium text-fg-secondary"
                >
                  {editing
                    ? "Nova API Key (deixe vazio para manter a atual)"
                    : "API Key (cifrada em AES-256-GCM)"}
                </label>
                <input
                  id="provider-key"
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={editing ? "••••••••••••" : "sk-..."}
                  className="h-9 w-full rounded-md border border-border-default bg-inset px-3 font-mono text-xs text-fg-primary"
                />
              </div>

              <div className="grid grid-cols-1 gap-2 border-t border-border-subtle pt-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <label
                    htmlFor="bind-discovery"
                    className="block text-[11px] font-medium text-fg-secondary"
                  >
                    Modelo Descoberta
                  </label>
                  <input
                    id="bind-discovery"
                    value={discoveryModel}
                    onChange={(e) => setDiscoveryModel(e.target.value)}
                    className="h-8 w-full rounded border border-border-default bg-inset px-2 font-mono text-xs text-fg-primary"
                  />
                </div>
                <div className="space-y-1">
                  <label
                    htmlFor="bind-architect"
                    className="block text-[11px] font-medium text-fg-secondary"
                  >
                    Modelo Arquiteto
                  </label>
                  <input
                    id="bind-architect"
                    value={architectModel}
                    onChange={(e) => setArchitectModel(e.target.value)}
                    className="h-8 w-full rounded border border-border-default bg-inset px-2 font-mono text-xs text-fg-primary"
                  />
                </div>
                <div className="space-y-1">
                  <label
                    htmlFor="bind-builder"
                    className="block text-[11px] font-medium text-fg-secondary"
                  >
                    Modelo Builder
                  </label>
                  <input
                    id="bind-builder"
                    value={builderModel}
                    onChange={(e) => setBuilderModel(e.target.value)}
                    className="h-8 w-full rounded border border-border-default bg-inset px-2 font-mono text-xs text-fg-primary"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 pt-1 text-xs text-fg-primary">
                <input
                  type="checkbox"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                  className="size-4 accent-accent"
                />
                <span>Definir como provedor padrão da organização</span>
              </label>

              {formError && (
                <p role="alert" className="text-xs text-status-danger">
                  {formError}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="h-8 rounded-md border border-border-default px-3 text-xs text-fg-secondary"
                  >
                    Cancelar
                  </button>
                </Dialog.Close>
                <button
                  type="submit"
                  disabled={saveMutation.isPending}
                  data-testid="submit-provider"
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-60"
                >
                  {saveMutation.isPending && (
                    <Loader2 className="size-3.5 animate-spin" />
                  )}
                  <span>Salvar no Cofre</span>
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
