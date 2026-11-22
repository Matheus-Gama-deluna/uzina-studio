import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  clients,
  closeDb,
  deliverables,
  ensureDefaultOrgAndInternalClient,
  getDb,
  memories,
  organizations,
  projects,
  type UzinaDb,
} from "../src/index.js";

describe("@uzina/db — Slice 5 Memories Schema (3 Escopos)", () => {
  let db: UzinaDb;
  let organizationId: string;
  let internalClientId: string;

  beforeAll(async () => {
    await closeDb();
    const ctx = await getDb({ dataDir: ":memory:" });
    db = ctx.db;
    const seeded = await ensureDefaultOrgAndInternalClient(db);
    organizationId = seeded.organizationId;
    internalClientId = seeded.internalClientId;
  });

  afterAll(async () => {
    await closeDb();
  });

  test("persiste memórias org/client/project, faz set null em sourceDeliverableId e cascade ao remover organização", async () => {
    const [project] = await db
      .insert(projects)
      .values({
        clientId: internalClientId,
        name: `Proj Mem ${crypto.randomUUID().slice(0, 6)}`,
        slug: `proj-mem-${crypto.randomUUID().slice(0, 6)}`,
      })
      .returning();

    const [deliv] = await db
      .insert(deliverables)
      .values({
        projectId: project!.id,
        title: "Entrega Origem Memória",
      })
      .returning();

    const [orgMemory] = await db
      .insert(memories)
      .values({
        organizationId,
        scopeType: "org",
        scopeId: organizationId,
        category: "convention",
        title: "Convenção Global",
        content: "Usar Zod strict em fronteiras externas.",
      })
      .returning();

    const [projMemory] = await db
      .insert(memories)
      .values({
        organizationId,
        scopeType: "project",
        scopeId: project!.id,
        category: "architecture",
        title: "Decisão Arquitetural",
        content: "Cache via singleton Symbol.for.",
        sourceDeliverableId: deliv!.id,
      })
      .returning();

    expect(orgMemory?.scopeType).toBe("org");
    expect(projMemory?.sourceDeliverableId).toBe(deliv!.id);

    // Excluir deliverable preserva a memória com sourceDeliverableId = null
    await db.delete(deliverables).where(eq(deliverables.id, deliv!.id));
    const [afterDelivDelete] = await db
      .select()
      .from(memories)
      .where(eq(memories.id, projMemory!.id));
    expect(afterDelivDelete?.sourceDeliverableId).toBeNull();
    expect(afterDelivDelete?.content).toContain("Symbol.for");

    // Isolamento de escopo em organização secundária e cascade
    const [otherOrg] = await db
      .insert(organizations)
      .values({
        name: "Org Secundária Mem",
        slug: `org-sec-${crypto.randomUUID().slice(0, 6)}`,
      })
      .returning();

    const [otherClient] = await db
      .insert(clients)
      .values({
        organizationId: otherOrg!.id,
        name: "Cliente Isolado",
        slug: "cliente-isolado",
      })
      .returning();

    const [otherMem] = await db
      .insert(memories)
      .values({
        organizationId: otherOrg!.id,
        scopeType: "client",
        scopeId: otherClient!.id,
        category: "domain_rule",
        title: "Regra Privada",
        content: "Somente Cliente Isolado.",
      })
      .returning();

    const queriedOrg1 = await db
      .select()
      .from(memories)
      .where(
        and(
          eq(memories.organizationId, organizationId),
          eq(memories.scopeType, "client")
        )
      );
    expect(queriedOrg1.some((m) => m.id === otherMem!.id)).toBe(false);

    await db.delete(organizations).where(eq(organizations.id, otherOrg!.id));
    const [afterOrgDelete] = await db
      .select()
      .from(memories)
      .where(eq(memories.id, otherMem!.id));
    expect(afterOrgDelete).toBeUndefined();
  });
});
