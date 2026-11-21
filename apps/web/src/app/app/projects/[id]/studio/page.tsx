import { getDb } from "@uzina/db";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ProjectStudio } from "@/components/project-studio";
import { isUuid } from "@/lib/api-utils";
import { READ_ROLES, requireOrgRoleFromHeaders } from "@/lib/rbac";
import { findScopedProject } from "@/lib/studio-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ProjectStudioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = await params;

  const isMswDevPreview =
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_API_MOCKING === "enabled";

  if (isMswDevPreview) {
    return <ProjectStudio projectId={projectId} />;
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
    <ProjectStudio projectId={project.id} initialProjectName={project.name} />
  );
}
