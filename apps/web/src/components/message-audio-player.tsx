"use client";

import { Loader2, Pause, Play, Volume2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getVoicePreferences,
  setupMediaSession,
  speakWithBrowserFallback,
  unlockMobileAudio,
} from "@/lib/voice-browser";

interface MessageAudioPlayerProps {
  text: string;
  title?: string;
  autoPlaySignal?: string | number | null;
  label?: string;
}

const SPEEDS = [1, 1.25, 1.5, 2] as const;

export function MessageAudioPlayer({
  text,
  title = "Resposta do Uzina Studio",
  autoPlaySignal,
  label = "Ouvir resumo",
}: MessageAudioPlayerProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "playing" | "paused">(
    "idle"
  );
  const [speedIdx, setSpeedIdx] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const cancelBrowserSpeechRef = useRef<(() => void) | null>(null);
  const cleanupSessionRef = useRef<(() => void) | null>(null);
  const lastAutoPlayedRef = useRef<string | number | null>(null);
  const playSpeechRef = useRef<(() => Promise<void>) | null>(null);

  const stopAll = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    cancelBrowserSpeechRef.current?.();
    cancelBrowserSpeechRef.current = null;
    cleanupSessionRef.current?.();
    cleanupSessionRef.current = null;
    setStatus("idle");
  }, []);

  useEffect(() => {
    return () => {
      stopAll();
    };
  }, [stopAll]);

  const playSpeech = useCallback(async () => {
    const cleanText = text.trim();
    if (!cleanText) return;

    unlockMobileAudio();

    if (status === "playing" && audioRef.current) {
      audioRef.current.pause();
      setStatus("paused");
      return;
    }
    if (status === "paused" && audioRef.current) {
      await audioRef.current.play().catch(() => undefined);
      setStatus("playing");
      return;
    }
    if (status === "playing") {
      stopAll();
      return;
    }

    stopAll();
    setStatus("loading");

    const prefs = getVoicePreferences();
    const rate = SPEEDS[speedIdx] ?? 1;

    try {
      const res = await fetch("/api/voice/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: cleanText.slice(0, 2000),
          voice: prefs.ttsVoice,
          speed: Math.min(1.5, rate),
          instructions: prefs.ttsInstructions,
          providerId: prefs.ttsProviderId ?? undefined,
        }),
      });

      const contentType = res.headers.get("content-type") ?? "";
      if (res.ok && contentType.includes("audio/")) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;

        const audio = new Audio(url);
        audio.setAttribute("playsinline", "true");
        audio.playbackRate = rate;
        audio.onended = () => stopAll();
        audio.onerror = () => stopAll();
        audioRef.current = audio;

        cleanupSessionRef.current = setupMediaSession({
          title,
          onPlay: () => {
            void audio.play().catch(() => undefined);
            setStatus("playing");
          },
          onPause: () => {
            audio.pause();
            setStatus("paused");
          },
        });

        await audio.play();
        setStatus("playing");
        return;
      }
    } catch {
      // fallback abaixo para speechSynthesis
    }

    const cancelBrowser = speakWithBrowserFallback(cleanText, rate, () => {
      setStatus("idle");
      cleanupSessionRef.current?.();
      cleanupSessionRef.current = null;
    });

    if (cancelBrowser) {
      cancelBrowserSpeechRef.current = cancelBrowser;
      cleanupSessionRef.current = setupMediaSession({
        title,
        onPlay: () => void playSpeechRef.current?.(),
        onPause: () => stopAll(),
      });
      setStatus("playing");
    } else {
      setStatus("idle");
    }
  }, [speedIdx, status, stopAll, text, title]);

  useEffect(() => {
    playSpeechRef.current = playSpeech;
  }, [playSpeech]);

  useEffect(() => {
    if (
      autoPlaySignal &&
      autoPlaySignal !== lastAutoPlayedRef.current &&
      text.trim()
    ) {
      lastAutoPlayedRef.current = autoPlaySignal;
      void playSpeech();
    }
  }, [autoPlaySignal, playSpeech, text]);

  function cycleSpeed() {
    const nextIdx = (speedIdx + 1) % SPEEDS.length;
    setSpeedIdx(nextIdx);
    const nextRate = SPEEDS[nextIdx] ?? 1;
    if (audioRef.current) {
      audioRef.current.playbackRate = nextRate;
    }
  }

  return (
    <div className="inline-flex items-center gap-1">
      <button
        type="button"
        data-testid="message-audio-play-btn"
        onClick={() => void playSpeech()}
        aria-label={status === "playing" ? "Pausar áudio" : label}
        className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border-subtle bg-inset px-2 py-1 text-xs text-fg-secondary transition-colors hover:border-border-default hover:text-fg-primary"
      >
        {status === "loading" ? (
          <Loader2 className="size-3.5 animate-spin text-accent" />
        ) : status === "playing" ? (
          <Pause className="size-3.5 text-accent" strokeWidth={1.75} />
        ) : status === "paused" ? (
          <Play className="size-3.5 text-accent" strokeWidth={1.75} />
        ) : (
          <Volume2 className="size-3.5" strokeWidth={1.75} />
        )}
        <span>{status === "playing" ? "Pausar" : label}</span>
      </button>

      {status !== "idle" && (
        <button
          type="button"
          onClick={cycleSpeed}
          aria-label="Alterar velocidade de reprodução"
          className="inline-flex min-h-8 items-center rounded-md border border-border-subtle bg-inset px-1.5 py-1 font-mono text-xs text-fg-muted hover:text-fg-primary tabular-nums"
        >
          {SPEEDS[speedIdx]}x
        </button>
      )}
    </div>
  );
}
