"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  NotificationItem,
  NotificationListResponse,
} from "@uzina/contracts";
import { Bell, CheckCheck, Settings2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { MobileBottomSheet } from "./mobile-bottom-sheet";
import { syncAppBadge } from "./pwa-provider";

async function fetchNotifications(): Promise<NotificationListResponse> {
  const res = await fetch("/api/notifications?limit=30");
  if (!res.ok) {
    return { items: [], unreadCount: 0 };
  }
  return (await res.json()) as NotificationListResponse;
}

export function NotificationsCenter() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const notificationsQuery = useQuery({
    queryKey: ["notifications"],
    queryFn: fetchNotifications,
    refetchInterval: 30_000,
  });

  const items = notificationsQuery.data?.items ?? [];
  const unreadCount = notificationsQuery.data?.unreadCount ?? 0;

  useEffect(() => {
    syncAppBadge(unreadCount);
  }, [unreadCount]);

  useEffect(() => {
    if (!open || isMobile) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onPointerDown(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onPointerDown);
    };
  }, [isMobile, open]);

  const markReadMutation = useMutation({
    mutationFn: async (payload: { ids?: string[]; all?: boolean }) => {
      const res = await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Falha ao atualizar notificações");
      return (await res.json()) as { unreadCount: number };
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  function handleSelectNotification(item: NotificationItem) {
    if (!item.readAt) {
      markReadMutation.mutate({ ids: [item.id] });
    }
    setOpen(false);
    router.push(item.actionUrl);
  }

  function renderListContent() {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 border-b border-border-subtle pb-2">
          <span className="text-xs font-medium text-fg-secondary tabular-nums">
            {unreadCount > 0
              ? `${unreadCount} não lida(s)`
              : "Tudo em dia"}
          </span>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                type="button"
                data-testid="notifications-mark-all-read"
                onClick={() => markReadMutation.mutate({ all: true })}
                className="inline-flex min-h-8 items-center gap-1 rounded px-2 text-xs text-accent hover:bg-accent-subtle"
              >
                <CheckCheck className="size-3.5" strokeWidth={1.75} />
                <span>Marcar todas</span>
              </button>
            )}
            <Link
              href="/app/settings"
              onClick={() => setOpen(false)}
              className="inline-flex min-h-8 items-center gap-1 rounded border border-border-subtle bg-inset px-2 text-xs text-fg-secondary hover:text-fg-primary"
            >
              <Settings2 className="size-3.5" strokeWidth={1.75} />
              <span>Configurar</span>
            </Link>
          </div>
        </div>

        {items.length === 0 ? (
          <p className="py-6 text-center text-xs text-fg-muted">
            Nenhuma notificação registrada até o momento.
          </p>
        ) : (
          <ul className="max-h-80 space-y-2 overflow-y-auto">
            {items.map((item) => {
              const unread = !item.readAt;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => handleSelectNotification(item)}
                    className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      unread
                        ? "border-accent/40 bg-accent-subtle/30 hover:bg-accent-subtle/50"
                        : "border-border-subtle bg-inset hover:border-border-default"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-semibold text-fg-primary">
                        {item.title}
                      </span>
                      {unread && (
                        <span className="mt-1 size-2 shrink-0 rounded-full bg-accent" />
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-fg-secondary">
                      {item.body}
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-fg-muted tabular-nums">
                      {new Date(item.createdAt).toLocaleString("pt-BR")}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        data-testid="notifications-bell-btn"
        aria-label="Central de Notificações"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="relative inline-flex size-9 items-center justify-center rounded-md border border-border-default bg-surface text-fg-secondary transition-colors hover:border-border-strong hover:text-fg-primary sm:size-8"
      >
        <Bell className="size-4" strokeWidth={1.75} />
        {unreadCount > 0 && (
          <span
            data-testid="notifications-unread-badge"
            className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-accent px-1 font-mono text-[10px] font-bold leading-4 text-accent-fg tabular-nums"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && !isMobile && (
        <div
          role="dialog"
          aria-label="Central de Notificações"
          data-testid="notifications-popover"
          className="absolute right-0 top-full z-50 mt-2 w-88 rounded-xl border border-border-default bg-surface p-3.5 shadow-2xl"
        >
          {renderListContent()}
        </div>
      )}

      {isMobile && (
        <MobileBottomSheet
          open={open}
          onOpenChange={setOpen}
          title="Central de Notificações"
          description="Alertas acionáveis do Uzina Studio"
          testId="notifications-mobile-sheet"
        >
          {renderListContent()}
        </MobileBottomSheet>
      )}
    </div>
  );
}
