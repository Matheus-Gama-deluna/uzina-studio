import {
  FinopsSummaryRequestSchema,
  RecordTokenSavingsSchema,
} from "@uzina/contracts";
import { getDb } from "@uzina/db";
import {
  getFinopsSummaryScoped,
  recordTokenSavingsEventScoped,
} from "@uzina/mastra-runtime";
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-utils";
import {
  READ_ROLES,
  WORKSPACE_WRITE_ROLES,
  requireOrgRole,
} from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireOrgRole(request, READ_ROLES);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const rawLimit = url.searchParams.get("limit");
  const parsed = FinopsSummaryRequestSchema.safeParse({
    projectId: url.searchParams.get("projectId") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    limit: rawLimit ? Number(rawLimit) : undefined,
  });

  if (!parsed.success) {
    return jsonError(400, {
      error: parsed.error.issues[0]?.message ?? "Parâmetros FinOps inválidos.",
      code: "VALIDATION_ERROR",
    });
  }

  const { db } = await getDb();
  const summary = await getFinopsSummaryScoped(db, {
    organizationId: auth.actor.organizationId,
    query: parsed.data,
  });
  return NextResponse.json(summary, { status: 200 });
}

export async function POST(request: Request) {
  const auth = await requireOrgRole(request, WORKSPACE_WRITE_ROLES);
  if (!auth.ok) return auth.response;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonError(400, {
      error: "Corpo JSON inválido.",
      code: "INVALID_JSON",
    });
  }

  const parsed = RecordTokenSavingsSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(400, {
      error: parsed.error.issues[0]?.message ?? "Payload FinOps inválido.",
      code: "VALIDATION_ERROR",
    });
  }

  const { db } = await getDb();
  const created = await recordTokenSavingsEventScoped(db, {
    organizationId: auth.actor.organizationId,
    input: parsed.data,
  });
  return NextResponse.json(created, { status: 201 });
}
