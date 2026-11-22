import {
  RunSecurityScanSchema,
  SecurityScanListResponseSchema,
  SecurityScanStatusSchema,
} from "@uzina/contracts";
import { getDb } from "@uzina/db";
import { runSecurityScan } from "@uzina/security-engine";
import { NextResponse } from "next/server";
import { isUuid, jsonError, parseJsonBody } from "@/lib/api-utils";
import {
  buildProjectSuppressionLookup,
  listScopedSecurityScans,
  persistExecutedSecurityScan,
  resolveServerScanTarget,
} from "@/lib/operations-queries";
import { READ_ROLES, WORKSPACE_WRITE_ROLES, requireOrgRole } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function resolveServerDastAllowlist(): string[] {
  return (process.env.UZINA_DAST_ALLOWLIST ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
}

export async function GET(request: Request): Promise<Response> {
  const guard = await requireOrgRole(request, READ_ROLES);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const rawProjectId = url.searchParams.get("projectId");
  const rawDeliverableId = url.searchParams.get("deliverableId");
  const rawStatus = url.searchParams.get("status");
  const rawLimit = url.searchParams.get("limit");

  if (rawProjectId && !isUuid(rawProjectId)) {
    return jsonError(400, { error: "projectId inválido.", code: "INVALID_UUID" });
  }
  if (rawDeliverableId && !isUuid(rawDeliverableId)) {
    return jsonError(400, {
      error: "deliverableId inválido.",
      code: "INVALID_UUID",
    });
  }

  let statusFilter: ReturnType<typeof SecurityScanStatusSchema.parse> | undefined;
  if (rawStatus) {
    const parsedStatus = SecurityScanStatusSchema.safeParse(rawStatus);
    if (!parsedStatus.success) {
      return jsonError(400, { error: "status inválido.", code: "INVALID_QUERY" });
    }
    statusFilter = parsedStatus.data;
  }

  const parsedLimit = rawLimit ? Number.parseInt(rawLimit, 10) : 50;

  try {
    const { db } = await getDb();
    const items = await listScopedSecurityScans(db, guard.actor.organizationId, {
      projectId: rawProjectId ?? undefined,
      deliverableId: rawDeliverableId ?? undefined,
      status: statusFilter,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 50,
    });

    return NextResponse.json(
      SecurityScanListResponseSchema.parse({ items }),
      { status: 200 }
    );
  } catch (error) {
    console.error("[GET /api/security/scans] falha:", error);
    return jsonError(500, {
      error: "Erro interno ao listar auditorias de segurança.",
      code: "INTERNAL_ERROR",
    });
  }
}

export async function POST(request: Request): Promise<Response> {
  const guard = await requireOrgRole(request, WORKSPACE_WRITE_ROLES);
  if (!guard.ok) return guard.response;

  const body = await parseJsonBody(request, RunSecurityScanSchema);
  if (!body.ok) return body.response;

  const { db } = await getDb();
  const target = await resolveServerScanTarget(
    db,
    guard.actor.organizationId,
    body.data
  );

  if (!target.ok) {
    return jsonError(target.statusCode, {
      error: target.message,
      code: target.code,
    });
  }

  try {
    const output = await runSecurityScan(
      {
        mode: "standalone",
        targetType: target.targetType,
        targetPath: target.targetPath,
        targetRef: target.targetRef,
        scanners: body.data.scanners,
        triage: body.data.triage,
      },
      {
        suppressionLookup: buildProjectSuppressionLookup(db, target.projectId),
        dastGuard: {
          serverAllowlist: resolveServerDastAllowlist(),
        },
      }
    );

    const saved = await persistExecutedSecurityScan(db, {
      organizationId: guard.actor.organizationId,
      projectId: target.projectId,
      deliverableId: target.deliverableId,
      output,
    });

    return NextResponse.json(saved, { status: 201 });
  } catch (error) {
    if (
      error instanceof Error &&
      /Trava DAST|Protocolo|URL DAST/i.test(error.message)
    ) {
      return jsonError(422, {
        error: error.message,
        code: "DAST_GUARD_BLOCKED",
      });
    }
    console.error("[POST /api/security/scans] falha:", error);
    return jsonError(500, {
      error: "Erro interno ao executar auditoria de segurança.",
      code: "INTERNAL_ERROR",
    });
  }
}
