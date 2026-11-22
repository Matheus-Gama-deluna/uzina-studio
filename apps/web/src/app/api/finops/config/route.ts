import { UpdateEngineConfigSchema } from "@uzina/contracts";
import { getDb } from "@uzina/db";
import {
  buildAutoInjectedCodebaseContext,
  getEngineConfigScoped,
  updateEngineConfigScoped,
} from "@uzina/mastra-runtime";
import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "@/lib/api-utils";
import {
  READ_ROLES,
  WORKSPACE_WRITE_ROLES,
  requireOrgRole,
} from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PreviewInjectionSchema = z
  .object({
    projectId: z.uuid(),
    queryText: z.string().trim().min(2).max(400),
  })
  .strict();

export async function GET(request: Request) {
  const auth = await requireOrgRole(request, READ_ROLES);
  if (!auth.ok) return auth.response;

  const { db } = await getDb();
  const res = await getEngineConfigScoped(db, {
    organizationId: auth.actor.organizationId,
  });
  return NextResponse.json(res, { status: 200 });
}

export async function PUT(request: Request) {
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

  const parsed = UpdateEngineConfigSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(400, {
      error: parsed.error.issues[0]?.message ?? "Configuração de motores inválida.",
      code: "VALIDATION_ERROR",
    });
  }

  const { db } = await getDb();
  const updated = await updateEngineConfigScoped(db, {
    organizationId: auth.actor.organizationId,
    input: parsed.data,
  });
  return NextResponse.json(updated, { status: 200 });
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

  const parsed = PreviewInjectionSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(400, {
      error: parsed.error.issues[0]?.message ?? "Payload inválido.",
      code: "VALIDATION_ERROR",
    });
  }

  const { db } = await getDb();
  const injected = await buildAutoInjectedCodebaseContext(db, {
    organizationId: auth.actor.organizationId,
    projectId: parsed.data.projectId,
    queryText: parsed.data.queryText,
  });
  return NextResponse.json(injected, { status: 200 });
}
