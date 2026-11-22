import {
  CreateMemorySchema,
  MemorySchema,
  UpdateMemorySchema,
  type CreateMemoryInput,
  type Memory,
  type MemoryCategory,
  type MemoryScope,
  type UpdateMemoryInput,
} from "@uzina/contracts";
import { redactSensitiveText } from "@uzina/core";
import {
  clients,
  deliverables,
  memories,
  projects,
  type UzinaDb,
} from "@uzina/db";
import { and, desc, eq, inArray, or, type SQL } from "drizzle-orm";
import { WorkflowRuntimeError } from "./errors.js";
import { indexMemoryChunks } from "./qmd.js";

export function mapMemoryRow(row: typeof memories.$inferSelect): Memory {
  return MemorySchema.parse({
    id: row.id,
    organizationId: row.organizationId,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    category: row.category,
    title: row.title,
    content: row.content,
    sourceDeliverableId: row.sourceDeliverableId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export async function assertValidMemoryScope(
  db: UzinaDb,
  organizationId: string,
  scopeType: MemoryScope,
  scopeId: string
): Promise<void> {
  if (scopeType === "org") {
    if (scopeId !== organizationId) {
      throw new WorkflowRuntimeError({
        statusCode: 403,
        code: "INVALID_WORKFLOW_INPUT",
        message: "Escopo 'org' deve corresponder à organização autenticada.",
      });
    }
    return;
  }

  if (scopeType === "client") {
    const [client] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(
        and(eq(clients.id, scopeId), eq(clients.organizationId, organizationId))
      )
      .limit(1);
    if (!client) {
      throw new WorkflowRuntimeError({
        statusCode: 404,
        code: "DELIVERABLE_NOT_FOUND",
        message: "Cliente de escopo não encontrado na organização.",
      });
    }
    return;
  }

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(
      and(eq(projects.id, scopeId), eq(clients.organizationId, organizationId))
    )
    .limit(1);

  if (!project) {
    throw new WorkflowRuntimeError({
      statusCode: 404,
      code: "DELIVERABLE_NOT_FOUND",
      message: "Projeto de escopo não encontrado na organização.",
    });
  }
}

export async function resolveHierarchicalMemories(
  db: UzinaDb,
  params: {
    organizationId: string;
    clientId?: string;
    projectId?: string;
    categories?: readonly MemoryCategory[];
    limit?: number;
  }
): Promise<Memory[]> {
  let effectiveClientId: string | undefined = params.clientId;
  let effectiveProjectId: string | undefined;

  if (params.projectId) {
    const [proj] = await db
      .select({ id: projects.id, clientId: projects.clientId })
      .from(projects)
      .innerJoin(clients, eq(projects.clientId, clients.id))
      .where(
        and(
          eq(projects.id, params.projectId),
          eq(clients.organizationId, params.organizationId)
        )
      )
      .limit(1);

    if (!proj) {
      return [];
    }
    effectiveProjectId = proj.id;
    effectiveClientId = proj.clientId;
  } else if (effectiveClientId) {
    const [client] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(
        and(
          eq(clients.id, effectiveClientId),
          eq(clients.organizationId, params.organizationId)
        )
      )
      .limit(1);
    if (!client) {
      return [];
    }
  }

  const scopePredicates: SQL[] = [
    and(
      eq(memories.scopeType, "org"),
      eq(memories.scopeId, params.organizationId)
    )!,
  ];

  if (effectiveClientId) {
    scopePredicates.push(
      and(
        eq(memories.scopeType, "client"),
        eq(memories.scopeId, effectiveClientId)
      )!
    );
  }

  if (effectiveProjectId) {
    scopePredicates.push(
      and(
        eq(memories.scopeType, "project"),
        eq(memories.scopeId, effectiveProjectId)
      )!
    );
  }

  const conditions: SQL[] = [
    eq(memories.organizationId, params.organizationId),
    or(...scopePredicates)!,
  ];

  if (params.categories && params.categories.length > 0) {
    conditions.push(inArray(memories.category, [...params.categories]));
  }

  const limit = Math.min(Math.max(params.limit ?? 30, 1), 100);
  const rows = await db
    .select()
    .from(memories)
    .where(and(...conditions))
    .orderBy(desc(memories.updatedAt))
    .limit(limit);

  return rows.map(mapMemoryRow);
}

export function formatMemoriesForPrompt(items: readonly Memory[]): string {
  if (items.length === 0) {
    return "";
  }
  const lines = items.map((m) => {
    const cleanTitle = redactSensitiveText(m.title);
    const cleanContent = redactSensitiveText(m.content).slice(0, 600);
    return `- [${m.scopeType}/${m.category}] ${cleanTitle}: ${cleanContent}`;
  });
  return `Memórias ativas do escopo:\n${lines.join("\n")}`;
}

export async function createMemoryScoped(
  db: UzinaDb,
  params: {
    organizationId: string;
    input: CreateMemoryInput;
  }
): Promise<Memory> {
  const parsed = CreateMemorySchema.parse(params.input);
  await assertValidMemoryScope(
    db,
    params.organizationId,
    parsed.scopeType,
    parsed.scopeId
  );

  if (parsed.sourceDeliverableId) {
    const [deliv] = await db
      .select({ id: deliverables.id })
      .from(deliverables)
      .innerJoin(projects, eq(deliverables.projectId, projects.id))
      .innerJoin(clients, eq(projects.clientId, clients.id))
      .where(
        and(
          eq(deliverables.id, parsed.sourceDeliverableId),
          eq(clients.organizationId, params.organizationId)
        )
      )
      .limit(1);
    if (!deliv) {
      throw new WorkflowRuntimeError({
        statusCode: 404,
        code: "DELIVERABLE_NOT_FOUND",
        message: "sourceDeliverableId não encontrado na organização.",
      });
    }
  }

  const [created] = await db
    .insert(memories)
    .values({
      organizationId: params.organizationId,
      scopeType: parsed.scopeType,
      scopeId: parsed.scopeId,
      category: parsed.category,
      title: redactSensitiveText(parsed.title),
      content: redactSensitiveText(parsed.content),
      sourceDeliverableId: parsed.sourceDeliverableId ?? null,
    })
    .returning();

  const mapped = mapMemoryRow(created!);
  await indexMemoryChunks(db, mapped);
  return mapped;
}

export async function listMemoriesScoped(
  db: UzinaDb,
  params: {
    organizationId: string;
    scopeType?: MemoryScope;
    scopeId?: string;
    clientId?: string;
    projectId?: string;
    category?: MemoryCategory;
    limit?: number;
  }
): Promise<Memory[]> {
  if (params.projectId || params.clientId) {
    const resolved = await resolveHierarchicalMemories(db, {
      organizationId: params.organizationId,
      clientId: params.clientId,
      projectId: params.projectId,
      categories: params.category ? [params.category] : undefined,
      limit: params.limit,
    });
    if (params.scopeType) {
      return resolved.filter((m) => m.scopeType === params.scopeType);
    }
    return resolved;
  }

  const conditions: SQL[] = [eq(memories.organizationId, params.organizationId)];
  if (params.scopeType) {
    conditions.push(eq(memories.scopeType, params.scopeType));
  }
  if (params.scopeId) {
    conditions.push(eq(memories.scopeId, params.scopeId));
  }
  if (params.category) {
    conditions.push(eq(memories.category, params.category));
  }

  const limit = Math.min(Math.max(params.limit ?? 50, 1), 100);
  const rows = await db
    .select()
    .from(memories)
    .where(and(...conditions))
    .orderBy(desc(memories.updatedAt))
    .limit(limit);

  return rows.map(mapMemoryRow);
}

export async function getMemoryByIdScoped(
  db: UzinaDb,
  id: string,
  organizationId: string
): Promise<Memory | null> {
  const [row] = await db
    .select()
    .from(memories)
    .where(and(eq(memories.id, id), eq(memories.organizationId, organizationId)))
    .limit(1);
  return row ? mapMemoryRow(row) : null;
}

export async function updateMemoryScoped(
  db: UzinaDb,
  params: {
    id: string;
    organizationId: string;
    input: UpdateMemoryInput;
  }
): Promise<Memory | null> {
  const parsed = UpdateMemorySchema.parse(params.input);
  const existing = await getMemoryByIdScoped(
    db,
    params.id,
    params.organizationId
  );
  if (!existing) {
    return null;
  }

  const [updated] = await db
    .update(memories)
    .set({
      category: parsed.category ?? existing.category,
      title: parsed.title ? redactSensitiveText(parsed.title) : existing.title,
      content: parsed.content
        ? redactSensitiveText(parsed.content)
        : existing.content,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(memories.id, params.id),
        eq(memories.organizationId, params.organizationId)
      )
    )
    .returning();

  if (!updated) {
    return null;
  }
  const mapped = mapMemoryRow(updated);
  await indexMemoryChunks(db, mapped);
  return mapped;
}

export async function deleteMemoryScoped(
  db: UzinaDb,
  params: { id: string; organizationId: string }
): Promise<boolean> {
  const deleted = await db
    .delete(memories)
    .where(
      and(
        eq(memories.id, params.id),
        eq(memories.organizationId, params.organizationId)
      )
    )
    .returning();

  return deleted.length > 0;
}
