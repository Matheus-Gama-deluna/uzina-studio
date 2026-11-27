import fs from "node:fs";
import { encryptSecret } from "@uzina/core";
import { closeDb, getDb, providerProfiles, users } from "@uzina/db";
import { transcribeAudioWithVault } from "@uzina/mastra-runtime";
import {
  EXTERNAL_SCANNER_SPECS,
  resolveBundledOpengrepRulesPath,
} from "@uzina/security-engine";
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

describe("Slice 39 — Estabilização Pós-Auditoria (4 Bugs P1)", () => {
  let organizationId = "";
  let googleProviderId = "";

  beforeAll(async () => {
    resetAuthForTests();
    await closeDb();

    const signUpRes = await authPost(
      new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          name: "Slice 39 QA",
          email: `s39-${Date.now()}@uzina.studio`,
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
      .orderBy(users.createdAt);
    organizationId = ownerRow!.organizationId!;

    const encryptedApiKey = encryptSecret({
      plaintext: "AIza-fake-gemini-key-s39-1234",
      masterKey: getServerMasterKey(),
      organizationId,
      providerType: "google",
    });

    const [inserted] = await db
      .insert(providerProfiles)
      .values({
        organizationId,
        name: "Google Gemini S39",
        providerType: "google",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        encryptedApiKey,
        keyPreview: "AIza...1234",
        isDefault: true,
      })
      .returning();
    googleProviderId = inserted!.id;
  });

  afterAll(async () => {
    resetAuthForTests();
    await closeDb();
  });

  test("P1 #1: STT Gemini envia thinkingBudget=0 e filtra blocos thought=true da transcrição", async () => {
    let capturedBody: Record<string, unknown> = {};
    const result = await transcribeAudioWithVault({
      db: (await getDb()).db,
      organizationId,
      masterKey: getServerMasterKey(),
      audioBuffer: Buffer.from("audio-wav-mock"),
      mimeType: "audio/wav",
      language: "pt",
      providerId: googleProviderId,
      fetchImpl: async (_url, init) => {
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
                      thought: true,
                      text: "think\nThe user wants an exact transcription of Portuguese audio.",
                    },
                    {
                      text: "Criar modulo financeiro da Clinica VidaPlena.",
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
    });

    const genCfg = capturedBody.generationConfig as {
      thinkingConfig?: { thinkingBudget?: number };
    };
    expect(genCfg?.thinkingConfig?.thinkingBudget).toBe(0);
    expect(result.text).toBe("Criar modulo financeiro da Clinica VidaPlena.");
    expect(result.text).not.toContain("The user wants");
  });

  test("P1 #1 (negativo): STT Gemini devolve texto vazio se só houver thought=true e propaga erro HTTP", async () => {
    const onlyThoughtResult = await transcribeAudioWithVault({
      db: (await getDb()).db,
      organizationId,
      masterKey: getServerMasterKey(),
      audioBuffer: Buffer.from("audio-wav-mock"),
      mimeType: "audio/wav",
      language: "pt",
      providerId: googleProviderId,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ thought: true, text: "internal thinking only" }],
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        ),
    });
    expect(onlyThoughtResult.text).toBe("");
    expect(onlyThoughtResult.text).not.toContain("internal thinking");

    await expect(
      transcribeAudioWithVault({
        db: (await getDb()).db,
        organizationId,
        masterKey: getServerMasterKey(),
        audioBuffer: Buffer.from("audio-wav-mock"),
        mimeType: "audio/wav",
        language: "pt",
        providerId: googleProviderId,
        fetchImpl: async () =>
          new Response("Service Unavailable", { status: 503 }),
      })
    ).rejects.toThrow(/503/);
  });

  test("P1 #2: opengrep_semgrep passa --config local (uzina-sast-core.yaml) sem depender de semgrep.dev", () => {
    const rulesPath = resolveBundledOpengrepRulesPath();
    expect(fs.existsSync(rulesPath)).toBe(true);
    expect(rulesPath.endsWith("uzina-sast-core.yaml")).toBe(true);

    const spec = EXTERNAL_SCANNER_SPECS.find(
      (s) => s.id === "opengrep_semgrep"
    );
    expect(spec?.id).toBe("opengrep_semgrep");
    const args = spec!.buildArgs("/tmp/legacypay");
    const cfgIdx = args.indexOf("--config");
    expect(cfgIdx).toBeGreaterThanOrEqual(0);
    expect(args[cfgIdx + 1]).toBe(rulesPath);
    expect(args).toContain("--");
    expect(args.at(-1)).toBe("/tmp/legacypay");
  });
});
