import {
  HttpUrlSchema,
  ProviderTypeSchema,
  VoiceTranscribeResponseSchema,
  isPrivateOrLoopbackUrl,
  type ProviderType,
  type VoiceTranscribeResponse,
} from "@uzina/contracts";
import { decryptSecret, redactSensitiveText } from "@uzina/core";
import { providerProfiles, type UzinaDb } from "@uzina/db";
import { and, desc, eq, inArray } from "drizzle-orm";

const VOICE_CAPABLE_PROVIDERS: ProviderType[] = [
  "openai_compatible",
  "google",
  "omniroute",
];

const DEFAULT_BASE_URLS: Record<
  "openai_compatible" | "google" | "omniroute",
  string
> = {
  openai_compatible: "https://api.openai.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
  omniroute: "http://localhost:8080/v1",
};

export interface ResolvedVoiceProvider {
  id: string;
  name: string;
  providerType: "openai_compatible" | "google" | "omniroute";
  baseUrl: string;
  apiKey: string | null;
}

export function buildSpokenSummary(markdownText: string, maxChars = 420): string {
  if (!markdownText || !markdownText.trim()) {
    return "";
  }

  const text = markdownText
    // Remove blocos de código fenced
    .replace(/```[\s\S]*?```/g, " ")
    // Remove código inline mantendo o identificador curto
    .replace(/`([^`\n]+)`/g, "$1")
    // Remove tabelas Markdown inteiras (linhas começando e terminando ou separadas por |)
    .replace(/^\s*\|.*\|\s*$/gm, " ")
    // Remove links mantendo apenas o rótulo
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1")
    // Remove URLs nuas longas
    .replace(/https?:\/\/\S+/g, "")
    // Remove prefixos Markdown (#, >, -, *, 1.)
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s+|[-*+]\s+|\d+\.\s+)/gm, "")
    // Remove negrito/itálico
    .replace(/(\*\*|__|\*|_)(.*?)\1/g, "$2")
    // Remove caminhos de arquivos muito técnicos entre parênteses
    .replace(/\((?:[a-zA-Z0-9_.-]+\/){2,}[^)]+\)/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) {
    return "Resumo técnico disponível na tela.";
  }

  if (text.length <= maxChars) {
    return text;
  }

  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [];
  let acc = "";
  for (const sentence of sentences) {
    const candidate = acc ? `${acc} ${sentence.trim()}` : sentence.trim();
    if (candidate.length > maxChars) {
      break;
    }
    acc = candidate;
    if (acc.length >= 240) {
      break;
    }
  }

  if (acc.length >= 40) {
    return acc;
  }

  const sliced = text.slice(0, maxChars - 1);
  const lastSpace = sliced.lastIndexOf(" ");
  return `${lastSpace > 40 ? sliced.slice(0, lastSpace) : sliced}…`;
}

function normalizeVoiceBaseUrl(
  providerType: "openai_compatible" | "google" | "omniroute",
  rawBaseUrl?: string | null
): string {
  const trimmed = rawBaseUrl?.trim() ?? "";
  const candidate = trimmed || DEFAULT_BASE_URLS[providerType];
  return candidate.replace(/\/+$/, "");
}

function normalizeAudioMimeForExtension(mimeType: string): {
  mime: string;
  ext: string;
} {
  const base = mimeType.split(";")[0]?.trim().toLowerCase() || "audio/webm";
  if (base === "audio/mp4" || base === "audio/m4a" || base === "audio/x-m4a") {
    return { mime: "audio/mp4", ext: "m4a" };
  }
  if (base === "audio/mpeg" || base === "audio/mp3") {
    return { mime: "audio/mpeg", ext: "mp3" };
  }
  if (base === "audio/ogg") {
    return { mime: "audio/ogg", ext: "ogg" };
  }
  if (base === "audio/wav") {
    return { mime: "audio/wav", ext: "wav" };
  }
  return { mime: "audio/webm", ext: "webm" };
}

export async function resolveVoiceProviderFromVault(
  db: UzinaDb,
  params: {
    organizationId: string;
    masterKey?: Buffer;
    preferredProviderId?: string | null;
  }
): Promise<ResolvedVoiceProvider | null> {
  const rows = await db
    .select()
    .from(providerProfiles)
    .where(
      and(
        eq(providerProfiles.organizationId, params.organizationId),
        inArray(providerProfiles.providerType, VOICE_CAPABLE_PROVIDERS)
      )
    )
    .orderBy(desc(providerProfiles.isDefault), desc(providerProfiles.createdAt));

  if (rows.length === 0) {
    return null;
  }

  const preferred = params.preferredProviderId
    ? rows.find((r) => r.id === params.preferredProviderId)
    : undefined;

  // Prioriza provider escolhido, depois default, depois openai_compatible (tem STT/TTS nativo) e google
  const ordered = preferred
    ? [preferred, ...rows.filter((r) => r.id !== preferred.id)]
    : [
        ...rows.filter((r) => r.isDefault),
        ...rows.filter(
          (r) => !r.isDefault && r.providerType === "openai_compatible"
        ),
        ...rows.filter(
          (r) => !r.isDefault && r.providerType !== "openai_compatible"
        ),
      ];

  for (const row of ordered) {
    const parsedType = ProviderTypeSchema.safeParse(row.providerType);
    if (!parsedType.success) continue;
    const providerType = parsedType.data;
    if (
      providerType !== "openai_compatible" &&
      providerType !== "google" &&
      providerType !== "omniroute"
    ) {
      continue;
    }

    const baseUrl = normalizeVoiceBaseUrl(providerType, row.baseUrl);
    if (!HttpUrlSchema.safeParse(baseUrl).success) {
      continue;
    }
    try {
      const parsedBase = new URL(baseUrl);
      if (
        parsedBase.username ||
        parsedBase.password ||
        parsedBase.search ||
        parsedBase.hash
      ) {
        continue;
      }
    } catch {
      continue;
    }
    if (providerType === "google" && isPrivateOrLoopbackUrl(baseUrl)) {
      continue;
    }

    let apiKey: string | null = null;
    if (row.encryptedApiKey) {
      if (!params.masterKey) continue;
      try {
        apiKey = decryptSecret({
          encrypted: row.encryptedApiKey,
          masterKey: params.masterKey,
          organizationId: params.organizationId,
          providerType,
        });
      } catch {
        continue;
      }
    }

    if (!apiKey && providerType === "google") {
      continue;
    }

    return {
      id: row.id,
      name: row.name,
      providerType,
      baseUrl,
      apiKey,
    };
  }

  return null;
}

export async function transcribeAudioWithVault(params: {
  db: UzinaDb;
  organizationId: string;
  masterKey?: Buffer;
  audioBuffer: Buffer;
  mimeType: string;
  fileName?: string;
  language?: string;
  providerId?: string;
  fetchImpl?: typeof fetch;
}): Promise<VoiceTranscribeResponse> {
  const provider = await resolveVoiceProviderFromVault(params.db, {
    organizationId: params.organizationId,
    masterKey: params.masterKey,
    preferredProviderId: params.providerId,
  });

  if (!provider) {
    throw new Error(
      "Nenhum provedor de voz (OpenAI-compatible, Groq ou Google Gemini) configurado no Cofre."
    );
  }

  const fetchFn = params.fetchImpl ?? globalThis.fetch;
  const language = params.language?.trim() || "pt";
  const normalized = normalizeAudioMimeForExtension(params.mimeType);
  const secretsToRedact = provider.apiKey ? [provider.apiKey] : [];

  if (
    provider.providerType === "openai_compatible" ||
    provider.providerType === "omniroute"
  ) {
    const isGroq = provider.baseUrl.toLowerCase().includes("groq.com");
    const model = isGroq
      ? "whisper-large-v3-turbo"
      : "gpt-4o-mini-transcribe";

    const formData = new FormData();
    const audioBytes = Uint8Array.from(params.audioBuffer);
    const blob = new Blob([audioBytes], { type: normalized.mime });
    const safeName =
      params.fileName?.replace(/[^a-zA-Z0-9._-]/g, "_") ||
      `voice-note.${normalized.ext}`;
    formData.append("file", blob, safeName);
    formData.append("model", model);
    formData.append("language", language);

    const headers: Record<string, string> = {};
    if (provider.apiKey) {
      headers.Authorization = `Bearer ${provider.apiKey}`;
    }

    let res: Response;
    try {
      res = await fetchFn(`${provider.baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers,
        body: formData,
        redirect: "error",
      });
    } catch (err) {
      throw new Error(
        redactSensitiveText(
          err instanceof Error
            ? `Erro de rede STT: ${err.message}`
            : "Erro de rede STT.",
          secretsToRedact
        )
      );
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        redactSensitiveText(
          `Falha na transcrição STT (${res.status}): ${errText.slice(0, 240)}`,
          secretsToRedact
        )
      );
    }

    const payload = (await res.json()) as {
      text?: string;
      duration?: number;
    };
    const text = redactSensitiveText(
      (payload.text ?? "").trim(),
      secretsToRedact
    );

    return VoiceTranscribeResponseSchema.parse({
      text,
      language,
      durationSeconds:
        typeof payload.duration === "number" && payload.duration >= 0
          ? payload.duration
          : undefined,
      providerType: provider.providerType,
      model,
      estimatedCostUsd: isGroq ? 0.0005 : 0.003,
    });
  }

  // Google Gemini multimodal áudio (via header x-goog-api-key, nunca na URL)
  const model = "gemini-2.5-flash";
  const endpoint = `${provider.baseUrl}/models/${encodeURIComponent(
    model
  )}:generateContent`;

  let res: Response;
  try {
    res = await fetchFn(endpoint, {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": provider.apiKey ?? "",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `Transcreva exatamente o áudio falado em ${language}. Retorne apenas o texto transcrito sem comentários, aspas ou formatação extra.`,
              },
              {
                inlineData: {
                  mimeType: normalized.mime,
                  data: params.audioBuffer.toString("base64"),
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
        },
      }),
    });
  } catch (err) {
    throw new Error(
      redactSensitiveText(
        err instanceof Error
          ? `Erro de rede Gemini STT: ${err.message}`
          : "Erro de rede Gemini STT.",
        secretsToRedact
      )
    );
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      redactSensitiveText(
        `Falha na transcrição Gemini (${res.status}): ${errText.slice(0, 240)}`,
        secretsToRedact
      )
    );
  }

  const data = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };
  const rawText =
    data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join(" ")
      .trim() ?? "";

  return VoiceTranscribeResponseSchema.parse({
    text: redactSensitiveText(rawText, secretsToRedact),
    language,
    providerType: provider.providerType,
    model,
    estimatedCostUsd: 0.001,
  });
}

export type SynthesizeSpeechResult =
  | {
      mode: "audio";
      audioBuffer: Buffer;
      contentType: string;
      providerType: string;
      model: string;
      estimatedCostUsd: number;
    }
  | {
      mode: "fallback_browser_speech";
      reason: string;
    };

export async function synthesizeSpeechWithVault(params: {
  db: UzinaDb;
  organizationId: string;
  masterKey?: Buffer;
  text: string;
  voice?: string;
  speed?: number;
  instructions?: string;
  providerId?: string;
  fetchImpl?: typeof fetch;
}): Promise<SynthesizeSpeechResult> {
  const provider = await resolveVoiceProviderFromVault(params.db, {
    organizationId: params.organizationId,
    masterKey: params.masterKey,
    preferredProviderId: params.providerId,
  });

  if (!provider) {
    return {
      mode: "fallback_browser_speech",
      reason: "no_tts_provider",
    };
  }

  // Groq não possui endpoint TTS OpenAI-compatible padrão na maior parte dos tiers; cai graciosamente se falhar
  if (
    provider.providerType !== "openai_compatible" &&
    provider.providerType !== "omniroute"
  ) {
    return {
      mode: "fallback_browser_speech",
      reason: "provider_uses_browser_speech",
    };
  }

  const fetchFn = params.fetchImpl ?? globalThis.fetch;
  const isOpenAiCloud = provider.baseUrl.toLowerCase().includes("api.openai.com");
  const model = isOpenAiCloud ? "gpt-4o-mini-tts" : "tts-1";
  const voice = params.voice?.trim() || "alloy";
  const speed = params.speed ?? 1;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (provider.apiKey) {
    headers.Authorization = `Bearer ${provider.apiKey}`;
  }

  const body: Record<string, unknown> = {
    model,
    input: params.text,
    voice,
    response_format: "mp3",
    speed,
  };
  if (isOpenAiCloud && params.instructions?.trim()) {
    body.instructions = params.instructions.trim();
  }

  try {
    const res = await fetchFn(`${provider.baseUrl}/audio/speech`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      redirect: "error",
    });

    if (!res.ok) {
      return {
        mode: "fallback_browser_speech",
        reason: `tts_http_${res.status}`,
      };
    }

    const arrayBuf = await res.arrayBuffer();
    if (arrayBuf.byteLength === 0) {
      return {
        mode: "fallback_browser_speech",
        reason: "empty_tts_audio",
      };
    }

    const estimatedCostUsd = Number(
      ((params.text.length / 1000) * 0.015).toFixed(6)
    );

    return {
      mode: "audio",
      audioBuffer: Buffer.from(arrayBuf),
      contentType: res.headers.get("content-type") || "audio/mpeg",
      providerType: provider.providerType,
      model,
      estimatedCostUsd,
    };
  } catch {
    return {
      mode: "fallback_browser_speech",
      reason: "tts_network_fallback",
    };
  }
}
