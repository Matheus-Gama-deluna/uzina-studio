import {
  ClientListResponseSchema,
  ClientSchema,
  CreateClientSchema,
  type Client,
} from "@uzina/contracts";
import { clients, getDb } from "@uzina/db";
import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { isPgUniqueViolation, jsonError, parseJsonBody, slugify } from "@/lib/api-utils";
import { READ_ROLES, WORKSPACE_WRITE_ROLES, requireOrgRole } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mapClient(row: typeof clients.$inferSelect): Client {
  return ClientSchema.parse({
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    slug: row.slug,
    isDefaultInternal: row.isDefaultInternal,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export async function GET(request: Request): Promise<Response> {
  const guard = await requireOrgRole(request, READ_ROLES);
  if (!guard.ok) return guard.response;

  const { db } = await getDb();
  const rows = await db
    .select()
    .from(clients)
    .where(eq(clients.organizationId, guard.actor.organizationId))
    .orderBy(asc(clients.isDefaultInternal), asc(clients.name));

  // Garantir "Internos" sempre no topo da lista
  const sorted = [...rows].sort(
    (a, b) => Number(b.isDefaultInternal) - Number(a.isDefaultInternal)
  );

  return NextResponse.json(
    ClientListResponseSchema.parse({ items: sorted.map(mapClient) }),
    { status: 200 }
  );
}

export async function POST(request: Request): Promise<Response> {
  const guard = await requireOrgRole(request, WORKSPACE_WRITE_ROLES);
  if (!guard.ok) return guard.response;

  const body = await parseJsonBody(request, CreateClientSchema);
  if (!body.ok) return body.response;

  const slug = body.data.slug ?? slugify(body.data.name);
  if (slug === "internos") {
    return jsonError(409, {
      error: "O slug 'internos' é reservado à conta interna da organização.",
      code: "RESERVED_SLUG",
    });
  }

  const { db } = await getDb();
  try {
    const [created] = await db
      .insert(clients)
      .values({
        organizationId: guard.actor.organizationId,
        name: body.data.name,
        slug,
        isDefaultInternal: false,
        notes: body.data.notes ?? null,
      })
      .returning();

    if (!created) {
      return jsonError(500, { error: "Falha ao criar cliente", code: "CREATE_FAILED" });
    }

    return NextResponse.json(mapClient(created), { status: 201 });
  } catch (error: unknown) {
    if (isPgUniqueViolation(error)) {
      return jsonError(409, {
        error: "Já existe um cliente com este slug nesta organização.",
        code: "DUPLICATE_SLUG",
      });
    }
    throw error;
  }
}
