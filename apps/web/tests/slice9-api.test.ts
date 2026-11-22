import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DesignPrototypeListResponseSchema,
  DesignPrototypeSchema,
  StitchMcpSyncResponseSchema,
} from "@uzina/contracts";
import { closeDb, getDb, organizations, users } from "@uzina/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { POST as authPost } from "../src/app/api/auth/[...all]/route";
import { GET as getClients, POST as createClient } from "../src/app/api/clients/route";
import { PATCH as approvePrototype } from "../src/app/api/projects/[id]/prototypes/[prototypeId]/route";
import { GET as listPrototypes, POST as createPrototype } from "../src/app/api/projects/[id]/prototypes/route";
import { POST as syncStitch } from "../src/app/api/projects/[id]/prototypes/stitch/route";
import { POST as createRepository } from "../src/app/api/projects/[id]/repositories/route";
import { POST as createProject } from "../src/app/api/projects/route";
import {
  GET as getPrototypePreview,
  PROTOTYPE_PREVIEW_CSP,
} from "../src/app/api/prototypes/[id]/preview/route";
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

describe("Slice 9 APIs — Estúdio Visual 3 Níveis, Stitch, Preview CSP/Anti-XSS & RBAC", () => {
  let ownerCookie = "";
  let auditorCookie = "";
  let otherOrgCookie = "";
  let projectId = "";
  const tempDirs: string[] = [];

  beforeAll(async () => {
    await resetWebWorkflowRuntimeForTests();
    resetAuthForTests();
    await closeDb();

    ownerCookie = await signUpCookie("Owner S9", "owner-s9@uzina.studio");
    auditorCookie = await signUpCookie("Auditor S9", "auditor-s9@uzina.studio");
    otherOrgCookie = await signUpCookie("Other S9", "other-s9@uzina.studio");

    await getClients(
      new Request("http://localhost:3000/api/clients", {
        headers: { cookie: ownerCookie },
      })
    );

    const { db } = await getDb();
    const [ownerRow] = await db
      .select()
      .from(users)
      .where(eq(users.email, "owner-s9@uzina.studio"));

    await db
      .update(users)
      .set({ organizationId: ownerRow!.organizationId, role: "auditor" })
      .where(eq(users.email, "auditor-s9@uzina.studio"));

    const [otherOrg] = await db
      .insert(organizations)
      .values({
        name: "Org Isolada S9",
        slug: `other-org-s9-${crypto.randomUUID().slice(0, 6)}`,
      })
      .returning();
    await db
      .update(users)
      .set({ organizationId: otherOrg!.id, role: "owner" })
      .where(eq(users.email, "other-s9@uzina.studio"));

    const cliRes = await createClient(
      new Request("http://localhost:3000/api/clients", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({ name: "Cliente S9", slug: "cliente-s9" }),
      })
    );
    const cli = (await cliRes.json()) as { id: string };

    const projRes = await createProject(
      new Request("http://localhost:3000/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({
          clientId: cli.id,
          name: "Projeto Stitch S9",
          slug: "projeto-stitch-s9",
        }),
      })
    );
    const proj = (await projRes.json()) as { id: string };
    projectId = proj.id;

    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-s9-web-"));
    tempDirs.push(repoDir);
    await createRepository(
      new Request(`http://localhost:3000/api/projects/${projectId}/repositories`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({ name: "repo-s9", localPath: repoDir }),
      }),
      { params: Promise.resolve({ id: projectId }) }
    );
  });

  afterAll(async () => {
    await resetWebWorkflowRuntimeForTests();
    resetAuthForTests();
    await closeDb();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("impõe 401/403/404/413, sanitiza XSS no preview com CSP e aprova com handoff", async () => {
    const unauth = await listPrototypes(
      new Request(`http://localhost:3000/api/projects/${projectId}/prototypes`),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(unauth.status).toBe(401);

    const forbidden = await createPrototype(
      new Request(`http://localhost:3000/api/projects/${projectId}/prototypes`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: auditorCookie },
        body: JSON.stringify({ title: "Auditor Blocked", level: 3 }),
      }),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(forbidden.status).toBe(403);

    const oversized = await createPrototype(
      new Request(`http://localhost:3000/api/projects/${projectId}/prototypes`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({
          title: "Oversized",
          level: 3,
          html: "<div>" + "a".repeat(2 * 1024 * 1024 + 10) + "</div>",
        }),
      }),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(oversized.status).toBe(413);

    const createRes = await createPrototype(
      new Request(`http://localhost:3000/api/projects/${projectId}/prototypes`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({
          title: "Stitch Checkout",
          level: 3,
          source: "stitch_import",
          html: '<main class="p-6 rounded-xl"><h1>Checkout Seguro</h1><script>alert(9)</script><img src="https://x.test/a.png" onerror="hack()"></main>',
        }),
      }),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(createRes.status).toBe(201);
    const created = DesignPrototypeSchema.parse(await createRes.json());

    const previewRes = await getPrototypePreview(
      new Request(`http://localhost:3000/api/prototypes/${created.id}/preview`, {
        headers: { cookie: ownerCookie },
      }),
      { params: Promise.resolve({ id: created.id }) }
    );
    expect(previewRes.status).toBe(200);
    expect(previewRes.headers.get("content-security-policy")).toBe(
      PROTOTYPE_PREVIEW_CSP
    );
    const previewHtml = await previewRes.text();
    expect(previewHtml).toContain("<h1>Checkout Seguro</h1>");
    expect(previewHtml.toLowerCase()).not.toContain("<script");
    expect(previewHtml.toLowerCase()).not.toContain("onerror");

    const crossOrgPreview = await getPrototypePreview(
      new Request(`http://localhost:3000/api/prototypes/${created.id}/preview`, {
        headers: { cookie: otherOrgCookie },
      }),
      { params: Promise.resolve({ id: created.id }) }
    );
    expect(crossOrgPreview.status).toBe(404);

    const approveRes = await approvePrototype(
      new Request(
        `http://localhost:3000/api/projects/${projectId}/prototypes/${created.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json", cookie: ownerCookie },
          body: JSON.stringify({ approved: true, syncDesignMd: true }),
        }
      ),
      { params: Promise.resolve({ id: projectId, prototypeId: created.id }) }
    );
    expect(approveRes.status).toBe(200);
    const approved = DesignPrototypeSchema.parse(await approveRes.json());
    expect(approved.approved).toBe(true);
    expect(approved.handoffPath).toBe(`.uzina/prototypes/${created.id}`);

    const listRes = await listPrototypes(
      new Request(`http://localhost:3000/api/projects/${projectId}/prototypes`, {
        headers: { cookie: ownerCookie },
      }),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(listRes.status).toBe(200);
    DesignPrototypeListResponseSchema.parse(await listRes.json());

    const stitchRes = await syncStitch(
      new Request(
        `http://localhost:3000/api/projects/${projectId}/prototypes/stitch`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie: ownerCookie },
          body: JSON.stringify({ action: "list_screens" }),
        }
      ),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(stitchRes.status).toBe(200);
    StitchMcpSyncResponseSchema.parse(await stitchRes.json());
  });
});
