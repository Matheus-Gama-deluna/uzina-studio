import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CleanupProjectWorktreesResponseSchema,
  DesignPrototypeListResponseSchema,
  ProjectWorktreeListResponseSchema,
} from "@uzina/contracts";
import {
  clients,
  closeDb,
  deliverables,
  getDb,
  projectRepositories,
  projects,
  users,
} from "@uzina/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { POST as authPost } from "../src/app/api/auth/[...all]/route";
import { GET as getClients } from "../src/app/api/clients/route";
import {
  GET as getPrototypes,
  POST as createPrototype,
} from "../src/app/api/projects/[id]/prototypes/route";
import {
  DELETE as deleteProjectWorktrees,
  GET as getProjectWorktrees,
} from "../src/app/api/projects/[id]/worktrees/route";
import { resetAuthForTests } from "../src/lib/auth";
import { resetWebWorkflowRuntimeForTests } from "../src/lib/workflow-runtime";

function cookieOf(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]?.trim() ?? "")
    .filter(Boolean)
    .join("; ");
}

async function signUp(name: string, email: string): Promise<string> {
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

describe("Slice 24 — API /api/projects/[id]/worktrees & Histórico de Versões de Protótipos", () => {
  let ownerCookie = "";
  let auditorCookie = "";
  let otherOrgCookie = "";
  let projectId = "";
  let orphanWorktreePath = "";
  const tempDirs: string[] = [];

  beforeAll(async () => {
    await resetWebWorkflowRuntimeForTests();
    resetAuthForTests();
    await closeDb();

    ownerCookie = await signUp("Owner S24", "owner-s24@uzina.studio");
    auditorCookie = await signUp("Auditor S24", "auditor-s24@uzina.studio");
    otherOrgCookie = await signUp("Other S24", "other-s24@uzina.studio");

    await getClients(
      new Request("http://localhost:3000/api/clients", {
        headers: { cookie: ownerCookie },
      })
    );

    const { db } = await getDb();
    const [ownerRow] = await db
      .select()
      .from(users)
      .where(eq(users.email, "owner-s24@uzina.studio"));

    await db
      .update(users)
      .set({ organizationId: ownerRow!.organizationId!, role: "auditor" })
      .where(eq(users.email, "auditor-s24@uzina.studio"));

    const [client] = await db
      .insert(clients)
      .values({
        organizationId: ownerRow!.organizationId!,
        name: "Cliente S24",
        slug: `cliente-s24-${crypto.randomUUID().slice(0, 6)}`,
      })
      .returning();

    const [project] = await db
      .insert(projects)
      .values({
        clientId: client!.id,
        name: "Projeto S24",
        slug: `proj-s24-${crypto.randomUUID().slice(0, 6)}`,
      })
      .returning();
    projectId = project!.id;

    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-s24-web-"));
    tempDirs.push(repoDir);
    execFileSync("git", ["init", "-b", "main"], { cwd: repoDir, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "Uzina Web S24"], {
      cwd: repoDir,
      stdio: "ignore",
    });
    execFileSync("git", ["config", "user.email", "s24-web@uzina.studio"], {
      cwd: repoDir,
      stdio: "ignore",
    });
    fs.writeFileSync(path.join(repoDir, "README.md"), "# Web S24\n", "utf8");
    execFileSync("git", ["add", "."], { cwd: repoDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "chore: initial"], {
      cwd: repoDir,
      stdio: "ignore",
    });

    const [repo] = await db
      .insert(projectRepositories)
      .values({
        projectId,
        name: "repo-web-s24",
        localPath: repoDir,
        defaultBranch: "main",
      })
      .returning();

    const [deliv] = await db
      .insert(deliverables)
      .values({
        projectId,
        repositoryId: repo!.id,
        title: "Entrega Órfã S24",
        status: "merged",
      })
      .returning();

    const wtPath = path.join(
      repoDir,
      ".worktrees",
      `task-${deliv!.id.slice(0, 8)}`
    );
    const branchName = `uzina/${deliv!.id.slice(0, 8)}`;
    fs.mkdirSync(path.dirname(wtPath), { recursive: true });
    execFileSync("git", ["worktree", "add", "-b", branchName, wtPath, "main"], {
      cwd: repoDir,
      stdio: "ignore",
    });
    orphanWorktreePath = wtPath;

    await db
      .update(deliverables)
      .set({
        worktreePath: wtPath,
        branchName,
      })
      .where(eq(deliverables.id, deliv!.id));
  });

  afterAll(async () => {
    await resetWebWorkflowRuntimeForTests();
    resetAuthForTests();
    await closeDb();
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("GET e DELETE /api/projects/[id]/worktrees aplicam auth/RBAC/multi-tenant e removem worktree órfão", async () => {
    const unauthRes = await getProjectWorktrees(
      new Request(`http://localhost:3000/api/projects/${projectId}/worktrees`),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(unauthRes.status).toBe(401);

    const invalidIdRes = await getProjectWorktrees(
      new Request("http://localhost:3000/api/projects/not-a-uuid/worktrees", {
        headers: { cookie: ownerCookie },
      }),
      { params: Promise.resolve({ id: "not-a-uuid" }) }
    );
    expect(invalidIdRes.status).toBe(400);

    const crossOrgRes = await getProjectWorktrees(
      new Request(`http://localhost:3000/api/projects/${projectId}/worktrees`, {
        headers: { cookie: otherOrgCookie },
      }),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(crossOrgRes.status).toBe(404);

    const listRes = await getProjectWorktrees(
      new Request(`http://localhost:3000/api/projects/${projectId}/worktrees`, {
        headers: { cookie: ownerCookie },
      }),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(listRes.status).toBe(200);
    const listed = ProjectWorktreeListResponseSchema.parse(await listRes.json());
    expect(listed.orphanCount).toBe(1);
    expect(listed.items.some((i) => i.isMain)).toBe(true);
    expect(listed.items.some((i) => i.isOrphan)).toBe(true);

    const forbiddenDeleteRes = await deleteProjectWorktrees(
      new Request(`http://localhost:3000/api/projects/${projectId}/worktrees`, {
        method: "DELETE",
        headers: { "content-type": "application/json", cookie: auditorCookie },
        body: JSON.stringify({ pruneAllOrphans: true }),
      }),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(forbiddenDeleteRes.status).toBe(403);

    const badDeleteRes = await deleteProjectWorktrees(
      new Request(`http://localhost:3000/api/projects/${projectId}/worktrees`, {
        method: "DELETE",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({ unknownField: true }),
      }),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(badDeleteRes.status).toBe(400);

    const badJsonDeleteRes = await deleteProjectWorktrees(
      new Request(`http://localhost:3000/api/projects/${projectId}/worktrees`, {
        method: "DELETE",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: "{invalid-json",
      }),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(badJsonDeleteRes.status).toBe(400);

    const mainWorktreeItem = listed.items.find((i) => i.isMain)!;
    const conflictMainRes = await deleteProjectWorktrees(
      new Request(`http://localhost:3000/api/projects/${projectId}/worktrees`, {
        method: "DELETE",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({
          worktreePath: mainWorktreeItem.worktreePath,
          pruneAllOrphans: false,
        }),
      }),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(conflictMainRes.status).toBe(409);

    // Remoção direcionada por worktreePath específico
    const targetRemoveRes = await deleteProjectWorktrees(
      new Request(`http://localhost:3000/api/projects/${projectId}/worktrees`, {
        method: "DELETE",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({
          worktreePath: orphanWorktreePath,
          pruneAllOrphans: false,
        }),
      }),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(targetRemoveRes.status).toBe(200);
    const pruned = CleanupProjectWorktreesResponseSchema.parse(
      await targetRemoveRes.json()
    );
    expect(pruned.removedPaths).toEqual([orphanWorktreePath]);
    expect(fs.existsSync(orphanWorktreePath)).toBe(false);

    const afterRes = await getProjectWorktrees(
      new Request(`http://localhost:3000/api/projects/${projectId}/worktrees`, {
        headers: { cookie: ownerCookie },
      }),
      { params: Promise.resolve({ id: projectId }) }
    );
    const afterList = ProjectWorktreeListResponseSchema.parse(
      await afterRes.json()
    );
    expect(afterList.orphanCount).toBe(0);
  });

  test("GET /api/projects/[id]/prototypes aplica auth/multi-tenant e retorna versões ordenáveis v1..vN com previewUrl", async () => {
    const unauthProtoRes = await getPrototypes(
      new Request(`http://localhost:3000/api/projects/${projectId}/prototypes`),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(unauthProtoRes.status).toBe(401);

    const crossOrgProtoRes = await getPrototypes(
      new Request(`http://localhost:3000/api/projects/${projectId}/prototypes`, {
        headers: { cookie: otherOrgCookie },
      }),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(crossOrgProtoRes.status).toBe(404);

    const p1Res = await createPrototype(
      new Request(`http://localhost:3000/api/projects/${projectId}/prototypes`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({
          title: "Protótipo v1",
          level: 3,
          source: "stitch_import",
          html: "<html><body><main><h1>V1</h1></main></body></html>",
        }),
      }),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(p1Res.status).toBe(201);

    const p2Res = await createPrototype(
      new Request(`http://localhost:3000/api/projects/${projectId}/prototypes`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({
          title: "Protótipo v2",
          level: 3,
          source: "stitch_import",
          html: "<html><body><main><h1>V2</h1></main></body></html>",
        }),
      }),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(p2Res.status).toBe(201);

    const listRes = await getPrototypes(
      new Request(`http://localhost:3000/api/projects/${projectId}/prototypes`, {
        headers: { cookie: ownerCookie },
      }),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(listRes.status).toBe(200);
    const list = DesignPrototypeListResponseSchema.parse(await listRes.json());
    const orderedAsc = [...list.items].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt)
    );
    expect(orderedAsc.map((p) => p.title)).toEqual([
      "Protótipo v1",
      "Protótipo v2",
    ]);
    expect(orderedAsc[0]?.previewUrl).toMatch(/^\/api\/prototypes\/.*\/preview$/);
    expect(orderedAsc[1]?.previewUrl).toMatch(/^\/api\/prototypes\/.*\/preview$/);
  });
});
