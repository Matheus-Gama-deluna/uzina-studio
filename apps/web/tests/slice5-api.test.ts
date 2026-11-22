import { MemoryListResponseSchema, MemorySchema } from "@uzina/contracts";
import { closeDb, getDb, organizations, users } from "@uzina/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { POST as authPost } from "../src/app/api/auth/[...all]/route";
import { GET as getClients, POST as createClient } from "../src/app/api/clients/route";
import { POST as postCopilotChat } from "../src/app/api/copilot/chat/route";
import {
  DELETE as deleteMemoryRoute,
  PATCH as patchMemoryRoute,
} from "../src/app/api/memories/[id]/route";
import {
  GET as getMemoriesRoute,
  POST as createMemoryRoute,
} from "../src/app/api/memories/route";
import { POST as createProject } from "../src/app/api/projects/route";
import { resetAuthForTests } from "../src/lib/auth";
import { resetWebWorkflowRuntimeForTests } from "../src/lib/workflow-runtime";

function cookieOf(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]?.trim() ?? "")
    .filter(Boolean)
    .join("; ");
}

async function signUpCookie(name: string, email: string): Promise<string> {
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

describe("Slice 5 APIs — Memórias em 3 Escopos (Isolamento & RBAC) & Co-piloto Executivo SSE", () => {
  let ownerCookie = "";
  let devCookie = "";
  let auditorCookie = "";
  let otherOrgCookie = "";
  let orgId = "";
  let clientAId = "";
  let clientBId = "";
  let projectAId = "";
  let projectBId = "";

  beforeAll(async () => {
    await resetWebWorkflowRuntimeForTests();
    resetAuthForTests();
    await closeDb();

    ownerCookie = await signUpCookie("Owner S5", "owner-s5@uzina.studio");
    devCookie = await signUpCookie("Dev S5", "dev-s5@uzina.studio");
    auditorCookie = await signUpCookie("Auditor S5", "auditor-s5@uzina.studio");
    otherOrgCookie = await signUpCookie("Other S5", "other-s5@uzina.studio");

    await getClients(
      new Request("http://localhost:3000/api/clients", {
        headers: { cookie: ownerCookie },
      })
    );

    const { db } = await getDb();
    const [ownerRow] = await db
      .select()
      .from(users)
      .where(eq(users.email, "owner-s5@uzina.studio"));
    orgId = ownerRow!.organizationId!;

    await db
      .update(users)
      .set({ organizationId: orgId, role: "developer" })
      .where(eq(users.email, "dev-s5@uzina.studio"));
    await db
      .update(users)
      .set({ organizationId: orgId, role: "auditor" })
      .where(eq(users.email, "auditor-s5@uzina.studio"));

    const [otherOrg] = await db
      .insert(organizations)
      .values({ name: "Tenant S5 B", slug: "tenant-s5-b" })
      .returning();
    await db
      .update(users)
      .set({ organizationId: otherOrg!.id, role: "owner" })
      .where(eq(users.email, "other-s5@uzina.studio"));

    const cARes = await createClient(
      new Request("http://localhost:3000/api/clients", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({ name: "Banco A" }),
      })
    );
    clientAId = ((await cARes.json()) as { id: string }).id;

    const cBRes = await createClient(
      new Request("http://localhost:3000/api/clients", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({ name: "Varejo B" }),
      })
    );
    clientBId = ((await cBRes.json()) as { id: string }).id;

    const pARes = await createProject(
      new Request("http://localhost:3000/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({ clientId: clientAId, name: "Core Pix A" }),
      })
    );
    projectAId = ((await pARes.json()) as { id: string }).id;

    const pBRes = await createProject(
      new Request("http://localhost:3000/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({ clientId: clientBId, name: "E-commerce B" }),
      })
    );
    projectBId = ((await pBRes.json()) as { id: string }).id;
  });

  afterAll(async () => {
    await resetWebWorkflowRuntimeForTests();
    resetAuthForTests();
    await closeDb();
  });

  test("impõe isolamento entre clientes, RBAC de escrita por escopo e proteção anti-IDOR em /api/memories", async () => {
    // 1. Developer bloqueado em memória org (403), permitido em client/project
    const devOrgMem = await createMemoryRoute(
      new Request("http://localhost:3000/api/memories", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: devCookie },
        body: JSON.stringify({
          scopeType: "org",
          scopeId: orgId,
          category: "convention",
          title: "Proibido Dev",
          content: "Apenas owner/admin criam memória global.",
        }),
      })
    );
    expect(devOrgMem.status).toBe(403);

    const ownerOrgMem = await createMemoryRoute(
      new Request("http://localhost:3000/api/memories", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({
          scopeType: "org",
          scopeId: orgId,
          category: "convention",
          title: "Padrão Org Compartilhado",
          content: "TypeScript strict obrigatório.",
        }),
      })
    );
    expect(ownerOrgMem.status).toBe(201);

    const memClientARes = await createMemoryRoute(
      new Request("http://localhost:3000/api/memories", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: devCookie },
        body: JSON.stringify({
          scopeType: "client",
          scopeId: clientAId,
          category: "domain_rule",
          title: "Regra Banco A",
          content: "Chave pix exclusiva do Banco A.",
        }),
      })
    );
    expect(memClientARes.status).toBe(201);
    const memClientA = MemorySchema.parse(await memClientARes.json());

    const memProjBRes = await createMemoryRoute(
      new Request("http://localhost:3000/api/memories", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: devCookie },
        body: JSON.stringify({
          scopeType: "project",
          scopeId: projectBId,
          category: "architecture",
          title: "Regra Projeto B",
          content: "Checkout headless do Varejo B.",
        }),
      })
    );
    expect(memProjBRes.status).toBe(201);

    // 2. Consulta hierárquica no Projeto B vê Org + Projeto B, mas JAMAIS Banco A
    const listBRes = await getMemoriesRoute(
      new Request(`http://localhost:3000/api/memories?projectId=${projectBId}`, {
        headers: { cookie: ownerCookie },
      })
    );
    expect(listBRes.status).toBe(200);
    const listB = MemoryListResponseSchema.parse(await listBRes.json());
    const titlesB = listB.items.map((m) => m.title);
    expect(titlesB).toContain("Padrão Org Compartilhado");
    expect(titlesB).toContain("Regra Projeto B");
    expect(titlesB).not.toContain("Regra Banco A");

    // 3. Consulta hierárquica no Projeto A vê Org + Banco A, nunca Projeto B
    const listARes = await getMemoriesRoute(
      new Request(`http://localhost:3000/api/memories?projectId=${projectAId}`, {
        headers: { cookie: ownerCookie },
      })
    );
    const listA = MemoryListResponseSchema.parse(await listARes.json());
    expect(listA.items.map((m) => m.title)).toContain("Regra Banco A");
    expect(listA.items.map((m) => m.title)).not.toContain("Regra Projeto B");

    // 4. Cross-tenant IDOR recebe 404
    const crossPatch = await patchMemoryRoute(
      new Request(`http://localhost:3000/api/memories/${memClientA.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: otherOrgCookie },
        body: JSON.stringify({ title: "Tentativa IDOR" }),
      }),
      { params: Promise.resolve({ id: memClientA.id }) }
    );
    expect(crossPatch.status).toBe(404);

    const crossDelete = await deleteMemoryRoute(
      new Request(`http://localhost:3000/api/memories/${memClientA.id}`, {
        method: "DELETE",
        headers: { cookie: otherOrgCookie },
      }),
      { params: Promise.resolve({ id: memClientA.id }) }
    );
    expect(crossDelete.status).toBe(404);
  });

  test("transmite SSE do Co-piloto Executivo, cria rascunho em discovery e bloqueia ação de escrita para auditor", async () => {
    const sseOk = await postCopilotChat(
      new Request("http://localhost:3000/api/copilot/chat", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: devCookie },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Criar rascunho de entrega" }],
          projectId: projectAId,
          action: {
            type: "draft_deliverable",
            projectId: projectAId,
            title: "Rascunho Co-piloto Pix",
          },
        }),
      })
    );
    expect(sseOk.status).toBe(200);
    expect(sseOk.headers.get("content-type")).toContain("text/event-stream");
    const streamBody = await sseOk.text();
    expect(streamBody).toContain("event: tool_call");
    expect(streamBody).toContain("Rascunho Co-piloto Pix");
    expect(streamBody).toContain("event: done");

    // Auditor recebe evento error ao tentar draft_deliverable
    const sseAuditor = await postCopilotChat(
      new Request("http://localhost:3000/api/copilot/chat", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: auditorCookie },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Criar rascunho" }],
          action: {
            type: "draft_deliverable",
            projectId: projectAId,
            title: "Bloqueado para Auditor",
          },
        }),
      })
    );
    expect(sseAuditor.status).toBe(200);
    const auditorBody = await sseAuditor.text();
    expect(auditorBody).toContain("event: error");
    expect(auditorBody).toContain("auditor");
  });
});
