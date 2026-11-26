"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function syncAppBadge(unreadCount: number): void {
  if (typeof navigator === "undefined") return;
  const nav = navigator as Navigator & {
    setAppBadge?: (count?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  if (unreadCount > 0 && typeof nav.setAppBadge === "function") {
    void nav.setAppBadge(unreadCount).catch(() => undefined);
  } else if (unreadCount <= 0 && typeof nav.clearAppBadge === "function") {
    void nav.clearAppBadge().catch(() => undefined);
  }
}

export function PwaProvider() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const userRequestedUpdateRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (process.env.NEXT_PUBLIC_API_MOCKING === "enabled") return;
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;
    let refreshing = false;

    const handleControllerChange = () => {
      if (!userRequestedUpdateRef.current) {
        return;
      }
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener(
      "controllerchange",
      handleControllerChange
    );

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((registration) => {
        if (cancelled) return;
        if (registration.waiting) {
          setWaitingWorker(registration.waiting);
        }

        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (
              installing.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              setWaitingWorker(installing);
            }
          });
        });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        handleControllerChange
      );
    };
  }, []);

  if (!waitingWorker) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-border-default bg-elevated px-4 py-2 text-xs text-fg-primary shadow-xl md:bottom-4"
    >
      <span>Nova versão do Uzina disponível</span>
      <button
        type="button"
        onClick={() => {
          userRequestedUpdateRef.current = true;
          waitingWorker.postMessage({ type: "SKIP_WAITING" });
        }}
        className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-accent px-3 py-1 font-medium text-accent-fg hover:bg-accent-hover"
      >
        <RefreshCw className="size-3.5" strokeWidth={1.75} />
        <span>Atualizar</span>
      </button>
    </div>
  );
}
