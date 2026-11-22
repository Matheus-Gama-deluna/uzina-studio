import { getDb } from "@uzina/db";
import {
  WorkflowRuntimeError,
  readPrototypePreviewHtmlScoped,
} from "@uzina/mastra-runtime";
import { NextResponse } from "next/server";
import { isUuid, jsonError } from "@/lib/api-utils";
import { READ_ROLES, requireOrgRole } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PROTOTYPE_PREVIEW_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; font-src data: https:;";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireOrgRole(request, READ_ROLES);
  if (!auth.ok) return auth.response;

  const { id: prototypeId } = await context.params;
  if (!isUuid(prototypeId)) {
    return jsonError(400, {
      error: "ID de protótipo inválido.",
      code: "INVALID_UUID",
    });
  }

  const { db } = await getDb();
  try {
    const preview = await readPrototypePreviewHtmlScoped(db, {
      organizationId: auth.actor.organizationId,
      prototypeId,
    });

    const htmlDocument = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${preview.title.replace(/[<>&"]/g, "")}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #09090b; color: #f4f4f5; padding: 16px; }
  </style>
</head>
<body>
${preview.html}
</body>
</html>`;

    return new NextResponse(htmlDocument, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": PROTOTYPE_PREVIEW_CSP,
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "SAMEORIGIN",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof WorkflowRuntimeError) {
      return jsonError(err.statusCode, { error: err.message, code: err.code });
    }
    throw err;
  }
}
