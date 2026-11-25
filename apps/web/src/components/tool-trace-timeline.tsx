"use client";

import {
  ToolCallTracePayloadSchema,
  type ExecutionEvent,
} from "@uzina/contracts";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Radio,
  Terminal,
  Wrench,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

type ConnectionState = "idle" | "connecting" | "live" | "reconnecting";

const CONNECTION_LABELS: Record<
  ConnectionState,
  { label: string; badgeClass: string }
> = {
  live: {
    label: "Ao vivo",
    badgeClass:
      "border-status-ok/40 bg-status-ok/10 text-status-ok",
  },
  connecting: {
    label: "Conectando...",
    badgeClass:
      "border-status-info/40 bg-status-info/10 text-status-info",
  },
  reconnecting: {
    label: "Reconectando...",
    badgeClass:
      "border-status-warn/40 bg-status-warn/10 text-status-warn",
  },
  idle: {
    label: "Inativo",
    badgeClass:
      "border-border-subtle bg-surface text-fg-muted",
  },
};

function formatOtherEventSummary(ev: ExecutionEvent): string | null {
  const payload = ev.payloadJson;
  if (!payload || typeof payload !== "object") return null;
  if (typeof payload.summary === "string" && payload.summary.trim()) {
    return payload.summary;
  }
  if (typeof payload.message === "string" && payload.message.trim()) {
    return payload.message;
  }
  if (typeof payload.verifyPassed === "boolean") {
    return payload.verifyPassed
      ? "Verify Gate aprovado"
      : "Verify Gate reprovado";
  }
  if (typeof payload.eventKind === "string") {
    return payload.eventKind;
  }
  if (typeof payload.status === "string") {
    return `status=${payload.status}`;
  }
  return null;
}

export interface ToolTraceTimelineProps {
  deliverableId: string | null;
  maxItems?: number;
  compact?: boolean;
}

export function ToolTraceTimeline({
  deliverableId,
  maxItems = 50,
  compact = false,
}: ToolTraceTimelineProps) {
  const [eventsState, setEventsState] = useState<{
    deliverableId: string | null;
    items: ExecutionEvent[];
  }>({ deliverableId: null, items: [] });
  const [connState, setConnState] = useState<{
    deliverableId: string | null;
    status: ConnectionState;
  }>({ deliverableId: null, status: "idle" });
  const lastEventIdRef = useRef<string | null>(null);
  const previousDeliverableRef = useRef<string | null>(null);

  useEffect(() => {
    if (previousDeliverableRef.current !== deliverableId) {
      previousDeliverableRef.current = deliverableId;
      lastEventIdRef.current = null;
    }

    if (!deliverableId) {
      return;
    }

    let cancelled = false;
    let currentSource: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const eventTypes = [
      "stage_change",
      "tool_call",
      "stuck_alert",
      "verify_result",
      "token_usage",
      "error",
    ];

    const connect = () => {
      if (cancelled) return;

      const cursor = lastEventIdRef.current;
      const url = cursor
        ? `/api/deliverables/${encodeURIComponent(deliverableId)}/events?afterEventId=${encodeURIComponent(cursor)}`
        : `/api/deliverables/${encodeURIComponent(deliverableId)}/events`;

      const source = new EventSource(url);
      currentSource = source;

      source.onopen = () => {
        if (cancelled) return;
        attempt = 0;
        setConnState({ deliverableId, status: "live" });
      };

      const handleEvent = (rawEvent: MessageEvent<string>) => {
        if (cancelled) return;
        setConnState({ deliverableId, status: "live" });
        try {
          const parsed = JSON.parse(rawEvent.data) as ExecutionEvent;
          if (!parsed?.id) return;
          lastEventIdRef.current = parsed.id;
          setEventsState((prev) => {
            const base =
              prev.deliverableId === deliverableId ? prev.items : [];
            if (base.some((e) => e.id === parsed.id)) {
              return prev;
            }
            const nextItems = [...base, parsed].slice(-Math.max(1, maxItems));
            return {
              deliverableId,
              items: nextItems,
            };
          });
        } catch {
          // Ignora frames não-JSON como snapshot_end ou heartbeat
        }
      };

      for (const evType of eventTypes) {
        source.addEventListener(evType, handleEvent as EventListener);
      }

      source.onerror = () => {
        if (cancelled) return;
        source.close();
        if (currentSource === source) {
          currentSource = null;
        }
        if (attempt >= 5) {
          setConnState({ deliverableId, status: "idle" });
          return;
        }
        const delayMs = 1000 * 2 ** attempt;
        attempt += 1;
        setConnState({ deliverableId, status: "reconnecting" });
        reconnectTimer = setTimeout(() => {
          setConnState({ deliverableId, status: "reconnecting" });
          connect();
        }, delayMs);
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      if (currentSource) {
        currentSource.close();
      }
    };
  }, [deliverableId, maxItems]);

  const items =
    deliverableId && eventsState.deliverableId === deliverableId
      ? eventsState.items
      : [];
  const connectionState: ConnectionState = !deliverableId
    ? "idle"
    : connState.deliverableId === deliverableId
      ? connState.status
      : "connecting";
  const statusMeta = CONNECTION_LABELS[connectionState];

  return (
    <div
      data-testid="tool-trace-timeline"
      className={`min-w-0 rounded-md border border-border-subtle bg-inset ${compact ? "p-2.5" : "p-3.5"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-fg-secondary">
          <Radio className="size-3.5 shrink-0 text-accent" />
          <span>Timeline de Execução &amp; Tool Trace (SSE)</span>
        </h3>
        <span
          data-testid="tool-trace-status"
          className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium ${statusMeta.badgeClass}`}
        >
          {connectionState === "reconnecting" && (
            <Loader2 className="size-3 animate-spin" />
          )}
          <span>{statusMeta.label}</span>
        </span>
      </div>

      {items.length === 0 ? (
        <p className="mt-2 text-xs text-fg-muted">
          Nenhum evento registrado ou stream aguardando novos eventos.
        </p>
      ) : (
        <ul
          className={`mt-2 space-y-1.5 overflow-auto font-mono text-xs ${compact ? "max-h-40" : "max-h-56"}`}
        >
          {items.map((ev) => {
            const toolTrace =
              ev.eventType === "tool_call"
                ? ToolCallTracePayloadSchema.safeParse(ev.payloadJson)
                : null;

            if (toolTrace?.success) {
              const payload = toolTrace.data;
              const isError = payload.status === "error";
              const isOk = payload.status === "ok";
              return (
                <li
                  key={ev.id}
                  data-testid="tool-trace-item"
                  className="min-w-0 rounded border border-border-subtle bg-surface px-2.5 py-1.5 text-fg-secondary"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5 font-medium text-fg-primary">
                      {isError ? (
                        <AlertCircle className="size-3.5 shrink-0 text-status-error" />
                      ) : isOk ? (
                        <CheckCircle2 className="size-3.5 shrink-0 text-status-ok" />
                      ) : (
                        <Wrench className="size-3.5 shrink-0 text-status-info" />
                      )}
                      <span className="break-all">{payload.toolName}</span>
                      <span
                        className={`rounded border px-1.5 py-0.5 text-[10px] uppercase ${
                          isError
                            ? "border-status-error/40 bg-status-error/10 text-status-error"
                            : isOk
                              ? "border-status-ok/40 bg-status-ok/10 text-status-ok"
                              : "border-status-info/40 bg-status-info/10 text-status-info"
                        }`}
                      >
                        {payload.phase}:{payload.status}
                      </span>
                    </span>
                    <span className="shrink-0 text-fg-muted tabular-nums">
                      {typeof payload.durationMs === "number"
                        ? `${payload.durationMs}ms · `
                        : ""}
                      {new Date(ev.createdAt).toLocaleTimeString("pt-BR")}
                    </span>
                  </div>
                  {(payload.targetPath || payload.summary) && (
                    <div className="mt-1 space-y-0.5 text-[11px] text-fg-muted">
                      {payload.targetPath && (
                        <p className="break-all text-fg-secondary">
                          alvo: {payload.targetPath}
                        </p>
                      )}
                      {payload.summary && (
                        <p className="break-words">{payload.summary}</p>
                      )}
                    </div>
                  )}
                </li>
              );
            }

            const otherSummary = formatOtherEventSummary(ev);
            return (
              <li
                key={ev.id}
                data-testid="tool-trace-item"
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-border-subtle/70 bg-surface/60 px-2.5 py-1.5 text-fg-secondary tabular-nums"
              >
                <span className="flex min-w-0 items-center gap-1.5 break-words">
                  <Terminal className="size-3 shrink-0 text-fg-muted" />
                  <span>
                    [{ev.stage}] {ev.eventType} ({ev.actorRole})
                    {otherSummary ? ` — ${otherSummary}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-fg-muted">
                  {new Date(ev.createdAt).toLocaleTimeString("pt-BR")}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
