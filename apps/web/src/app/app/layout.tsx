import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CockpitShell } from "@/components/cockpit-shell";
import { READ_ROLES, requireOrgRoleFromHeaders } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isMswDevPreview =
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_API_MOCKING === "enabled";

  if (isMswDevPreview) {
    return (
      <CockpitShell
        actor={{
          name: "Operador Preview",
          email: "preview@uzina.studio",
          role: "owner",
        }}
      >
        {children}
      </CockpitShell>
    );
  }

  const guard = await requireOrgRoleFromHeaders(await headers(), READ_ROLES);
  if (!guard.ok) {
    redirect("/login");
  }

  return (
    <CockpitShell
      actor={{
        name: guard.actor.name,
        email: guard.actor.email,
        role: guard.actor.role,
      }}
    >
      {children}
    </CockpitShell>
  );
}
