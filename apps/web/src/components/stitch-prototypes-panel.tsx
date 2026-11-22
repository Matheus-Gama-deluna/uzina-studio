"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DesignPrototypeListResponseSchema,
  DesignPrototypeSchema,
  StitchMcpSyncResponseSchema,
  type DesignPrototype,
  type PrototypeLevel,
} from "@uzina/contracts";
import { CheckCircle2, Layers, RefreshCw, Sparkles, Upload } from "lucide-react";
import { useState, type FormEvent } from "react";

interface StitchPrototypesPanelProps {
  projectId: string;
}

export function StitchPrototypesPanel({ projectId }: StitchPrototypesPanelProps) {
  const queryClient = useQueryClient();
  const [level, setLevel] = useState<PrototypeLevel>(3);
  const [title, setTitle] = useState("");
  const [htmlInput, setHtmlInput] = useState("");
  const [specSummary, setSpecSummary] = useState("");
  const [panelMsg, setPanelMsg] = useState<string | null>(null);
  const [panelErr, setPanelErr] = useState<string | null>(null);

  const prototypesQuery = useQuery({
    queryKey: ["project-prototypes", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/prototypes`);
      if (!res.ok) {
        throw new Error("Falha ao carregar protótipos do Estúdio.");
      }
      return DesignPrototypeListResponseSchema.parse(await res.json());
    },
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/prototypes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          level,
          source: level === 3 ? "stitch_import" : "native",
          ...(specSummary.trim() ? { specSummary: specSummary.trim() } : {}),
          ...(htmlInput.trim() ? { html: htmlInput } : {}),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Falha ao importar protótipo.");
      }
      return DesignPrototypeSchema.parse(await res.json());
    },
    onSuccess: async (created) => {
      setPanelErr(null);
      setPanelMsg(`Protótipo "${created.title}" (Nível ${created.level}) salvo e sanitizado.`);
      setTitle("");
      setHtmlInput("");
      setSpecSummary("");
      await queryClient.invalidateQueries({
        queryKey: ["project-prototypes", projectId],
      });
    },
    onError: (err: Error) => {
      setPanelMsg(null);
      setPanelErr(err.message);
    },
  });

  const stitchSyncMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/prototypes/stitch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "list_screens" }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Falha ao consultar Google Stitch MCP.");
      }
      return StitchMcpSyncResponseSchema.parse(await res.json());
    },
    onSuccess: (res) => {
      setPanelErr(null);
      setPanelMsg(`Stitch MCP (${res.status}): ${res.detail}`);
    },
    onError: (err: Error) => {
      setPanelMsg(null);
      setPanelErr(err.message);
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (proto: DesignPrototype) => {
      const res = await fetch(
        `/api/projects/${projectId}/prototypes/${proto.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            approved: !proto.approved,
            syncDesignMd: !proto.approved,
          }),
        }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Falha ao atualizar aprovação do protótipo.");
      }
      return DesignPrototypeSchema.parse(await res.json());
    },
    onSuccess: async (updated) => {
      setPanelErr(null);
      setPanelMsg(
        updated.approved
          ? `Protótipo "${updated.title}" aprovado (${updated.handoffPath ?? "handoff concluído"}).`
          : `Aprovação de "${updated.title}" removida.`
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["project-prototypes", projectId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["design-assets", projectId],
        }),
      ]);
    },
    onError: (err: Error) => {
      setPanelMsg(null);
      setPanelErr(err.message);
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setPanelErr(null);
    importMutation.mutate();
  }

  const prototypes = prototypesQuery.data?.items ?? [];

  return (
    <section
      className="min-w-0 max-w-full space-y-4 overflow-hidden rounded-lg border border-border-subtle bg-surface p-4"
      data-testid="stitch-prototypes-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle pb-3">
        <div className="flex items-center gap-2">
          <Layers className="size-4 text-accent" strokeWidth={1.75} />
          <div>
            <h2 className="text-sm font-semibold text-fg-primary">
              Estúdio Visual 3 Níveis &amp; Google Stitch
            </h2>
            <p className="text-xs text-fg-muted">
              Nível 1 (Wireframe) · Nível 2 (Tokens W3C) · Nível 3 (Protótipo Stitch Sandboxed)
            </p>
          </div>
        </div>

        <button
          type="button"
          data-testid="stitch-mcp-sync-btn"
          disabled={stitchSyncMutation.isPending}
          onClick={() => stitchSyncMutation.mutate()}
          className="inline-flex items-center gap-1.5 rounded border border-border-default bg-inset px-2.5 py-1 text-xs font-medium text-fg-secondary transition-colors hover:border-accent hover:text-fg-primary disabled:opacity-50"
        >
          <RefreshCw
            className={`size-3.5 ${stitchSyncMutation.isPending ? "animate-spin" : ""}`}
            strokeWidth={1.75}
          />
          <span>Sincronizar Stitch MCP</span>
        </button>
      </div>

      {panelMsg && (
        <div className="rounded border border-status-ok/40 bg-status-ok/10 px-3 py-2 text-xs text-status-ok">
          {panelMsg}
        </div>
      )}
      {panelErr && (
        <div className="rounded border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-xs text-status-danger">
          {panelErr}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {([1, 2, 3] as const).map((lvl) => (
            <button
              key={lvl}
              type="button"
              onClick={() => setLevel(lvl)}
              className={`rounded border px-2.5 py-1 text-xs font-medium transition-colors ${
                level === lvl
                  ? "border-accent bg-accent/15 text-fg-primary"
                  : "border-border-subtle bg-inset text-fg-secondary hover:border-border-default"
              }`}
            >
              {lvl === 1
                ? "1 · Estrutura Wireframe"
                : lvl === 2
                  ? "2 · Direção Visual W3C"
                  : "3 · Interativo Stitch"}
            </button>
          ))}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="min-w-0 space-y-2">
            <label className="block text-xs font-medium text-fg-secondary">
              Título do Protótipo
            </label>
            <input
              type="text"
              required
              minLength={2}
              data-testid="stitch-title-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Painel Checkout Google Stitch"
              className="w-full rounded border border-border-subtle bg-inset px-3 py-1.5 text-xs text-fg-primary placeholder:text-fg-muted focus:border-accent focus:outline-none"
            />
            {level === 1 && (
              <input
                type="text"
                value={specSummary}
                onChange={(e) => setSpecSummary(e.target.value)}
                placeholder="Fluxo (ex: Login -> Dashboard -> Aprovação)"
                className="w-full rounded border border-border-subtle bg-inset px-3 py-1.5 text-xs text-fg-primary placeholder:text-fg-muted focus:border-accent focus:outline-none"
              />
            )}
          </div>

          <div className="min-w-0 space-y-2">
            <label className="block text-xs font-medium text-fg-secondary">
              HTML / Tailwind Exportado (Sanitizado no Servidor)
            </label>
            <textarea
              rows={3}
              data-testid="stitch-html-input"
              value={htmlInput}
              onChange={(e) => setHtmlInput(e.target.value)}
              placeholder='<main class="p-6 rounded-xl" style="color: oklch(0.75 0.14 210)"><h1>Checkout</h1></main>'
              className="w-full rounded border border-border-subtle bg-inset px-3 py-1.5 font-mono text-[11px] text-fg-primary placeholder:text-fg-muted focus:border-accent focus:outline-none"
            />
          </div>
        </div>

        <button
          type="submit"
          data-testid="stitch-import-submit"
          disabled={importMutation.isPending}
          className="inline-flex items-center gap-1.5 rounded border border-accent/50 bg-accent/15 px-3 py-1.5 text-xs font-medium text-fg-primary transition-colors hover:bg-accent/25 disabled:opacity-50"
        >
          <Upload className="size-3.5" strokeWidth={1.75} />
          <span>
            {importMutation.isPending
              ? "Importando & Sanitizando..."
              : "Importar Protótipo & Extrair Tokens"}
          </span>
        </button>
      </form>

      {prototypes.length === 0 ? (
        <p className="rounded border border-border-subtle bg-inset px-3 py-2 text-xs text-fg-muted">
          Nenhum protótipo importado neste projeto ainda.
        </p>
      ) : (
        <div className="grid min-w-0 gap-3 lg:grid-cols-2">
          {prototypes.map((proto) => (
            <article
              key={proto.id}
              data-testid="prototype-card"
              className="flex min-w-0 flex-col gap-3 overflow-hidden rounded border border-border-subtle bg-inset p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate text-xs font-semibold text-fg-primary">
                    {proto.title}
                  </h3>
                  <p className="font-mono text-[10px] text-fg-muted">
                    Nível {proto.level} · {proto.source}
                  </p>
                </div>

                <button
                  type="button"
                  data-testid="prototype-approve-btn"
                  disabled={approveMutation.isPending}
                  onClick={() => approveMutation.mutate(proto)}
                  className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium transition-colors ${
                    proto.approved
                      ? "border-status-ok/50 bg-status-ok/15 text-status-ok"
                      : "border-border-default bg-surface text-fg-secondary hover:border-accent hover:text-fg-primary"
                  }`}
                >
                  {proto.approved ? (
                    <>
                      <CheckCircle2 className="size-3" strokeWidth={1.75} />
                      <span>Aprovado (Handoff)</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="size-3" strokeWidth={1.75} />
                      <span>Aprovar &amp; Gerar Handoff</span>
                    </>
                  )}
                </button>
              </div>

              <iframe
                sandbox=""
                data-testid="prototype-preview-iframe"
                title={proto.title}
                src={proto.previewUrl}
                className="h-44 w-full max-w-full rounded border border-border-subtle bg-canvas"
              />

              <pre
                data-testid="prototype-tokens-box"
                className="max-h-32 w-full max-w-full overflow-auto rounded border border-border-subtle bg-canvas p-2 font-mono text-[10px] text-fg-secondary"
              >
                {JSON.stringify(proto.tokensJson, null, 2)}
              </pre>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
