import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ExecutiveCockpit } from "@/components/executive-cockpit";
import { READ_ROLES, requireOrgRoleFromHeaders } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ExecutiveSurfacePage() {
  const isMswDevPreview =
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_API_MOCKING === "enabled";

  if (isMswDevPreview) {
    return (
      <ExecutiveCockpit
        actor={{
          name: "Executivo Preview",
          email: "exec@uzina.studio",
          role: "owner",
        }}
      />
    );
  }

  const guard = await requireOrgRoleFromHeaders(await headers(), READ_ROLES);
  if (!guard.ok) {
    redirect("/login?next=/exec");
  }

  return (
    <ExecutiveCockpit
      actor={{
        name: guard.actor.name,
        email: guard.actor.email,
        role: guard.actor.role,
      }}
    />
  );
}
