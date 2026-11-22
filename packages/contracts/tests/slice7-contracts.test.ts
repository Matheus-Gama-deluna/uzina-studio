import crypto from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  QmdReindexRequestSchema,
  QmdReindexResponseSchema,
  QmdSearchHitSchema,
  QmdSearchRequestSchema,
  QmdSearchResponseSchema,
} from "../src/index.js";

describe("@uzina/contracts — Slice 7 QMD Schemas", () => {
  test.each([
    [{ query: "cofre criptográfico" }, "hybrid", 5],
    [{ query: "VAULT_WRITE_ROLES", mode: "lexical", limit: 3 }, "lexical", 3],
    [
      {
        query: "isolamento entre clientes",
        mode: "vector",
        scopeType: "client",
        clientId: crypto.randomUUID(),
        limit: 10,
      },
      "vector",
      10,
    ],
  ])("aceita QmdSearchRequest válido %j", (payload, expectedMode, expectedLimit) => {
    const parsed = QmdSearchRequestSchema.parse(payload);
    expect(parsed.mode).toBe(expectedMode);
    expect(parsed.limit).toBe(expectedLimit);
  });

  test.each([
    [{ query: "a" }],
    [{ query: "   " }],
    [{ query: "busca valida", limit: 0 }],
    [{ query: "busca valida", limit: 11 }],
    [{ query: "busca valida", mode: "semantic_only" }],
    [{ query: "busca valida", clientId: "not-a-uuid" }],
    [{ query: "busca valida", extraField: true }],
  ])("rejeita QmdSearchRequest inválido %j", (badPayload) => {
    expect(() => QmdSearchRequestSchema.parse(badPayload)).toThrow();
  });

  test("impõe snippet <= 700 chars em QmdSearchHitSchema e valida QmdSearchResponse / QmdReindex", () => {
    const baseHit = {
      id: crypto.randomUUID(),
      sourceType: "markdown" as const,
      memoryId: null,
      sourcePath: "docs/adr/004.md",
      scopeType: "org" as const,
      scopeId: crypto.randomUUID(),
      headingPath: "Decisão > Embeddings",
      lineStart: 12,
      lineEnd: 28,
      snippet: "x".repeat(700),
      scores: { bm25: 1.4, vector: 0.72, rrf: 0.032 },
    };

    expect(QmdSearchHitSchema.parse(baseHit).snippet.length).toBe(700);
    expect(() =>
      QmdSearchHitSchema.parse({ ...baseHit, snippet: "x".repeat(701) })
    ).toThrow();

    const response = QmdSearchResponseSchema.parse({
      query: "embeddings",
      mode: "hybrid",
      embeddingModel: "deterministic-trigram-384",
      degraded: true,
      totalCandidates: 4,
      contextTree: [
        {
          directory: "docs/adr",
          summary: "Decisão > Embeddings",
          chunkCount: 1,
        },
      ],
      hits: [baseHit],
    });
    expect(response.hits).toHaveLength(1);

    const reindexReq = QmdReindexRequestSchema.parse({});
    expect(reindexReq.includeDocs).toBe(true);
    expect(reindexReq.force).toBe(false);
    expect(() =>
      QmdReindexRequestSchema.parse({ includeDocs: true, unknown: 1 })
    ).toThrow();

    const reindexRes = QmdReindexResponseSchema.parse({
      indexedMemories: 3,
      indexedDocFiles: 5,
      totalChunks: 18,
      embeddingModel: "deterministic-trigram-384",
      degraded: true,
    });
    expect(reindexRes.totalChunks).toBe(18);
  });
});
