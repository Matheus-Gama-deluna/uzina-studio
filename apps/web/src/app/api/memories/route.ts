import {
  CreateMemorySchema,
  MemoryCategorySchema,
  MemoryListResponseSchema,
  MemoryScopeSchema,
} from "@uzina/contracts";
import { getDb } from "@uzina/db";
import {
  WorkflowRuntimeError,
  createMemoryScoped,
  listMemoriesScoped,
} from "@uzina/mastra-runtime";
import { NextResponse } from "next/server";
import { isUuid, jsonError, parseJsonBody } from "@/lib/api-utils";
import {
  READ_ROLES,
  VAULT_WRITE_ROLES,
  WORKSPACE_WRITE_ROLES,
  requireOrgRole,
} from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const guard = await requireOrgRole(request, READ_ROLES);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const rawScopeType = url.searchParams.get("scopeType");
  const rawScopeId = url.searchParams.get("scopeId");
  const rawClientId = url.searchParams.get("clientId");
  const rawProjectId = url.searchParams.get("projectId");
  const rawCategory = url.searchParams.get("category");
  const rawLimit = url.searchParams.get("limit");

  let scopeType: ReturnType<typeof MemoryScopeSchema.parse> | undefined;
  if (rawScopeType) {
    const p = MemoryScopeSchema.safeParse(rawScopeType);
    if (!p.success) {
      return jsonError(400, { error: "scopeType inválido.", code: "INVALID_QUERY" });
    }
    scopeType = p.data;
  }

  let category: ReturnType<typeof MemoryCategorySchema.parse> | undefined;
  if (rawCategory) {
    const p = MemoryCategorySchema.safeParse(rawCategory);
    if (!p.success) {
      return jsonError(400, { error: "category inválida.", code: "INVALID_QUERY" });
    }
    category = p.data;
  }

  for (const [label, val] of [
    ["scopeId", rawScopeId],
    ["clientId", rawClientId],
    ["projectId", rawProjectId],
  ] as const) {
    if (val && !isUuid(val)) {
      return jsonError(400, { error: `${label} inválido.`, code: "INVALID_UUID" });
    }
  }

  const parsedLimit = rawLimit ? Number.parseInt(rawLimit, 10) : 50;

  try {
    const { db } = await getDb();
    const items = await listMemoriesScoped(db, {
      organizationId: guard.actor.organizationId,
      scopeType,
      scopeId: rawScopeId ?? undefined,
      clientId: rawClientId ?? undefined,
      projectId: rawProjectId ?? undefined,
      category,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 50,
    });
    return NextResponse.json(MemoryListResponseSchema.parse({ items }), {
      status: 200,
    });
  } catch (error) {
    console.error("[GET /api/memories] falha:", error);
    return jsonError(500, {
      error: "Erro interno ao listar memórias.",
      code: "INTERNAL_ERROR",
    });
  }
}

export async function POST(request: Request): Promise<Response> {
  const guard = await requireOrgRole(request, WORKSPACE_WRITE_ROLES);
  if (!guard.ok) return guard.response;

  const body = await parseJsonBody(request, CreateMemorySchema);
  if (!body.ok) return body.response;

  const isPrivileged =
    body.data.scopeType === "org" || body.data.category === "security_triage";
  if (isPrivileged && !VAULT_WRITE_ROLES.includes(guard.actor.role)) {
    return jsonError(403, {
      error:
        "Apenas owner ou admin pode criar memórias globais (org) ou de security_triage.",
      code: "FORBIDDEN",
    });
  }

  try {
    const { db } = await getDb();
    const created = await createMemoryScoped(db, {
      organizationId: guard.actor.organizationId,
      input: body.data,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof WorkflowRuntimeError) {
      return jsonError(error.statusCode, {
        error: error.message,
        code: error.code,
      });
    }
    console.error("[POST /api/memories] falha:", error);
    return jsonError(500, {
      error: "Erro interno ao criar memória.",
      code: "INTERNAL_ERROR",
    });
  }
}
