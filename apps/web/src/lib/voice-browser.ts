"use client";

import type { VoicePreferences } from "@uzina/contracts";

const VOICE_PREFS_STORAGE_KEY = "uzina-voice-preferences-v1";

export const DEFAULT_VOICE_PREFERENCES: VoicePreferences = {
  sttProviderId: null,
  ttsProviderId: null,
  ttsVoice: "alloy",
  ttsSpeed: 1,
  ttsInstructions: "Tom técnico claro, direto e calmo em português do Brasil.",
  autoPlayInVoiceMode: true,
  fallbackToBrowserSpeech: true,
};

export function getVoicePreferences(): VoicePreferences {
  if (typeof window === "undefined") {
    return DEFAULT_VOICE_PREFERENCES;
  }
  try {
    const raw = window.localStorage.getItem(VOICE_PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_VOICE_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<VoicePreferences>;
    return {
      ...DEFAULT_VOICE_PREFERENCES,
      ...parsed,
    };
  } catch {
    return DEFAULT_VOICE_PREFERENCES;
  }
}

export function saveVoicePreferences(next: Partial<VoicePreferences>): VoicePreferences {
  const merged: VoicePreferences = {
    ...getVoicePreferences(),
    ...next,
  };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(
        VOICE_PREFS_STORAGE_KEY,
        JSON.stringify(merged)
      );
    } catch {
      // ignora erro de cota
    }
  }
  return merged;
}

export function detectSupportedAudioMimeType(): string {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
    return "";
  }
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
    "audio/wav",
  ];
  for (const type of candidates) {
    if (
      typeof MediaRecorder.isTypeSupported === "function" &&
      MediaRecorder.isTypeSupported(type)
    ) {
      return type;
    }
  }
  return "";
}

export function mimeTypeToExtension(mimeType: string): string {
  const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (base === "audio/mp4" || base === "audio/m4a" || base === "audio/x-m4a") {
    return "m4a";
  }
  if (base === "audio/mpeg" || base === "audio/mp3") return "mp3";
  if (base === "audio/ogg") return "ogg";
  if (base === "audio/wav") return "wav";
  return "webm";
}

let audioUnlocked = false;

export function unlockMobileAudio(): void {
  if (typeof window === "undefined" || audioUnlocked) return;

  try {
    const AudioCtx =
      window.AudioContext ||
      (window as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (AudioCtx) {
      const ctx = new AudioCtx();
      if (ctx.state === "suspended") {
        void ctx.resume().catch(() => undefined);
      }
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
    }
  } catch {
    // ignore Web Audio unlock failures
  }

  try {
    if ("speechSynthesis" in window) {
      const silent = new SpeechSynthesisUtterance("");
      silent.volume = 0;
      window.speechSynthesis.speak(silent);
    }
  } catch {
    // ignore speechSynthesis unlock failures
  }

  audioUnlocked = true;
}

export function createAudioLevelMonitor(
  stream: MediaStream,
  onLevels: (bars: number[]) => void
): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const AudioCtx =
    window.AudioContext ||
    (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) {
    return () => undefined;
  }

  let rafId = 0;
  let closed = false;

  try {
    const ctx = new AudioCtx();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 32;
    source.connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      if (closed) return;
      analyser.getByteFrequencyData(data);
      const bars = [0, 1, 2, 3, 4, 5].map((i) => {
        const val = data[i * 2] ?? 0;
        return Math.max(0.15, Math.min(1, val / 180));
      });
      onLevels(bars);
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);

    return () => {
      closed = true;
      if (rafId) window.cancelAnimationFrame(rafId);
      source.disconnect();
      analyser.disconnect();
      void ctx.close().catch(() => undefined);
    };
  } catch {
    return () => undefined;
  }
}

export function setupMediaSession(params: {
  title: string;
  artist?: string;
  onPlay: () => void;
  onPause: () => void;
}): () => void {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
    return () => undefined;
  }

  try {
    if (typeof MediaMetadata !== "undefined") {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: params.title,
        artist: params.artist ?? "Uzina Studio",
        album: "Fábrica de Software IA",
        artwork: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      });
    }
    navigator.mediaSession.setActionHandler("play", params.onPlay);
    navigator.mediaSession.setActionHandler("pause", params.onPause);
  } catch {
    // Alguns browsers bloqueiam action handlers específicos
  }

  return () => {
    try {
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
    } catch {
      // noop
    }
  };
}

export function speakWithBrowserFallback(
  text: string,
  rate = 1,
  onEnd?: () => void
): (() => void) | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return null;
  }

  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "pt-BR";
    utterance.rate = Math.min(1.5, Math.max(0.75, rate));
    const voices = window.speechSynthesis.getVoices();
    const ptVoice = voices.find((v) =>
      v.lang.toLowerCase().startsWith("pt")
    );
    if (ptVoice) {
      utterance.voice = ptVoice;
    }
    if (onEnd) {
      utterance.onend = onEnd;
      utterance.onerror = onEnd;
    }
    window.speechSynthesis.speak(utterance);
    return () => {
      window.speechSynthesis.cancel();
    };
  } catch {
    return null;
  }
}
