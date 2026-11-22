import { describe, expect, test } from "vitest";
import {
  ChangeImpactRequestSchema,
  CodebaseReindexRequestSchema,
  CodebaseRelationSchema,
  CodebaseSymbolKindSchema,
  ProvenanceQuerySchema,
  SymbolGraphQuerySchema,
  SymbolSliceRequestSchema,
} from "../src/index.js";

describe("Slice 8 contracts — Codebase Intelligence", () => {
  const validUuid = "11111111-1111-4111-8111-111111111111";

  test.each([
    {
      name: "SymbolGraphQuery defaults",
      schema: SymbolGraphQuerySchema,
      input: { symbol: "createDeliverable" },
      ok: true,
    },
    {
      name: "SymbolGraphQuery full valid",
      schema: SymbolGraphQuerySchema,
      input: {
        repositoryId: validUuid,
        symbol: "deliverables",
        relation: "queries_table",
        depth: 3,
        maxResults: 50,
      },
      ok: true,
    },
    {
      name: "SymbolGraphQuery rejects depth > 3",
      schema: SymbolGraphQuerySchema,
      input: { symbol: "foo", depth: 4 },
      ok: false,
    },
    {
      name: "SymbolGraphQuery rejects maxResults > 50",
      schema: SymbolGraphQuerySchema,
      input: { symbol: "foo", maxResults: 51 },
      ok: false,
    },
    {
      name: "SymbolGraphQuery rejects extra field (.strict)",
      schema: SymbolGraphQuerySchema,
      input: { symbol: "foo", organizationId: validUuid },
      ok: false,
    },
    {
      name: "SymbolSliceRequest valid",
      schema: SymbolSliceRequestSchema,
      input: { path: "src/index.ts", symbol: "main", maxBytes: 2048 },
      ok: true,
    },
    {
      name: "SymbolSliceRequest rejects maxBytes < 128",
      schema: SymbolSliceRequestSchema,
      input: { path: "src/index.ts", symbol: "main", maxBytes: 64 },
      ok: false,
    },
    {
      name: "ProvenanceQuery valid",
      schema: ProvenanceQuerySchema,
      input: { path: "apps/web/src/app/api/health/route.ts", limit: 10 },
      ok: true,
    },
    {
      name: "ChangeImpactRequest valid",
      schema: ChangeImpactRequestSchema,
      input: { changedFiles: ["packages/core/src/qmd.ts"] },
      ok: true,
    },
    {
      name: "ChangeImpactRequest rejects empty array",
      schema: ChangeImpactRequestSchema,
      input: { changedFiles: [] },
      ok: false,
    },
    {
      name: "CodebaseReindexRequest defaults",
      schema: CodebaseReindexRequestSchema,
      input: {},
      ok: true,
    },
  ])("$name", ({ schema, input, ok }) => {
    expect(schema.safeParse(input).success).toBe(ok);
  });

  test("valida enums de tipos de símbolo e relação AST", () => {
    expect(CodebaseSymbolKindSchema.options).toEqual([
      "function",
      "class",
      "route",
      "zod_schema",
      "db_table",
      "component",
    ]);
    expect(CodebaseRelationSchema.options).toEqual([
      "imports",
      "calls",
      "validates_with",
      "queries_table",
      "renders",
    ]);
  });
});
