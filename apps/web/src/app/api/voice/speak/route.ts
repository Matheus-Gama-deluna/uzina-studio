import crypto from "node:crypto";
import { VoiceSpeakRequestSchema } from "@uzina/contracts";
import { getDb } from "@uzina/db";
import { synthesizeSpeechWithVault } from "@uzina/mastra-runtime";
import { NextResponse } from "next/server";
import { parseJsonBody } from "@/lib/api-utils";
import { READ_ROLES, requireOrgRole } from "@/lib/rbac";
import { tryGetServerMasterKey } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CachedTtsEntry {
  buffer: Buffer;
  contentType: string;
  expiresAt: number;
}

const TTS_CACHE_KEY = Symbol.for("@uzina/web/ttsCache");
const TTS_TTL_MS = 5 * 60 * 1000;
const TTS_MAX_ENTRIES = 64;

function getTtsCache(): Map<string, CachedTtsEntry> {
  const holder = globalThis as Record<
    symbol,
    Map<string, CachedTtsEntry> | undefined
  >;
  if (!holder[TTS_CACHE_KEY]) {
    holder[TTS_CACHE_KEY] = new Map<string, CachedTtsEntry>();
  }
  return holder[TTS_CACHE_KEY];
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireOrgRole(request, READ_ROLES);
  if (!auth.ok) return auth.response;

  const parsed = await parseJsonBody(request, VoiceSpeakRequestSchema);
  if (!parsed.ok) return parsed.response;

  const { text, voice, speed, instructions, providerId } = parsed.data;
  const cacheKey = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        org: auth.actor.organizationId,
        text,
        voice: voice ?? "alloy",
        speed: speed ?? 1,
        instructions: instructions ?? "",
        providerId: providerId ?? "",
      })
    )
    .digest("hex");

  const cache = getTtsCache();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return new Response(new Uint8Array(cached.buffer), {
      status: 200,
      headers: {
        "Content-Type": cached.contentType,
        "Cache-Control": "private, max-age=300",
        "X-Voice-Cache": "hit",
      },
    });
  }

  const { db } = await getDb();
  const result = await synthesizeSpeechWithVault({
    db,
    organizationId: auth.actor.organizationId,
    masterKey: tryGetServerMasterKey(),
    text,
    voice,
    speed,
    instructions,
    providerId,
  });

  if (result.mode === "fallback_browser_speech") {
    return NextResponse.json(
      {
        fallback: "browser_speech" as const,
        reason: result.reason,
        text,
      },
      { status: 200 }
    );
  }

  const safeContentType = result.contentType
    .split(";")[0]
    ?.trim()
    .toLowerCase()
    .startsWith("audio/")
    ? result.contentType
    : "audio/mpeg";

  if (cache.size >= TTS_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(cacheKey, {
    buffer: result.audioBuffer,
    contentType: safeContentType,
    expiresAt: Date.now() + TTS_TTL_MS,
  });

  return new Response(new Uint8Array(result.audioBuffer), {
    status: 200,
    headers: {
      "Content-Type": safeContentType,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "X-Voice-Cache": "miss",
    },
  });
}
