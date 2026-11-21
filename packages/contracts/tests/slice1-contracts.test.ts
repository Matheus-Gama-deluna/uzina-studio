import { describe, expect, test } from "vitest";
import {
  AgentRoleSchema,
  ApiErrorSchema,
  CreateClientSchema,
  CreateDeliverableSchema,
  CreateProjectSchema,
  CreateProviderProfileSchema,
  ProjectStatusSchema,
  ProviderProfilePublicSchema,
  UpdateClientSchema,
  UpdateProviderProfileSchema,
} from "../src/index.js";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const PROFILE_ID = "22222222-2222-4222-8222-222222222222";
const CLIENT_ID = "33333333-3333-4333-8333-333333333333";
const NOW = "2026-11-21T17:00:00.000Z";

describe("@uzina/contracts — Slice 1 schemas", () => {
  test.each([
    {
      label: "Client válido",
      schema: CreateClientSchema,
      payload: { name: "Acme Corp", slug: "acme-corp", notes: "Cliente B2B" },
      ok: true,
    },
    {
      label: "Client com slug maiúsculo inválido",
      schema: CreateClientSchema,
      payload: { name: "Acme", slug: "Acme_Corp" },
      ok: false,
    },
    {
      label: "UpdateClient rejeita tentativa de alterar isDefaultInternal",
      schema: UpdateClientSchema,
      payload: { name: "Internos", isDefaultInternal: false },
      ok: false,
    },
    {
      label: "Project válido com repositório",
      schema: CreateProjectSchema,
      payload: {
        clientId: CLIENT_ID,
        name: "Portal SaaS",
        defaultDevelopmentStrategy: "frontend_first_msw",
        repository: { name: "portal-web", localPath: "/repos/portal-web" },
      },
      ok: true,
    },
    {
      label: "Project com clientId inválido",
      schema: CreateProjectSchema,
      payload: { clientId: "nao-uuid", name: "Portal" },
      ok: false,
    },
    {
      label: "Deliverable válido",
      schema: CreateDeliverableSchema,
      payload: { title: "Implementar painel Kanban", hasUi: true, riskLevel: "medium" },
      ok: true,
    },
    {
      label: "Deliverable com título curto demais",
      schema: CreateDeliverableSchema,
      payload: { title: "AB" },
      ok: false,
    },
    {
      label: "ApiError válido",
      schema: ApiErrorSchema,
      payload: { error: "Não autorizado", code: "UNAUTHORIZED" },
      ok: true,
    },
  ])("$label", ({ schema, payload, ok }) => {
    expect(schema.safeParse(payload).success).toBe(ok);
  });

  test.each([
    {
      label: "OmniRoute com baseUrl e apiKey válidos",
      payload: {
        name: "OmniRoute Local",
        providerType: "omniroute",
        baseUrl: "http://localhost:8080/v1",
        apiKey: "sk-omni-12345678",
        roleBindings: { builder: { modelId: "claude-sonnet" } },
      },
      ok: true,
    },
    {
      label: "Ollama sem apiKey é aceito",
      payload: {
        name: "Ollama Local",
        providerType: "ollama",
        baseUrl: "http://localhost:11434/v1",
      },
      ok: true,
    },
    {
      label: "Anthropic sem apiKey é rejeitado",
      payload: {
        name: "Anthropic Prod",
        providerType: "anthropic",
      },
      ok: false,
    },
    {
      label: "OmniRoute sem baseUrl é rejeitado",
      payload: {
        name: "OmniRoute Sem URL",
        providerType: "omniroute",
        apiKey: "sk-omni-12345678",
      },
      ok: false,
    },
  ])("CreateProviderProfileSchema — $label", ({ payload, ok }) => {
    expect(CreateProviderProfileSchema.safeParse(payload).success).toBe(ok);
  });

  test("ProviderProfilePublicSchema rejeita campos secretos (strict) e UpdateProviderProfileSchema bloqueia troca de providerType", () => {
    const publicSafe = {
      id: PROFILE_ID,
      organizationId: ORG_ID,
      name: "OmniRoute",
      providerType: "omniroute",
      baseUrl: "http://localhost:8080/v1",
      hasApiKey: true,
      keyPreview: "sk-...5678",
      roleBindings: { architect: { modelId: "gpt-5" } },
      isDefault: true,
      createdAt: NOW,
      updatedAt: NOW,
    };

    expect(ProviderProfilePublicSchema.safeParse(publicSafe).success).toBe(true);
    expect(
      ProviderProfilePublicSchema.safeParse({
        ...publicSafe,
        encryptedApiKey: "v1:aa:bb:cc",
      }).success
    ).toBe(false);
    expect(
      ProviderProfilePublicSchema.safeParse({
        ...publicSafe,
        apiKey: "sk-vazado",
      }).success
    ).toBe(false);
    expect(
      UpdateProviderProfileSchema.safeParse({ providerType: "anthropic" }).success
    ).toBe(false);
  });

  test("Enums ProjectStatusSchema e AgentRoleSchema validam valores corretos", () => {
    expect(ProjectStatusSchema.parse("active")).toBe("active");
    expect(AgentRoleSchema.parse("copilot")).toBe("copilot");
    expect(AgentRoleSchema.safeParse("admin").success).toBe(false);
  });

  test.each([
    { url: "file:///etc/passwd" },
    { url: "javascript:alert(1)" },
    { url: "ftp://files.internal/repo" },
  ])("rejeita URI não-HTTP(S) '$url' em baseUrl e remoteUrl", ({ url }) => {
    expect(
      CreateProviderProfileSchema.safeParse({
        name: "Bad URL",
        providerType: "ollama",
        baseUrl: url,
      }).success
    ).toBe(false);

    expect(
      CreateProjectSchema.safeParse({
        clientId: CLIENT_ID,
        name: "Projeto URL Ruim",
        repository: {
          name: "repo",
          localPath: "/tmp/repo",
          remoteUrl: url,
        },
      }).success
    ).toBe(false);
  });
});
