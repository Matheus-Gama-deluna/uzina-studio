import { NextResponse } from "next/server";
import { READ_ROLES, requireOrgRoleFromHeaders } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clampShareField(value: FormDataEntryValue | null, maxLen: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

export async function POST(request: Request): Promise<Response> {
  const guard = await requireOrgRoleFromHeaders(request.headers, READ_ROLES);
  if (!guard.ok) {
    return NextResponse.redirect(new URL("/login?next=/app/ideas", request.url), {
      status: 303,
    });
  }

  try {
    const formData = await request.formData();
    const title = clampShareField(formData.get("title"), 180);
    const text = clampShareField(formData.get("text"), 1800);
    const sharedUrl = clampShareField(formData.get("url"), 500);

    const params = new URLSearchParams();
    if (title) params.set("sharedTitle", title);
    if (text) params.set("sharedText", text);
    if (sharedUrl) params.set("sharedUrl", sharedUrl);

    const target = params.toString()
      ? `/app/ideas?${params.toString()}`
      : "/app/ideas";

    return NextResponse.redirect(new URL(target, request.url), {
      status: 303,
    });
  } catch {
    return NextResponse.redirect(new URL("/app/ideas?shareError=1", request.url), {
      status: 303,
    });
  }
}
