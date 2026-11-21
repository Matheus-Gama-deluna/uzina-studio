import {
  ApiErrorSchema,
  ClientListResponseSchema,
  DeliverableListResponseSchema,
  ProjectListResponseSchema,
  ProviderProfileListResponseSchema,
} from "@uzina/contracts";
import { closeDb } from "@uzina/db";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { POST as authPost } from "../src/app/api/auth/[...all]/route";
import { GET as getClients } from "../src/app/api/clients/route";
import { GET as getDeliverables, POST as createDeliverable } from "../src/app/api/projects/[id]/deliverables/route";
import { GET as getProjects, POST as createProject } from "../src/app/api/projects/route";
import { GET as getProviders, POST as createProvider } from "../src/app/api/providers/route";
import { resetAuthForTests } from "../src/lib/auth";
import { server } from "../src/mocks/server";

function getCookie(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]?.trim() ?? "")
    .filter(Boolean)
    .join("; ");
}

describe("Contract Drift Check — MSW vs Rotas REST Reais", () => {
  beforeAll(() => {
    server.listen({ onUnhandledFrame: "bypass" });
  });

  afterEach(() => {
    server.resetHandlers();
  });

  afterAll(async () => {
    server.close();
    resetAuthForTests();
    await closeDb();
  });

  test("respostas dos handlers MSW passam nos mesmos schemas Zod que as rotas reais em PGlite", async () => {
    // 1. Validar respostas via MSW (borda HTTP interceptada)
    const mswClientsRes = await fetch("http://msw.local/api/clients");
    expect(mswClientsRes.status).toBe(200);
    const mswClients = ClientListResponseSchema.parse(await mswClientsRes.json());

    const mswProjectsRes = await fetch("http://msw.local/api/projects");
    expect(mswProjectsRes.status).toBe(200);
    const mswProjects = ProjectListResponseSchema.parse(await mswProjectsRes.json());

    const mswDeliverablesRes = await fetch(
      `http://msw.local/api/projects/${mswProjects.items[0]?.id}/deliverables`
    );
    expect(mswDeliverablesRes.status).toBe(200);
    DeliverableListResponseSchema.parse(await mswDeliverablesRes.json());

    const mswProvidersRes = await fetch("http://msw.local/api/providers");
    expect(mswProvidersRes.status).toBe(200);
    ProviderProfileListResponseSchema.parse(await mswProvidersRes.json());

    const mswEmptyRes = await fetch("http://msw.local/api/projects?state=empty");
    expect(mswEmptyRes.status).toBe(200);
    expect(ProjectListResponseSchema.parse(await mswEmptyRes.json()).items).toEqual([]);

    const mswErrorRes = await fetch("http://msw.local/api/clients?state=error");
    expect(mswErrorRes.status).toBe(500);
    ApiErrorSchema.parse(await mswErrorRes.json());

    // 2. Validar respostas das rotas reais contra os mesmos schemas Zod
    resetAuthForTests();
    await closeDb();

    const signUpRes = await authPost(
      new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Operador Drift",
          email: "drift@uzina.studio",
          password: "StrongPassword!123",
        }),
      })
    );
    expect(signUpRes.status).toBe(200);
    const cookie = getCookie(signUpRes);

    const realClientsRes = await getClients(
      new Request("http://localhost:3000/api/clients", { headers: { cookie } })
    );
    expect(realClientsRes.status).toBe(200);
    const realClients = ClientListResponseSchema.parse(await realClientsRes.json());
    const internalClient = realClients.items.find((c) => c.isDefaultInternal);
    expect(internalClient?.slug).toBe(mswClients.items[0]?.slug);

    const createProjRes = await createProject(
      new Request("http://localhost:3000/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          clientId: internalClient?.id,
          name: "Projeto Drift",
          defaultDevelopmentStrategy: "frontend_first_msw",
          repository: { name: "repo-drift", localPath: "/tmp/repo-drift" },
        }),
      })
    );
    expect(createProjRes.status).toBe(201);

    const realProjectsRes = await getProjects(
      new Request("http://localhost:3000/api/projects", { headers: { cookie } })
    );
    expect(realProjectsRes.status).toBe(200);
    const realProjects = ProjectListResponseSchema.parse(
      await realProjectsRes.json()
    );
    const projectId = realProjects.items[0]?.id ?? "";

    const createDelivRes = await createDeliverable(
      new Request(`http://localhost:3000/api/projects/${projectId}/deliverables`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ title: "Entrega Drift", hasUi: true }),
      }),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(createDelivRes.status).toBe(201);

    const realDelivRes = await getDeliverables(
      new Request(`http://localhost:3000/api/projects/${projectId}/deliverables`, {
        headers: { cookie },
      }),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(realDelivRes.status).toBe(200);
    DeliverableListResponseSchema.parse(await realDelivRes.json());

    const createProvRes = await createProvider(
      new Request("http://localhost:3000/api/providers", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          name: "OmniRoute Real",
          providerType: "omniroute",
          baseUrl: "http://localhost:8080/v1",
          apiKey: "sk-drift-secret-9988",
          isDefault: true,
        }),
      })
    );
    expect(createProvRes.status).toBe(201);

    const realProvRes = await getProviders(
      new Request("http://localhost:3000/api/providers", { headers: { cookie } })
    );
    expect(realProvRes.status).toBe(200);
    ProviderProfileListResponseSchema.parse(await realProvRes.json());
  });
});
