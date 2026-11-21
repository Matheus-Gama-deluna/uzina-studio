import {
  ApiErrorSchema,
  ClientListResponseSchema,
  ClientSchema,
  CreateClientSchema,
  CreateDeliverableSchema,
  CreateProjectSchema,
  CreateProviderProfileSchema,
  DeliverableListResponseSchema,
  DeliverableSchema,
  ProjectListResponseSchema,
  ProjectSchema,
  ProviderProfileListResponseSchema,
  ProviderProfilePublicSchema,
} from "@uzina/contracts";
import { http, HttpResponse } from "msw";
import {
  MOCK_ORG_ID,
  mockClients,
  mockDeliverables,
  mockProjects,
  mockProviders,
} from "./fixtures";

function checkSimulatedState(url: URL) {
  const state = url.searchParams.get("state");
  if (state === "unauthorized") {
    return HttpResponse.json(
      ApiErrorSchema.parse({ error: "Não autorizado", code: "UNAUTHORIZED" }),
      { status: 401 }
    );
  }
  if (state === "error") {
    return HttpResponse.json(
      ApiErrorSchema.parse({
        error: "Erro simulado de infraestrutura",
        code: "INTERNAL_ERROR",
      }),
      { status: 500 }
    );
  }
  return null;
}

export const handlers = [
  http.get("*/api/clients", ({ request }) => {
    const url = new URL(request.url);
    const err = checkSimulatedState(url);
    if (err) return err;
    if (url.searchParams.get("state") === "empty") {
      return HttpResponse.json(ClientListResponseSchema.parse({ items: [] }));
    }
    return HttpResponse.json(ClientListResponseSchema.parse(mockClients));
  }),

  http.post("*/api/clients", async ({ request }) => {
    const parsed = CreateClientSchema.safeParse(await request.json());
    if (!parsed.success) {
      return HttpResponse.json(
        ApiErrorSchema.parse({
          error: parsed.error.issues[0]?.message ?? "Payload inválido",
          code: "VALIDATION_ERROR",
        }),
        { status: 400 }
      );
    }
    const now = new Date().toISOString();
    return HttpResponse.json(
      ClientSchema.parse({
        id: crypto.randomUUID(),
        organizationId: MOCK_ORG_ID,
        name: parsed.data.name,
        slug: parsed.data.slug ?? "novo-cliente",
        isDefaultInternal: false,
        notes: parsed.data.notes ?? null,
        createdAt: now,
        updatedAt: now,
      }),
      { status: 201 }
    );
  }),

  http.get("*/api/projects", ({ request }) => {
    const url = new URL(request.url);
    const err = checkSimulatedState(url);
    if (err) return err;
    if (url.searchParams.get("state") === "empty") {
      return HttpResponse.json(ProjectListResponseSchema.parse({ items: [] }));
    }
    return HttpResponse.json(ProjectListResponseSchema.parse(mockProjects));
  }),

  http.post("*/api/projects", async ({ request }) => {
    const parsed = CreateProjectSchema.safeParse(await request.json());
    if (!parsed.success) {
      return HttpResponse.json(
        ApiErrorSchema.parse({ error: "Payload inválido", code: "VALIDATION_ERROR" }),
        { status: 400 }
      );
    }
    const now = new Date().toISOString();
    const projectId = crypto.randomUUID();
    return HttpResponse.json(
      ProjectSchema.parse({
        id: projectId,
        clientId: parsed.data.clientId,
        name: parsed.data.name,
        slug: parsed.data.slug ?? "novo-projeto",
        description: parsed.data.description ?? null,
        defaultDevelopmentStrategy: parsed.data.defaultDevelopmentStrategy,
        maturityScore: null,
        designMdPath: null,
        status: "active",
        repositories: parsed.data.repository
          ? [
              {
                id: crypto.randomUUID(),
                projectId,
                name: parsed.data.repository.name,
                localPath: parsed.data.repository.localPath,
                remoteUrl: parsed.data.repository.remoteUrl ?? null,
                defaultBranch: parsed.data.repository.defaultBranch,
                stackMetadataJson: {},
                createdAt: now,
                updatedAt: now,
              },
            ]
          : [],
        createdAt: now,
        updatedAt: now,
      }),
      { status: 201 }
    );
  }),

  http.get("*/api/projects/:id/deliverables", ({ request }) => {
    const url = new URL(request.url);
    const err = checkSimulatedState(url);
    if (err) return err;
    if (url.searchParams.get("state") === "empty") {
      return HttpResponse.json(
        DeliverableListResponseSchema.parse({ items: [] })
      );
    }
    return HttpResponse.json(
      DeliverableListResponseSchema.parse(mockDeliverables)
    );
  }),

  http.post("*/api/projects/:id/deliverables", async ({ request, params }) => {
    const parsed = CreateDeliverableSchema.safeParse(await request.json());
    if (!parsed.success) {
      return HttpResponse.json(
        ApiErrorSchema.parse({ error: "Payload inválido", code: "VALIDATION_ERROR" }),
        { status: 400 }
      );
    }
    const now = new Date().toISOString();
    return HttpResponse.json(
      DeliverableSchema.parse({
        id: crypto.randomUUID(),
        projectId: String(params.id),
        repositoryId: parsed.data.repositoryId ?? null,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        status: "discovery",
        pausedFromStatus: null,
        hasUi: parsed.data.hasUi,
        developmentStrategy:
          parsed.data.developmentStrategy ?? "frontend_first_msw",
        tacticalPattern: parsed.data.tacticalPattern,
        riskLevel: parsed.data.riskLevel,
        worktreePath: null,
        branchName: null,
        verifyAttempts: 0,
        maxVerifyAttempts: 3,
        createdAt: now,
        updatedAt: now,
      }),
      { status: 201 }
    );
  }),

  http.get("*/api/providers", ({ request }) => {
    const url = new URL(request.url);
    const err = checkSimulatedState(url);
    if (err) return err;
    if (url.searchParams.get("state") === "empty") {
      return HttpResponse.json(
        ProviderProfileListResponseSchema.parse({ items: [] })
      );
    }
    return HttpResponse.json(
      ProviderProfileListResponseSchema.parse(mockProviders)
    );
  }),

  http.post("*/api/providers", async ({ request }) => {
    const parsed = CreateProviderProfileSchema.safeParse(await request.json());
    if (!parsed.success) {
      return HttpResponse.json(
        ApiErrorSchema.parse({ error: "Payload inválido", code: "VALIDATION_ERROR" }),
        { status: 400 }
      );
    }
    const now = new Date().toISOString();
    return HttpResponse.json(
      ProviderProfilePublicSchema.parse({
        id: crypto.randomUUID(),
        organizationId: MOCK_ORG_ID,
        name: parsed.data.name,
        providerType: parsed.data.providerType,
        baseUrl: parsed.data.baseUrl ?? null,
        hasApiKey: Boolean(parsed.data.apiKey),
        keyPreview: parsed.data.apiKey
          ? `${parsed.data.apiKey.slice(0, 3)}...${parsed.data.apiKey.slice(-4)}`
          : null,
        roleBindings: parsed.data.roleBindings,
        isDefault: parsed.data.isDefault,
        createdAt: now,
        updatedAt: now,
      }),
      { status: 201 }
    );
  }),
];
