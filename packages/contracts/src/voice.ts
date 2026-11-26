import { z } from "zod";

export const ALLOWED_AUDIO_MIME_TYPES = [
  "audio/webm",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/mpeg",
  "audio/mp3",
  "audio/ogg",
  "audio/wav",
] as const;

export const MAX_AUDIO_UPLOAD_BYTES = 15 * 1024 * 1024;

export const VoiceTranscribeResponseSchema = z
  .object({
    text: z.string(),
    language: z.string().min(1).max(32),
    durationSeconds: z.number().nonnegative().optional(),
    providerType: z.string().min(1).max(64),
    model: z.string().min(1).max(160),
    estimatedCostUsd: z.number().nonnegative(),
  })
  .strict();
export type VoiceTranscribeResponse = z.infer<
  typeof VoiceTranscribeResponseSchema
>;

export const VoiceSpeakRequestSchema = z
  .object({
    text: z.string().trim().min(1).max(2000),
    voice: z.string().trim().min(1).max(64).optional(),
    speed: z.number().min(0.75).max(1.5).optional(),
    instructions: z.string().trim().max(400).optional(),
    providerId: z.uuid().optional(),
    language: z.string().trim().max(16).optional(),
  })
  .strict();
export type VoiceSpeakRequest = z.infer<typeof VoiceSpeakRequestSchema>;

export const VoiceSpeakFallbackResponseSchema = z
  .object({
    fallback: z.literal("browser_speech"),
    reason: z.string().min(1).max(120),
    text: z.string().min(1).max(2000),
  })
  .strict();
export type VoiceSpeakFallbackResponse = z.infer<
  typeof VoiceSpeakFallbackResponseSchema
>;

export const VoicePreferencesSchema = z
  .object({
    sttProviderId: z.uuid().nullable().optional(),
    ttsProviderId: z.uuid().nullable().optional(),
    ttsVoice: z.string().trim().min(1).max(64).default("alloy"),
    ttsSpeed: z.number().min(0.75).max(1.5).default(1),
    ttsInstructions: z.string().trim().max(400).optional(),
    autoPlayInVoiceMode: z.boolean().default(true),
    fallbackToBrowserSpeech: z.boolean().default(true),
  })
  .strict();
export type VoicePreferences = z.infer<typeof VoicePreferencesSchema>;
