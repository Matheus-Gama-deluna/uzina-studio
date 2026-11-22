import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  closeDb,
  ensureDefaultOrgAndInternalClient,
  getDb,
  memories,
  memoryChunks,
  type UzinaDb,
} from "../src/index.js";

describe("@uzina/db — Slice 7 memory_chunks Schema & Cascade", () => {
  let db: UzinaDb;
  let organizationId: string;

  beforeAll(async () => {
    await closeDb();
    const ctx = await getDb({ dataDir: ":memory:" });
    db = ctx.db;
    const seeded = await ensureDefaultOrgAndInternalClient(db);
    organizationId = seeded.organizationId;
  });

  afterAll(async () => {
    await closeDb();
  });

  test("persiste chunk com vetor 384d e remove em cascade ao deletar a memória origem", async () => {
    const [mem] = await db
      .insert(memories)
      .values({
        organizationId,
        scopeType: "org",
        scopeId: organizationId,
        category: "architecture",
        title: "Padrão QMD",
        content: "# QMD\nUsa BM25 e vetor 384d.",
      })
      .returning();

    const vector384 = Array.from({ length: 384 }, (_, idx) =>
      idx === 0 ? 1 : 0
    );

    const [chunk] = await db
      .insert(memoryChunks)
      .values({
        organizationId,
        sourceType: "memory",
        memoryId: mem!.id,
        sourcePath: null,
        scopeType: "org",
        scopeId: organizationId,
        headingPath: "QMD",
        lineStart: 1,
        lineEnd: 2,
        content: "# QMD\nUsa BM25 e vetor 384d.",
        contentHash: "abc123",
        embedding: vector384,
        embeddingModel: "deterministic-trigram-384",
      })
      .returning();

    expect(chunk?.embedding).toHaveLength(384);
    expect(chunk?.embedding[0]).toBe(1);

    await db.delete(memories).where(eq(memories.id, mem!.id));

    const remaining = await db
      .select()
      .from(memoryChunks)
      .where(eq(memoryChunks.memoryId, mem!.id));
    expect(remaining).toHaveLength(0);
  });
});
