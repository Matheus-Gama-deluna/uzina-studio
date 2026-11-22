import { IngestSecurityScanSchema } from "@uzina/contracts";
import { getDb } from "@uzina/db";
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-utils";
import {
  assertScopedProjectOrDeliverable,
  persistIngestedSecurityScan,
} from "@/lib/operations-queries";
import { WORKSPACE_WRITE_ROLES, requireOrgRole } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_INGEST_BYTES = 5 * 1024 * 1024;

export async function POST(request: Request): Promise<Response> {
  const guard = await requireOrgRole(request, WORKSPACE_WRITE_ROLES);
  if (!guard.ok) return guard.response;

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_INGEST_BYTES) {
    return jsonError(413, {
      error: "Payload de ingestão SARIF excede o limite de 5 MiB.",
      code: "PAYLOAD_TOO_LARGE",
    });
  }

  let rawText: string;
  try {
    rawText = await request.text();
  } catch {
    return jsonError(400, {
      error: "Não foi possível ler o corpo da requisição.",
      code: "INVALID_BODY",
    });
  }

  if (Buffer.byteLength(rawText, "utf8") > MAX_INGEST_BYTES) {
    return jsonError(413, {
      error: "Payload de ingestão SARIF excede o limite de 5 MiB.",
      code: "PAYLOAD_TOO_LARGE",
    });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    return jsonError(400, {
      error: "JSON inválido no payload de ingestão.",
      code: "INVALID_JSON",
    });
  }

  const parsed = IngestSecurityScanSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return jsonError(400, {
      error: parsed.error.issues[0]?.message ?? "Payload SARIF inválido.",
      code: "VALIDATION_ERROR",
    });
  }

  const { db } = await getDb();
  const scoped = await assertScopedProjectOrDeliverable(
    db,
    guard.actor.organizationId,
    {
      projectId: parsed.data.projectId ?? null,
      deliverableId: parsed.data.deliverableId ?? null,
    }
  );

  if (!scoped.ok) {
    return jsonError(404, {
      error: scoped.message,
      code: "NOT_FOUND",
    });
  }

  try {
    const saved = await persistIngestedSecurityScan(db, {
      organizationId: guard.actor.organizationId,
      projectId: scoped.resolvedProjectId,
      deliverableId: parsed.data.deliverableId ?? null,
      input: parsed.data,
    });
    return NextResponse.json(saved, { status: 201 });
  } catch (error) {
    console.error("[POST /api/security/scans/ingest] falha:", error);
    return jsonError(500, {
      error: "Erro interno ao ingerir relatório de segurança.",
      code: "INTERNAL_ERROR",
    });
  }
}
