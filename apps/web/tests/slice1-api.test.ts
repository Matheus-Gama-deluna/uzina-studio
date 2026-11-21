import { decryptSecret } from "@uzina/core";
import {
  closeDb,
  getDb,
  providerProfiles,
  users,
} from "@uzina/db";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { POST as authPost } from "../src/app/api/auth/[...all]/route";
import { PATCH as patchClient } from "../src/app/api/clients/[id]/route";
import { GET as getClients, POST as createClient } from "../src/app/api/clients/route";
import { PATCH as patchDeliverable } from "../src/app/api/deliverables/[id]/route";
import { POST as createDeliverable } from "../src/app/api/projects/[id]/deliverables/route";
import { POST as createRepository } from "../src/app/api/projects/[id]/repositories/route";
import { PATCH as patchProject } from "../src/app/api/projects/[id]/route";
import { GET as getProjects, POST as createProject } from "../src/app/api/projects/route";
import { PATCH as patchProvider } from "../src/app/api/providers/[id]/route";
import { GET as getProviders, POST as createProvider } from "../src/app/api/providers/route";
import { resetAuthForTests } from "../src/lib/auth";
import { getServerMasterKey } from "../src/lib/vault";

function cookieOf(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]?.trim() ?? "")
    .filter(Boolean)
    .join("; ");
}

async function signUpAndGetCookie(name: string, email: string): Promise<string> {
  const res = await authPost(
    new Request("http://localhost:3000/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, email, password: "StrongPassword!123" }),
    })
  );
  expect(res.status).toBe(200);
  return cookieOf(res);
}

describe("Slice 1 APIs — Cofre AES-256-GCM, StateMachine, RBAC & Anti-IDOR", () => {
  afterAll(async () => {
    resetAuthForTests();
    await closeDb();
  });

  test("rejeita acesso sem sessão (401) nas rotas protegidas", async () => {
    resetAuthForTests();
    await closeDb();

    const r1 = await getClients(new Request("http://localhost:3000/api/clients"));
    expect(r1.status).toBe(401);

    const r2 = await getProjects(new Request("http://localhost:3000/api/projects"));
    expect(r2.status).toBe(401);

    const r3 = await getProviders(new Request("http://localhost:3000/api/providers"));
    expect(r3.status).toBe(401);

    const r4 = await patchDeliverable(
      new Request("http://localhost:3000/api/deliverables/11111111-1111-4111-8111-111111111111", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Sem auth" }),
      }),
      { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) }
    );
    expect(r4.status).toBe(401);
  });

  test("cifra chave no banco sem expor plaintext, isola signup aberto por tenant, valida 400/409/422 e bloqueia RBAC/IDOR", async () => {
    resetAuthForTests();
    await closeDb();

    // Usuário A (1º cadastro -> owner da uzina-default)
    const cookieA = await signUpAndGetCookie("Owner A", "ownera@uzina.studio");
    const clientsARes = await getClients(
      new Request("http://localhost:3000/api/clients", {
        headers: { cookie: cookieA },
      })
    );
    expect(clientsARes.status).toBe(200);
    const clientsA = (await clientsARes.json()) as {
      items: Array<{ id: string; organizationId: string; slug: string; isDefaultInternal: boolean }>;
    };
    const internos = clientsA.items.find((c) => c.isDefaultInternal);
    expect(internos?.slug).toBe("internos");
    const orgAId = internos?.organizationId ?? "";

    // Bloqueia renomear cliente padrão "Internos" e rejeita UUID inválido (400)
    const badIdRes = await patchClient(
      new Request("http://localhost:3000/api/clients/not-a-uuid", {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: cookieA },
        body: JSON.stringify({ name: "X" }),
      }),
      { params: Promise.resolve({ id: "not-a-uuid" }) }
    );
    expect(badIdRes.status).toBe(400);

    const renameInternos = await patchClient(
      new Request(`http://localhost:3000/api/clients/${internos?.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: cookieA },
        body: JSON.stringify({ name: "Outro Nome" }),
      }),
      { params: Promise.resolve({ id: internos?.id ?? "" }) }
    );
    expect(renameInternos.status).toBe(400);

    // Slug duplicado em cliente retorna 409 Conflict
    const c1 = await createClient(
      new Request("http://localhost:3000/api/clients", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookieA },
        body: JSON.stringify({ name: "Cliente Duplicado", slug: "dup-slug" }),
      })
    );
    expect(c1.status).toBe(201);
    const c2 = await createClient(
      new Request("http://localhost:3000/api/clients", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookieA },
        body: JSON.stringify({ name: "Cliente Duplicado 2", slug: "dup-slug" }),
      })
    );
    expect(c2.status).toBe(409);

    // Cria projetos A1 e A2 + repositório em A2
    const projRes = await createProject(
      new Request("http://localhost:3000/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookieA },
        body: JSON.stringify({
          clientId: internos?.id,
          name: "App Interno",
          defaultDevelopmentStrategy: "frontend_first_msw",
        }),
      })
    );
    expect(projRes.status).toBe(201);
    const proj = (await projRes.json()) as { id: string; name: string };

    // PATCH /api/projects/[id]
    const patchedProjRes = await patchProject(
      new Request(`http://localhost:3000/api/projects/${proj.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: cookieA },
        body: JSON.stringify({ name: "App Interno v2", maturityScore: 88 }),
      }),
      { params: Promise.resolve({ id: proj.id }) }
    );
    expect(patchedProjRes.status).toBe(200);
    expect(((await patchedProjRes.json()) as { maturityScore: number }).maturityScore).toBe(88);

    // POST /api/projects/[id]/repositories
    const repoRes = await createRepository(
      new Request(`http://localhost:3000/api/projects/${proj.id}/repositories`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookieA },
        body: JSON.stringify({ name: "core-repo", localPath: "/tmp/core-repo" }),
      }),
      { params: Promise.resolve({ id: proj.id }) }
    );
    expect(repoRes.status).toBe(201);
    const repo = (await repoRes.json()) as { id: string };

    const proj2Res = await createProject(
      new Request("http://localhost:3000/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookieA },
        body: JSON.stringify({
          clientId: internos?.id,
          name: "Outro Projeto",
        }),
      })
    );
    const proj2 = (await proj2Res.json()) as { id: string };

    // Rejeita repositoryId pertencente a outro projeto (400 INVALID_REPOSITORY)
    const wrongRepoDeliv = await createDeliverable(
      new Request(`http://localhost:3000/api/projects/${proj2.id}/deliverables`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookieA },
        body: JSON.stringify({
          title: "Repo cruzado",
          repositoryId: repo.id,
        }),
      }),
      { params: Promise.resolve({ id: proj2.id }) }
    );
    expect(wrongRepoDeliv.status).toBe(400);

    // Cria entrega válida no projeto A1
    const delivRes = await createDeliverable(
      new Request(`http://localhost:3000/api/projects/${proj.id}/deliverables`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookieA },
        body: JSON.stringify({
          title: "Setup UI",
          hasUi: true,
          repositoryId: repo.id,
        }),
      }),
      { params: Promise.resolve({ id: proj.id }) }
    );
    expect(delivRes.status).toBe(201);
    const deliv = (await delivRes.json()) as { id: string; status: string };

    // Transição inválida -> 422
    const invalidTransition = await patchDeliverable(
      new Request(`http://localhost:3000/api/deliverables/${deliv.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: cookieA },
        body: JSON.stringify({ status: "merged" }),
      }),
      { params: Promise.resolve({ id: deliv.id }) }
    );
    expect(invalidTransition.status).toBe(422);

    // Pause + Resume
    const pauseRes = await patchDeliverable(
      new Request(`http://localhost:3000/api/deliverables/${deliv.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: cookieA },
        body: JSON.stringify({ status: "paused" }),
      }),
      { params: Promise.resolve({ id: deliv.id }) }
    );
    expect(pauseRes.status).toBe(200);
    expect(((await pauseRes.json()) as { pausedFromStatus: string }).pausedFromStatus).toBe("discovery");

    const resumeRes = await patchDeliverable(
      new Request(`http://localhost:3000/api/deliverables/${deliv.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: cookieA },
        body: JSON.stringify({ status: "discovery" }),
      }),
      { params: Promise.resolve({ id: deliv.id }) }
    );
    expect(resumeRes.status).toBe(200);
    expect(((await resumeRes.json()) as { pausedFromStatus: string | null }).pausedFromStatus).toBeNull();

    // Provedor AES-256-GCM
    const rawSecret = "sk-uzina-super-secret-7788";
    const provRes = await createProvider(
      new Request("http://localhost:3000/api/providers", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookieA },
        body: JSON.stringify({
          name: "Anthropic Prod",
          providerType: "anthropic",
          apiKey: rawSecret,
          isDefault: true,
        }),
      })
    );
    expect(provRes.status).toBe(201);
    const provRawText = await provRes.text();
    expect(provRawText).not.toContain(rawSecret);
    expect(provRawText).not.toContain("encryptedApiKey");
    const provJson = JSON.parse(provRawText) as {
      id: string;
      organizationId: string;
      keyPreview: string;
    };
    expect(provJson.keyPreview).toBe("sk-...7788");

    const { db } = await getDb();
    const [dbProv] = await db
      .select()
      .from(providerProfiles)
      .where(eq(providerProfiles.id, provJson.id));
    expect(dbProv?.encryptedApiKey).toMatch(/^v1:/);
    expect(dbProv?.encryptedApiKey).not.toContain(rawSecret);
    expect(
      decryptSecret({
        encrypted: dbProv?.encryptedApiKey ?? "",
        masterKey: getServerMasterKey(),
        organizationId: provJson.organizationId,
        providerType: "anthropic",
      })
    ).toBe(rawSecret);

    // Usuário B via signup aberto recebe AUTOMATICAMENTE organização isolada própria (anti-escalação!)
    const cookieB = await signUpAndGetCookie("Owner B", "ownerb@other.studio");
    const clientsBRes = await getClients(
      new Request("http://localhost:3000/api/clients", {
        headers: { cookie: cookieB },
      })
    );
    expect(clientsBRes.status).toBe(200);
    const clientsB = (await clientsBRes.json()) as {
      items: Array<{ organizationId: string }>;
    };
    expect(clientsB.items[0]?.organizationId).not.toBe(orgAId);

    const idorProviderRes = await patchProvider(
      new Request(`http://localhost:3000/api/providers/${provJson.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: cookieB },
        body: JSON.stringify({ name: "Sequestrado" }),
      }),
      { params: Promise.resolve({ id: provJson.id }) }
    );
    expect(idorProviderRes.status).toBe(404);

    const idorDeliverableRes = await patchDeliverable(
      new Request(`http://localhost:3000/api/deliverables/${deliv.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: cookieB },
        body: JSON.stringify({ title: "Sequestrado" }),
      }),
      { params: Promise.resolve({ id: deliv.id }) }
    );
    expect(idorDeliverableRes.status).toBe(404);

    // Membro developer dentro da Org A pode ler provedores (200), mas NÃO mutar provedores (403)
    const cookieDev = await signUpAndGetCookie("Dev", "dev@uzina.studio");
    await db
      .update(users)
      .set({ organizationId: orgAId, role: "developer" })
      .where(eq(users.email, "dev@uzina.studio"));

    const devProvRead = await getProviders(
      new Request("http://localhost:3000/api/providers", {
        headers: { cookie: cookieDev },
      })
    );
    expect(devProvRead.status).toBe(200);
    expect(await devProvRead.text()).not.toContain(rawSecret);

    const devProvCreate = await createProvider(
      new Request("http://localhost:3000/api/providers", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookieDev },
        body: JSON.stringify({
          name: "Ollama Dev",
          providerType: "ollama",
          baseUrl: "http://localhost:11434/v1",
        }),
      })
    );
    expect(devProvCreate.status).toBe(403);

    // Membro auditor dentro da Org A não pode criar cliente (403)
    const cookieAuditor = await signUpAndGetCookie("Auditor", "auditor@uzina.studio");
    await db
      .update(users)
      .set({ organizationId: orgAId, role: "auditor" })
      .where(eq(users.email, "auditor@uzina.studio"));

    const auditorClientCreate = await createClient(
      new Request("http://localhost:3000/api/clients", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookieAuditor },
        body: JSON.stringify({ name: "Bloqueado" }),
      })
    );
    expect(auditorClientCreate.status).toBe(403);
  });
});
