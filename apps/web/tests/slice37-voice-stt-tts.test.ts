import {
  VoiceSpeakFallbackResponseSchema,
  VoiceTranscribeResponseSchema,
} from "@uzina/contracts";
import { encryptSecret } from "@uzina/core";
import { closeDb, getDb, providerProfiles, users } from "@uzina/db";
import {
  buildSpokenSummary,
  synthesizeSpeechWithVault,
  transcribeAudioWithVault,
} from "@uzina/mastra-runtime";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { POST as authPost } from "../src/app/api/auth/[...all]/route";
import { GET as getClients } from "../src/app/api/clients/route";
import { POST as speakPost } from "../src/app/api/voice/speak/route";
import { POST as transcribePost } from "../src/app/api/voice/transcribe/route";
import { resetAuthForTests } from "../src/lib/auth";
import { getServerMasterKey } from "../src/lib/vault";

function cookieOf(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]?.trim() ?? "")
    .filter(Boolean)
    .join("; ");
}

describe("Slice 37 — Voz Bidirecional (STT, TTS, Resumo Falado & Segurança de Upload)", () => {
  let ownerCookie = "";
  let organizationId = "";

  beforeAll(async () => {
    resetAuthForTests();
    await closeDb();

    const signUpRes = await authPost(
      new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Voice Owner",
          email: "voice-s37@uzina.studio",
          password: "StrongPassword!123",
        }),
      })
    );
    expect(signUpRes.status).toBe(200);
    ownerCookie = cookieOf(signUpRes);

    await getClients(
      new Request("http://localhost:3000/api/clients", {
        headers: { cookie: ownerCookie },
      })
    );

    const { db } = await getDb();
    const [ownerRow] = await db
      .select()
      .from(users)
      .where(eq(users.email, "voice-s37@uzina.studio"));
    organizationId = ownerRow?.organizationId ?? "";
    expect(organizationId.length).toBeGreaterThan(10);
  });

  afterAll(async () => {
    resetAuthForTests();
    await closeDb();
  });

  test.each([
    {
      label: "remove blocos de código fenced e links longos",
      input:
        "## Resumo\nConcluí o **endpoint** de autenticação.\n```ts\nconst x = 1;\n```\nVeja [a documentação](https://example.com/docs/muito/longo) para detalhes.",
      mustContain: ["Resumo", "Concluí o endpoint de autenticação", "a documentação"],
      mustNotContain: ["```", "const x = 1", "https://example.com"],
    },
    {
      label: "remove tabelas Markdown mantendo frases objetivas",
      input:
        "| Slice | Status |\n| --- | --- |\n| S37 | OK |\nPronto para validar a entrega no estúdio.",
      mustContain: ["Pronto para validar a entrega no estúdio."],
      mustNotContain: ["| Slice |", "| --- |"],
    },
    {
      label: "retorna fallback seguro quando conteúdo tem apenas código",
      input: "```bash\npnpm verify\n```",
      mustContain: ["Resumo técnico disponível na tela."],
      mustNotContain: ["pnpm verify"],
    },
  ])(
    "buildSpokenSummary $label",
    ({ input, mustContain, mustNotContain }) => {
      const summary = buildSpokenSummary(input, 420);
      expect(summary.length).toBeLessThanOrEqual(420);
      for (const expected of mustContain) {
        expect(summary).toContain(expected);
      }
      for (const forbidden of mustNotContain) {
        expect(summary).not.toContain(forbidden);
      }
    }
  );

  test("POST /api/voice/transcribe exige autenticação (401) e valida arquivo/MIME/tamanho (400)", async () => {
    const formUnauth = new FormData();
    formUnauth.append(
      "file",
      new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }),
      "nota.webm"
    );
    const unauthRes = await transcribePost(
      new Request("http://localhost:3000/api/voice/transcribe", {
        method: "POST",
        body: formUnauth,
      })
    );
    expect(unauthRes.status).toBe(401);

    const emptyForm = new FormData();
    emptyForm.append("file", new Blob([], { type: "audio/webm" }), "vazio.webm");
    const emptyRes = await transcribePost(
      new Request("http://localhost:3000/api/voice/transcribe", {
        method: "POST",
        headers: { cookie: ownerCookie },
        body: emptyForm,
      })
    );
    expect(emptyRes.status).toBe(400);
    expect(((await emptyRes.json()) as { code?: string }).code).toBe(
      "INVALID_AUDIO_SIZE"
    );

    const tooBigForm = new FormData();
    tooBigForm.append(
      "file",
      new Blob([new Uint8Array(15 * 1024 * 1024 + 1)], { type: "audio/webm" }),
      "gigante.webm"
    );
    const tooBigRes = await transcribePost(
      new Request("http://localhost:3000/api/voice/transcribe", {
        method: "POST",
        headers: { cookie: ownerCookie },
        body: tooBigForm,
      })
    );
    expect(tooBigRes.status).toBe(400);
    expect(((await tooBigRes.json()) as { code?: string }).code).toBe(
      "INVALID_AUDIO_SIZE"
    );

    const invalidMimeForm = new FormData();
    invalidMimeForm.append(
      "file",
      new Blob([new Uint8Array([1, 2, 3])], { type: "application/x-msdownload" }),
      "bad.exe"
    );
    const badMimeRes = await transcribePost(
      new Request("http://localhost:3000/api/voice/transcribe", {
        method: "POST",
        headers: { cookie: ownerCookie },
        body: invalidMimeForm,
      })
    );
    expect(badMimeRes.status).toBe(400);
    const badMimeBody = (await badMimeRes.json()) as { code?: string };
    expect(badMimeBody.code).toBe("UNSUPPORTED_AUDIO_MIME");
  });

  test("POST /api/voice/speak valida Zod (400), 401 sem auth, cacheia em LRU (miss -> hit) e cai em fallback sem provedor", async () => {
    const unauthSpeak = await speakPost(
      new Request("http://localhost:3000/api/voice/speak", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "Sem auth" }),
      })
    );
    expect(unauthSpeak.status).toBe(401);

    const badRes = await speakPost(
      new Request("http://localhost:3000/api/voice/speak", {
        method: "POST",
        headers: {
          cookie: ownerCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ text: "" }),
      })
    );
    expect(badRes.status).toBe(400);

    const fallbackRes = await speakPost(
      new Request("http://localhost:3000/api/voice/speak", {
        method: "POST",
        headers: {
          cookie: ownerCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ text: "Decisão aprovada na caixa." }),
      })
    );
    expect(fallbackRes.status).toBe(200);
    const parsed = VoiceSpeakFallbackResponseSchema.parse(
      await fallbackRes.json()
    );
    expect(parsed.fallback).toBe("browser_speech");
    expect(parsed.reason).toBe("no_tts_provider");

    // Insere provedor e intercepta fetch global na borda para testar miss -> hit no cache LRU
    const { db } = await getDb();
    const masterKey = getServerMasterKey();
    const encryptedApiKey = encryptSecret({
      plaintext: "sk-openai-cache-test-key",
      masterKey,
      organizationId,
      providerType: "openai_compatible",
    });
    const [ttsProvider] = await db
      .insert(providerProfiles)
      .values({
        organizationId,
        name: "OpenAI Cache Test",
        providerType: "openai_compatible",
        baseUrl: "https://api.openai.com/v1",
        encryptedApiKey,
        keyPreview: "sk-...test",
        isDefault: true,
      })
      .returning();

    const originalFetch = globalThis.fetch;
    let upstreamCalls = 0;
    globalThis.fetch = (async () => {
      upstreamCalls += 1;
      return new Response(new Uint8Array([73, 68, 51, 9]), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      });
    }) as typeof fetch;

    try {
      const reqBody = JSON.stringify({
        text: "Áudio com cache LRU ativo.",
        providerId: ttsProvider!.id,
      });
      const firstRes = await speakPost(
        new Request("http://localhost:3000/api/voice/speak", {
          method: "POST",
          headers: { cookie: ownerCookie, "content-type": "application/json" },
          body: reqBody,
        })
      );
      expect(firstRes.status).toBe(200);
      expect(firstRes.headers.get("x-voice-cache")).toBe("miss");
      expect(firstRes.headers.get("content-type")).toBe("audio/mpeg");

      const secondRes = await speakPost(
        new Request("http://localhost:3000/api/voice/speak", {
          method: "POST",
          headers: { cookie: ownerCookie, "content-type": "application/json" },
          body: reqBody,
        })
      );
      expect(secondRes.status).toBe(200);
      expect(secondRes.headers.get("x-voice-cache")).toBe("hit");
      expect(upstreamCalls).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("transcribeAudioWithVault e synthesizeSpeechWithVault operam com Cofre AES-256-GCM (Groq/OpenAI) e redigem segredos", async () => {
    const { db } = await getDb();
    const masterKey = getServerMasterKey();
    const fakeKey = "sk-groq-secret-voice-999999";
    const encryptedApiKey = encryptSecret({
      plaintext: fakeKey,
      masterKey,
      organizationId,
      providerType: "openai_compatible",
    });

    const [inserted] = await db
      .insert(providerProfiles)
      .values({
        organizationId,
        name: "Groq Voice Test",
        providerType: "openai_compatible",
        baseUrl: "https://api.groq.com/openai/v1",
        encryptedApiKey,
        keyPreview: "sk-...9999",
        isDefault: true,
      })
      .returning();

    let capturedSttUrl = "";
    let capturedAuth = "";
    const sttResult = await transcribeAudioWithVault({
      db,
      organizationId,
      masterKey,
      audioBuffer: Buffer.from("audio-bytes-mp4"),
      mimeType: "audio/mp4",
      fileName: "nota.m4a",
      providerId: inserted!.id,
      fetchImpl: async (input, init) => {
        capturedSttUrl = String(input);
        const hdrs = (init?.headers ?? {}) as Record<string, string>;
        capturedAuth = hdrs.Authorization ?? "";
        return new Response(
          JSON.stringify({
            text: `Criar slice usando chave ${fakeKey} no painel`,
            duration: 4.2,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
    });

    expect(capturedSttUrl).toBe(
      "https://api.groq.com/openai/v1/audio/transcriptions"
    );
    expect(capturedAuth).toBe(`Bearer ${fakeKey}`);
    const parsedStt = VoiceTranscribeResponseSchema.parse(sttResult);
    expect(parsedStt.model).toBe("whisper-large-v3-turbo");
    expect(parsedStt.text).not.toContain(fakeKey);
    expect(parsedStt.text).toContain("Criar slice");

    const ttsResult = await synthesizeSpeechWithVault({
      db,
      organizationId,
      masterKey,
      text: "Briefing curto pronto para aprovação.",
      providerId: inserted!.id,
      fetchImpl: async () =>
        new Response(new Uint8Array([73, 68, 51, 3]), {
          status: 200,
          headers: { "content-type": "audio/mpeg" },
        }),
    });

    expect(ttsResult.mode).toBe("audio");
    if (ttsResult.mode === "audio") {
      expect(ttsResult.contentType).toBe("audio/mpeg");
      expect(ttsResult.audioBuffer.byteLength).toBe(4);
    }
  });
});
