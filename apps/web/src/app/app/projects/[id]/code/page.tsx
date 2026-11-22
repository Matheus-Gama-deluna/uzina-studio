import { getDb } from "@uzina/db";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ProjectCodebaseMap } from "@/components/project-codebase-map";
import { isUuid } from "@/lib/api-utils";
import { READ_ROLES, requireOrgRoleFromHeaders } from "@/lib/rbac";
import { findScopedProject } from "@/lib/studio-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ProjectCodebasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = await params;

  const isMswDevPreview =
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_API_MOCKING === "enabled";

  if (isMswDevPreview) {
    return <ProjectCodebaseMap projectId={projectId} />;
  }

  if (!isUuid(projectId)) {
    notFound();
  }

  const guard = await requireOrgRoleFromHeaders(await headers(), READ_ROLES);
  if (!guard.ok) {
    redirect("/login");
  }

  const { db } = await getDb();
  const project = await findScopedProject(
    db,
    projectId,
    guard.actor.organizationId
  );
  if (!project) {
    notFound();
  }

  return (
    <ProjectCodebaseMap
      projectId={project.id}
      initialProjectName={project.name}
    />
  );
}
