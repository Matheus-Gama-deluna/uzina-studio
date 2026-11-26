"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  NotificationEventType,
  NotificationPreferences,
  VoicePreferences,
} from "@uzina/contracts";
import {
  Bell,
  BellOff,
  CheckCircle2,
  Loader2,
  MoonStar,
  Send,
  Smartphone,
  Volume2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  getVoicePreferences,
  saveVoicePreferences,
  unlockMobileAudio,
} from "@/lib/voice-browser";

const emptySubscribe = () => () => {};

const EVENT_LABELS: Array<{ key: NotificationEventType; label: string; desc: string }> = [
  {
    key: "decision_pending",
    label: "Decisões HITL Pendentes",
    desc: "Quando Discovery, Blueprint, Estúdio ou PR pausam aguardando você.",
  },
  {
    key: "deliverable_completed",
    label: "Entrega Concluída",
    desc: "Quando o pipeline fecha com build e testes verdes.",
  },
  {
    key: "deliverable_failed",
    label: "Falha em Entrega",
    desc: "Quando um slice trava após tentativas automáticas.",
  },
  {
    key: "security_critical",
    label: "Alerta Crítico AppSec",
    desc: "Vulnerabilidades críticas detectadas pelo motor de segurança.",
  },
  {
    key: "budget_cap_pause",
    label: "Pausa por Teto de Orçamento",
    desc: "Quando o gasto do projeto atinge o limite configurado.",
  },
  {
    key: "agent_reply_ready",
    label: "Resposta Longa da Agência",
    desc: "Quando uma orquestração longa termina em segundo plano.",
  },
];

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function MobileSettingsPanel() {
  const queryClient = useQueryClient();
  const isStandalone = useSyncExternalStore(
    emptySubscribe,
    () =>
      window.matchMedia("(display-mode: standalone)").matches ||
      Boolean((window.navigator as { standalone?: boolean }).standalone),
    () => false
  );
  const pushSupported = useSyncExternalStore(
    emptySubscribe,
    () =>
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window,
    () => false
  );
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushStatusMsg, setPushStatusMsg] = useState<string | null>(null);
  const [voicePrefs, setVoicePrefs] = useState<VoicePreferences>(() =>
    getVoicePreferences()
  );
  const [prefsOverride, setPrefsDraft] =
    useState<NotificationPreferences | null>(null);

  const prefsQuery = useQuery({
    queryKey: ["notification-preferences"],
    queryFn: async () => {
      const res = await fetch("/api/notifications/preferences");
      if (!res.ok) throw new Error("Falha ao carregar preferências");
      return (await res.json()) as NotificationPreferences;
    },
  });

  const prefsDraft = prefsOverride ?? prefsQuery.data ?? null;

  useEffect(() => {
    if (!pushSupported) return;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setPushSubscribed(Boolean(sub)))
      .catch(() => undefined);
  }, [pushSupported]);

  const savePrefsMutation = useMutation({
    mutationFn: async (next: NotificationPreferences) => {
      const res = await fetch("/api/notifications/preferences", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(err?.error ?? "Falha ao salvar preferências.");
      }
      return (await res.json()) as NotificationPreferences;
    },
    onSuccess: async (saved) => {
      setPrefsDraft(saved);
      setPushStatusMsg("Preferências salvas.");
      await queryClient.invalidateQueries({
        queryKey: ["notification-preferences"],
      });
    },
  });

  const testPushMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/notifications/test", { method: "POST" });
      if (!res.ok) throw new Error("Falha ao enviar teste.");
      return res.json();
    },
    onSuccess: async () => {
      setPushStatusMsg("Notificação de teste enviada!");
      await queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  async function handleEnablePush() {
    setPushStatusMsg(null);
    if (!pushSupported) {
      setPushStatusMsg(
        "No iPhone/iPad, adicione primeiro o Uzina à Tela de Início (Compartilhar → Adicionar à Tela de Início)."
      );
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushStatusMsg("Permissão de notificação negada no navegador.");
        return;
      }

      const keyRes = await fetch("/api/notifications/vapid-public-key");
      if (!keyRes.ok) {
        throw new Error("Chave VAPID indisponível.");
      }
      const { publicKey } = (await keyRes.json()) as { publicKey: string };

      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }));

      const jsonSub = subscription.toJSON();
      const saveRes = await fetch("/api/notifications/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          endpoint: subscription.endpoint,
          keys: {
            p256dh: jsonSub.keys?.p256dh ?? "",
            auth: jsonSub.keys?.auth ?? "",
          },
          surface: "technical",
        }),
      });
      if (!saveRes.ok) {
        throw new Error("Falha ao registrar dispositivo.");
      }

      setPushSubscribed(true);
      setPushStatusMsg("Notificações Push ativadas neste dispositivo!");
    } catch (err) {
      setPushStatusMsg(
        err instanceof Error ? err.message : "Erro ao ativar Web Push."
      );
    }
  }

  async function handleDisablePush() {
    setPushStatusMsg(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/notifications/subscriptions", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setPushSubscribed(false);
      setPushStatusMsg("Push desativado neste dispositivo.");
    } catch {
      setPushStatusMsg("Não foi possível remover a inscrição.");
    }
  }

  function updateVoicePref<K extends keyof VoicePreferences>(
    key: K,
    val: VoicePreferences[K]
  ) {
    unlockMobileAudio();
    const updated = saveVoicePreferences({ [key]: val });
    setVoicePrefs(updated);
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <header className="border-b border-border-subtle pb-4">
        <div className="flex items-center gap-2 text-xs font-medium text-fg-muted">
          <Smartphone className="size-4 text-accent" strokeWidth={1.75} />
          <span>Celular, PWA, Voz &amp; Notificações</span>
        </div>
        <h1 className="mt-1.5 text-xl font-semibold text-fg-primary">
          Configurações Mobile &amp; Alertas
        </h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Ative Web Push no dispositivo instalado, configure Horário Silencioso
          e ajuste o comportamento da conversa por voz.
        </p>
      </header>

      {/* Card 1: Status PWA & Web Push */}
      <section className="uzina-card space-y-4 rounded-xl border border-border-default bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-fg-primary">
              <Bell className="size-4 text-accent" strokeWidth={1.75} />
              <span>Notificações Push (Este Dispositivo)</span>
            </h2>
            <p className="mt-1 text-xs text-fg-secondary">
              Modo atual:{" "}
              <strong className="text-fg-primary">
                {isStandalone ? "App Instalado (Standalone)" : "Navegador Web"}
              </strong>{" "}
              · Push:{" "}
              <strong className="text-fg-primary">
                {pushSubscribed ? "Ativo" : "Inativo"}
              </strong>
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {pushSubscribed ? (
              <button
                type="button"
                onClick={() => void handleDisablePush()}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border-default bg-inset px-3 text-xs font-medium text-fg-secondary hover:text-fg-primary"
              >
                <BellOff className="size-3.5" strokeWidth={1.75} />
                <span>Desativar neste aparelho</span>
              </button>
            ) : (
              <button
                type="button"
                data-testid="btn-enable-web-push"
                onClick={() => void handleEnablePush()}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-accent px-4 text-xs font-semibold text-accent-fg hover:bg-accent-hover"
              >
                <Bell className="size-3.5" strokeWidth={1.75} />
                <span>Ativar Notificações Push</span>
              </button>
            )}

            <button
              type="button"
              data-testid="btn-test-notification"
              disabled={testPushMutation.isPending}
              onClick={() => testPushMutation.mutate()}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border-default bg-elevated px-3 text-xs font-medium text-fg-primary hover:border-border-strong disabled:opacity-50"
            >
              {testPushMutation.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Send className="size-3.5" strokeWidth={1.75} />
              )}
              <span>Enviar teste</span>
            </button>
          </div>
        </div>

        {pushStatusMsg && (
          <p
            role="status"
            className="flex items-center gap-2 rounded-md border border-border-subtle bg-inset px-3 py-2 text-xs text-fg-primary"
          >
            <CheckCircle2 className="size-3.5 text-status-ok" />
            <span>{pushStatusMsg}</span>
          </p>
        )}
      </section>

      {/* Card 2: Preferências de Eventos & Quiet Hours */}
      {prefsDraft && (
        <section className="uzina-card space-y-4 rounded-xl border border-border-default bg-surface p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-fg-primary">
              <MoonStar className="size-4 text-accent" strokeWidth={1.75} />
              <span>Eventos Acionáveis &amp; Horário Silencioso</span>
            </h2>
            <label className="flex items-center gap-2 text-xs font-medium text-fg-primary">
              <input
                type="checkbox"
                checked={prefsDraft.pushEnabled}
                onChange={(e) =>
                  setPrefsDraft({ ...prefsDraft, pushEnabled: e.target.checked })
                }
                className="size-4 accent-accent"
              />
              <span>Receber Push</span>
            </label>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {EVENT_LABELS.map((item) => {
              const checked = prefsDraft.enabledEvents[item.key] !== false;
              return (
                <label
                  key={item.key}
                  className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border-subtle bg-inset p-3 text-xs"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) =>
                      setPrefsDraft({
                        ...prefsDraft,
                        enabledEvents: {
                          ...prefsDraft.enabledEvents,
                          [item.key]: e.target.checked,
                        },
                      })
                    }
                    className="mt-0.5 size-4 accent-accent"
                  />
                  <div>
                    <p className="font-medium text-fg-primary">{item.label}</p>
                    <p className="mt-0.5 text-fg-muted">{item.desc}</p>
                  </div>
                </label>
              );
            })}
          </div>

          <div className="space-y-3 rounded-lg border border-border-subtle bg-inset p-3.5">
            <label className="flex items-center gap-2 text-xs font-semibold text-fg-primary">
              <input
                type="checkbox"
                data-testid="quiet-hours-toggle"
                checked={prefsDraft.quietHoursEnabled}
                onChange={(e) =>
                  setPrefsDraft({
                    ...prefsDraft,
                    quietHoursEnabled: e.target.checked,
                  })
                }
                className="size-4 accent-accent"
              />
              <span>Ativar Horário Silencioso (Quiet Hours)</span>
            </label>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label
                  htmlFor="quiet-start"
                  className="block text-xs text-fg-secondary"
                >
                  Início
                </label>
                <input
                  id="quiet-start"
                  type="time"
                  value={prefsDraft.quietHoursStart}
                  onChange={(e) =>
                    setPrefsDraft({
                      ...prefsDraft,
                      quietHoursStart: e.target.value,
                    })
                  }
                  className="mt-1 min-h-9 w-full rounded-md border border-border-default bg-surface px-2.5 text-xs text-fg-primary"
                />
              </div>
              <div>
                <label
                  htmlFor="quiet-end"
                  className="block text-xs text-fg-secondary"
                >
                  Fim
                </label>
                <input
                  id="quiet-end"
                  type="time"
                  value={prefsDraft.quietHoursEnd}
                  onChange={(e) =>
                    setPrefsDraft({
                      ...prefsDraft,
                      quietHoursEnd: e.target.value,
                    })
                  }
                  className="mt-1 min-h-9 w-full rounded-md border border-border-default bg-surface px-2.5 text-xs text-fg-primary"
                />
              </div>
              <div>
                <label
                  htmlFor="quiet-tz"
                  className="block text-xs text-fg-secondary"
                >
                  Fuso horário
                </label>
                <input
                  id="quiet-tz"
                  type="text"
                  value={prefsDraft.timezone}
                  onChange={(e) =>
                    setPrefsDraft({ ...prefsDraft, timezone: e.target.value })
                  }
                  className="mt-1 min-h-9 w-full rounded-md border border-border-default bg-surface px-2.5 font-mono text-xs text-fg-primary"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-fg-secondary">
              <input
                type="checkbox"
                checked={prefsDraft.allowCriticalDuringQuietHours}
                onChange={(e) =>
                  setPrefsDraft({
                    ...prefsDraft,
                    allowCriticalDuringQuietHours: e.target.checked,
                  })
                }
                className="size-4 accent-accent"
              />
              <span>
                Permitir alertas críticos (AppSec / Orçamento) mesmo no horário
                silencioso
              </span>
            </label>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              data-testid="btn-save-notification-prefs"
              disabled={savePrefsMutation.isPending}
              onClick={() => savePrefsMutation.mutate(prefsDraft)}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-accent px-4 text-xs font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-50"
            >
              {savePrefsMutation.isPending && (
                <Loader2 className="size-3.5 animate-spin" />
              )}
              <span>Salvar preferências de alertas</span>
            </button>
          </div>
        </section>
      )}

      {/* Card 3: Preferências Locais de Voz (STT/TTS) */}
      <section className="uzina-card space-y-4 rounded-xl border border-border-default bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-fg-primary">
            <Volume2 className="size-4 text-accent" strokeWidth={1.75} />
            <span>Preferências de Voz (STT &amp; TTS)</span>
          </h2>
          <Link
            href="/app/providers"
            className="text-xs font-medium text-accent hover:underline"
          >
            Gerenciar chaves no Cofre →
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label
              htmlFor="voice-tts-select"
              className="block text-xs font-medium text-fg-secondary"
            >
              Voz padrão (OpenAI-compatible)
            </label>
            <select
              id="voice-tts-select"
              value={voicePrefs.ttsVoice}
              onChange={(e) => updateVoicePref("ttsVoice", e.target.value)}
              className="mt-1 min-h-9 w-full rounded-md border border-border-default bg-inset px-2.5 text-xs text-fg-primary"
            >
              <option value="alloy">Alloy (Neutra)</option>
              <option value="verse">Verse (Conversacional)</option>
              <option value="nova">Nova (Clara)</option>
              <option value="onyx">Onyx (Grave)</option>
              <option value="shimmer">Shimmer (Suave)</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="voice-tts-speed"
              className="block text-xs font-medium text-fg-secondary"
            >
              Velocidade padrão ({voicePrefs.ttsSpeed.toFixed(2)}x)
            </label>
            <input
              id="voice-tts-speed"
              type="range"
              min={0.75}
              max={1.5}
              step={0.05}
              value={voicePrefs.ttsSpeed}
              onChange={(e) =>
                updateVoicePref("ttsSpeed", Number(e.target.value))
              }
              className="mt-2.5 w-full accent-accent"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-xs text-fg-secondary">
          <input
            type="checkbox"
            checked={voicePrefs.fallbackToBrowserSpeech}
            onChange={(e) =>
              updateVoicePref("fallbackToBrowserSpeech", e.target.checked)
            }
            className="size-4 accent-accent"
          />
          <span>
            Usar voz nativa do dispositivo gratuitamente quando nenhum provedor
            TTS estiver ativo no Cofre
          </span>
        </label>
      </section>
    </div>
  );
}
