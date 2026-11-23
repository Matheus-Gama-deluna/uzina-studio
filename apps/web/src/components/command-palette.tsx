"use client";

import * as Dialog from "@radix-ui/react-dialog";
import {
  Bot,
  Brain,
  ClipboardCheck,
  Coins,
  Command,
  KeyRound,
  Layers,
  Lightbulb,
  MessageSquare,
  Moon,
  Palette,
  Search,
  ShieldAlert,
  Sun,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { applyTheme } from "./theme-toggle";

interface CommandItem {
  id: string;
  label: string;
  hint: string;
  action: () => void;
  icon:
    | "ideas"
    | "board"
    | "studio"
    | "deliverables"
    | "decisions"
    | "security"
    | "memories"
    | "finops"
    | "providers"
    | "copilot"
    | "theme";
}

export function CommandPalette({
  open,
  onOpenChange,
  onOpenCopilot,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenCopilot?: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(!open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  const items = useMemo<CommandItem[]>(
    () => [
      {
        id: "nav-ideas",
        label: "Ir para Ideias & Novos Projetos",
        hint: "/app/ideas",
        icon: "ideas",
        action: () => {
          router.push("/app/ideas");
          onOpenChange(false);
        },
      },
      {
        id: "nav-board",
        label: "Ir para Chat da Engenharia",
        hint: "/app",
        icon: "board",
        action: () => {
          router.push("/app");
          onOpenChange(false);
        },
      },
      {
        id: "nav-studio",
        label: "Ir para Estúdio Visual (Preview Multi-Viewport)",
        hint: "/app/studio",
        icon: "studio",
        action: () => {
          router.push("/app/studio");
          onOpenChange(false);
        },
      },
      {
        id: "nav-deliverables",
        label: "Ir para Entregas, Kanban & Documentos",
        hint: "/app/deliverables",
        icon: "deliverables",
        action: () => {
          router.push("/app/deliverables");
          onOpenChange(false);
        },
      },
      {
        id: "nav-decisions",
        label: "Ir para Caixa de Decisões HITL & Evidências",
        hint: "/app/decisions",
        icon: "decisions",
        action: () => {
          router.push("/app/decisions");
          onOpenChange(false);
        },
      },
      {
        id: "nav-security",
        label: "Ir para Auditoria AppSec (Security Engine)",
        hint: "/app/security",
        icon: "security",
        action: () => {
          router.push("/app/security");
          onOpenChange(false);
        },
      },
      {
        id: "nav-memories",
        label: "Ir para Memórias & Busca Híbrida QMD",
        hint: "/app/memories",
        icon: "memories",
        action: () => {
          router.push("/app/memories");
          onOpenChange(false);
        },
      },
      {
        id: "nav-finops",
        label: "Ir para FinOps de Tokens & Motores Dinâmicos (Hot-Reload)",
        hint: "/app/finops",
        icon: "finops",
        action: () => {
          router.push("/app/finops");
          onOpenChange(false);
        },
      },
      {
        id: "nav-providers",
        label: "Ir para Provedores & Cofre LLM AES-256-GCM",
        hint: "/app/providers",
        icon: "providers",
        action: () => {
          router.push("/app/providers");
          onOpenChange(false);
        },
      },
      ...(onOpenCopilot
        ? [
            {
              id: "open-copilot",
              label: "Abrir Co-piloto Executivo (Resumo Read-Only)",
              hint: "Drawer",
              icon: "copilot" as const,
              action: () => {
                onOpenChange(false);
                onOpenCopilot();
              },
            },
          ]
        : []),
      {
        id: "theme-dark",
        label: "Ativar tema Warm Stone Dark",
        hint: "Tema padrão",
        icon: "theme",
        action: () => {
          applyTheme("dark");
          onOpenChange(false);
        },
      },
      {
        id: "theme-light",
        label: "Ativar tema Warm Stone Light",
        hint: "Tema claro",
        icon: "theme",
        action: () => {
          applyTheme("light");
          onOpenChange(false);
        },
      },
    ],
    [router, onOpenChange, onOpenCopilot]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.label.toLowerCase().includes(q) || i.hint.toLowerCase().includes(q)
    );
  }, [items, query]);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery("");
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[1px]" />
        <Dialog.Content
          aria-describedby={undefined}
          data-testid="command-palette"
          className="fixed left-1/2 top-24 z-50 w-[min(92vw,540px)] -translate-x-1/2 rounded-lg border border-border-default bg-elevated shadow-2xl"
        >
          <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2.5">
            <Search className="size-4 text-fg-muted" strokeWidth={1.75} />
            <Dialog.Title className="sr-only">
              Paleta de comandos do Uzina Studio
            </Dialog.Title>
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar navegação ou comando..."
              className="w-full bg-transparent text-sm text-fg-primary placeholder:text-fg-muted focus:outline-none"
            />
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Fechar paleta de comandos"
                className="rounded p-1 text-fg-muted hover:text-fg-primary"
              >
                <X className="size-4" strokeWidth={1.75} />
              </button>
            </Dialog.Close>
          </div>

          <ul className="max-h-72 overflow-y-auto p-1.5" role="menu">
            {filtered.length === 0 ? (
              <li className="px-3 py-6 text-center text-xs text-fg-muted">
                Nenhum comando encontrado.
              </li>
            ) : (
              filtered.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={item.action}
                    className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm text-fg-primary transition-colors hover:bg-accent-subtle"
                  >
                    <span className="flex items-center gap-2.5">
                      {item.icon === "ideas" && (
                        <Lightbulb
                          className="size-4 text-fg-secondary"
                          strokeWidth={1.75}
                        />
                      )}
                      {item.icon === "board" && (
                        <MessageSquare
                          className="size-4 text-fg-secondary"
                          strokeWidth={1.75}
                        />
                      )}
                      {item.icon === "studio" && (
                        <Palette
                          className="size-4 text-fg-secondary"
                          strokeWidth={1.75}
                        />
                      )}
                      {item.icon === "deliverables" && (
                        <Layers
                          className="size-4 text-fg-secondary"
                          strokeWidth={1.75}
                        />
                      )}
                      {item.icon === "decisions" && (
                        <ClipboardCheck
                          className="size-4 text-fg-secondary"
                          strokeWidth={1.75}
                        />
                      )}
                      {item.icon === "security" && (
                        <ShieldAlert
                          className="size-4 text-fg-secondary"
                          strokeWidth={1.75}
                        />
                      )}
                      {item.icon === "memories" && (
                        <Brain
                          className="size-4 text-fg-secondary"
                          strokeWidth={1.75}
                        />
                      )}
                      {item.icon === "finops" && (
                        <Coins
                          className="size-4 text-fg-secondary"
                          strokeWidth={1.75}
                        />
                      )}
                      {item.icon === "providers" && (
                        <KeyRound
                          className="size-4 text-fg-secondary"
                          strokeWidth={1.75}
                        />
                      )}
                      {item.icon === "copilot" && (
                        <Bot
                          className="size-4 text-fg-secondary"
                          strokeWidth={1.75}
                        />
                      )}
                      {item.icon === "theme" &&
                        (item.id === "theme-dark" ? (
                          <Moon
                            className="size-4 text-fg-secondary"
                            strokeWidth={1.75}
                          />
                        ) : (
                          <Sun
                            className="size-4 text-fg-secondary"
                            strokeWidth={1.75}
                          />
                        ))}
                      <span>{item.label}</span>
                    </span>
                    <span className="font-mono text-xs text-fg-muted">
                      {item.hint}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>

          <div className="flex items-center justify-between border-t border-border-subtle px-3 py-2 text-xs text-fg-muted">
            <span className="inline-flex items-center gap-1">
              <Command className="size-3" strokeWidth={1.75} />
              <span>Atalho: Ctrl/Cmd + K</span>
            </span>
            <span>ESC para fechar</span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
