import fs from "node:fs";
import path from "node:path";
import { resolveDataDir } from "@uzina/db";
import * as webpushNs from "web-push";

type WebPushApi = typeof import("web-push");
const webpush: WebPushApi =
  "default" in webpushNs && webpushNs.default
    ? (webpushNs.default as WebPushApi)
    : (webpushNs as WebPushApi);

export interface VapidKeyPair {
  publicKey: string;
  privateKey: string;
  subject: string;
  source: "env" | "file" | "ephemeral";
}

const VAPID_CACHE_KEY = Symbol.for("@uzina/web/vapidKeys");

function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

export function resolveVapidKeys(
  env: Record<string, string | undefined> = process.env,
  explicitDataDir?: string
): VapidKeyPair {
  const envPublic = env.VAPID_PUBLIC_KEY?.trim();
  const envPrivate = env.VAPID_PRIVATE_KEY?.trim();
  const subject = env.VAPID_SUBJECT?.trim() || "mailto:admin@uzina.local";

  if (envPublic && envPrivate) {
    return {
      publicKey: envPublic,
      privateKey: envPrivate,
      subject,
      source: "env",
    };
  }

  const dataDir = explicitDataDir ?? resolveDataDir(env);
  if (dataDir !== ":memory:" && !isBuildPhase()) {
    const filePath = path.join(dataDir, ".vapid-keys.json");
    fs.mkdirSync(dataDir, { recursive: true });
    try {
      const generated = webpush.generateVAPIDKeys();
      const payload = JSON.stringify(
        {
          publicKey: generated.publicKey,
          privateKey: generated.privateKey,
          subject,
          createdAt: new Date().toISOString(),
        },
        null,
        2
      );
      fs.writeFileSync(filePath, payload, { flag: "wx", mode: 0o600 });
      return {
        publicKey: generated.publicKey,
        privateKey: generated.privateKey,
        subject,
        source: "file",
      };
    } catch (error: unknown) {
      const code = (error as { code?: string }).code;
      if (code === "EEXIST") {
        try {
          fs.chmodSync(filePath, 0o600);
        } catch {
          // Windows pode ignorar bits POSIX
        }
        try {
          const raw = fs.readFileSync(filePath, "utf8");
          const parsed = JSON.parse(raw) as {
            publicKey?: string;
            privateKey?: string;
            subject?: string;
          };
          if (parsed.publicKey && parsed.privateKey) {
            return {
              publicKey: parsed.publicKey,
              privateKey: parsed.privateKey,
              subject: parsed.subject || subject,
              source: "file",
            };
          }
        } catch {
          throw new Error(".vapid-keys.json inválido ou corrompido.");
        }
      }
    }
  }

  const holder = globalThis as Record<symbol, VapidKeyPair | undefined>;
  if (!holder[VAPID_CACHE_KEY]) {
    const generated = webpush.generateVAPIDKeys();
    holder[VAPID_CACHE_KEY] = {
      publicKey: generated.publicKey,
      privateKey: generated.privateKey,
      subject,
      source: "ephemeral",
    };
  }
  return holder[VAPID_CACHE_KEY];
}

export function resetVapidKeysCacheForTests(): void {
  const holder = globalThis as Record<symbol, unknown>;
  delete holder[VAPID_CACHE_KEY];
}
