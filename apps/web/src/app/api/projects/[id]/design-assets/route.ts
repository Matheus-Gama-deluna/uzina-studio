import {
  CreateDesignAssetReferenceSchema,
  DesignAssetListResponseSchema,
} from "@uzina/contracts";
import { designAssets, getDb } from "@uzina/db";
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isUuid, jsonError, parseJsonBody } from "@/lib/api-utils";
import { READ_ROLES, WORKSPACE_WRITE_ROLES, requireOrgRole } from "@/lib/rbac";
import {
  findScopedDeliverableInProject,
  findScopedProject,
  mapDesignAsset,
} from "@/lib/studio-queries";
import {
  checkMultipartContentLength,
  deleteUploadBestEffort,
  saveProjectImageUpload,
} from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MultipartMetadataSchema = z
  .object({
    assetType: z.enum(["moodboard_image", "image_mockup"]).default("moodboard_image"),
    title: z.string().trim().min(2).max(160),
    deliverableId: z.uuid().nullable().optional(),
    intentionTags: z.array(z.string().trim().min(1).max(60)).max(12).default([]),
    notes: z.string().trim().max(4000).nullable().optional(),
  })
  .strict();

function parseIntentionTagsField(
  raw: FormDataEntryValue | null
): { ok: true; tags: string[] } | { ok: false; error: string } {
  if (raw === null) {
    return { ok: true, tags: [] };
  }
  if (typeof raw !== "string") {
    return { ok: false, error: "intentionTags deve ser string ou JSON array." };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: true, tags: [] };
  }
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (
        Array.isArray(parsed) &&
        parsed.every((item) => typeof item === "string")
      ) {
        return {
          ok: true,
          tags: parsed.map((item) => item.trim()).filter(Boolean),
        };
      }
      return { ok: false, error: "intentionTags JSON deve ser array de strings." };
    } catch {
      return { ok: false, error: "JSON inválido no campo intentionTags." };
    }
  }
  return {
    ok: true,
    tags: trimmed
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireOrgRole(request, READ_ROLES);
  if (!auth.ok) return auth.response;

  const { id: projectId } = await context.params;
  if (!isUuid(projectId)) {
    return jsonError(400, {
      error: "ID de projeto inválido.",
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

  const url = new URL(request.url);
  const deliverableIdParam = url.searchParams.get("deliverableId");
  if (deliverableIdParam && !isUuid(deliverableIdParam)) {
    return jsonError(400, {
      error: "deliverableId inválido.",
      code: "INVALID_UUID",
    });
  }

  const conditions = [eq(designAssets.projectId, projectId)];
  if (deliverableIdParam) {
    conditions.push(eq(designAssets.deliverableId, deliverableIdParam));
  }

  const rows = await db
    .select()
    .from(designAssets)
    .where(and(...conditions))
    .orderBy(desc(designAssets.createdAt));

  return NextResponse.json(
    DesignAssetListResponseSchema.parse({
      items: rows.map(mapDesignAsset),
    }),
    { status: 200 }
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireOrgRole(request, WORKSPACE_WRITE_ROLES);
  if (!auth.ok) return auth.response;

  const { id: projectId } = await context.params;
  if (!isUuid(projectId)) {
    return jsonError(400, {
      error: "ID de projeto inválido.",
      code: "INVALID_UUID",
    });
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
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

  if (contentType.includes("multipart/form-data")) {
    const lengthErr = checkMultipartContentLength(request);
    if (lengthErr) return lengthErr;

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return jsonError(400, {
        error: "Corpo multipart/form-data inválido.",
        code: "INVALID_FORM_DATA",
      });
    }

    const fileEntry = form.get("file");
    if (!(fileEntry instanceof File)) {
      return jsonError(400, {
        error: "Campo 'file' (imagem PNG/JPEG/WEBP) é obrigatório.",
        code: "MISSING_FILE",
      });
    }

    const parsedTags = parseIntentionTagsField(form.get("intentionTags"));
    if (!parsedTags.ok) {
      return jsonError(400, {
        error: parsedTags.error,
        code: "VALIDATION_ERROR",
      });
    }

    const rawDeliverableId = form.get("deliverableId");
    const rawNotes = form.get("notes");
    const rawAssetType = form.get("assetType");
    const metaParsed = MultipartMetadataSchema.safeParse({
      assetType:
        typeof rawAssetType === "string" && rawAssetType.length > 0
          ? rawAssetType
          : "moodboard_image",
      title: typeof form.get("title") === "string" ? form.get("title") : fileEntry.name,
      deliverableId:
        typeof rawDeliverableId === "string" && rawDeliverableId.length > 0
          ? rawDeliverableId
          : null,
      intentionTags: parsedTags.tags,
      notes:
        typeof rawNotes === "string" && rawNotes.length > 0 ? rawNotes : null,
    });

    if (!metaParsed.success) {
      return jsonError(400, {
        error: metaParsed.error.issues[0]?.message ?? "Metadados inválidos.",
        code: "VALIDATION_ERROR",
      });
    }

    if (metaParsed.data.deliverableId) {
      const deliv = await findScopedDeliverableInProject(
        db,
        metaParsed.data.deliverableId,
        projectId,
        auth.actor.organizationId
      );
      if (!deliv) {
        return jsonError(404, {
          error: "Entregável informado não pertence a este projeto.",
          code: "NOT_FOUND",
        });
      }
    }

    const saved = await saveProjectImageUpload(projectId, fileEntry);
    if (!saved.ok) {
      return jsonError(saved.status, {
        error: saved.error,
        code: saved.code,
      });
    }

    try {
      const [created] = await db
        .insert(designAssets)
        .values({
          projectId,
          deliverableId: metaParsed.data.deliverableId ?? null,
          assetType: metaParsed.data.assetType,
          title: metaParsed.data.title,
          sourceUrl: null,
          storagePath: saved.storagePath,
          mimeType: saved.mimeType,
          sizeBytes: saved.sizeBytes,
          intentionTags: metaParsed.data.intentionTags,
          notes: metaParsed.data.notes ?? null,
          approved: false,
        })
        .returning();

      if (!created) {
        deleteUploadBestEffort(saved.storagePath);
        return jsonError(500, {
          error: "Falha ao persistir asset visual.",
          code: "DB_INSERT_FAILED",
        });
      }

      return NextResponse.json(mapDesignAsset(created), { status: 201 });
    } catch {
      deleteUploadBestEffort(saved.storagePath);
      return jsonError(500, {
        error: "Erro ao gravar metadados do asset após upload.",
        code: "DB_INSERT_FAILED",
      });
    }
  }

  const parsed = await parseJsonBody(request, CreateDesignAssetReferenceSchema);
  if (!parsed.ok) return parsed.response;

  if (parsed.data.deliverableId) {
    const deliv = await findScopedDeliverableInProject(
      db,
      parsed.data.deliverableId,
      projectId,
      auth.actor.organizationId
    );
    if (!deliv) {
      return jsonError(404, {
        error: "Entregável informado não pertence a este projeto.",
        code: "NOT_FOUND",
      });
    }
  }

  const [created] = await db
    .insert(designAssets)
    .values({
      projectId,
      deliverableId: parsed.data.deliverableId ?? null,
      assetType: parsed.data.assetType,
      title: parsed.data.title,
      sourceUrl: parsed.data.sourceUrl ?? null,
      storagePath: null,
      mimeType: null,
      sizeBytes: null,
      intentionTags: parsed.data.intentionTags,
      notes: parsed.data.notes ?? null,
      approved: false,
    })
    .returning();

  if (!created) {
    return jsonError(500, {
      error: "Falha ao cadastrar referência visual.",
      code: "DB_INSERT_FAILED",
    });
  }

  return NextResponse.json(mapDesignAsset(created), { status: 201 });
}
