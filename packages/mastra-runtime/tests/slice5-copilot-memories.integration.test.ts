import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  clients,
  closeDb,
  deliverables,
  ensureDefaultOrgAndInternalClient,
  getDb,
  organizations,
  projectRepositories,
  projects,
  users,
  type UzinaDb,
} from "@uzina/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  EXECUTIVE_COPILOT_TOOL_IDS,
  assertValidMemoryScope,
  createMastraRuntime,
  createMemoryScoped,
  resetMastraStorageForTests,
  resolveHierarchicalMemories,
  streamExecutiveCopilot,
} from "../src/index.js";

function makeTempRepoWithSecret(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-s5-copilot-repo-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "ci@uzina.local"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Uzina CI"], { cwd: dir });
  fs.writeFileSync(
    path.join(dir, "app.ts"),
    'export const demo = "ghp_1234567890abcdefghijklmnopqrstuvwxyz1234";\n',
    "utf8"
  );
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-m", "chore: seed"], { cwd: dir });
  return dir;
}

describe("@uzina/mastra-runtime — Slice 5 (Co-piloto Executivo & Memória em 3 Escopos)", () => {
  let db: UzinaDb;
  let organizationId: string;
  let userId: string;
  const cleanupDirs: string[] = [];

  beforeAll(async () => {
    await resetMastraStorageForTests();
    await closeDb();
    const ctx = await getDb({ dataDir: ":memory:" });
    db = ctx.db;
    const seeded = await ensureDefaultOrgAndInternalClient(db);
    organizationId = seeded.organizationId;

    const [user] = await db
      .insert(users)
      .values({
        name: "Exec Copilot User",
        email: `copilot-${crypto.randomUUID().slice(0, 6)}@uzina.local`,
        organizationId,
        role: "developer",
      })
      .returning();
    userId = user!.id;
  });

  afterAll(async () => {
    await resetMastraStorageForTests();
    await closeDb();
    for (const dir of cleanupDirs.splice(0, cleanupDirs.length)) {
      try {
        fs.rmSync(dir, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 150,
        });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EBUSY") {
          throw err;
        }
      }
    }
  });

  test("isola memórias entre Cliente A e Cliente B e resolve hierarquia org -> client -> project", async () => {
    const [clientA] = await db
      .insert(clients)
      .values({
        organizationId,
        name: "Cliente Alpha",
        slug: `cliente-a-${crypto.randomUUID().slice(0, 5)}`,
      })
      .returning();

    const [clientB] = await db
      .insert(clients)
      .values({
        organizationId,
        name: "Cliente Beta",
        slug: `cliente-b-${crypto.randomUUID().slice(0, 5)}`,
      })
      .returning();

    const [projA] = await db
      .insert(projects)
      .values({
        clientId: clientA!.id,
        name: "Projeto Alpha",
        slug: `proj-a-${crypto.randomUUID().slice(0, 5)}`,
      })
      .returning();

    const [projB] = await db
      .insert(projects)
      .values({
        clientId: clientB!.id,
        name: "Projeto Beta",
        slug: `proj-b-${crypto.randomUUID().slice(0, 5)}`,
      })
      .returning();

    await createMemoryScoped(db, {
      organizationId,
      input: {
        scopeType: "org",
        scopeId: organizationId,
        category: "convention",
        title: "Padrão Zod Global",
        content: "Todas as rotas usam Zod strict.",
      },
    });

    await createMemoryScoped(db, {
      organizationId,
      input: {
        scopeType: "client",
        scopeId: clientA!.id,
        category: "domain_rule",
        title: "Sigilo Cliente A",
        content: "Regra confidencial exclusiva do Cliente A.",
      },
    });

    await createMemoryScoped(db, {
      organizationId,
      input: {
        scopeType: "project",
        scopeId: projA!.id,
        category: "architecture",
        title: "Stack Projeto A",
        content: "API REST Node 22.",
      },
    });

    await createMemoryScoped(db, {
      organizationId,
      input: {
        scopeType: "client",
        scopeId: clientB!.id,
        category: "preference",
        title: "Preferência Cliente B",
        content: "Tema Claro padrão.",
      },
    });

    const resolvedForProjB = await resolveHierarchicalMemories(db, {
      organizationId,
      projectId: projB!.id,
    });

    const titlesB = resolvedForProjB.map((m) => m.title);
    expect(titlesB).toContain("Padrão Zod Global");
    expect(titlesB).toContain("Preferência Cliente B");
    expect(titlesB).not.toContain("Sigilo Cliente A");
    expect(titlesB).not.toContain("Stack Projeto A");

    const resolvedForClientA = await resolveHierarchicalMemories(db, {
      organizationId,
      clientId: clientA!.id,
    });
    const titlesA = resolvedForClientA.map((m) => m.title);
    expect(titlesA).toContain("Padrão Zod Global");
    expect(titlesA).toContain("Sigilo Cliente A");
    expect(titlesA).not.toContain("Preferência Cliente B");

    // Redação automática de segredos em createMemoryScoped e rejeição cross-org para client/project/deliverable
    const redactedMemory = await createMemoryScoped(db, {
      organizationId,
      input: {
        scopeType: "org",
        scopeId: organizationId,
        category: "convention",
        title: "Segredo Redigido",
        content: "Nunca usar sk-or-v1-1234567890abcdef1234567890abcdef no prompt.",
      },
    });
    expect(redactedMemory.content).not.toContain(
      "sk-or-v1-1234567890abcdef1234567890abcdef"
    );
    expect(redactedMemory.content).toContain("[REDACTED");

    // Cross-org scope validation deve falhar para org, client, project e sourceDeliverableId
    const [otherOrg] = await db
      .insert(organizations)
      .values({
        name: "Outra Org",
        slug: `other-org-${crypto.randomUUID().slice(0, 5)}`,
      })
      .returning();

    const [otherClient] = await db
      .insert(clients)
      .values({
        organizationId: otherOrg!.id,
        name: "Cliente Outra Org",
        slug: `other-cli-${crypto.randomUUID().slice(0, 5)}`,
      })
      .returning();

    const [otherProj] = await db
      .insert(projects)
      .values({
        clientId: otherClient!.id,
        name: "Proj Outra Org",
        slug: `other-proj-${crypto.randomUUID().slice(0, 5)}`,
      })
      .returning();

    await expect(
      assertValidMemoryScope(db, organizationId, "org", otherOrg!.id)
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      assertValidMemoryScope(db, organizationId, "client", otherClient!.id)
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      assertValidMemoryScope(db, organizationId, "project", otherProj!.id)
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      createMemoryScoped(db, {
        organizationId,
        input: {
          scopeType: "org",
          scopeId: organizationId,
          category: "architecture",
          title: "Fonte Invasora",
          content: "Tentativa de vincular entregável alheio.",
          sourceDeliverableId: crypto.randomUUID(),
        },
      })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  test("registra executiveCopilot sem ferramentas de escrita em disco/shell/merged e executa streaming + ações permitidas", async () => {
    const mastraDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-s5-mastra-"));
    cleanupDirs.push(mastraDir);

    const repoDir = makeTempRepoWithSecret();
    cleanupDirs.push(repoDir);

    const [client] = await db
      .insert(clients)
      .values({
        organizationId,
        name: "Cliente Copiloto",
        slug: `cli-cop-${crypto.randomUUID().slice(0, 5)}`,
      })
      .returning();

    const [project] = await db
      .insert(projects)
      .values({
        clientId: client!.id,
        name: "Projeto Copiloto",
        slug: `proj-cop-${crypto.randomUUID().slice(0, 5)}`,
      })
      .returning();

    await db.insert(projectRepositories).values({
      projectId: project!.id,
      name: "repo-copiloto",
      localPath: repoDir,
      defaultBranch: "main",
    });

    const runtime = await createMastraRuntime({
      db,
      dataDir: mastraDir,
      securityRunnerDeps: {
        commandRunner: async () => ({
          status: "missing_binary",
          exitCode: null,
          stdout: "",
          stderr: "ENOENT",
          durationMs: 1,
        }),
      },
    });

    try {
      const copilotAgent = runtime.mastra.getAgent("executiveCopilot");
      const registeredToolsMap = await copilotAgent.listTools();
      const registeredTools = Object.keys(registeredToolsMap);
      expect(registeredTools.sort()).toEqual(
        [...EXECUTIVE_COPILOT_TOOL_IDS].sort()
      );
      expect(registeredTools).not.toContain("bash");
      expect(registeredTools).not.toContain("write");
      expect(registeredTools).not.toContain("git");
      expect(registeredTools).not.toContain("merge_deliverable");

      // Invariant AppSec: nenhuma tool expõe organizationId/userId/role no inputSchema para o LLM
      for (const toolDef of Object.values(registeredToolsMap)) {
        const schema = (toolDef as { inputSchema?: { shape?: Record<string, unknown> } })
          .inputSchema;
        const shapeKeys = Object.keys(schema?.shape ?? {});
        expect(shapeKeys).not.toContain("organizationId");
        expect(shapeKeys).not.toContain("userId");
        expect(shapeKeys).not.toContain("role");
      }

      // 1. Streaming de resumo + criação de rascunho (developer permitido)
      const draftEvents = [];
      for await (const ev of streamExecutiveCopilot({
        db,
        actor: { organizationId, userId, role: "developer" },
        request: {
          messages: [{ role: "user", content: "Crie um rascunho de entrega." }],
          projectId: project!.id,
          action: {
            type: "draft_deliverable",
            projectId: project!.id,
            title: "Auditoria de Checkout",
            hasUi: true,
          },
        },
      })) {
        draftEvents.push(ev);
      }

      expect(draftEvents.some((e) => e.type === "tool_call")).toBe(true);
      expect(draftEvents.some((e) => e.type === "token")).toBe(true);
      expect(draftEvents.at(-1)).toMatchObject({
        type: "done",
        finishReason: "completed",
      });

      const createdDelivs = await db
        .select()
        .from(deliverables)
        .where(eq(deliverables.projectId, project!.id));
      expect(createdDelivs).toHaveLength(1);
      expect(createdDelivs[0]!.status).toBe("discovery");

      // 2. Auditor é bloqueado ao tentar draft_deliverable
      const auditorEvents = [];
      for await (const ev of streamExecutiveCopilot({
        db,
        actor: { organizationId, userId, role: "auditor" },
        request: {
          messages: [{ role: "user", content: "Criar rascunho" }],
          action: {
            type: "draft_deliverable",
            projectId: project!.id,
            title: "Proibido Auditor",
          },
        },
      })) {
        auditorEvents.push(ev);
      }
      expect(auditorEvents.some((e) => e.type === "error")).toBe(true);
      const afterAuditorDelivs = await db
        .select()
        .from(deliverables)
        .where(eq(deliverables.projectId, project!.id));
      expect(
        afterAuditorDelivs.some((d) => d.title === "Proibido Auditor")
      ).toBe(false);

      // 2b. Auditor também é bloqueado em trigger_security_scan e tentativa cross-tenant retorna erro
      const auditorScanEvents = [];
      for await (const ev of streamExecutiveCopilot({
        db,
        actor: { organizationId, userId, role: "auditor" },
        request: {
          messages: [{ role: "user", content: "Rodar scan" }],
          action: {
            type: "trigger_security_scan",
            projectId: project!.id,
          },
        },
      })) {
        auditorScanEvents.push(ev);
      }
      expect(auditorScanEvents.some((e) => e.type === "error")).toBe(true);

      const crossTenantEvents = [];
      for await (const ev of streamExecutiveCopilot({
        db,
        actor: {
          organizationId: crypto.randomUUID(),
          userId,
          role: "owner",
        },
        request: {
          messages: [{ role: "user", content: "Rascunho cross-tenant" }],
          action: {
            type: "draft_deliverable",
            projectId: project!.id,
            title: "Cross Tenant Bloqueado",
          },
        },
      })) {
        crossTenantEvents.push(ev);
      }
      expect(crossTenantEvents.some((e) => e.type === "error")).toBe(true);

      // 3. Disparo de scan via Co-piloto executa @uzina/security-engine e detecta o segredo do repo
      const scanEvents = [];
      for await (const ev of streamExecutiveCopilot({
        db,
        actor: { organizationId, userId, role: "owner" },
        request: {
          messages: [{ role: "user", content: "Rodar AppSec" }],
          projectId: project!.id,
          action: {
            type: "trigger_security_scan",
            projectId: project!.id,
          },
        },
        securityRunnerDeps: {
          commandRunner: async () => ({
            status: "missing_binary",
            exitCode: null,
            stdout: "",
            stderr: "ENOENT",
            durationMs: 1,
          }),
        },
      })) {
        scanEvents.push(ev);
      }
      expect(
        scanEvents.some(
          (e) =>
            e.type === "tool_result" &&
            e.toolName === "trigger_security_scan" &&
            Number(e.output.totalFindings) >= 1
        )
      ).toBe(true);
    } finally {
      await runtime.close();
    }
  });
});
