"use client";

import { useEffect, useState, type ReactNode } from "react";

export function MswClient({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { worker } = await import("@/mocks/browser");
      await worker.start({ onUnhandledFrame: "bypass" });
      if (!cancelled) {
        setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-canvas text-sm text-fg-secondary"
        role="status"
        aria-live="polite"
      >
        Inicializando ambiente isolado de rede...
      </div>
    );
  }

  return <>{children}</>;
}
