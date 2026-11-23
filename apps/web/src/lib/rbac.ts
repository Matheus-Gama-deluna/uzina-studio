import { OrgRoleSchema, type OrgRole } from "@uzina/contracts";
import {
  clients,
  ensureDefaultOrgAndInternalClient,
  getDb,
  users,
} from "@uzina/db";
import { and, eq } from "drizzle-orm";
import { getAuth } from "./auth";
import { jsonError } from "./api-utils";
import { bootstrapOmniRouteIfConfigured } from "./vault";

export interface AuthenticatedActor {
  userId: string;
  organizationId: string;
  role: OrgRole;
  name: string;
  email: string;
}

export type AuthGuardResult =
  | { ok: true; actor: AuthenticatedActor }
  | { ok: false; response: ReturnType<typeof jsonError> };

export const READ_ROLES: OrgRole[] = ["owner", "admin", "developer", "auditor"];
export const WORKSPACE_WRITE_ROLES: OrgRole[] = ["owner", "admin", "developer"];
export const VAULT_WRITE_ROLES: OrgRole[] = ["owner", "admin"];

export async function requireOrgRoleFromHeaders(
  headers: Headers,
  allowedRoles: readonly OrgRole[]
): Promise<AuthGuardResult> {
  let sessionUserId: string | undefined;
  try {
    const auth = await getAuth();
    const session = await auth.api.getSession({ headers });
    sessionUserId = session?.user?.id;
  } catch {
    return {
      ok: false,
      response: jsonError(503, {
        error: "Serviço de autenticação indisponível",
        code: "AUTH_UNAVAILABLE",
      }),
    };
  }

  if (!sessionUserId) {
    return {
      ok: false,
      response: jsonError(401, {
        error: "Não autorizado",
        code: "UNAUTHORIZED",
      }),
    };
  }

  const { db } = await getDb();
  const [dbUser] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      organizationId: users.organizationId,
      role: users.role,
    })
    .from(users)
    .where(eq(users.id, sessionUserId))
    .limit(1);

  if (!dbUser) {
    return {
      ok: false,
      response: jsonError(401, {
        error: "Sessão inválida",
        code: "UNAUTHORIZED",
      }),
    };
  }

  let organizationId = dbUser.organizationId;
  let effectiveRole = dbUser.role;
  if (!organizationId) {
    const seeded = await ensureDefaultOrgAndInternalClient(db, dbUser.id);
    organizationId = seeded.organizationId;
    await bootstrapOmniRouteIfConfigured(db, organizationId);
    const [refreshed] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, dbUser.id))
      .limit(1);
    if (refreshed?.role) {
      effectiveRole = refreshed.role;
    }
  } else {
    const [existingInternal] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(
        and(
          eq(clients.organizationId, organizationId),
          eq(clients.isDefaultInternal, true)
        )
      )
      .limit(1);
    if (!existingInternal) {
      await ensureDefaultOrgAndInternalClient(db, dbUser.id);
    }
  }

  const parsedRole = OrgRoleSchema.safeParse(effectiveRole);
  const role: OrgRole = parsedRole.success ? parsedRole.data : "auditor";

  if (!allowedRoles.includes(role)) {
    return {
      ok: false,
      response: jsonError(403, {
        error: "Permissão insuficiente para esta operação",
        code: "FORBIDDEN",
      }),
    };
  }

  return {
    ok: true,
    actor: {
      userId: dbUser.id,
      organizationId,
      role,
      name: dbUser.name,
      email: dbUser.email,
    },
  };
}

export async function requireOrgRole(
  request: Request,
  allowedRoles: readonly OrgRole[]
): Promise<AuthGuardResult> {
  return requireOrgRoleFromHeaders(request.headers, allowedRoles);
}
