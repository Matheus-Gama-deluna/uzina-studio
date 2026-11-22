import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CodebaseEdge, CodebaseSymbol } from "@uzina/contracts";
import { afterAll, describe, expect, test } from "vitest";
import {
  buildCodebaseDirectoryTree,
  buildCodebaseSkeleton,
  computeChangeImpactInMemory,
  indexSourceText,
  probeCodebaseAdapters,
  querySymbolGraphInMemory,
  readSymbolSliceFromWorkspace,
  scanCodebaseWorkspace,
} from "../src/index.js";

function makeFixtureRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-s8-intel-"));

  fs.mkdirSync(path.join(dir, "src", "schema"), { recursive: true });
  fs.mkdirSync(path.join(dir, "src", "contracts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "src", "services"), { recursive: true });
  fs.mkdirSync(path.join(dir, "src", "components"), { recursive: true });
  fs.mkdirSync(path.join(dir, "src", "app", "api", "orders"), {
    recursive: true,
  });

  fs.writeFileSync(
    path.join(dir, ".env.local"),
    "OPENAI_API_KEY=sk-secret-do-not-read-1234567890abcdef\n",
    "utf8"
  );

  fs.writeFileSync(
    path.join(dir, "src", "schema", "orders.ts"),
    `import { pgTable, text } from "drizzle-orm/pg-core";
export const ordersTable = pgTable("orders", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  notes: text("notes").notNull(),
});
`,
    "utf8"
  );

  fs.writeFileSync(
    path.join(dir, "src", "contracts", "order-input.ts"),
    `import { z } from "zod";
export const CreateOrderSchema = z.object({
  title: z.string().min(3),
  notes: z.string().max(500),
}).strict();
`,
    "utf8"
  );

  const bigServiceBody = Array.from({ length: 45 }, (_, idx) =>
    `  const step${idx} = "observability_trace_${idx}_long_payload_for_token_baseline_measurement";`
  ).join("\n");

  fs.writeFileSync(
    path.join(dir, "src", "services", "order-service.ts"),
    `import { ordersTable } from "../schema/orders.js";
import { CreateOrderSchema } from "../contracts/order-input.js";

export class OrderService {
  async listAll() {
    return [];
  }
}

export async function createOrderRecord(db: { insert: (t: unknown) => void }, raw: unknown) {
  const parsed = CreateOrderSchema.parse(raw);
${bigServiceBody}
  db.insert(ordersTable);
  const apiFallback = "sk-proj-secret1234567890abcdef1234567890";
  return { parsed, stepCount: 45, apiFallback };
}
`,
    "utf8"
  );

  fs.writeFileSync(
    path.join(dir, "src", "app", "api", "orders", "route.ts"),
    `import { createOrderRecord } from "../../../services/order-service.js";
export async function POST(req: Request) {
  const body = await req.json();
  return Response.json(createOrderRecord({ insert: () => {} }, body));
}
`,
    "utf8"
  );

  fs.writeFileSync(
    path.join(dir, "src", "components", "OrderCard.tsx"),
    `export function OrderBadge({ label }: { label: string }) {
  return <span>{label}</span>;
}

export function OrderCard({ title }: { title: string }) {
  return (
    <div>
      <OrderBadge label={title} />
    </div>
  );
}
`,
    "utf8"
  );

  return dir;
}

describe("@uzina/codebase-intel — AST Indexer, Skeleton, Graph & Adapters", () => {
  const tempDirs: string[] = [];

  afterAll(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test.each([
    {
      label: "function",
      path: "src/math.ts",
      code: "export function computeTotal(a: number, b: number): number { return a + b; }",
      expectedKind: "function",
      expectedName: "computeTotal",
    },
    {
      label: "class",
      path: "src/engine.ts",
      code: "export class CacheEngine { get() { return 1; } set() {} }",
      expectedKind: "class",
      expectedName: "CacheEngine",
    },
    {
      label: "route",
      path: "src/app/api/ping/route.ts",
      code: "export async function GET() { return Response.json({ ok: true }); }",
      expectedKind: "route",
      expectedName: "GET",
    },
    {
      label: "zod_schema",
      path: "src/contracts.ts",
      code: 'import { z } from "zod"; export const PingSchema = z.object({ ok: z.boolean() });',
      expectedKind: "zod_schema",
      expectedName: "PingSchema",
    },
    {
      label: "db_table",
      path: "src/db.ts",
      code: 'export const pings = pgTable("pings", {});',
      expectedKind: "db_table",
      expectedName: "pings",
    },
    {
      label: "component",
      path: "src/Card.tsx",
      code: "export function StatusCard() { return <div>ok</div>; }",
      expectedKind: "component",
      expectedName: "StatusCard",
    },
  ])(
    "indexSourceText extrai símbolo $label com assinatura sem corpo",
    ({ path: relPath, code, expectedKind, expectedName }) => {
      const parsed = indexSourceText(relPath, code);
      const sym = parsed.symbols.find((s) => s.name === expectedName);
      expect(sym).toBeDefined();
      expect(sym!.kind).toBe(expectedKind);
      expect(sym!.signature).not.toContain("return a + b");
      expect(sym!.citation).toMatch(new RegExp(`^${relPath}#L\\d+-L\\d+$`));
    }
  );

  test("scanCodebaseWorkspace resolve arestas, esqueleto >= 80% economia, impacto e contenção de leitura", () => {
    const repoDir = makeFixtureRepo();
    tempDirs.push(repoDir);

    const scan = scanCodebaseWorkspace(repoDir);
    expect(scan.files.some((f) => f.path.includes(".env"))).toBe(false);
    expect(scan.files.length).toBe(5);

    const symbols: CodebaseSymbol[] = [];
    const symbolIdMap = new Map<string, CodebaseSymbol>();
    for (const file of scan.files) {
      const fileId = crypto.randomUUID();
      for (const s of file.symbols) {
        const entry: CodebaseSymbol = {
          id: crypto.randomUUID(),
          fileId,
          filePath: s.filePath,
          kind: s.kind,
          name: s.name,
          signature: s.signature,
          lineStart: s.lineStart,
          lineEnd: s.lineEnd,
          exported: s.exported,
          citation: s.citation,
        };
        symbols.push(entry);
        symbolIdMap.set(`${s.filePath}:${s.name}`, entry);
      }
    }

    const edges: CodebaseEdge[] = scan.edges
      .map((e) => {
        const from = symbolIdMap.get(`${e.fromFilePath}:${e.fromSymbolName}`);
        const to = symbolIdMap.get(`${e.toFilePath}:${e.toSymbolName}`);
        if (!from || !to) return null;
        return {
          id: crypto.randomUUID(),
          fromSymbolId: from.id,
          toSymbolId: to.id,
          fromSymbolName: from.name,
          toSymbolName: to.name,
          relation: e.relation,
        };
      })
      .filter((e): e is CodebaseEdge => Boolean(e));

    expect(edges.some((e) => e.relation === "validates_with")).toBe(true);
    expect(edges.some((e) => e.relation === "queries_table")).toBe(true);
    expect(edges.some((e) => e.relation === "calls")).toBe(true);
    expect(edges.some((e) => e.relation === "renders")).toBe(true);

    const tree = buildCodebaseDirectoryTree(
      scan.files.map((f) => f.path),
      symbols
    );
    expect(tree.length).toBeGreaterThanOrEqual(3);

    const skeleton = buildCodebaseSkeleton({
      files: scan.files.map((f) => ({ path: f.path, size: f.size })),
      symbols,
      edges,
      maxTokens: 150,
    });
    expect(skeleton.savingsPercent).toBeGreaterThanOrEqual(50);
    expect(skeleton.skeletonText).not.toContain("observability_trace_");

    const graphRes = querySymbolGraphInMemory(symbols, edges, {
      symbol: "createOrderRecord",
      depth: 2,
      maxResults: 20,
    });
    expect(graphRes.nodes.some((n) => n.name === "createOrderRecord")).toBe(true);
    expect(graphRes.nodes.some((n) => n.name === "POST")).toBe(true);

    const impact = computeChangeImpactInMemory(symbols, edges, [
      "src/contracts/order-input.ts",
    ]);
    expect(impact.affectedSymbols.some((s) => s.name === "createOrderRecord")).toBe(
      true
    );
    expect(impact.affectedRoutes.some((r) => r.name === "POST")).toBe(true);

    const slice = readSymbolSliceFromWorkspace(repoDir, symbols, {
      path: "src/services/order-service.ts",
      symbol: "OrderService",
      maxBytes: 2048,
    });
    expect(slice.code).toContain("class OrderService");
    expect(slice.savingsPercent).toBeGreaterThanOrEqual(80);

    const secretSlice = readSymbolSliceFromWorkspace(repoDir, symbols, {
      path: "src/services/order-service.ts",
      symbol: "createOrderRecord",
      maxBytes: 4096,
    });
    expect(secretSlice.code).not.toContain("sk-proj-secret");

    expect(() =>
      readSymbolSliceFromWorkspace(repoDir, symbols, {
        path: ".env.local",
        symbol: "OPENAI_API_KEY",
        maxBytes: 1024,
      })
    ).toThrow(/Acesso negado/);

    expect(() =>
      readSymbolSliceFromWorkspace(repoDir, symbols, {
        path: "../outside.ts",
        symbol: "foo",
        maxBytes: 1024,
      })
    ).toThrow();
  });

  test("probeCodebaseAdapters degrada explicitamente com skipped_missing_binary sem falso verde", async () => {
    const reports = await probeCodebaseAdapters(process.cwd(), {
      commandRunner: async (binary) => {
        if (binary === "repomix") {
          return { status: "ok", stdout: "repomix 0.2.0\n", stderr: "" };
        }
        return { status: "missing_binary", stdout: "", stderr: "ENOENT" };
      },
    });

    expect(reports.find((r) => r.adapter === "qmd")?.status).toBe("ok");
    expect(reports.find((r) => r.adapter === "repomix")?.status).toBe("ok");
    expect(reports.find((r) => r.adapter === "ast_grep")?.status).toBe(
      "skipped_missing_binary"
    );
    expect(
      reports.find((r) => r.adapter === "codebase_memory_mcp")?.status
    ).toBe("skipped_missing_binary");
  });
});
