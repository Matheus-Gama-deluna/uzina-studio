import { TestProviderConnectionRequestSchema } from "@uzina/contracts";
import { getDb } from "@uzina/db";
import { testProviderLlmConnectionScoped } from "@uzina/mastra-runtime/agency";
import { NextResponse } from "next/server";
import { parseJsonBody } from "@/lib/api-utils";
import { VAULT_WRITE_ROLES, requireOrgRole } from "@/lib/rbac";
import { getServerMasterKey } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const guard = await requireOrgRole(request, VAULT_WRITE_ROLES);
  if (!guard.ok) return guard.response;

  const body = await parseJsonBody(
    request,
    TestProviderConnectionRequestSchema
  );
  if (!body.ok) return body.response;

  const { db } = await getDb();
  const masterKey = getServerMasterKey();

  const result = await testProviderLlmConnectionScoped(db, {
    organizationId: guard.actor.organizationId,
    masterKey,
    request: body.data,
  });

  return NextResponse.json(result, { status: 200 });
}
