import { VapidPublicKeyResponseSchema } from "@uzina/contracts";
import { NextResponse } from "next/server";
import { READ_ROLES, requireOrgRole } from "@/lib/rbac";
import { resolveVapidKeys } from "@/lib/vapid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const guard = await requireOrgRole(request, READ_ROLES);
  if (!guard.ok) return guard.response;

  const keys = resolveVapidKeys();
  return NextResponse.json(
    VapidPublicKeyResponseSchema.parse({
      publicKey: keys.publicKey,
      configured: Boolean(keys.publicKey && keys.privateKey),
    }),
    { status: 200 }
  );
}
