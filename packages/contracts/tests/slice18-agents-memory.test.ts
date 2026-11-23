import { describe, expect, it } from "vitest";
import {
  AgencyChatRequestSchema,
  AgencyStreamEventSchema,
  AgencyThreadListResponseSchema,
  CopilotChatRequestSchema,
  CopilotStreamEventSchema,
  CreateProviderProfileSchema,
  ObservationalMemoryStatusSchema,
  TestProviderConnectionRequestSchema,
  TokenSavingsTechniqueSchema,
} from "../src/index.js";

const VALID_UUID = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-11-23T13:00:00.000Z";

describe("Slice 18 Contracts — Agentes Reais, Observational Memory & Guardrails", () => {
  it.each([
    {
      label: "ObservationalMemoryStatusSchema válido",
      schema: ObservationalMemoryStatusSchema,
      payload: {
        activeMessageTokens: 3200,
        messageTokensThreshold: 20000,
        activeObservationTokens: 840,
        observationTokensThreshold: 40000,
        generationCount: 1,
        bufferingStatus: "idle",
      },
      ok: true,
    },
    {
      label: "ObservationalMemoryStatusSchema rejeita campo extra (.strict())",
      schema: ObservationalMemoryStatusSchema,
      payload: {
        activeMessageTokens: 100,
        messageTokensThreshold: 20000,
        activeObservationTokens: 0,
        observationTokensThreshold: 40000,
        generationCount: 0,
        bufferingStatus: "running",
        extraLeak: true,
      },
      ok: false,
    },
    {
      label: "AgencyThreadListResponseSchema válido com metadados",
      schema: AgencyThreadListResponseSchema,
      payload: {
        threads: [
          {
            threadId: "thread-abc",
            projectId: VALID_UUID,
            title: "Arquitetura Checkout",
            updatedAt: NOW,
            messageCount: 4,
          },
        ],
        activeThreadId: "thread-abc",
        messages: [
          {
            id: "msg-1",
            role: "assistant",
            content: "Blueprint inicial estruturado.",
            createdAt: NOW,
            agentRole: "software_architect",
            agentName: "Agente Arquiteto",
            executionMode: "live_llm",
            boundModelId: "gemini-2.5-pro",
            toolsUsed: ["search_qmd_memories"],
          },
        ],
      },
      ok: true,
    },
    {
      label: "AgencyThreadListResponseSchema rejeita campo extra (.strict())",
      schema: AgencyThreadListResponseSchema,
      payload: {
        threads: [],
        activeThreadId: null,
        messages: [],
        unexpected: "x",
      },
      ok: false,
    },
    {
      label: "AgencyChatRequestSchema aceita threadId válido",
      schema: AgencyChatRequestSchema,
      payload: {
        message: "Continue a especificação do módulo fiscal.",
        threadId: "thread-123",
        projectId: VALID_UUID,
      },
      ok: true,
    },
    {
      label: "CopilotChatRequestSchema aceita threadId válido",
      schema: CopilotChatRequestSchema,
      payload: {
        messages: [{ role: "user", content: "Resuma o andamento do projeto." }],
        threadId: "copilot-thread-1",
        projectId: VALID_UUID,
      },
      ok: true,
    },
    {
      label: "TokenSavingsTechniqueSchema aceita observational_memory",
      schema: TokenSavingsTechniqueSchema,
      payload: "observational_memory",
      ok: true,
    },
    {
      label: "ObservationalMemoryStatusSchema rejeita tokens negativos",
      schema: ObservationalMemoryStatusSchema,
      payload: {
        activeMessageTokens: -1,
        messageTokensThreshold: 20000,
        activeObservationTokens: 0,
        observationTokensThreshold: 40000,
        generationCount: 0,
        bufferingStatus: "idle",
      },
      ok: false,
    },
    {
      label: "ObservationalMemoryStatusSchema rejeita threshold zero e bufferingStatus inválido",
      schema: ObservationalMemoryStatusSchema,
      payload: {
        activeMessageTokens: 0,
        messageTokensThreshold: 0,
        activeObservationTokens: 0,
        observationTokensThreshold: 40000,
        generationCount: 0,
        bufferingStatus: "paused",
      },
      ok: false,
    },
    {
      label: "AgencyChatRequestSchema rejeita message curta e threadId vazio",
      schema: AgencyChatRequestSchema,
      payload: {
        message: "a",
        threadId: "",
      },
      ok: false,
    },
    {
      label: "CopilotChatRequestSchema rejeita array vazio de messages",
      schema: CopilotChatRequestSchema,
      payload: {
        messages: [],
      },
      ok: false,
    },
  ])("$label", ({ schema, payload, ok }) => {
    expect(schema.safeParse(payload).success).toBe(ok);
  });

  it.each([
    {
      label: "AgencyStreamEvent tool_call válido",
      payload: {
        type: "tool_call",
        toolName: "search_qmd_memories",
        input: { query: "ADR" },
      },
      ok: true,
    },
    {
      label: "AgencyStreamEvent om_status válido",
      payload: {
        type: "om_status",
        status: {
          activeMessageTokens: 500,
          messageTokensThreshold: 20000,
          activeObservationTokens: 120,
          observationTokensThreshold: 40000,
          generationCount: 0,
          bufferingStatus: "complete",
        },
      },
      ok: true,
    },
    {
      label: "AgencyStreamEvent rejeita campo extra (.strict())",
      payload: {
        type: "token",
        text: "Olá",
        secret: "sk-123",
      },
      ok: false,
    },
  ])("$label", ({ payload, ok }) => {
    expect(AgencyStreamEventSchema.safeParse(payload).success).toBe(ok);
  });

  it.each([
    {
      label: "CopilotStreamEvent done com threadId e executionMode",
      payload: {
        type: "done",
        toolsUsed: ["read_workspace_overview"],
        finishReason: "completed",
        threadId: "copilot-1",
        executionMode: "live_llm",
      },
      ok: true,
    },
    {
      label: "CopilotStreamEvent om_status válido",
      payload: {
        type: "om_status",
        status: {
          activeMessageTokens: 1200,
          messageTokensThreshold: 20000,
          activeObservationTokens: 300,
          observationTokensThreshold: 40000,
          generationCount: 1,
          bufferingStatus: "running",
        },
      },
      ok: true,
    },
    {
      label: "CopilotStreamEvent rejeita campo desconhecido",
      payload: {
        type: "token",
        text: "ok",
        extra: 1,
      },
      ok: false,
    },
  ])("$label", ({ payload, ok }) => {
    expect(CopilotStreamEventSchema.safeParse(payload).success).toBe(ok);
  });

  it.each([
    {
      label: "bloqueia Google com baseUrl loopback (SSRF) em CreateProviderProfileSchema",
      schema: CreateProviderProfileSchema,
      payload: {
        name: "Google SSRF",
        providerType: "google",
        baseUrl: "http://127.0.0.1:8080/v1",
        apiKey: "AIzaSyTest1234567890",
      },
      ok: false,
    },
    {
      label: "bloqueia Anthropic com baseUrl rede privada 10.0.0.1 (SSRF) em CreateProviderProfileSchema",
      schema: CreateProviderProfileSchema,
      payload: {
        name: "Anthropic SSRF",
        providerType: "anthropic",
        baseUrl: "http://10.0.0.5/v1",
        apiKey: "sk-ant-test-1234567890",
      },
      ok: false,
    },
    {
      label: "bloqueia Google com baseUrl privada 192.168.1.10 (SSRF) em TestProviderConnectionRequestSchema",
      schema: TestProviderConnectionRequestSchema,
      payload: {
        providerType: "google",
        baseUrl: "http://192.168.1.10/v1",
        apiKey: "AIzaSyTest1234567890",
      },
      ok: false,
    },
    {
      label: "permite Ollama local em 127.0.0.1",
      schema: CreateProviderProfileSchema,
      payload: {
        name: "Ollama Local",
        providerType: "ollama",
        baseUrl: "http://127.0.0.1:11434/v1",
      },
      ok: true,
    },
  ])("anti-SSRF: $label", ({ schema, payload, ok }) => {
    expect(schema.safeParse(payload).success).toBe(ok);
  });
});
