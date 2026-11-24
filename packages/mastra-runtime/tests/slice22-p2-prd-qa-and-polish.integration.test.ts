import crypto from "node:crypto";
import {
  MastraLanguageModelV2Mock,
  simulateReadableStream,
} from "@mastra/core/test-utils/llm-mock";
import {
  clients,
  closeDb,
  deliverables,
  ensureDefaultOrgAndInternalClient,
  getDb,
  memories,
  projects,
  type UzinaDb,
} from "@uzina/db";
import { asc, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  handleAgencyChatScoped,
  resetAgentControllerForTests,
  resetMastraStorageForTests,
} from "../src/index.js";

function createPrdQaMockModel(replyText: string) {
  const usage = {
    inputTokens: 85,
    outputTokens: 45,
    totalTokens: 130,
  };
  return new MastraLanguageModelV2Mock({
    provider: "mock-prd-provider",
    modelId: "mock-v2-prd",
    doGenerate: async () => ({
      content: [{ type: "text", text: replyText }],
      finishReason: "stop",
      usage,
      warnings: [],
      rawCall: { rawPrompt: null, rawSettings: {} },
      request: { body: {} },
      response: { headers: {} },
      stream: simulateReadableStream({ chunks: [] }),
    }),
    doStream: async () => ({
      rawCall: { rawPrompt: null, rawSettings: {} },
      warnings: [],
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          {
            type: "response-metadata",
            id: "id-s22-prd",
            modelId: "mock-v2-prd",
            timestamp: new Date(0),
          },
          { type: "text-start", id: "txt-1" },
          { type: "text-delta", id: "txt-1", delta: replyText },
          { type: "text-end", id: "txt-1" },
          { type: "finish", finishReason: "stop", usage },
        ],
      }),
    }),
  });
}

describe("@uzina/mastra-runtime — Slice 22 (P2 PRD Q+A & Sem Ponto Duplo)", () => {
  let db: UzinaDb;
  let organizationId: string;
  let userId: string;

  beforeAll(async () => {
    await resetMastraStorageForTests();
    resetAgentControllerForTests();
    await closeDb();
    const ctx = await getDb({ dataDir: ":memory:" });
    db = ctx.db;
    const seeded = await ensureDefaultOrgAndInternalClient(db);
    organizationId = seeded.organizationId;
    userId = seeded.ownerUserId;
  });

  afterAll(async () => {
    await resetMastraStorageForTests();
    resetAgentControllerForTests();
    await closeDb();
  });

  test("Alinhamento via chat grava Pergunta e Resposta (Q+A) no PRD Vivo redigindo segredos", async () => {
    const suffix = crypto.randomUUID().slice(0, 6);
    const [cli] = await db
      .insert(clients)
      .values({
        organizationId,
        name: `Cliente PRD S22 ${suffix}`,
        slug: `cli-prd-s22-${suffix}`,
      })
      .returning();
    const [proj] = await db
      .insert(projects)
      .values({
        clientId: cli!.id,
        name: `Projeto PRD Q+A ${suffix}`,
        slug: `proj-prd-qa-${suffix}`,
      })
      .returning();

    const secretToken = "sk-or-v1-leaktest1234567890abcdef";
    const mockModel = createPrdQaMockModel(
      `Definimos autenticação via token rotativo (${secretToken}) e auditoria por evento.`
    );

    const res = await handleAgencyChatScoped(db, {
      actor: { organizationId, userId, role: "owner" },
      modelOverride: mockModel,
      request: {
        message: `Como devemos tratar auditoria de sessão (${secretToken}) e expiração?`,
        intent: "general_chat",
        projectId: proj!.id,
        targetAgentRole: "software_architect",
        teamTopology: "lean_mvp",
        autonomyMode: "semi_autonomous",
      },
    });
    expect(res.executionMode).toBe("live_llm");

    const [savedMem] = await db
      .select()
      .from(memories)
      .where(eq(memories.scopeId, proj!.id))
      .orderBy(desc(memories.updatedAt))
      .limit(1);

    expect(savedMem?.content).toContain("**Pergunta / Direcionamento:**");
    expect(savedMem?.content).toContain("auditoria de sessão");
    expect(savedMem?.content).toContain("**Resposta (");
    expect(savedMem?.content).toContain("auditoria por evento");
    expect(savedMem?.content).not.toContain(secretToken);

    // Também testa no modo assistido local (sem modelOverride) com segredo na pergunta
    const localSecret = "sk-ant-api03-localquestionsecret99999";
    const localRes = await handleAgencyChatScoped(db, {
      actor: { organizationId, userId, role: "owner" },
      request: {
        message: `Confirmar estratégia de fallback offline (${localSecret})`,
        intent: "general_chat",
        projectId: proj!.id,
        teamTopology: "lean_mvp",
        autonomyMode: "semi_autonomous",
      },
    });
    expect(localRes.executionMode).toBe("local_assisted");

    const memRows = await db
      .select()
      .from(memories)
      .where(eq(memories.scopeId, proj!.id))
      .orderBy(desc(memories.createdAt));
    expect(memRows).toHaveLength(2);
    const localMem = memRows.find((m) =>
      m.content.includes("Confirmar estratégia de fallback offline")
    );
    expect(localMem?.content).toContain("**Pergunta / Direcionamento:**");
    expect(localMem?.content).toContain("**Resposta (");
    expect(localMem?.content).not.toContain(localSecret);
  });

  test.each([
    "Criar plataforma de gestão de reservas para hotéis boutique com check-in digital.",
    "Criar plataforma de gestão de reservas para hotéis boutique com check-in digital...",
  ])(
    "start_greenfield sem ponto duplo ('..') para prompt '%s'",
    async (promptWithDot) => {
      const res = await handleAgencyChatScoped(db, {
        actor: { organizationId, userId, role: "owner" },
        request: {
          message: promptWithDot,
          intent: "start_greenfield",
          projectName: "HotelBoutique S22",
          teamTopology: "lean_mvp",
          autonomyMode: "semi_autonomous",
        },
      });

      const projectId = res.projectState?.projectId;
      expect(projectId).toBeTypeOf("string");

      const rows = await db
        .select()
        .from(deliverables)
        .where(eq(deliverables.projectId, projectId!))
        .orderBy(asc(deliverables.createdAt));
      expect(rows).toHaveLength(3);
      expect(rows[0]?.description ?? "").toContain(
        "Criar plataforma de gestão de reservas para hotéis boutique com check-in digital."
      );
      for (const row of rows) {
        expect(row.description ?? "").not.toContain("..");
      }
    }
  );
});
