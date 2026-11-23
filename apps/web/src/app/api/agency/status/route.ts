import { getDb } from "@uzina/db";
import { getAgencyOverviewScoped } from "@uzina/mastra-runtime/agency";
import { NextResponse } from "next/server";
import { READ_ROLES, requireOrgRole } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireOrgRole(request, READ_ROLES);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const clientId = url.searchParams.get("clientId")?.trim() || undefined;
  const projectId = url.searchParams.get("projectId")?.trim() || undefined;

  const { db } = await getDb();
  const overview = await getAgencyOverviewScoped(db, {
    organizationId: auth.actor.organizationId,
    ...(clientId && clientId !== "all" ? { clientId } : {}),
    ...(projectId ? { projectId } : {}),
  });

  return NextResponse.json(overview, { status: 200 });
}
