"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import type {
  CopilotActionRequest,
  CopilotStreamEvent,
  ProjectListResponse,
} from "@uzina/contracts";
import {
  AlertCircle,
  Bot,
  FilePlus2,
  Loader2,
  Send,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";
import { useState, type FormEvent } from "react";

interface ChatEntry {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolsUsed?: string[];
}

async function fetchProjects(): Promise<ProjectListResponse> {
  const res = await fetch("/api/projects");
  if (!res.ok) throw new Error("Falha ao carregar projetos");
  return (await res.json()) as ProjectListResponse;
}

export function CopilotDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [inputText, setInputText] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatEntry[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Olá! Sou o Co-piloto Executivo da Uzina Studio. Posso resumir o workspace, criar rascunhos em discovery ou disparar scans AppSec (sem acesso a disco, shell/git ou merge direto).",
    },
  ]);

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: fetchProjects,
    enabled: open,
  });

  const projects = projectsQuery.data?.items ?? [];
  const effectiveProjectId =
    selectedProjectId === "__org__"
      ? ""
      : selectedProjectId || projects[0]?.id || "";

  async function runCopilotTurn(
    promptText: string,
    action?: CopilotActionRequest
  ) {
    if (streaming || !promptText.trim()) return;
    setErrorMsg(null);
    setStreaming(true);

    const userMsg: ChatEntry = {
      id: crypto.randomUUID(),
      role: "user",
      content: promptText.trim(),
    };
    const assistantId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: assistantId, role: "assistant", content: "", toolsUsed: [] },
    ]);

    try {
      const res = await fetch("/api/copilot/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: promptText.trim() }],
          ...(effectiveProjectId ? { projectId: effectiveProjectId } : {}),
          ...(action ? { action } : {}),
        }),
      });

      if (!res.ok || !res.body) {
        const errBody = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(errBody.error ?? "Falha ao conectar ao Co-piloto SSE.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";

        for (const block of blocks) {
          const dataLine = block
            .split("\n")
            .find((line) => line.startsWith("data: "));
          if (!dataLine) continue;
          const ev = JSON.parse(dataLine.slice(6)) as CopilotStreamEvent;
          if (ev.type === "token") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: `${m.content}${ev.text}` }
                  : m
              )
            );
          } else if (ev.type === "done") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, toolsUsed: ev.toolsUsed } : m
              )
            );
          } else if (ev.type === "error") {
            setErrorMsg(ev.message);
          }
        }
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Erro ao processar resposta."
      );
    } finally {
      setStreaming(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const text = inputText.trim();
    if (!text) return;
    setInputText("");
    void runCopilotTurn(text);
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs" />
        <Dialog.Content
          aria-label="Co-piloto Executivo"
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border-default bg-surface shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
            <div className="flex items-center gap-2">
              <Bot className="size-4 text-accent" strokeWidth={1.75} />
              <div>
                <Dialog.Title className="text-sm font-semibold text-fg-primary">
                  Co-piloto Executivo
                </Dialog.Title>
                <p className="text-[11px] text-fg-muted">
                  Read-only + rascunho discovery (sem disco/shell/merge)
                </p>
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Fechar Co-piloto"
                className="rounded border border-border-subtle p-1 text-fg-secondary hover:text-fg-primary"
              >
                <X className="size-4" strokeWidth={1.75} />
              </button>
            </Dialog.Close>
          </div>

          <div className="border-b border-border-subtle bg-inset px-4 py-2.5">
            <label
              htmlFor="copilot-project-scope"
              className="block text-[11px] font-medium uppercase tracking-wider text-fg-muted"
            >
              Escopo de Projeto
            </label>
            <select
              id="copilot-project-scope"
              value={effectiveProjectId || "__org__"}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="mt-1 min-h-9 w-full rounded border border-border-default bg-surface px-2.5 py-1 text-xs text-fg-primary focus:border-accent focus:outline-none"
            >
              <option value="__org__">Organização inteira</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={streaming}
                onClick={() =>
                  void runCopilotTurn("Gerar resumo executivo do workspace", {
                    type: "overview",
                    ...(effectiveProjectId
                      ? { projectId: effectiveProjectId }
                      : {}),
                  })
                }
                className="inline-flex min-h-8 items-center gap-1 rounded border border-border-default bg-surface px-2.5 py-1 text-xs font-medium text-fg-secondary hover:text-fg-primary disabled:opacity-50"
              >
                <Sparkles className="size-3 text-accent" />
                <span>Resumo Executivo</span>
              </button>

              <button
                type="button"
                disabled={streaming || !effectiveProjectId}
                onClick={() =>
                  void runCopilotTurn("Disparar auditoria AppSec no projeto", {
                    type: "trigger_security_scan",
                    projectId: effectiveProjectId,
                  })
                }
                className="inline-flex min-h-8 items-center gap-1 rounded border border-border-default bg-surface px-2.5 py-1 text-xs font-medium text-fg-secondary hover:text-fg-primary disabled:opacity-50"
              >
                <ShieldAlert className="size-3 text-status-warn" />
                <span>Scan AppSec</span>
              </button>
            </div>

            {effectiveProjectId && (
              <div className="mt-2 flex gap-1.5">
                <input
                  type="text"
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  placeholder="Título de rascunho discovery..."
                  className="min-h-8 flex-1 rounded border border-border-default bg-surface px-2.5 py-1 text-xs text-fg-primary placeholder:text-fg-muted focus:border-accent focus:outline-none"
                />
                <button
                  type="button"
                  disabled={streaming || draftTitle.trim().length < 3}
                  onClick={() => {
                    const title = draftTitle.trim();
                    setDraftTitle("");
                    void runCopilotTurn(`Criar rascunho "${title}"`, {
                      type: "draft_deliverable",
                      projectId: effectiveProjectId,
                      title,
                    });
                  }}
                  className="inline-flex min-h-8 items-center gap-1 rounded border border-accent/40 bg-accent-subtle px-2.5 py-1 text-xs font-medium text-accent disabled:opacity-50"
                >
                  <FilePlus2 className="size-3" />
                  <span>Rascunho</span>
                </button>
              </div>
            )}
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`rounded-lg border p-3 text-xs leading-relaxed ${
                  msg.role === "user"
                    ? "ml-6 border-accent/40 bg-accent-subtle/40 text-fg-primary"
                    : "mr-4 border-border-subtle bg-inset text-fg-secondary"
                }`}
              >
                <p className="whitespace-pre-wrap">
                  {msg.content || (streaming ? "Processando..." : "")}
                </p>
                {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                  <p className="mt-2 font-mono text-[10px] text-fg-muted">
                    Tools: {msg.toolsUsed.join(", ")}
                  </p>
                )}
              </div>
            ))}

            {errorMsg && (
              <div
                role="alert"
                className="flex items-center gap-2 rounded border border-status-error/40 bg-status-error/10 px-3 py-2 text-xs text-status-error"
              >
                <AlertCircle className="size-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}
          </div>

          <form
            onSubmit={handleSubmit}
            className="flex items-center gap-2 border-t border-border-subtle p-3"
          >
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Pergunte ao Co-piloto Executivo..."
              aria-label="Mensagem ao Co-piloto"
              className="flex-1 rounded-md border border-border-default bg-inset px-3 py-2 text-xs text-fg-primary placeholder:text-fg-muted focus:border-accent focus:outline-none"
            />
            <button
              type="submit"
              disabled={streaming || !inputText.trim()}
              aria-label="Enviar mensagem"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-accent text-base transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {streaming ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Send className="size-3.5" />
              )}
            </button>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
