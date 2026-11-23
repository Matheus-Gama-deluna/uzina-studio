import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DeliverablesDocsHub } from "@/components/deliverables-docs-hub";
import { READ_ROLES, requireOrgRoleFromHeaders } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DeliverablesDocsPage() {
  const isMswDevPreview =
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_API_MOCKING === "enabled";

  if (!isMswDevPreview) {
    const guard = await requireOrgRoleFromHeaders(await headers(), READ_ROLES);
    if (!guard.ok) {
      redirect("/login");
    }
  }

  return <DeliverablesDocsHub />;
}
