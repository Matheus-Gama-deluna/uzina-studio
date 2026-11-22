import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  CreatePrototypeRequestSchema,
  StitchMcpScreenSchema,
  StitchMcpSyncResponseSchema,
  type CreatePrototypeRequest,
  type DesignPrototype,
  type StitchMcpScreen,
  type StitchMcpSyncRequest,
  type StitchMcpSyncResponse,
  type UpdatePrototypeApproval,
} from "@uzina/contracts";
import {
  MAX_PROTOTYPE_HTML_BYTES,
  PrototypePayloadTooLargeError,
  assertPathInsideWorkspace,
  extractW3CDesignTokens,
  generateMermaidWireframeFromSpec,
  renderTokensToDesignMdSection,
  sanitizePrototypeHtml,
} from "@uzina/core";
import {
  clients,
  designAssets,
  designPrototypes,
  projectRepositories,
  projects,
  resolveDataDir,
  type UzinaDb,
} from "@uzina/db";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { WorkflowRuntimeError } from "./errors.js";

const StitchRpcOutputSchema = z
  .object({
    screens: z.array(StitchMcpScreenSchema),
  })
  .strict();

function resolvePrototypesStorageDir(dataDir?: string): string {
  const base = dataDir ?? resolveDataDir();
  if (base === ":memory:") {
    return path.resolve(process.cwd(), ".uzina-data", "uploads", "prototypes");
  }
  return path.resolve(base, "uploads", "prototypes");
}

function toDesignPrototypeDto(
  row: typeof designPrototypes.$inferSelect
): DesignPrototype {
  return {
    id: row.id,
    projectId: row.projectId,
    deliverableId: row.deliverableId ?? null,
    level: row.level,
    source: row.source,
    title: row.title,
    previewUrl: `/api/prototypes/${row.id}/preview`,
    tokensJson: row.tokensJson,
    wireframeMermaid: row.wireframeMermaid ?? null,
    approved: row.approved,
    handoffPath: row.handoffPath ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

async function assertScopedProject(
  db: UzinaDb,
  organizationId: string,
  projectId: string
) {
  const [row] = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(
      and(eq(projects.id, projectId), eq(clients.organizationId, organizationId))
    )
    .limit(1);

  if (!row) {
    throw new WorkflowRuntimeError({
      statusCode: 404,
      code: "DELIVERABLE_NOT_FOUND",
      message: `Projeto '${projectId}' não encontrado na organização.`,
    });
  }
  return row;
}

export async function listProjectPrototypesScoped(
  db: UzinaDb,
  params: { organizationId: string; projectId: string }
): Promise<DesignPrototype[]> {
  await assertScopedProject(db, params.organizationId, params.projectId);
  const rows = await db
    .select()
    .from(designPrototypes)
    .where(eq(designPrototypes.projectId, params.projectId))
    .orderBy(desc(designPrototypes.createdAt));
  return rows.map(toDesignPrototypeDto);
}

export async function createOrImportPrototypeScoped(
  db: UzinaDb,
  params: {
    organizationId: string;
    projectId: string;
    input: CreatePrototypeRequest;
    dataDir?: string;
  }
): Promise<DesignPrototype> {
  await assertScopedProject(db, params.organizationId, params.projectId);
  const parsed = CreatePrototypeRequestSchema.parse(params.input);

  const id = crypto.randomUUID();
  const wireframeMermaid =
    parsed.level === 1 || parsed.specSummary
      ? generateMermaidWireframeFromSpec(parsed.title, parsed.specSummary)
      : null;

  const defaultHtml =
    parsed.level === 1
      ? `<main class="p-6 rounded-xl bg-slate-950 text-slate-100"><h1>${parsed.title}</h1><pre>${wireframeMermaid ?? ""}</pre></main>`
      : `<main class="p-6 rounded-xl bg-slate-950 text-slate-100"><h1>${parsed.title}</h1><p>Direção Visual Nível ${parsed.level}</p></main>`;

  const rawHtml = parsed.html?.trim() ? parsed.html : defaultHtml;
  let sanitizedHtml = "";
  try {
    sanitizedHtml = sanitizePrototypeHtml(rawHtml, {
      maxBytes: MAX_PROTOTYPE_HTML_BYTES,
    });
  } catch (err) {
    if (err instanceof PrototypePayloadTooLargeError) {
      throw new WorkflowRuntimeError({
        statusCode: 413,
        code: "EXECUTION_FAILED",
        message: err.message,
        cause: err,
      });
    }
    throw err;
  }

  const tokensJson = extractW3CDesignTokens(sanitizedHtml);
  const storageDir = resolvePrototypesStorageDir(params.dataDir);
  fs.mkdirSync(storageDir, { recursive: true });
  const fileName = `${id}.html`;
  const absFile = assertPathInsideWorkspace(storageDir, fileName);
  fs.writeFileSync(absFile, sanitizedHtml, "utf8");

  const [inserted] = await db
    .insert(designPrototypes)
    .values({
      id,
      projectId: params.projectId,
      deliverableId: parsed.deliverableId ?? null,
      level: parsed.level,
      source: parsed.source,
      title: parsed.title,
      htmlStoragePath: fileName,
      tokensJson,
      wireframeMermaid,
      approved: false,
      handoffPath: null,
    })
    .returning();

  return toDesignPrototypeDto(inserted!);
}

export async function readPrototypePreviewHtmlScoped(
  db: UzinaDb,
  params: { organizationId: string; prototypeId: string; dataDir?: string }
): Promise<{ title: string; html: string }> {
  const [row] = await db
    .select({
      id: designPrototypes.id,
      title: designPrototypes.title,
      htmlStoragePath: designPrototypes.htmlStoragePath,
    })
    .from(designPrototypes)
    .innerJoin(projects, eq(designPrototypes.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(
      and(
        eq(designPrototypes.id, params.prototypeId),
        eq(clients.organizationId, params.organizationId)
      )
    )
    .limit(1);

  if (!row) {
    throw new WorkflowRuntimeError({
      statusCode: 404,
      code: "DELIVERABLE_NOT_FOUND",
      message: `Protótipo '${params.prototypeId}' não encontrado.`,
    });
  }

  const storageDir = resolvePrototypesStorageDir(params.dataDir);
  const absFile = assertPathInsideWorkspace(
    storageDir,
    path.basename(row.htmlStoragePath)
  );
  if (!fs.existsSync(absFile)) {
    throw new WorkflowRuntimeError({
      statusCode: 404,
      code: "DELIVERABLE_NOT_FOUND",
      message: "Arquivo HTML do protótipo não encontrado no armazenamento.",
    });
  }

  const rawContent = fs.readFileSync(absFile, "utf8");
  return {
    title: row.title,
    html: sanitizePrototypeHtml(rawContent),
  };
}

export async function approvePrototypeScoped(
  db: UzinaDb,
  params: {
    organizationId: string;
    projectId: string;
    prototypeId: string;
    input: UpdatePrototypeApproval;
    workspaceRoot?: string;
    dataDir?: string;
  }
): Promise<DesignPrototype> {
  await assertScopedProject(db, params.organizationId, params.projectId);

  const [existing] = await db
    .select()
    .from(designPrototypes)
    .where(
      and(
        eq(designPrototypes.id, params.prototypeId),
        eq(designPrototypes.projectId, params.projectId)
      )
    )
    .limit(1);

  if (!existing) {
    throw new WorkflowRuntimeError({
      statusCode: 404,
      code: "DELIVERABLE_NOT_FOUND",
      message: `Protótipo '${params.prototypeId}' não encontrado no projeto.`,
    });
  }

  let handoffPath: string | null = existing.handoffPath ?? null;

  if (params.input.approved) {
    const [repo] = await db
      .select()
      .from(projectRepositories)
      .where(eq(projectRepositories.projectId, params.projectId))
      .limit(1);

    const targetRoot = params.workspaceRoot ?? repo?.localPath ?? null;
    const relHandoff = `.uzina/prototypes/${existing.id}`;
    handoffPath = relHandoff;

    if (targetRoot && fs.existsSync(/*turbopackIgnore: true*/ targetRoot)) {
      const storageDir = resolvePrototypesStorageDir(params.dataDir);
      const absHtmlSrc = assertPathInsideWorkspace(
        storageDir,
        path.basename(existing.htmlStoragePath)
      );
      const safeHtml = fs.existsSync(absHtmlSrc)
        ? sanitizePrototypeHtml(fs.readFileSync(absHtmlSrc, "utf8"))
        : "";

      const destDir = assertPathInsideWorkspace(targetRoot, relHandoff);
      fs.mkdirSync(destDir, { recursive: true });
      fs.writeFileSync(path.join(destDir, "index.html"), safeHtml, "utf8");
      fs.writeFileSync(
        path.join(destDir, "tokens.json"),
        JSON.stringify(existing.tokensJson, null, 2),
        "utf8"
      );

      if (params.input.syncDesignMd) {
        const section = renderTokensToDesignMdSection(
          existing.tokensJson,
          existing.title
        );
        const designMdPath = assertPathInsideWorkspace(
          targetRoot,
          ".uzina/DESIGN.md"
        );
        fs.mkdirSync(path.dirname(designMdPath), { recursive: true });
        const prevMd = fs.existsSync(designMdPath)
          ? fs.readFileSync(designMdPath, "utf8")
          : "# DESIGN.md — Contrato Visual\n";
        fs.writeFileSync(designMdPath, `${prevMd.trim()}\n\n${section}\n`, "utf8");
      }
    }

    if (params.input.syncDesignMd) {
      const section = renderTokensToDesignMdSection(
        existing.tokensJson,
        existing.title
      );
      await db.insert(designAssets).values({
        projectId: params.projectId,
        deliverableId: existing.deliverableId,
        assetType: "design_md",
        title: `Tokens W3C — ${existing.title}`,
        intentionTags: ["w3c-dtcg", "stitch-approved"],
        notes: section,
        approved: true,
      });
    }
  }

  const [updated] = await db
    .update(designPrototypes)
    .set({
      approved: params.input.approved,
      handoffPath,
    })
    .where(eq(designPrototypes.id, existing.id))
    .returning();

  return toDesignPrototypeDto(updated!);
}

function runStitchMcpStdio(params: {
  command: string;
  args: string[];
  cwd: string;
}): Promise<{ ok: true; screens: StitchMcpScreen[] } | { ok: false; detail: string }> {
  return new Promise((resolve) => {
    const reqPayload = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "list_screens", arguments: {} },
    });

    const child = execFile(
      params.command,
      params.args,
      {
        cwd: params.cwd,
        shell: false,
        timeout: 8000,
        maxBuffer: 2 * 1024 * 1024,
        env: {
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? process.env.USERPROFILE ?? "",
          SystemRoot: process.env.SystemRoot ?? "",
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "ENOENT") {
            resolve({
              ok: false,
              detail: `Binário MCP '${params.command}' não encontrado; use a importação HTML/Tailwind.`,
            });
            return;
          }
          resolve({
            ok: false,
            detail: stderr?.trim() || error.message,
          });
          return;
        }

        const firstJsonLine = stdout
          .split(/\r?\n/)
          .map((l) => l.trim())
          .find((l) => l.startsWith("{"));
        if (!firstJsonLine) {
          resolve({
            ok: false,
            detail: "Resposta vazia do servidor Stitch MCP.",
          });
          return;
        }

        try {
          const raw = JSON.parse(firstJsonLine) as {
            result?: unknown;
            screens?: unknown;
          };
          const candidate = raw.result ?? raw;
          const parsed = StitchRpcOutputSchema.safeParse(candidate);
          if (!parsed.success) {
            resolve({
              ok: false,
              detail: "Payload do Stitch MCP falhou na validação Zod.",
            });
            return;
          }
          resolve({ ok: true, screens: parsed.data.screens });
        } catch {
          resolve({
            ok: false,
            detail: "JSON inválido retornado pelo servidor Stitch MCP.",
          });
        }
      }
    );

    if (child.stdin) {
      child.stdin.write(`${reqPayload}\n`);
      child.stdin.end();
    }
  });
}

export async function syncStitchMcpScreensScoped(
  db: UzinaDb,
  params: {
    organizationId: string;
    projectId: string;
    input: StitchMcpSyncRequest;
    mcpCommand?: { command: string; args: string[] };
    dataDir?: string;
  }
): Promise<StitchMcpSyncResponse> {
  await assertScopedProject(db, params.organizationId, params.projectId);

  const cmd = params.mcpCommand?.command ?? process.env.UZINA_STITCH_MCP_CMD ?? "stitch-mcp";
  const args = params.mcpCommand?.args ?? ["--stdio"];

  const rpcResult = await runStitchMcpStdio({
    command: cmd,
    args,
    cwd: process.cwd(),
  });

  if (!rpcResult.ok) {
    return StitchMcpSyncResponseSchema.parse({
      status: "unavailable",
      detail: rpcResult.detail,
      screens: [],
      importedPrototype: null,
    });
  }

  let importedPrototype: DesignPrototype | null = null;
  if (params.input.action === "import_screen" && rpcResult.screens.length > 0) {
    const selected =
      rpcResult.screens.find((s) => s.id === params.input.screenId) ??
      rpcResult.screens[0]!;
    importedPrototype = await createOrImportPrototypeScoped(db, {
      organizationId: params.organizationId,
      projectId: params.projectId,
      dataDir: params.dataDir,
      input: {
        title: params.input.title ?? selected.title,
        level: 3,
        source: "stitch_mcp",
        html: selected.html,
        stitchScreenId: selected.id,
      },
    });
  }

  return StitchMcpSyncResponseSchema.parse({
    status: "ok",
    detail: `${rpcResult.screens.length} tela(s) sincronizada(s) via Stitch MCP.`,
    screens: rpcResult.screens,
    importedPrototype,
  });
}
