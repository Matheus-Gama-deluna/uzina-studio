import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  acquireDeliverableLock,
  clients,
  closeDb,
  deliverables,
  designAssets,
  ensureDefaultOrgAndInternalClient,
  getDb,
  projects,
  releaseDeliverableLock,
  renewDeliverableLock,
  type UzinaDb,
} from "../src/index.js";

describe("@uzina/db — Slice 3 Atomic SQL Locks & design_assets", () => {
  let db: UzinaDb;
  let internalClientId: string;

  beforeAll(async () => {
    await closeDb();
    const ctx = await getDb({ dataDir: ":memory:" });
    db = ctx.db;
    const seeded = await ensureDefaultOrgAndInternalClient(db);
    internalClientId = seeded.internalClientId;

    const [client] = await db
      .select()
      .from(clients)
      .where(eq(clients.id, internalClientId));
    expect(client?.id).toBe(internalClientId);
  });

  afterAll(async () => {
    await closeDb();
  });

  async function seedProjectAndDeliverable() {
    const suffix = crypto.randomUUID().slice(0, 8);
    const [project] = await db
      .insert(projects)
      .values({
        clientId: internalClientId,
        name: `Projeto Slice 3 ${suffix}`,
        slug: `projeto-slice-3-${suffix}`,
      })
      .returning();

    const [deliverable] = await db
      .insert(deliverables)
      .values({
        projectId: project?.id ?? "",
        title: `Entregável Lock & Assets ${suffix}`,
        hasUi: true,
      })
      .returning();

    return {
      projectId: project?.id ?? "",
      deliverableId: deliverable?.id ?? "",
    };
  }

  test("acquireDeliverableLock resolve corrida concorrente com exatamente 1 vencedor", async () => {
    const { deliverableId } = await seedProjectAndDeliverable();

    const [resA, resB] = await Promise.all([
      acquireDeliverableLock(db, {
        deliverableId,
        workerId: "op-worker-a",
        ttlMinutes: 10,
      }),
      acquireDeliverableLock(db, {
        deliverableId,
        workerId: "op-worker-b",
        ttlMinutes: 10,
      }),
    ]);

    const acquiredCount = [resA.acquired, resB.acquired].filter(Boolean).length;
    expect(acquiredCount).toBe(1);

    const winner = resA.acquired ? "op-worker-a" : "op-worker-b";
    const loser = resA.acquired ? resB : resA;
    expect(loser.acquired).toBe(false);
    expect(loser.lockedBy).toBe(winner);
    expect(loser.lockedAt).toBeInstanceOf(Date);
  });

  test("renewDeliverableLock e releaseDeliverableLock exigem posse do workerId e TTL expirado permite takeover", async () => {
    const { deliverableId } = await seedProjectAndDeliverable();

    const first = await acquireDeliverableLock(db, {
      deliverableId,
      workerId: "op-1",
      ttlMinutes: 10,
    });
    expect(first.acquired).toBe(true);

    // Outro worker não pode renovar nem liberar
    expect(
      await renewDeliverableLock(db, { deliverableId, workerId: "op-2" })
    ).toBe(false);
    expect(
      await releaseDeliverableLock(db, { deliverableId, workerId: "op-2" })
    ).toBe(false);

    // Dono atual consegue renovar
    expect(
      await renewDeliverableLock(db, { deliverableId, workerId: "op-1" })
    ).toBe(true);

    // Simula lock expirado há 15 minutos (> TTL de 10 minutos)
    const expiredAt = new Date(Date.now() - 15 * 60 * 1000);
    await db
      .update(deliverables)
      .set({ lockedAt: expiredAt })
      .where(eq(deliverables.id, deliverableId));

    const takeover = await acquireDeliverableLock(db, {
      deliverableId,
      workerId: "op-2",
      ttlMinutes: 10,
    });
    expect(takeover.acquired).toBe(true);
    expect(takeover.lockedBy).toBe("op-2");

    // Dono antigo op-1 não consegue mais liberar
    expect(
      await releaseDeliverableLock(db, { deliverableId, workerId: "op-1" })
    ).toBe(false);
    // Novo dono op-2 consegue liberar
    expect(
      await releaseDeliverableLock(db, { deliverableId, workerId: "op-2" })
    ).toBe(true);

    // Após release, outro worker adquire imediatamente
    const reacquired = await acquireDeliverableLock(db, {
      deliverableId,
      workerId: "op-3",
      ttlMinutes: 5,
    });
    expect(reacquired.acquired).toBe(true);
  });

  test("valida RangeError em parâmetros inválidos, deliverable inexistente e corrida em lock expirado", async () => {
    const { deliverableId } = await seedProjectAndDeliverable();

    await expect(
      acquireDeliverableLock(db, {
        deliverableId,
        workerId: "op-bad-ttl",
        ttlMinutes: 0,
      })
    ).rejects.toThrowError(RangeError);

    await expect(
      acquireDeliverableLock(db, {
        deliverableId,
        workerId: "op-float-ttl",
        ttlMinutes: 1.5,
      })
    ).rejects.toThrowError(RangeError);

    await expect(
      acquireDeliverableLock(db, {
        deliverableId,
        workerId: "   ",
      })
    ).rejects.toThrowError(RangeError);

    const missing = await acquireDeliverableLock(db, {
      deliverableId: crypto.randomUUID(),
      workerId: "op-missing",
    });
    expect(missing).toEqual({
      acquired: false,
      lockedBy: null,
      lockedAt: null,
    });

    // Lock expirado sob corrida concorrente: exatamente 1 vencedor assume
    const staleDate = new Date(Date.now() - 10 * 60 * 1000);
    await db
      .update(deliverables)
      .set({ lockedBy: "op-stale", lockedAt: staleDate })
      .where(eq(deliverables.id, deliverableId));

    const [race1, race2] = await Promise.all([
      acquireDeliverableLock(db, {
        deliverableId,
        workerId: "op-racer-1",
      }),
      acquireDeliverableLock(db, {
        deliverableId,
        workerId: "op-racer-2",
      }),
    ]);
    expect([race1.acquired, race2.acquired].filter(Boolean)).toHaveLength(1);
  });

  test("design_assets suporta CRUD completo, onDelete set null em deliverable e cascade em project", async () => {
    const { projectId, deliverableId } = await seedProjectAndDeliverable();

    const [refAsset] = await db
      .insert(designAssets)
      .values({
        projectId,
        deliverableId,
        assetType: "reference_url",
        title: "Linear Cockpit Reference",
        sourceUrl: "https://linear.app",
        intentionTags: ["densidade", "tipografia"],
        notes: "Adotar sidebar compacta",
      })
      .returning();

    const [imgAsset] = await db
      .insert(designAssets)
      .values({
        projectId,
        deliverableId: null,
        assetType: "moodboard_image",
        title: "Painel Industrial",
        storagePath: `uploads/${projectId}/sample.png`,
        mimeType: "image/png",
        sizeBytes: 2048,
        intentionTags: ["tema-escuro"],
      })
      .returning();

    expect(refAsset?.approved).toBe(false);
    expect(imgAsset?.storagePath).toBe(`uploads/${projectId}/sample.png`);

    const [approved] = await db
      .update(designAssets)
      .set({ approved: true, notes: "Aprovado para DESIGN.md" })
      .where(eq(designAssets.id, refAsset?.id ?? ""))
      .returning();
    expect(approved?.approved).toBe(true);
    expect(approved?.notes).toBe("Aprovado para DESIGN.md");

    // Remover deliverable deve preservar design_asset com deliverableId = null
    await db.delete(deliverables).where(eq(deliverables.id, deliverableId));
    const [afterDeliverableDelete] = await db
      .select()
      .from(designAssets)
      .where(eq(designAssets.id, refAsset?.id ?? ""));
    expect(afterDeliverableDelete?.id).toBe(refAsset?.id);
    expect(afterDeliverableDelete?.deliverableId).toBeNull();

    // Remover project deve apagar todos design_assets em cascata
    await db.delete(projects).where(eq(projects.id, projectId));
    const remaining = await db
      .select()
      .from(designAssets)
      .where(eq(designAssets.projectId, projectId));
    expect(remaining).toHaveLength(0);
  });
});
