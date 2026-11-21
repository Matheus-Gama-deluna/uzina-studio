import { and, eq, isNull } from "drizzle-orm";
import type { UzinaDb } from "./client.js";
import { organizations, users } from "./schema/auth.js";
import { clients } from "./schema/workspace.js";

const DEFAULT_ORG_SLUG = "uzina-default";
const DEFAULT_ORG_NAME = "Uzina Studio";
const INTERNAL_CLIENT_SLUG = "internos";
const INTERNAL_CLIENT_NAME = "Internos";

export interface SeedResult {
  organizationId: string;
  internalClientId: string;
}

export async function ensureDefaultOrgAndInternalClient(
  db: UzinaDb,
  userId?: string
): Promise<SeedResult> {
  return db.transaction(async (tx) => {
    let organizationId: string | null = null;
    let userName = DEFAULT_ORG_NAME;

    if (userId) {
      const [existingUser] = await tx
        .select({
          organizationId: users.organizationId,
          name: users.name,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      organizationId = existingUser?.organizationId ?? null;
      if (existingUser?.name) {
        userName = existingUser.name;
      }
    }

    if (!organizationId) {
      const [anyExistingOrg] = await tx
        .select({ id: organizations.id })
        .from(organizations)
        .limit(1);

      // O 1o bootstrap cria "uzina-default". Novos usuários sem convite recebem
      // uma organização isolada própria, impedindo ingresso indevido no tenant de terceiros.
      const isIsolatedSignup = Boolean(userId && anyExistingOrg);
      const targetSlug = isIsolatedSignup
        ? `org-${userId!.replace(/-/g, "").slice(0, 12)}`
        : DEFAULT_ORG_SLUG;
      const targetName = isIsolatedSignup
        ? `${userName} Workspace`
        : DEFAULT_ORG_NAME;

      await tx
        .insert(organizations)
        .values({ name: targetName, slug: targetSlug })
        .onConflictDoNothing({ target: organizations.slug });

      const [resolvedOrg] = await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.slug, targetSlug))
        .limit(1);

      if (!resolvedOrg) {
        throw new Error(
          "Falha ao inicializar organização padrão do Uzina Studio."
        );
      }

      organizationId = resolvedOrg.id;

      if (userId) {
        await tx
          .update(users)
          .set({
            organizationId,
            role: "owner",
            updatedAt: new Date(),
          })
          .where(and(eq(users.id, userId), isNull(users.organizationId)));
      }
    }

    await tx
      .insert(clients)
      .values({
        organizationId,
        name: INTERNAL_CLIENT_NAME,
        slug: INTERNAL_CLIENT_SLUG,
        isDefaultInternal: true,
        notes:
          "Conta padrão para produtos e ferramentas internas da organização.",
      })
      .onConflictDoNothing({
        target: [clients.organizationId, clients.slug],
      });

    const [internalClient] = await tx
      .select({ id: clients.id })
      .from(clients)
      .where(
        and(
          eq(clients.organizationId, organizationId),
          eq(clients.slug, INTERNAL_CLIENT_SLUG)
        )
      )
      .limit(1);

    if (!internalClient) {
      throw new Error("Falha ao garantir cliente padrão 'Internos'.");
    }

    return {
      organizationId,
      internalClientId: internalClient.id,
    };
  });
}
