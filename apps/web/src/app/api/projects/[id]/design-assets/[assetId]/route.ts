import { UpdateDesignAssetSchema } from "@uzina/contracts";
import { designAssets, getDb } from "@uzina/db";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { isUuid, jsonError, parseJsonBody } from "@/lib/api-utils";
import { WORKSPACE_WRITE_ROLES, requireOrgRole } from "@/lib/rbac";
import { findScopedProject, mapDesignAsset } from "@/lib/studio-queries";
import { deleteUploadBestEffort } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; assetId: string }> }
) {
  const auth = await requireOrgRole(request, WORKSPACE_WRITE_ROLES);
  if (!auth.ok) return auth.response;

  const { id: projectId, assetId } = await context.params;
  if (!isUuid(projectId) || !isUuid(assetId)) {
    return jsonError(400, {
      error: "Identificador inválido.",
      code: "INVALID_UUID",
    });
  }

  const parsed = await parseJsonBody(request, UpdateDesignAssetSchema);
  if (!parsed.ok) return parsed.response;

  const { db } = await getDb();
  const project = await findScopedProject(
    db,
    projectId,
    auth.actor.organizationId
  );
  if (!project) {
    return jsonError(404, {
      error: "Projeto não encontrado.",
      code: "NOT_FOUND",
    });
  }

  const [existing] = await db
    .select()
    .from(designAssets)
    .where(
      and(eq(designAssets.id, assetId), eq(designAssets.projectId, projectId))
    )
    .limit(1);

  if (!existing) {
    return jsonError(404, {
      error: "Asset visual não encontrado.",
      code: "NOT_FOUND",
    });
  }

  const [updated] = await db
    .update(designAssets)
    .set({
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.intentionTags !== undefined
        ? { intentionTags: parsed.data.intentionTags }
        : {}),
      ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
      ...(parsed.data.approved !== undefined
        ? { approved: parsed.data.approved }
        : {}),
      updatedAt: new Date(),
    })
    .where(
      and(eq(designAssets.id, assetId), eq(designAssets.projectId, projectId))
    )
    .returning();

  if (!updated) {
    return jsonError(404, {
      error: "Asset visual não encontrado.",
      code: "NOT_FOUND",
    });
  }

  return NextResponse.json(mapDesignAsset(updated), { status: 200 });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; assetId: string }> }
) {
  const auth = await requireOrgRole(request, WORKSPACE_WRITE_ROLES);
  if (!auth.ok) return auth.response;

  const { id: projectId, assetId } = await context.params;
  if (!isUuid(projectId) || !isUuid(assetId)) {
    return jsonError(400, {
      error: "Identificador inválido.",
      code: "INVALID_UUID",
    });
  }

  const { db } = await getDb();
  const project = await findScopedProject(
    db,
    projectId,
    auth.actor.organizationId
  );
  if (!project) {
    return jsonError(404, {
      error: "Projeto não encontrado.",
      code: "NOT_FOUND",
    });
  }

  const [removed] = await db
    .delete(designAssets)
    .where(
      and(eq(designAssets.id, assetId), eq(designAssets.projectId, projectId))
    )
    .returning();

  if (!removed) {
    return jsonError(404, {
      error: "Asset visual não encontrado.",
      code: "NOT_FOUND",
    });
  }

  deleteUploadBestEffort(removed.storagePath);

  return NextResponse.json({ deleted: true, id: removed.id }, { status: 200 });
}
