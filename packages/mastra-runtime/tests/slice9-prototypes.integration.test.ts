import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  clients,
  closeDb,
  ensureDefaultOrgAndInternalClient,
  getDb,
  organizations,
  projectRepositories,
  projects,
  type UzinaDb,
} from "@uzina/db";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  approvePrototypeScoped,
  createOrImportPrototypeScoped,
  listProjectPrototypesScoped,
  readPrototypePreviewHtmlScoped,
  resetMastraStorageForTests,
  syncStitchMcpScreensScoped,
} from "../src/index.js";

describe("@uzina/mastra-runtime — Slice 9 Estúdio Visual 3 Níveis, Stitch MCP & Handoff", () => {
  let db: UzinaDb;
  let organizationId: string;
  let projectId: string;
  let repoDir: string;
  let dataDir: string;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    await resetMastraStorageForTests();
    await closeDb();
    const ctx = await getDb({ dataDir: ":memory:" });
    db = ctx.db;
    const seeded = await ensureDefaultOrgAndInternalClient(db);
    organizationId = seeded.organizationId;

    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-s9-repo-"));
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-s9-data-"));
    tempDirs.push(repoDir, dataDir);

    const [client] = await db
      .insert(clients)
      .values({
        organizationId,
        name: "Cliente Stitch",
        slug: `cli-s9-${crypto.randomUUID().slice(0, 5)}`,
      })
      .returning();

    const [proj] = await db
      .insert(projects)
      .values({
        clientId: client!.id,
        name: "Projeto Stitch",
        slug: `proj-s9-${crypto.randomUUID().slice(0, 5)}`,
      })
      .returning();
    projectId = proj!.id;

    await db.insert(projectRepositories).values({
      projectId,
      name: "repo-s9",
      localPath: repoDir,
    });
  });

  afterAll(async () => {
    await resetMastraStorageForTests();
    await closeDb();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("importa HTML com XSS sanitizado, aprova com handoff em .uzina/prototypes/ e sync DESIGN.md, e isola orgs", async () => {
    const created = await createOrImportPrototypeScoped(db, {
      organizationId,
      projectId,
      dataDir,
      input: {
        title: "Painel Stitch Checkout",
        level: 3,
        source: "stitch_import",
        html: '<main class="p-6 rounded-xl" style="color: oklch(0.75 0.14 210)"><h1>Checkout</h1><script>alert(1)</script><img src="https://x.test/a.png" onerror="alert(2)"></main>',
      },
    });

    expect(created.approved).toBe(false);
    expect(created.tokensJson.color.primary?.$value).toBe("oklch(0.75 0.14 210)");

    const preview = await readPrototypePreviewHtmlScoped(db, {
      organizationId,
      prototypeId: created.id,
      dataDir,
    });
    expect(preview.html).toContain("<h1>Checkout</h1>");
    expect(preview.html.toLowerCase()).not.toContain("<script");
    expect(preview.html.toLowerCase()).not.toContain("onerror");

    const approved = await approvePrototypeScoped(db, {
      organizationId,
      projectId,
      prototypeId: created.id,
      workspaceRoot: repoDir,
      dataDir,
      input: { approved: true, syncDesignMd: true },
    });
    expect(approved.approved).toBe(true);
    expect(approved.handoffPath).toBe(`.uzina/prototypes/${created.id}`);

    const handoffHtml = fs.readFileSync(
      path.join(repoDir, ".uzina", "prototypes", created.id, "index.html"),
      "utf8"
    );
    expect(handoffHtml).toContain("<h1>Checkout</h1>");
    expect(
      fs.existsSync(
        path.join(repoDir, ".uzina", "prototypes", created.id, "tokens.json")
      )
    ).toBe(true);
    const designMd = fs.readFileSync(
      path.join(repoDir, ".uzina", "DESIGN.md"),
      "utf8"
    );
    expect(designMd).toContain("Painel Stitch Checkout");

    const list = await listProjectPrototypesScoped(db, {
      organizationId,
      projectId,
    });
    expect(list.some((p) => p.id === created.id)).toBe(true);

    const [otherOrg] = await db
      .insert(organizations)
      .values({
        name: "Org Isolada S9",
        slug: `other-s9-${crypto.randomUUID().slice(0, 5)}`,
      })
      .returning();

    await expect(
      readPrototypePreviewHtmlScoped(db, {
        organizationId: otherOrg!.id,
        prototypeId: created.id,
        dataDir,
      })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  test("executa cliente Stitch MCP real via stdio (shell:false) e degrada para unavailable se ausente", async () => {
    const mcpScript = path.join(dataDir, "fake-stitch-mcp.mjs");
    fs.writeFileSync(
      mcpScript,
      `process.stdin.setEncoding("utf8");
process.stdin.on("data", () => {
  const payload = {
    jsonrpc: "2.0",
    id: 1,
    result: {
      screens: [
        {
          id: "scr-stitch-1",
          title: "Stitch Landing",
          viewport: "desktop",
          html: "<section class='p-4 rounded-lg'><h1>Landing MCP</h1><script>evil()</script></section>"
        }
      ]
    }
  };
  process.stdout.write(JSON.stringify(payload) + "\\n");
  process.exit(0);
});
`,
      "utf8"
    );

    const syncRes = await syncStitchMcpScreensScoped(db, {
      organizationId,
      projectId,
      dataDir,
      mcpCommand: { command: process.execPath, args: [mcpScript] },
      input: { action: "import_screen", screenId: "scr-stitch-1" },
    });
    expect(syncRes.status).toBe("ok");
    expect(syncRes.screens).toHaveLength(1);
    expect(syncRes.importedPrototype?.source).toBe("stitch_mcp");

    const unavailableRes = await syncStitchMcpScreensScoped(db, {
      organizationId,
      projectId,
      dataDir,
      mcpCommand: { command: "nonexistent-stitch-mcp-bin", args: [] },
      input: { action: "list_screens" },
    });
    expect(unavailableRes.status).toBe("unavailable");
  });
});
