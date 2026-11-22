import {
  SymbolGraphQuerySchema,
  SymbolSliceRequestSchema,
} from "@uzina/contracts";
import { getDb } from "@uzina/db";
import {
  WorkflowRuntimeError,
  queryProjectSymbolsScoped,
  readProjectSymbolSliceScoped,
} from "@uzina/mastra-runtime";
import { NextResponse } from "next/server";
import { isUuid, jsonError } from "@/lib/api-utils";
import { READ_ROLES, requireOrgRole } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
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

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonError(400, {
      error: "Corpo JSON inválido.",
      code: "INVALID_JSON",
    });
  }

  const { db } = await getDb();

  if (
    typeof rawBody === "object" &&
    rawBody !== null &&
    "mode" in rawBody &&
    (rawBody as Record<string, unknown>).mode === "slice"
  ) {
    const slicePayload = { ...(rawBody as Record<string, unknown>) };
    delete slicePayload.mode;
    const parsedSlice = SymbolSliceRequestSchema.safeParse(slicePayload);
    if (!parsedSlice.success) {
      return jsonError(400, {
        error: parsedSlice.error.issues[0]?.message ?? "Payload de fatia inválido.",
        code: "VALIDATION_ERROR",
      });
    }
    try {
      const slice = await readProjectSymbolSliceScoped(db, {
        organizationId: auth.actor.organizationId,
        projectId,
        request: parsedSlice.data,
      });
      return NextResponse.json(slice, { status: 200 });
    } catch (err) {
      if (err instanceof WorkflowRuntimeError) {
        return jsonError(err.statusCode, { error: err.message, code: err.code });
      }
      throw err;
    }
  }

  const parsedGraph = SymbolGraphQuerySchema.safeParse(rawBody);
  if (!parsedGraph.success) {
    return jsonError(400, {
      error: parsedGraph.error.issues[0]?.message ?? "Consulta AST inválida.",
      code: "VALIDATION_ERROR",
    });
  }

  try {
    const graph = await queryProjectSymbolsScoped(db, {
      organizationId: auth.actor.organizationId,
      projectId,
      query: parsedGraph.data,
    });
    return NextResponse.json(graph, { status: 200 });
  } catch (err) {
    if (err instanceof WorkflowRuntimeError) {
      return jsonError(err.statusCode, { error: err.message, code: err.code });
    }
    throw err;
  }
}
