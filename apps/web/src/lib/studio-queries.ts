import { DesignAssetSchema, type DesignAsset } from "@uzina/contracts";
import {
  clients,
  deliverables,
  designAssets,
  projects,
  type UzinaDb,
} from "@uzina/db";
import { and, eq } from "drizzle-orm";

export function mapDesignAsset(
  row: typeof designAssets.$inferSelect
): DesignAsset {
  return DesignAssetSchema.parse({
    id: row.id,
    projectId: row.projectId,
    deliverableId: row.deliverableId,
    assetType: row.assetType,
    title: row.title,
    sourceUrl: row.sourceUrl,
    assetUrl: row.storagePath ? `/api/assets/${row.id}` : null,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    intentionTags: row.intentionTags,
    notes: row.notes,
    approved: row.approved,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export async function findScopedProject(
  db: UzinaDb,
  projectId: string,
  organizationId: string
): Promise<typeof projects.$inferSelect | null> {
  const [row] = await db
    .select({ project: projects })
    .from(projects)
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(
      and(
        eq(projects.id, projectId),
        eq(clients.organizationId, organizationId)
      )
    )
    .limit(1);
  return row?.project ?? null;
}

export async function findScopedDeliverableInProject(
  db: UzinaDb,
  deliverableId: string,
  projectId: string,
  organizationId: string
): Promise<typeof deliverables.$inferSelect | null> {
  const [row] = await db
    .select({ deliverable: deliverables })
    .from(deliverables)
    .innerJoin(projects, eq(deliverables.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(
      and(
        eq(deliverables.id, deliverableId),
        eq(deliverables.projectId, projectId),
        eq(clients.organizationId, organizationId)
      )
    )
    .limit(1);
  return row?.deliverable ?? null;
}
