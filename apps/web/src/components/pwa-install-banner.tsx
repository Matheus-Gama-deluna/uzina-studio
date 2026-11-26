"use client";

import { Download, Share, Smartphone, X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "uzina-pwa-install-dismissed-v1";
const emptySubscribe = () => () => {};

export function PwaInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [dismissedOverride, setDismissedOverride] = useState<boolean | null>(
    null
  );

  const isClientDismissed = useSyncExternalStore(
    emptySubscribe,
    () => window.localStorage.getItem(DISMISS_KEY) === "1",
    () => true
  );
  const isStandalone = useSyncExternalStore(
    emptySubscribe,
    () =>
      window.matchMedia("(display-mode: standalone)").matches ||
      Boolean((window.navigator as { standalone?: boolean }).standalone),
    () => true
  );
  const showIosGuide = useSyncExternalStore(
    emptySubscribe,
    () => {
      const ua = window.navigator.userAgent;
      const isIos = /iPad|iPhone|iPod/.test(ua) && !("MSStream" in window);
      const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
      return isIos && isSafari;
    },
    () => false
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isClientDismissed || isStandalone) return;

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setDismissedOverride(false);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
    };
  }, [isClientDismissed, isStandalone]);

  const dismissed =
    dismissedOverride ?? (isClientDismissed || isStandalone || !showIosGuide);

  if (dismissed && !deferredPrompt) {
    return null;
  }

  function handleDismiss() {
    window.localStorage.setItem(DISMISS_KEY, "1");
    setDismissedOverride(true);
    setDeferredPrompt(null);
  }

  async function handleInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setDismissedOverride(true);
    }
    setDeferredPrompt(null);
  }

  return (
    <div
      data-testid="pwa-install-banner"
      className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-default bg-surface px-3 py-2 text-xs text-fg-secondary"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <Smartphone className="size-4 shrink-0 text-accent" strokeWidth={1.75} />
        {deferredPrompt ? (
          <p className="min-w-0">
            <strong className="font-medium text-fg-primary">
              Instalar Uzina no dispositivo:
            </strong>{" "}
            acesse em tela cheia e receba notificações das entregas.
          </p>
        ) : (
          <p className="min-w-0">
            <strong className="font-medium text-fg-primary">
              Instale no iPhone:
            </strong>{" "}
            toque em{" "}
            <Share
              className="mx-0.5 inline size-3.5 text-accent"
              aria-hidden="true"
            />{" "}
            <strong>Compartilhar</strong> →{" "}
            <strong>Adicionar à Tela de Início</strong> para ativar Push e voz
            em tela cheia.
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {deferredPrompt && (
          <button
            type="button"
            onClick={handleInstall}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-accent-hover"
          >
            <Download className="size-3.5" strokeWidth={1.75} />
            <span>Instalar app</span>
          </button>
        )}
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dispensar aviso de instalação"
          className="inline-flex size-9 items-center justify-center rounded-md text-fg-muted hover:bg-elevated hover:text-fg-primary"
        >
          <X className="size-3.5" strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}
