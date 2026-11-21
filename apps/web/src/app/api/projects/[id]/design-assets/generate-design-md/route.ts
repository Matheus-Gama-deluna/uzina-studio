import {
  GenerateDesignMdInputSchema,
  GenerateDesignMdResponseSchema,
} from "@uzina/contracts";
import { generateDesignMdContract } from "@uzina/core/design-md";
import { designAssets, getDb, projects } from "@uzina/db";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { isUuid, jsonError, parseJsonBody } from "@/lib/api-utils";
import { WORKSPACE_WRITE_ROLES, requireOrgRole } from "@/lib/rbac";
import {
  findScopedDeliverableInProject,
  findScopedProject,
  mapDesignAsset,
} from "@/lib/studio-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const parsed = await parseJsonBody(request, GenerateDesignMdInputSchema);
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

  const rows = await db
    .select()
    .from(designAssets)
    .where(eq(designAssets.projectId, projectId));

  const referenceAssets = rows
    .filter((row) => row.assetType !== "design_md")
    .map(mapDesignAsset);

  const markdown = generateDesignMdContract({
    projectName: project.name,
    themePreference: parsed.data.themePreference,
    assets: referenceAssets,
    notes: parsed.data.notes,
  });

  const existingContract = rows.find((row) => row.assetType === "design_md");
  let savedRow: typeof designAssets.$inferSelect | undefined;

  if (existingContract) {
    const [updated] = await db
      .update(designAssets)
      .set({
        deliverableId: parsed.data.deliverableId ?? existingContract.deliverableId,
        mimeType: "text/markdown",
        sizeBytes: Buffer.byteLength(markdown, "utf8"),
        intentionTags: ["design-contract", parsed.data.themePreference],
        notes: markdown,
        approved: false,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(designAssets.id, existingContract.id),
          eq(designAssets.projectId, projectId)
        )
      )
      .returning();
    savedRow = updated;
  } else {
    const [inserted] = await db
      .insert(designAssets)
      .values({
        projectId,
        deliverableId: parsed.data.deliverableId ?? null,
        assetType: "design_md",
        title: "Contrato Visual .uzina/DESIGN.md",
        sourceUrl: null,
        storagePath: null,
        mimeType: "text/markdown",
        sizeBytes: Buffer.byteLength(markdown, "utf8"),
        intentionTags: ["design-contract", parsed.data.themePreference],
        notes: markdown,
        approved: false,
      })
      .returning();
    savedRow = inserted;
  }

  if (!savedRow) {
    return jsonError(500, {
      error: "Falha ao salvar contrato visual.",
      code: "DB_WRITE_FAILED",
    });
  }

  const designMdPath = ".uzina/DESIGN.md";
  await db
    .update(projects)
    .set({ designMdPath, updatedAt: new Date() })
    .where(eq(projects.id, projectId));

  return NextResponse.json(
    GenerateDesignMdResponseSchema.parse({
      asset: mapDesignAsset(savedRow),
      designMdPath,
      markdown,
    }),
    { status: 201 }
  );
}
