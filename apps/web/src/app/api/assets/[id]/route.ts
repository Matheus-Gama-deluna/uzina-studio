import path from "node:path";
import { clients, designAssets, getDb, projects } from "@uzina/db";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { isUuid, jsonError } from "@/lib/api-utils";
import { READ_ROLES, requireOrgRole } from "@/lib/rbac";
import { readProjectImageUpload } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireOrgRole(request, READ_ROLES);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!isUuid(id)) {
    return jsonError(400, {
      error: "ID de asset inválido.",
      code: "INVALID_UUID",
    });
  }

  const { db } = await getDb();
  const [row] = await db
    .select({
      id: designAssets.id,
      storagePath: designAssets.storagePath,
      mimeType: designAssets.mimeType,
    })
    .from(designAssets)
    .innerJoin(projects, eq(designAssets.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(
      and(
        eq(designAssets.id, id),
        eq(clients.organizationId, auth.actor.organizationId)
      )
    )
    .limit(1);

  if (!row || !row.storagePath || !row.mimeType) {
    return jsonError(404, {
      error: "Asset não encontrado.",
      code: "NOT_FOUND",
    });
  }

  if (!ALLOWED_MIME_TYPES.has(row.mimeType)) {
    return jsonError(404, {
      error: "Asset não disponível para entrega binária.",
      code: "NOT_FOUND",
    });
  }

  const buffer = readProjectImageUpload(row.storagePath);
  if (!buffer) {
    return jsonError(404, {
      error: "Arquivo físico do asset não encontrado.",
      code: "NOT_FOUND",
    });
  }

  const safeFilename = path.basename(row.storagePath);

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": row.mimeType,
      "Content-Disposition": `inline; filename="${safeFilename}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, max-age=300",
    },
  });
}
