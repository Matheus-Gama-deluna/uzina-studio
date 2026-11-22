import { QmdReindexResponseSchema, QmdSearchResponseSchema } from "@uzina/contracts";
import { closeDb, getDb, users } from "@uzina/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { POST as authPost } from "../src/app/api/auth/[...all]/route";
import { GET as getClients, POST as createClient } from "../src/app/api/clients/route";
import { POST as createMemoryRoute } from "../src/app/api/memories/route";
import { POST as searchMemoriesQmd } from "../src/app/api/memories/search/route";
import { POST as createProject } from "../src/app/api/projects/route";
import { POST as reindexQmd } from "../src/app/api/qmd/reindex/route";
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

describe("Slice 7 APIs — Busca Híbrida QMD & Reindexação Multi-Tenant", () => {
  let ownerCookie = "";
  let devCookie = "";
  let auditorCookie = "";
  let orgId = "";
  let clientAId = "";
  let clientBId = "";
  let projectAId = "";
  let projectBId = "";

  beforeAll(async () => {
    await resetWebWorkflowRuntimeForTests();
    resetAuthForTests();
    await closeDb();

    ownerCookie = await signUpCookie("Owner S7", "owner-s7@uzina.studio");
    devCookie = await signUpCookie("Dev S7", "dev-s7@uzina.studio");
    auditorCookie = await signUpCookie("Auditor S7", "auditor-s7@uzina.studio");

    await getClients(
      new Request("http://localhost:3000/api/clients", {
        headers: { cookie: ownerCookie },
      })
    );

    const { db } = await getDb();
    const [ownerRow] = await db
      .select()
      .from(users)
      .where(eq(users.email, "owner-s7@uzina.studio"));
    orgId = ownerRow!.organizationId!;

    await db
      .update(users)
      .set({ organizationId: orgId, role: "developer" })
      .where(eq(users.email, "dev-s7@uzina.studio"));
    await db
      .update(users)
      .set({ organizationId: orgId, role: "auditor" })
      .where(eq(users.email, "auditor-s7@uzina.studio"));

    const cARes = await createClient(
      new Request("http://localhost:3000/api/clients", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({ name: "Cliente QMD A" }),
      })
    );
    clientAId = ((await cARes.json()) as { id: string }).id;

    const cBRes = await createClient(
      new Request("http://localhost:3000/api/clients", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({ name: "Cliente QMD B" }),
      })
    );
    clientBId = ((await cBRes.json()) as { id: string }).id;

    const pARes = await createProject(
      new Request("http://localhost:3000/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({ clientId: clientAId, name: "Projeto QMD A" }),
      })
    );
    projectAId = ((await pARes.json()) as { id: string }).id;

    const pBRes = await createProject(
      new Request("http://localhost:3000/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({ clientId: clientBId, name: "Projeto QMD B" }),
      })
    );
    projectBId = ((await pBRes.json()) as { id: string }).id;

    const orgMemRes = await createMemoryRoute(
      new Request("http://localhost:3000/api/memories", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({
          scopeType: "org",
          scopeId: orgId,
          category: "architecture",
          title: "Cofre AES-256-GCM",
          content: "Credenciais usam AES-256-GCM e VAULT_WRITE_ROLES.",
        }),
      })
    );
    expect(orgMemRes.status).toBe(201);

    const clientAMemRes = await createMemoryRoute(
      new Request("http://localhost:3000/api/memories", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({
          scopeType: "client",
          scopeId: clientAId,
          category: "domain_rule",
          title: "Segredo Exclusivo Cliente A",
          content: "Identificador exclusivo QMD_ALPHA_ONLY do Cliente A.",
        }),
      })
    );
    expect(clientAMemRes.status).toBe(201);
  });

  afterAll(async () => {
    await resetWebWorkflowRuntimeForTests();
    resetAuthForTests();
    await closeDb();
  });

  test("impõe 401/400/403 e executa busca híbrida QMD isolada entre Cliente A e Cliente B", async () => {
    const unauthRes = await searchMemoriesQmd(
      new Request("http://localhost:3000/api/memories/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "AES-256-GCM" }),
      })
    );
    expect(unauthRes.status).toBe(401);

    const badPayloadRes = await searchMemoriesQmd(
      new Request("http://localhost:3000/api/memories/search", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({ query: "x" }),
      })
    );
    expect(badPayloadRes.status).toBe(400);

    // Busca em Projeto B encontra Org mas NUNCA Cliente A
    const searchBRes = await searchMemoriesQmd(
      new Request("http://localhost:3000/api/memories/search", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: auditorCookie },
        body: JSON.stringify({
          query: "QMD_ALPHA_ONLY",
          mode: "hybrid",
          projectId: projectBId,
        }),
      })
    );
    expect(searchBRes.status).toBe(200);
    const searchB = QmdSearchResponseSchema.parse(await searchBRes.json());
    expect(searchB.hits.every((h) => h.scopeId !== clientAId)).toBe(true);

    // Busca em Projeto A encontra QMD_ALPHA_ONLY do Cliente A
    const searchARes = await searchMemoriesQmd(
      new Request("http://localhost:3000/api/memories/search", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: devCookie },
        body: JSON.stringify({
          query: "QMD_ALPHA_ONLY",
          mode: "lexical",
          projectId: projectAId,
        }),
      })
    );
    expect(searchARes.status).toBe(200);
    const searchA = QmdSearchResponseSchema.parse(await searchARes.json());
    expect(searchA.hits[0]?.snippet).toContain("QMD_ALPHA_ONLY");

    // Reindex: developer/auditor -> 403; owner -> 200
    const devReindex = await reindexQmd(
      new Request("http://localhost:3000/api/qmd/reindex", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: devCookie },
        body: JSON.stringify({ includeDocs: false }),
      })
    );
    expect(devReindex.status).toBe(403);

    const ownerReindex = await reindexQmd(
      new Request("http://localhost:3000/api/qmd/reindex", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({ includeDocs: false, force: true }),
      })
    );
    expect(ownerReindex.status).toBe(200);
    const reindexBody = QmdReindexResponseSchema.parse(await ownerReindex.json());
    expect(reindexBody.totalChunks).toBeGreaterThanOrEqual(2);
  });
});
