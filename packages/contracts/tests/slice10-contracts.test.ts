import { describe, expect, test } from "vitest";
import {
  FinopsSummaryRequestSchema,
  RecordTokenSavingsSchema,
  TokenSavingsTechniqueSchema,
  WorkspaceKindSchema,
} from "../src/index.js";

describe("Slice 10 contracts — Docker Workspace & FinOps de Tokens", () => {
  const validUuid = "11111111-1111-4111-8111-111111111111";

  test.each([
    {
      name: "RecordTokenSavings válido (skeleton)",
      schema: RecordTokenSavingsSchema,
      input: {
        deliverableId: validUuid,
        technique: "skeleton",
        tokensBaseline: 10000,
        tokensActual: 800,
      },
      ok: true,
    },
    {
      name: "RecordTokenSavings rejeita técnica desconhecida",
      schema: RecordTokenSavingsSchema,
      input: {
        technique: "magic",
        tokensBaseline: 100,
        tokensActual: 10,
      },
      ok: false,
    },
    {
      name: "RecordTokenSavings rejeita chave extra (.strict)",
      schema: RecordTokenSavingsSchema,
      input: {
        technique: "qmd",
        tokensBaseline: 1000,
        tokensActual: 200,
        organizationId: validUuid,
      },
      ok: false,
    },
    {
      name: "FinopsSummaryRequest defaults",
      schema: FinopsSummaryRequestSchema,
      input: {},
      ok: true,
    },
    {
      name: "FinopsSummaryRequest rejeita limit > 100",
      schema: FinopsSummaryRequestSchema,
      input: { limit: 101 },
      ok: false,
    },
  ])("$name", ({ schema, input, ok }) => {
    expect(schema.safeParse(input).success).toBe(ok);
  });

  test("valida WorkspaceKindSchema e TokenSavingsTechniqueSchema", () => {
    expect(WorkspaceKindSchema.options).toEqual(["worktree", "docker"]);
    expect(TokenSavingsTechniqueSchema.options).toEqual([
      "prompt_cache",
      "qmd",
      "ast_graph",
      "skeleton",
    ]);
  });
});
