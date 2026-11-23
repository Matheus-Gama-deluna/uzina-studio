"use client";

import { useSyncExternalStore } from "react";

export type UzinaFontScale = "compact" | "comfortable" | "large";

const FONT_SCALE_EVENT = "uzina-font-scale-change";
const STORAGE_KEY = "uzina-font-scale";

export function applyFontScale(next: UzinaFontScale): void {
  if (next === "comfortable") {
    delete document.documentElement.dataset.fontScale;
  } else {
    document.documentElement.dataset.fontScale = next;
  }
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Armazenamento indisponível em navegação restrita
  }
  window.dispatchEvent(new Event(FONT_SCALE_EVENT));
}

function subscribeFontScale(callback: () => void): () => void {
  window.addEventListener(FONT_SCALE_EVENT, callback);
  return () => window.removeEventListener(FONT_SCALE_EVENT, callback);
}

function getFontScaleSnapshot(): UzinaFontScale {
  const val = document.documentElement.dataset.fontScale;
  if (val === "compact" || val === "large") return val;
  return "comfortable";
}

function getServerFontScaleSnapshot(): UzinaFontScale {
  return "comfortable";
}

const SCALE_OPTIONS: Array<{
  id: UzinaFontScale;
  shortLabel: string;
  title: string;
}> = [
  { id: "compact", shortLabel: "A-", title: "Texto compacto (90%)" },
  { id: "comfortable", shortLabel: "A", title: "Texto confortável (100%)" },
  { id: "large", shortLabel: "A+", title: "Texto ampliado (112.5%)" },
];

export function FontScaleToggle() {
  const scale = useSyncExternalStore(
    subscribeFontScale,
    getFontScaleSnapshot,
    getServerFontScaleSnapshot
  );

  return (
    <div
      role="group"
      aria-label="Tamanho da fonte da interface"
      data-testid="font-scale-toggle"
      className="inline-flex h-8 items-center rounded-md border border-border-default bg-inset p-0.5"
    >
      {SCALE_OPTIONS.map((opt) => {
        const active = scale === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            title={opt.title}
            aria-label={opt.title}
            aria-pressed={active}
            data-testid={`font-scale-${opt.id}`}
            onClick={() => applyFontScale(opt.id)}
            className={`inline-flex h-7 items-center justify-center rounded px-2 text-xs font-medium transition-colors ${
              active
                ? "bg-surface text-fg-primary border border-border-subtle"
                : "text-fg-muted hover:text-fg-primary"
            }`}
          >
            {opt.shortLabel}
          </button>
        );
      })}
    </div>
  );
}
