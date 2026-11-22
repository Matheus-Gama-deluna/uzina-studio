import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CodebaseReindexResponseSchema,
  CodebaseTreeResponseSchema,
  ProvenanceListResponseSchema,
  SymbolGraphResponseSchema,
  SymbolSliceResponseSchema,
} from "@uzina/contracts";
import { closeDb, getDb, organizations, users } from "@uzina/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { POST as authPost } from "../src/app/api/auth/[...all]/route";
import { GET as getClients, POST as createClient } from "../src/app/api/clients/route";
import { GET as getCodebaseProvenance } from "../src/app/api/projects/[id]/codebase/provenance/route";
import { POST as reindexCodebase } from "../src/app/api/projects/[id]/codebase/reindex/route";
import { GET as getCodebaseTree } from "../src/app/api/projects/[id]/codebase/route";
import { POST as queryCodebaseSymbols } from "../src/app/api/projects/[id]/codebase/symbols/route";
import { POST as createRepository } from "../src/app/api/projects/[id]/repositories/route";
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

describe("Slice 8 APIs — Codebase Intelligence (AST, Esqueleto, Slice, Provenance & RBAC)", () => {
  let ownerCookie = "";
  let auditorCookie = "";
  let otherOrgCookie = "";
  let projectId = "";
  const tempDirs: string[] = [];

  beforeAll(async () => {
    await resetWebWorkflowRuntimeForTests();
    resetAuthForTests();
    await closeDb();

    ownerCookie = await signUpCookie("Owner S8", "owner-s8@uzina.studio");
    auditorCookie = await signUpCookie("Auditor S8", "auditor-s8@uzina.studio");
    otherOrgCookie = await signUpCookie("Other S8", "other-s8@uzina.studio");

    await getClients(
      new Request("http://localhost:3000/api/clients", {
        headers: { cookie: ownerCookie },
      })
    );

    const { db } = await getDb();
    const [ownerRow] = await db
      .select()
      .from(users)
      .where(eq(users.email, "owner-s8@uzina.studio"));
    expect(ownerRow?.organizationId).toBeTruthy();

    await db
      .update(users)
      .set({ organizationId: ownerRow!.organizationId, role: "auditor" })
      .where(eq(users.email, "auditor-s8@uzina.studio"));

    const [otherOrg] = await db
      .insert(organizations)
      .values({
        name: "Org Isolada S8",
        slug: `other-org-s8-${crypto.randomUUID().slice(0, 6)}`,
      })
      .returning();
    await db
      .update(users)
      .set({ organizationId: otherOrg!.id, role: "owner" })
      .where(eq(users.email, "other-s8@uzina.studio"));

    const cliRes = await createClient(
      new Request("http://localhost:3000/api/clients", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({ name: "Cliente S8", slug: "cliente-s8" }),
      })
    );
    const cli = (await cliRes.json()) as { id: string };

    const projRes = await createProject(
      new Request("http://localhost:3000/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({
          clientId: cli.id,
          name: "Projeto AST S8",
          slug: "projeto-ast-s8",
        }),
      })
    );
    const proj = (await projRes.json()) as { id: string };
    projectId = proj.id;

    const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-s8-web-"));
    tempDirs.push(tempRepo);
    fs.mkdirSync(path.join(tempRepo, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(tempRepo, "src", "tax.ts"),
      `export function computeTax(v: number): number {\n  return v * 0.1;\n}\n`,
      "utf8"
    );

    const repoRes = await createRepository(
      new Request(`http://localhost:3000/api/projects/${projectId}/repositories`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({ name: "repo-s8", localPath: tempRepo }),
      }),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(repoRes.status).toBe(201);
  });

  afterAll(async () => {
    await resetWebWorkflowRuntimeForTests();
    resetAuthForTests();
    await closeDb();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("impõe 401/400/403/404, reindex incremental, grafo AST, leitura de fatia e proveniência", async () => {
    // 401 sem sessão
    const unauth = await getCodebaseTree(
      new Request(`http://localhost:3000/api/projects/${projectId}/codebase`),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(unauth.status).toBe(401);

    // 403 auditor tentando reindexar
    const forbidden = await reindexCodebase(
      new Request(
        `http://localhost:3000/api/projects/${projectId}/codebase/reindex`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie: auditorCookie },
          body: JSON.stringify({}),
        }
      ),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(forbidden.status).toBe(403);

    // 404 cross-org
    const crossOrg = await getCodebaseTree(
      new Request(`http://localhost:3000/api/projects/${projectId}/codebase`, {
        headers: { cookie: otherOrgCookie },
      }),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(crossOrg.status).toBe(404);

    // 400 UUID inválido
    const invalidId = await getCodebaseTree(
      new Request("http://localhost:3000/api/projects/not-a-uuid/codebase", {
        headers: { cookie: ownerCookie },
      }),
      { params: Promise.resolve({ id: "not-a-uuid" }) }
    );
    expect(invalidId.status).toBe(400);

    // 200 reindex
    const reindexRes = await reindexCodebase(
      new Request(
        `http://localhost:3000/api/projects/${projectId}/codebase/reindex`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie: ownerCookie },
          body: JSON.stringify({}),
        }
      ),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(reindexRes.status).toBe(200);
    const reindexData = CodebaseReindexResponseSchema.parse(
      await reindexRes.json()
    );
    expect(reindexData.indexedFiles).toBe(1);
    expect(reindexData.totalSymbols).toBe(1);

    // 200 tree + skeleton
    const treeRes = await getCodebaseTree(
      new Request(`http://localhost:3000/api/projects/${projectId}/codebase`, {
        headers: { cookie: ownerCookie },
      }),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(treeRes.status).toBe(200);
    const treeData = CodebaseTreeResponseSchema.parse(await treeRes.json());
    expect(treeData.skeleton.skeletonText).toContain("computeTax");

    // 200 graph search
    const graphRes = await queryCodebaseSymbols(
      new Request(
        `http://localhost:3000/api/projects/${projectId}/codebase/symbols`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie: ownerCookie },
          body: JSON.stringify({ symbol: "computeTax", depth: 2 }),
        }
      ),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(graphRes.status).toBe(200);
    const graphData = SymbolGraphResponseSchema.parse(await graphRes.json());
    expect(graphData.nodes[0]?.name).toBe("computeTax");

    // 200 slice
    const sliceRes = await queryCodebaseSymbols(
      new Request(
        `http://localhost:3000/api/projects/${projectId}/codebase/symbols`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie: ownerCookie },
          body: JSON.stringify({
            mode: "slice",
            path: "src/tax.ts",
            symbol: "computeTax",
          }),
        }
      ),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(sliceRes.status).toBe(200);
    const sliceData = SymbolSliceResponseSchema.parse(await sliceRes.json());
    expect(sliceData.code).toContain("computeTax");

    // 200 provenance
    const provRes = await getCodebaseProvenance(
      new Request(
        `http://localhost:3000/api/projects/${projectId}/codebase/provenance`,
        { headers: { cookie: ownerCookie } }
      ),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(provRes.status).toBe(200);
    ProvenanceListResponseSchema.parse(await provRes.json());
  });
});
