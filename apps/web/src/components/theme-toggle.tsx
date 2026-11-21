"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

export type UzinaTheme = "dark" | "light";

const THEME_EVENT = "uzina-theme-change";

export function applyTheme(next: UzinaTheme): void {
  if (next === "light") {
    document.documentElement.dataset.theme = "light";
  } else {
    delete document.documentElement.dataset.theme;
  }
  try {
    localStorage.setItem("uzina-theme", next);
  } catch {
    // Armazenamento indisponível em navegação restrita
  }
  window.dispatchEvent(new Event(THEME_EVENT));
}

function subscribeTheme(callback: () => void): () => void {
  window.addEventListener(THEME_EVENT, callback);
  return () => window.removeEventListener(THEME_EVENT, callback);
}

function getThemeSnapshot(): UzinaTheme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function getServerThemeSnapshot(): UzinaTheme {
  return "dark";
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(
    subscribeTheme,
    getThemeSnapshot,
    getServerThemeSnapshot
  );

  function handleToggle() {
    applyTheme(theme === "dark" ? "light" : "dark");
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      data-testid="theme-toggle"
      aria-label={
        theme === "dark" ? "Alternar para tema claro" : "Alternar para tema escuro"
      }
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-default bg-surface px-2.5 text-xs font-medium text-fg-secondary transition-colors hover:border-border-strong hover:text-fg-primary"
    >
      {theme === "dark" ? (
        <>
          <Sun className="size-3.5" strokeWidth={1.75} />
          <span className="hidden sm:inline">Claro</span>
        </>
      ) : (
        <>
          <Moon className="size-3.5" strokeWidth={1.75} />
          <span className="hidden sm:inline">Escuro</span>
        </>
      )}
    </button>
  );
}
