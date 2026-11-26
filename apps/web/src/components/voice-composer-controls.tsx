"use client";

import { AudioLines, Loader2, Mic, Square, Volume2, VolumeX, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useWakeLock } from "@/lib/mobile-resilience";
import {
  createAudioLevelMonitor,
  detectSupportedAudioMimeType,
  getVoicePreferences,
  mimeTypeToExtension,
  unlockMobileAudio,
} from "@/lib/voice-browser";

interface VoiceComposerControlsProps {
  disabled?: boolean;
  voiceMode: boolean;
  onVoiceModeChange: (enabled: boolean) => void;
  onTranscribed: (text: string, options: { autoSend: boolean }) => void;
  onOfflineAudioQueued?: (blob: Blob, mimeType: string) => void;
  compact?: boolean;
}

export function VoiceComposerControls({
  disabled = false,
  voiceMode,
  onVoiceModeChange,
  onTranscribed,
  onOfflineAudioQueued,
  compact = false,
}: VoiceComposerControlsProps) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [levels, setLevels] = useState<number[]>([0.2, 0.35, 0.25, 0.4, 0.3, 0.2]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const cancelledRef = useRef(false);
  const stopMonitorRef = useRef<(() => void) | null>(null);
  const voiceModeRef = useRef(voiceMode);

  useEffect(() => {
    voiceModeRef.current = voiceMode;
  }, [voiceMode]);

  useWakeLock(recording);

  useEffect(() => {
    if (!recording) {
      return;
    }
    const timer = window.setInterval(() => {
      setElapsedSec((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    return () => {
      stopMonitorRef.current?.();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function cleanupStream() {
    stopMonitorRef.current?.();
    stopMonitorRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }

  async function startRecording() {
    if (disabled || recording || transcribing) return;
    setErrorMsg(null);
    unlockMobileAudio();

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setErrorMsg("Gravação de áudio não suportada neste navegador.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      cancelledRef.current = false;

      const mimeType = detectSupportedAudioMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      recorderRef.current = recorder;
      stopMonitorRef.current = createAudioLevelMonitor(stream, setLevels);

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          chunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = async () => {
        const finalMime =
          recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: finalMime });
        cleanupStream();
        setRecording(false);
        setElapsedSec(0);

        if (cancelledRef.current || blob.size === 0) {
          return;
        }

        if (typeof navigator !== "undefined" && !navigator.onLine) {
          onOfflineAudioQueued?.(blob, finalMime);
          setErrorMsg("Sem sinal: áudio salvo na fila offline.");
          return;
        }

        setTranscribing(true);
        try {
          const prefs = getVoicePreferences();
          const form = new FormData();
          const ext = mimeTypeToExtension(finalMime);
          form.append("file", blob, `uzina-voice.${ext}`);
          form.append("language", "pt");
          if (prefs.sttProviderId) {
            form.append("providerId", prefs.sttProviderId);
          }

          const res = await fetch("/api/voice/transcribe", {
            method: "POST",
            body: form,
          });
          if (!res.ok) {
            const errJson = (await res.json().catch(() => null)) as {
              error?: string;
            } | null;
            if (res.status >= 500 && onOfflineAudioQueued) {
              onOfflineAudioQueued(blob, finalMime);
            }
            setErrorMsg(
              errJson?.error ?? "Não foi possível transcrever o áudio."
            );
            return;
          }
          const data = (await res.json()) as { text?: string };
          const text = data.text?.trim() ?? "";
          if (!text) {
            setErrorMsg("Nenhuma fala detectada no áudio.");
            return;
          }
          onTranscribed(text, { autoSend: voiceModeRef.current });
        } catch {
          onOfflineAudioQueued?.(blob, finalMime);
          setErrorMsg("Falha de rede ao transcrever; salvo na fila local.");
        } finally {
          setTranscribing(false);
        }
      };

      recorder.start(250);
      setElapsedSec(0);
      setRecording(true);
    } catch {
      cleanupStream();
      setErrorMsg("Permissão de microfone negada ou indisponível.");
    }
  }

  function stopAndSend() {
    cancelledRef.current = false;
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  }

  function cancelRecording() {
    cancelledRef.current = true;
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    } else {
      cleanupStream();
      setElapsedSec(0);
      setRecording(false);
    }
  }

  const formatTimer = (sec: number) => {
    const mm = String(Math.floor(sec / 60)).padStart(2, "0");
    const ss = String(sec % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {recording ? (
        <div
          data-testid="voice-recording-pill"
          className="flex items-center gap-2 rounded-lg border border-accent/60 bg-accent-subtle px-2.5 py-1.5 text-xs text-fg-primary"
        >
          <span className="size-2 animate-pulse rounded-full bg-status-danger" />
          <div className="flex h-5 items-end gap-0.5" aria-hidden="true">
            {levels.map((lvl, idx) => (
              <span
                key={idx}
                className="w-1 rounded-full bg-accent transition-all duration-75"
                style={{ height: `${Math.round(lvl * 18) + 3}px` }}
              />
            ))}
          </div>
          <span className="font-mono text-xs tabular-nums">
            {formatTimer(elapsedSec)}
          </span>
          <button
            type="button"
            onClick={cancelRecording}
            aria-label="Cancelar gravação"
            className="inline-flex size-8 items-center justify-center rounded-md text-fg-secondary hover:bg-surface hover:text-fg-primary"
          >
            <X className="size-3.5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            data-testid="voice-stop-record-btn"
            onClick={stopAndSend}
            aria-label="Finalizar e transcrever áudio"
            className="inline-flex min-h-8 items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg hover:bg-accent-hover"
          >
            <Square className="size-3" strokeWidth={2} />
            <span>{voiceMode ? "Enviar" : "Transcrever"}</span>
          </button>
        </div>
      ) : (
        <button
          type="button"
          data-testid="voice-mic-btn"
          disabled={disabled || transcribing}
          onClick={() => void startRecording()}
          aria-label="Gravar mensagem por voz"
          title="Gravar áudio (STT)"
          className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg border border-border-default bg-surface px-2.5 text-xs text-fg-secondary transition-colors hover:border-border-strong hover:text-fg-primary disabled:opacity-50 sm:min-h-9 sm:min-w-9"
        >
          {transcribing ? (
            <Loader2 className="size-4 animate-spin text-accent" />
          ) : (
            <Mic className="size-4" strokeWidth={1.75} />
          )}
          {!compact && (
            <span className="hidden sm:inline">
              {transcribing ? "Transcrevendo..." : "Falar"}
            </span>
          )}
        </button>
      )}

      <button
        type="button"
        data-testid="voice-mode-toggle"
        aria-pressed={voiceMode}
        onClick={() => {
          unlockMobileAudio();
          onVoiceModeChange(!voiceMode);
        }}
        title={
          voiceMode
            ? "Modo Voz ativo (envia e lê o resumo automaticamente)"
            : "Ativar Modo Conversa por Voz"
        }
        className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors sm:min-h-9 ${
          voiceMode
            ? "border-accent bg-accent-subtle text-accent"
            : "border-border-default bg-surface text-fg-secondary hover:border-border-strong hover:text-fg-primary"
        }`}
      >
        {voiceMode ? (
          <Volume2 className="size-3.5" strokeWidth={1.75} />
        ) : (
          <VolumeX className="size-3.5" strokeWidth={1.75} />
        )}
        <AudioLines className="size-3.5 sm:hidden" strokeWidth={1.75} />
        <span className="hidden sm:inline">Modo Voz</span>
      </button>

      {errorMsg && (
        <span
          role="status"
          className="text-xs text-status-warn"
        >
          {errorMsg}
        </span>
      )}
    </div>
  );
}
