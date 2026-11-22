import { describe, expect, test } from "vitest";
import {
  QMD_EMBEDDING_DIMENSIONS,
  buildDirectoryContextTree,
  chunkMarkdownByHeadings,
  computeBm25Scores,
  cosineSimilarity,
  createDeterministicEmbeddingProvider,
  formatQmdSnippet,
  reciprocalRankFusion,
  tokenizeForQmd,
} from "../src/qmd.js";

describe("@uzina/core — Slice 7 QMD (Chunker, BM25, RRF & Embeddings 384d)", () => {
  test("chunkMarkdownByHeadings preserva hierarquia de títulos, ignora # em código cercado e divide seções longas", () => {
    const md = [
      "# Arquitetura",
      "Introdução do sistema.",
      "",
      "## Persistência",
      "```bash",
      "# comentário dentro do bloco não é heading",
      "echo ok",
      "```",
      "Usa PGlite local e PostgreSQL em VPS.",
      "",
      "### Migração",
      `${"A".repeat(90)}\n${"B".repeat(90)}`,
    ].join("\n");

    const chunks = chunkMarkdownByHeadings(md, { maxChunkChars: 120 });
    expect(chunks.length).toBeGreaterThanOrEqual(4);
    expect(chunks[0]?.headingPath).toBe("Arquitetura");
    expect(chunks[0]?.lineStart).toBe(1);

    const persistChunk = chunks.find(
      (c) => c.headingPath === "Arquitetura > Persistência"
    );
    expect(persistChunk?.content).toContain("# comentário dentro do bloco");

    const migChunks = chunks.filter(
      (c) => c.headingPath === "Arquitetura > Persistência > Migração"
    );
    expect(migChunks.length).toBeGreaterThanOrEqual(2);
    expect(migChunks[0]!.lineStart).toBe(11);
  });

  test("tokenizeForQmd e computeBm25Scores priorizam identificadores técnicos exatos", () => {
    expect(tokenizeForQmd("VAULT_WRITE_ROLES")).toEqual([
      "vault_write_roles",
      "vault",
      "write",
      "roles",
    ]);

    const scores = computeBm25Scores("VAULT_WRITE_ROLES", [
      { id: "doc1", text: "Apenas owner/admin satisfazem VAULT_WRITE_ROLES na rota." },
      { id: "doc2", text: "Documentação geral sobre roles de leitura do painel." },
      { id: "doc3", text: "Configuração visual de cores OKLCH." },
    ]);

    expect(scores.get("doc1")!).toBeGreaterThan(scores.get("doc2")!);
    expect(scores.get("doc2")!).toBeGreaterThan(scores.get("doc3")!);
    expect(scores.get("doc3")).toBe(0);
  });

  test("createDeterministicEmbeddingProvider gera vetores 384d normalizados com alinhamento bilíngue PT-BR <-> EN", async () => {
    const provider = createDeterministicEmbeddingProvider();
    expect(provider.dimensions).toBe(QMD_EMBEDDING_DIMENSIONS);

    const queryVec = await provider.embedQuery(
      "isolamento de permissões e cofre criptográfico"
    );
    const [relevantDocVec, unrelatedDocVec] = await provider.embedDocuments([
      "RBAC role tenant isolation and vault AES encryption",
      "CSS tailwind button color border radius spacing",
    ]);

    expect(queryVec).toHaveLength(384);
    const norm = Math.sqrt(queryVec.reduce((acc, v) => acc + v * v, 0));
    expect(norm).toBeGreaterThan(0.99);
    expect(norm).toBeLessThan(1.01);

    const simRelevant = cosineSimilarity(queryVec, relevantDocVec!);
    const simUnrelated = cosineSimilarity(queryVec, unrelatedDocVec!);
    expect(simRelevant).toBeGreaterThan(simUnrelated);
  });

  test("reciprocalRankFusion combina listas BM25 + Vetor e formatQmdSnippet respeita 700 chars", () => {
    const fused = reciprocalRankFusion([
      [
        { id: "a", score: 2.5 },
        { id: "b", score: 1.2 },
        { id: "c", score: 0 },
      ],
      [
        { id: "b", score: 0.9 },
        { id: "a", score: 0.4 },
      ],
    ]);

    expect(fused.map((f) => f.id)).toEqual(["a", "b"]);
    expect(fused[0]!.rrf).toBeCloseTo(1 / 61 + 1 / 62, 5);

    const snippet = formatQmdSnippet("palavra ".repeat(150));
    expect(snippet.length).toBeLessThanOrEqual(700);
    expect(snippet.endsWith("...")).toBe(true);

    const tree = buildDirectoryContextTree([
      { sourcePath: "docs/adr/004.md", scopeType: "org", headingPath: "QMD" },
      { sourcePath: null, scopeType: "client", headingPath: "Regras" },
    ]);
    expect(tree.map((t) => t.directory).sort()).toEqual([
      "docs/adr",
      "memories/client",
    ]);
  });
});
