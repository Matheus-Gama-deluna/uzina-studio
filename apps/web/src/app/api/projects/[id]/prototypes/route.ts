import { CreatePrototypeRequestSchema } from "@uzina/contracts";
import { MAX_PROTOTYPE_HTML_BYTES } from "@uzina/core";
import { getDb } from "@uzina/db";
import {
  WorkflowRuntimeError,
  createOrImportPrototypeScoped,
  listProjectPrototypesScoped,
} from "@uzina/mastra-runtime";
import { NextResponse } from "next/server";
import { isUuid, jsonError } from "@/lib/api-utils";
import {
  READ_ROLES,
  WORKSPACE_WRITE_ROLES,
  requireOrgRole,
} from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireOrgRole(request, READ_ROLES);
  if (!auth.ok) return auth.response;

  const { id: projectId } = await context.params;
  if (!isUuid(projectId)) {
    return jsonError(400, {
      error: "ID de projeto inválido.",
      code: "INVALID_UUID",
    });
  }

  const { db } = await getDb();
  try {
    const items = await listProjectPrototypesScoped(db, {
      organizationId: auth.actor.organizationId,
      projectId,
    });
    return NextResponse.json({ items }, { status: 200 });
  } catch (err) {
    if (err instanceof WorkflowRuntimeError) {
      return jsonError(err.statusCode, { error: err.message, code: err.code });
    }
    throw err;
  }
}

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

  const rawLen = request.headers.get("content-length");
  if (rawLen && Number(rawLen) > MAX_PROTOTYPE_HTML_BYTES + 64 * 1024) {
    return jsonError(413, {
      error: "Payload HTML excede o limite de 2 MiB.",
      code: "PAYLOAD_TOO_LARGE",
    });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonError(400, {
      error: "Corpo JSON inválido.",
      code: "INVALID_JSON",
    });
  }

  if (
    typeof rawBody === "object" &&
    rawBody !== null &&
    "html" in rawBody &&
    typeof (rawBody as { html?: unknown }).html === "string" &&
    Buffer.byteLength((rawBody as { html: string }).html, "utf8") >
      MAX_PROTOTYPE_HTML_BYTES
  ) {
    return jsonError(413, {
      error: "HTML do protótipo excede o limite de 2 MiB.",
      code: "PAYLOAD_TOO_LARGE",
    });
  }

  const parsed = CreatePrototypeRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(400, {
      error: parsed.error.issues[0]?.message ?? "Payload inválido.",
      code: "VALIDATION_ERROR",
    });
  }

  const { db } = await getDb();
  try {
    const created = await createOrImportPrototypeScoped(db, {
      organizationId: auth.actor.organizationId,
      projectId,
      input: parsed.data,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (err instanceof WorkflowRuntimeError) {
      return jsonError(err.statusCode, { error: err.message, code: err.code });
    }
    throw err;
  }
}
