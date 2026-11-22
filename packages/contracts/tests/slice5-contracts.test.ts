import { describe, expect, test } from "vitest";
import {
  CopilotCapabilitiesSchema,
  CopilotChatRequestSchema,
  CopilotStreamEventSchema,
  CreateMemorySchema,
  MemorySchema,
  UpdateMemorySchema,
} from "../src/index.js";

describe("Slice 5 contracts — Memories & Executive Copilot", () => {
  const validUuid = "11111111-1111-4111-8111-111111111111";

  test.each([
    {
      name: "valid org architecture memory",
      input: {
        scopeType: "org",
        scopeId: validUuid,
        category: "architecture",
        title: "Padrão Drizzle Dual-Mode",
        content: "Usar PGlite local e PostgreSQL em produção.",
      },
      ok: true,
    },
    {
      name: "valid client convention memory",
      input: {
        scopeType: "client",
        scopeId: validUuid,
        category: "convention",
        title: "Idioma UI",
        content: "Mensagens ao usuário sempre em pt-BR.",
        sourceDeliverableId: validUuid,
      },
      ok: true,
    },
    {
      name: "rejects invalid category",
      input: {
        scopeType: "project",
        scopeId: validUuid,
        category: "arbitrary_rule",
        title: "Regra",
        content: "Conteúdo válido",
      },
      ok: false,
    },
    {
      name: "rejects extra property in strict CreateMemorySchema",
      input: {
        scopeType: "org",
        scopeId: validUuid,
        category: "domain_rule",
        title: "Regra",
        content: "Conteúdo válido",
        organizationId: validUuid,
      },
      ok: false,
    },
  ])("CreateMemorySchema ($name)", ({ input, ok }) => {
    expect(CreateMemorySchema.safeParse(input).success).toBe(ok);
  });

  test.each([
    {
      name: "rejects empty update object",
      input: {},
      ok: false,
    },
    {
      name: "accepts title update",
      input: { title: "Novo título de convenção" },
      ok: true,
    },
  ])("UpdateMemorySchema ($name)", ({ input, ok }) => {
    expect(UpdateMemorySchema.safeParse(input).success).toBe(ok);
  });

  test("validates MemorySchema, CopilotChatRequestSchema, CopilotStreamEventSchema and CopilotCapabilitiesSchema", () => {
    expect(
      MemorySchema.safeParse({
        id: validUuid,
        organizationId: validUuid,
        scopeType: "project",
        scopeId: validUuid,
        category: "security_triage",
        title: "Supressão documentada",
        content: "Falso positivo validado para fixture.",
        sourceDeliverableId: null,
        createdAt: "2026-11-22T10:00:00.000Z",
        updatedAt: "2026-11-22T10:00:00.000Z",
      }).success
    ).toBe(true);

    expect(
      CopilotChatRequestSchema.safeParse({
        messages: [{ role: "user", content: "Resuma o estado do workspace" }],
        projectId: validUuid,
      }).success
    ).toBe(true);

    expect(
      CopilotChatRequestSchema.safeParse({
        messages: [],
      }).success
    ).toBe(false);

    expect(
      CopilotStreamEventSchema.safeParse({
        type: "token",
        text: "Resumo executivo",
      }).success
    ).toBe(true);

    expect(
      CopilotCapabilitiesSchema.safeParse({
        agentId: "executive_copilot",
        allowedTools: ["read_workspace_overview", "draft_deliverable"],
        forbiddenCapabilities: ["fs_write", "shell_exec", "status_merged"],
        actorRole: "owner",
      }).success
    ).toBe(true);
  });
});
