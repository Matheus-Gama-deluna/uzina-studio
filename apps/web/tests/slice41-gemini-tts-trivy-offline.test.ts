import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { encryptSecret } from "@uzina/core";
import { closeDb, getDb, providerProfiles, users } from "@uzina/db";
import {
  synthesizeSpeechWithVault,
  wrapPcm16MonoToWav,
} from "@uzina/mastra-runtime";
import { buildTrivyFsArgs } from "@uzina/security-engine";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { POST as authPost } from "../src/app/api/auth/[...all]/route";
import { GET as getClients } from "../src/app/api/clients/route";
import { resetAuthForTests } from "../src/lib/auth";
import { getServerMasterKey } from "../src/lib/vault";

function cookieOf(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]?.trim() ?? "")
    .filter(Boolean)
    .join("; ");
}

describe("Slice 41 — Google Gemini Neural TTS & Trivy Offline Cache", () => {
  let organizationId = "";
  let googleProviderId = "";

  beforeAll(async () => {
    resetAuthForTests();
    await closeDb();

    const email = `s41-${Date.now()}@uzina.studio`;
    const signUpRes = await authPost(
      new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          name: "Slice 41 QA",
          email,
          password: "StrongPassword!123",
        }),
      })
    );
    expect(signUpRes.status).toBe(200);
    const cookie = cookieOf(signUpRes);

    await getClients(
      new Request("http://localhost:3000/api/clients", {
        headers: { cookie },
      })
    );

    const { db } = await getDb();
    const [ownerRow] = await db
      .select()
      .from(users)
      .where(eq(users.email, email));
    organizationId = ownerRow!.organizationId!;

    const encryptedApiKey = encryptSecret({
      plaintext: "AIza-fake-gemini-key-s41-tts",
      masterKey: getServerMasterKey(),
      organizationId,
      providerType: "google",
    });

    const [inserted] = await db
      .insert(providerProfiles)
      .values({
        organizationId,
        name: "Google Gemini S41 TTS",
        providerType: "google",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        encryptedApiKey,
        keyPreview: "AIza...tts",
        isDefault: true,
      })
      .returning();
    googleProviderId = inserted!.id;
  });

  afterAll(async () => {
    resetAuthForTests();
    await closeDb();
  });

  test("wrapPcm16MonoToWav gera cabeçalho RIFF/WAVE válido de 44 bytes com sampleRate 24000", () => {
    const pcmPayload = Buffer.from([0x10, 0x20, 0x30, 0x40, 0x50, 0x60]);
    const wav = wrapPcm16MonoToWav(pcmPayload, 24000);

    expect(wav.length).toBe(44 + pcmPayload.length);
    expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(wav.readUInt32LE(4)).toBe(36 + pcmPayload.length);
    expect(wav.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(wav.readUInt16LE(20)).toBe(1);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.subarray(36, 40).toString("ascii")).toBe("data");
    expect(wav.readUInt32LE(40)).toBe(pcmPayload.length);
    expect(wav.subarray(44)).toEqual(pcmPayload);
  });

  test("synthesizeSpeechWithVault usa Gemini 2.5 Flash TTS via x-goog-api-key e converte PCM L16 para audio/wav", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: Record<string, unknown> = {};
    const pcmSample = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);

    const result = await synthesizeSpeechWithVault({
      db: (await getDb()).db,
      organizationId,
      masterKey: getServerMasterKey(),
      text: "Entrega pronta para sua aprovação.",
      voice: "aoede",
      providerId: googleProviderId,
      fetchImpl: async (input, init) => {
        capturedUrl = String(input);
        const h = new Headers(init?.headers);
        capturedHeaders = {
          apiKey: h.get("x-goog-api-key") ?? "",
          contentType: h.get("content-type") ?? "",
        };
        capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<
          string,
          unknown
        >;
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      inlineData: {
                        mimeType: "audio/L16;codec=pcm;rate=24000",
                        data: pcmSample.toString("base64"),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        );
      },
    });

    expect(capturedUrl).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent"
    );
    expect(capturedUrl).not.toContain("?key=");
    expect(capturedHeaders.apiKey).toBe("AIza-fake-gemini-key-s41-tts");
    expect(capturedHeaders.contentType).toBe("application/json");
    const genCfg = capturedBody.generationConfig as {
      responseModalities?: string[];
      speechConfig?: {
        voiceConfig?: { prebuiltVoiceConfig?: { voiceName?: string } };
      };
    };
    expect(genCfg.responseModalities).toEqual(["AUDIO"]);
    expect(genCfg.speechConfig?.voiceConfig?.prebuiltVoiceConfig?.voiceName).toBe(
      "Aoede"
    );

    expect(result.mode).toBe("audio");
    if (result.mode === "audio") {
      expect(result.contentType).toBe("audio/wav");
      expect(result.providerType).toBe("google");
      expect(result.model).toBe("gemini-2.5-flash-preview-tts");
      expect(result.audioBuffer.subarray(0, 4).toString("ascii")).toBe("RIFF");
      expect(result.audioBuffer.subarray(44)).toEqual(pcmSample);
    }
  });

  test("synthesizeSpeechWithVault com provedor google retorna fallback gracioso em erro HTTP", async () => {
    const result = await synthesizeSpeechWithVault({
      db: (await getDb()).db,
      organizationId,
      masterKey: getServerMasterKey(),
      text: "Teste de falha controlada.",
      providerId: googleProviderId,
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: { message: "quota exceeded" } }), {
          status: 429,
          headers: { "content-type": "application/json" },
        }),
    });

    expect(result).toEqual({
      mode: "fallback_browser_speech",
      reason: "tts_http_429",
    });
  });

  test.each([
    {
      label: "sem db em cache nem modo offline",
      createCachedDb: false,
      offlineFlag: undefined,
      expectSkipDbUpdate: false,
      expectOfflineScan: false,
    },
    {
      label: "com db/trivy.db presente em cache",
      createCachedDb: true,
      offlineFlag: undefined,
      expectSkipDbUpdate: true,
      expectOfflineScan: false,
    },
    {
      label: "com UZINA_TRIVY_OFFLINE=1",
      createCachedDb: false,
      offlineFlag: "1",
      expectSkipDbUpdate: true,
      expectOfflineScan: true,
    },
  ])(
    "buildTrivyFsArgs ajusta flags de cache/offline corretamente ($label)",
    ({ createCachedDb, offlineFlag, expectSkipDbUpdate, expectOfflineScan }) => {
      const tmpDataDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "uzina-trivy-cache-test-")
      );
      try {
        const expectedCacheDir = path.join(tmpDataDir, "trivy-cache");
        if (createCachedDb) {
          fs.mkdirSync(path.join(expectedCacheDir, "db"), { recursive: true });
          fs.writeFileSync(
            path.join(expectedCacheDir, "db", "trivy.db"),
            "sqlite-stub",
            "utf8"
          );
        }

        const args = buildTrivyFsArgs("/repo/target", {
          UZINA_DATA_DIR: tmpDataDir,
          ...(offlineFlag ? { UZINA_TRIVY_OFFLINE: offlineFlag } : {}),
        });

        expect(args.slice(-2)).toEqual(["--", "/repo/target"]);
        expect(args).toContain("--cache-dir");
        expect(args[args.indexOf("--cache-dir") + 1]).toBe(expectedCacheDir);
        expect(args.includes("--skip-db-update")).toBe(expectSkipDbUpdate);
        expect(args.includes("--offline-scan")).toBe(expectOfflineScan);
      } finally {
        fs.rmSync(tmpDataDir, { recursive: true, force: true });
      }
    }
  );
});
