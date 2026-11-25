import {
  ProviderTypeSchema,
  UpdateProviderProfileSchema,
  isAllowedGitHubApiBaseUrl,
  isPrivateOrLoopbackUrl,
} from "@uzina/contracts";
import { encryptSecret, maskApiKey } from "@uzina/core";
import { getDb, providerProfiles } from "@uzina/db";
import { and, eq, ne } from "drizzle-orm";
import { NextResponse } from "next/server";
import { isUuid, jsonError, parseJsonBody } from "@/lib/api-utils";
import { VAULT_WRITE_ROLES, requireOrgRole } from "@/lib/rbac";
import { getServerMasterKey, toPublicProviderProfile } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const guard = await requireOrgRole(request, VAULT_WRITE_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  if (!isUuid(id)) {
    return jsonError(400, { error: "ID de provedor inválido", code: "INVALID_ID" });
  }

  const body = await parseJsonBody(request, UpdateProviderProfileSchema);
  if (!body.ok) return body.response;

  const { db } = await getDb();
  const [existing] = await db
    .select()
    .from(providerProfiles)
    .where(
      and(
        eq(providerProfiles.id, id),
        eq(providerProfiles.organizationId, guard.actor.organizationId)
      )
    )
    .limit(1);

  if (!existing) {
    return jsonError(404, { error: "Provedor não encontrado", code: "NOT_FOUND" });
  }

  const providerType = ProviderTypeSchema.parse(existing.providerType);

  if (
    (providerType === "google" || providerType === "anthropic") &&
    body.data.baseUrl &&
    isPrivateOrLoopbackUrl(body.data.baseUrl)
  ) {
    return jsonError(400, {
      error:
        "Provedores cloud (Google/Anthropic) não podem apontar para endereços privados ou loopback.",
      code: "VALIDATION_ERROR",
    });
  }
  if (
    providerType === "github_pat" &&
    body.data.baseUrl &&
    !isAllowedGitHubApiBaseUrl(body.data.baseUrl)
  ) {
    return jsonError(400, {
      error:
        "GitHub PAT aceita exclusivamente https://api.github.com como Base URL.",
      code: "VALIDATION_ERROR",
    });
  }

  let nextEncryptedKey = existing.encryptedApiKey;
  let nextPreview = existing.keyPreview;
  if (body.data.apiKey) {
    const masterKey = getServerMasterKey();
    nextEncryptedKey = encryptSecret({
      plaintext: body.data.apiKey,
      masterKey,
      organizationId: guard.actor.organizationId,
      providerType,
    });
    nextPreview = maskApiKey(body.data.apiKey);
  }

  const updated = await db.transaction(async (tx) => {
    if (body.data.isDefault) {
      await tx
        .update(providerProfiles)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(
          and(
            eq(providerProfiles.organizationId, guard.actor.organizationId),
            providerType === "github_pat"
              ? eq(providerProfiles.providerType, "github_pat")
              : ne(providerProfiles.providerType, "github_pat")
          )
        );
    }

    const [row] = await tx
      .update(providerProfiles)
      .set({
        ...(body.data.name !== undefined ? { name: body.data.name } : {}),
        ...(body.data.baseUrl !== undefined
          ? { baseUrl: body.data.baseUrl }
          : {}),
        ...(body.data.apiKey !== undefined
          ? { encryptedApiKey: nextEncryptedKey, keyPreview: nextPreview }
          : {}),
        ...(body.data.roleBindings !== undefined
          ? { roleBindingsJson: body.data.roleBindings }
          : {}),
        ...(body.data.customPricing !== undefined
          ? { customPricingJson: body.data.customPricing }
          : {}),
        ...(body.data.isDefault !== undefined
          ? { isDefault: body.data.isDefault }
          : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(providerProfiles.id, existing.id),
          eq(providerProfiles.organizationId, guard.actor.organizationId)
        )
      )
      .returning();

    return row;
  });

  if (!updated) {
    return jsonError(404, { error: "Provedor não encontrado", code: "NOT_FOUND" });
  }

  return NextResponse.json(toPublicProviderProfile(updated), { status: 200 });
}
