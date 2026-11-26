"use client";

import { RefreshCw, WifiOff } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { listOfflineDraftsCount } from "@/lib/mobile-resilience";

export default function OfflinePage() {
  const [draftCount, setDraftCount] = useState(0);

  useEffect(() => {
    void listOfflineDraftsCount()
      .then(setDraftCount)
      .catch(() => setDraftCount(0));
  }, []);

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-canvas px-4 py-8 text-fg-primary">
      <div className="w-full max-w-md rounded-xl border border-border-default bg-surface p-6 text-center shadow-lg">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full border border-border-subtle bg-elevated text-accent">
          <WifiOff className="size-6" strokeWidth={1.75} />
        </div>
        <h1 className="text-lg font-semibold text-fg-primary">
          Sem conexão no momento
        </h1>
        <p className="mt-2 text-sm text-fg-secondary">
          O Uzina Studio precisa de sinal para falar com os agentes e validar
          entregas na VPS. Assim que a rede voltar, suas mensagens pendentes
          serão sincronizadas.
        </p>

        {draftCount > 0 && (
          <div className="mt-4 rounded-lg border border-border-subtle bg-inset px-3 py-2 text-xs text-fg-secondary">
            Você tem{" "}
            <strong className="font-semibold text-fg-primary tabular-nums">
              {draftCount}
            </strong>{" "}
            {draftCount === 1
              ? "rascunho salvo localmente"
              : "rascunhos salvos localmente"}
            .
          </div>
        )}

        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover"
          >
            <RefreshCw className="size-4" strokeWidth={1.75} />
            <span>Tentar reconectar</span>
          </button>
          <Link
            href="/app"
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border-default bg-elevated px-4 py-2.5 text-sm font-medium text-fg-primary transition-colors hover:border-border-strong"
          >
            Voltar ao Cockpit
          </Link>
        </div>
      </div>
    </div>
  );
}
