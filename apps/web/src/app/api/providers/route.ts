import {
  CreateProviderProfileSchema,
  ProviderProfileListResponseSchema,
} from "@uzina/contracts";
import { encryptSecret, maskApiKey } from "@uzina/core";
import { getDb, providerProfiles } from "@uzina/db";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { jsonError, parseJsonBody } from "@/lib/api-utils";
import { READ_ROLES, VAULT_WRITE_ROLES, requireOrgRole } from "@/lib/rbac";
import { getServerMasterKey, toPublicProviderProfile } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const guard = await requireOrgRole(request, READ_ROLES);
  if (!guard.ok) return guard.response;

  const { db } = await getDb();
  const rows = await db
    .select()
    .from(providerProfiles)
    .where(eq(providerProfiles.organizationId, guard.actor.organizationId))
    .orderBy(desc(providerProfiles.isDefault), desc(providerProfiles.createdAt));

  return NextResponse.json(
    ProviderProfileListResponseSchema.parse({
      items: rows.map(toPublicProviderProfile),
    }),
    { status: 200 }
  );
}

export async function POST(request: Request): Promise<Response> {
  const guard = await requireOrgRole(request, VAULT_WRITE_ROLES);
  if (!guard.ok) return guard.response;

  const body = await parseJsonBody(request, CreateProviderProfileSchema);
  if (!body.ok) return body.response;

  let encryptedApiKey: string | null = null;
  let keyPreview: string | null = null;

  if (body.data.apiKey) {
    const masterKey = getServerMasterKey();
    encryptedApiKey = encryptSecret({
      plaintext: body.data.apiKey,
      masterKey,
      organizationId: guard.actor.organizationId,
      providerType: body.data.providerType,
    });
    keyPreview = maskApiKey(body.data.apiKey);
  }

  const { db } = await getDb();
  const created = await db.transaction(async (tx) => {
    if (body.data.isDefault) {
      await tx
        .update(providerProfiles)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(providerProfiles.organizationId, guard.actor.organizationId));
    }

    const [row] = await tx
      .insert(providerProfiles)
      .values({
        organizationId: guard.actor.organizationId,
        name: body.data.name,
        providerType: body.data.providerType,
        baseUrl: body.data.baseUrl ?? null,
        encryptedApiKey,
        keyPreview,
        roleBindingsJson: body.data.roleBindings,
        customPricingJson: body.data.customPricing ?? {},
        isDefault: body.data.isDefault,
      })
      .returning();

    return row;
  });

  if (!created) {
    return jsonError(500, {
      error: "Falha ao criar perfil de provedor",
      code: "CREATE_FAILED",
    });
  }

  return NextResponse.json(toPublicProviderProfile(created), { status: 201 });
}
