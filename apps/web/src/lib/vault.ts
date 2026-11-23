import {
  ProviderProfilePublicSchema,
  ProviderTypeSchema,
  RoleBindingsSchema,
  type ProviderProfilePublic,
} from "@uzina/contracts";
import { encryptSecret, maskApiKey, resolveMasterKey } from "@uzina/core";
import { providerProfiles, resolveDataDir, type UzinaDb } from "@uzina/db";
import { eq } from "drizzle-orm";

export function getServerMasterKey(): Buffer {
  if (process.env.NEXT_PHASE === "phase-production-build") {
    throw new Error(
      "getServerMasterKey não deve ser chamado durante phase-production-build."
    );
  }
  return resolveMasterKey(process.env, resolveDataDir(process.env));
}

export function tryGetServerMasterKey(): Buffer | undefined {
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return undefined;
  }
  try {
    return resolveMasterKey(process.env, resolveDataDir(process.env));
  } catch {
    return undefined;
  }
}

export function toPublicProviderProfile(
  row: typeof providerProfiles.$inferSelect
): ProviderProfilePublic {
  const providerType = ProviderTypeSchema.parse(row.providerType);
  const roleBindings = RoleBindingsSchema.parse(row.roleBindingsJson ?? {});

  return ProviderProfilePublicSchema.parse({
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    providerType,
    baseUrl: row.baseUrl,
    hasApiKey: Boolean(row.encryptedApiKey),
    keyPreview: row.keyPreview,
    roleBindings,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export async function bootstrapOmniRouteIfConfigured(
  db: UzinaDb,
  organizationId: string
): Promise<void> {
  const baseUrl = process.env.OMNIROUTE_BASE_URL?.trim();
  const apiKey = process.env.OMNIROUTE_API_KEY?.trim();
  if (!baseUrl || !apiKey) {
    return;
  }

  const existing = await db
    .select({ id: providerProfiles.id })
    .from(providerProfiles)
    .where(eq(providerProfiles.organizationId, organizationId))
    .limit(1);

  if (existing.length > 0) {
    return;
  }

  const masterKey = getServerMasterKey();
  const encryptedApiKey = encryptSecret({
    plaintext: apiKey,
    masterKey,
    organizationId,
    providerType: "omniroute",
  });

  await db.insert(providerProfiles).values({
    organizationId,
    name: "OmniRoute (Env Bootstrap)",
    providerType: "omniroute",
    baseUrl,
    encryptedApiKey,
    keyPreview: maskApiKey(apiKey),
    roleBindingsJson: {},
    isDefault: true,
  });
}
