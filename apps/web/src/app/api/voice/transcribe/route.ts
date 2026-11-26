import {
  ALLOWED_AUDIO_MIME_TYPES,
  MAX_AUDIO_UPLOAD_BYTES,
} from "@uzina/contracts";
import { redactSensitiveText } from "@uzina/core";
import { getDb } from "@uzina/db";
import { transcribeAudioWithVault } from "@uzina/mastra-runtime";
import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "@/lib/api-utils";
import { READ_ROLES, requireOrgRole } from "@/lib/rbac";
import { tryGetServerMasterKey } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TranscribeFormMetaSchema = z.object({
  language: z.string().trim().min(1).max(16).default("pt"),
  providerId: z.uuid().optional(),
});

function isAllowedAudioMime(rawMime: string): boolean {
  const base = rawMime.split(";")[0]?.trim().toLowerCase() ?? "";
  return (ALLOWED_AUDIO_MIME_TYPES as readonly string[]).includes(base);
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireOrgRole(request, READ_ROLES);
  if (!auth.ok) return auth.response;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError(400, {
      error: "Envio multipart/form-data inválido.",
      code: "INVALID_FORM_DATA",
    });
  }

  const fileEntry = formData.get("file");
  if (!fileEntry || typeof fileEntry === "string") {
    return jsonError(400, {
      error: "Arquivo de áudio obrigatório no campo 'file'.",
      code: "MISSING_AUDIO_FILE",
    });
  }

  if (fileEntry.size <= 0 || fileEntry.size > MAX_AUDIO_UPLOAD_BYTES) {
    return jsonError(400, {
      error: "Áudio vazio ou excede o limite de 15 MB.",
      code: "INVALID_AUDIO_SIZE",
    });
  }

  const mimeType = fileEntry.type || "audio/webm";
  if (!isAllowedAudioMime(mimeType)) {
    return jsonError(400, {
      error: `Formato de áudio não suportado: ${mimeType}`,
      code: "UNSUPPORTED_AUDIO_MIME",
    });
  }

  const rawLanguage = formData.get("language");
  const rawProviderId = formData.get("providerId");
  const metaParsed = TranscribeFormMetaSchema.safeParse({
    language:
      typeof rawLanguage === "string" && rawLanguage.trim()
        ? rawLanguage
        : undefined,
    providerId:
      typeof rawProviderId === "string" && rawProviderId.trim()
        ? rawProviderId
        : undefined,
  });
  if (!metaParsed.success) {
    return jsonError(400, {
      error: metaParsed.error.issues[0]?.message ?? "Metadados de voz inválidos.",
      code: "VALIDATION_ERROR",
    });
  }
  const { language, providerId } = metaParsed.data;

  try {
    const arrayBuffer = await fileEntry.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);
    const { db } = await getDb();
    const result = await transcribeAudioWithVault({
      db,
      organizationId: auth.actor.organizationId,
      masterKey: tryGetServerMasterKey(),
      audioBuffer,
      mimeType,
      fileName: fileEntry.name,
      language,
      providerId,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const message =
      err instanceof Error
        ? redactSensitiveText(err.message)
        : "Falha ao transcrever áudio.";
    return jsonError(422, {
      error: message,
      code: "TRANSCRIPTION_FAILED",
    });
  }
}
