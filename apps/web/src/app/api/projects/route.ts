import {
  CreateProjectSchema,
  DEFAULT_PROJECT_STAGE_AUTOMATION,
  DevelopmentStrategySchema,
  ProjectListResponseSchema,
  ProjectRepositorySchema,
  ProjectSchema,
  ProjectStageAutomationSchema,
  ProjectStatusSchema,
  type Project,
} from "@uzina/contracts";
import {
  clients,
  getDb,
  projectRepositories,
  projects,
} from "@uzina/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import {
  isPgUniqueViolation,
  isUuid,
  jsonError,
  parseJsonBody,
  slugify,
} from "@/lib/api-utils";
import { READ_ROLES, WORKSPACE_WRITE_ROLES, requireOrgRole } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function mapProject(
  row: typeof projects.$inferSelect,
  repos: (typeof projectRepositories.$inferSelect)[]
): Project {
  const stageAutomation = ProjectStageAutomationSchema.parse({
    ...DEFAULT_PROJECT_STAGE_AUTOMATION,
    ...(row.stageAutomationJson ?? {}),
    decision_pending: "manual" as const,
  });
  const parsedBudget =
    row.budgetCapUsd != null ? Number(row.budgetCapUsd) : null;
  const budgetCapUsd =
    parsedBudget !== null && Number.isFinite(parsedBudget)
      ? parsedBudget
      : null;

  return ProjectSchema.parse({
    id: row.id,
    clientId: row.clientId,
    name: row.name,
    slug: row.slug,
    description: row.description,
    defaultDevelopmentStrategy: DevelopmentStrategySchema.parse(
      row.defaultDevelopmentStrategy
    ),
    maturityScore: row.maturityScore,
    designMdPath: row.designMdPath,
    status: ProjectStatusSchema.parse(row.status),
    stageAutomation,
    budgetCapUsd,
    repositories: repos.map((r) =>
      ProjectRepositorySchema.parse({
        id: r.id,
        projectId: r.projectId,
        name: r.name,
        localPath: r.localPath,
        remoteUrl: r.remoteUrl,
        defaultBranch: r.defaultBranch,
        stackMetadataJson: r.stackMetadataJson ?? {},
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })
    ),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export async function GET(request: Request): Promise<Response> {
  const guard = await requireOrgRole(request, READ_ROLES);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const clientIdFilter = url.searchParams.get("clientId")?.trim();
  if (clientIdFilter && !isUuid(clientIdFilter)) {
    return jsonError(400, { error: "clientId inválido", code: "INVALID_ID" });
  }

  const { db } = await getDb();
  const whereClause = clientIdFilter
    ? and(
        eq(clients.organizationId, guard.actor.organizationId),
        eq(projects.clientId, clientIdFilter)
      )
    : eq(clients.organizationId, guard.actor.organizationId);

  const rows = await db
    .select({ project: projects })
    .from(projects)
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(whereClause)
    .orderBy(desc(projects.createdAt));

  const projectIds = rows.map((r) => r.project.id);
  const repos =
    projectIds.length > 0
      ? await db
          .select()
          .from(projectRepositories)
          .where(inArray(projectRepositories.projectId, projectIds))
      : [];

  const reposByProject = new Map<string, (typeof projectRepositories.$inferSelect)[]>();
  for (const repo of repos) {
    const list = reposByProject.get(repo.projectId) ?? [];
    list.push(repo);
    reposByProject.set(repo.projectId, list);
  }

  const items = rows.map(({ project }) =>
    mapProject(project, reposByProject.get(project.id) ?? [])
  );

  return NextResponse.json(
    ProjectListResponseSchema.parse({ items }),
    { status: 200 }
  );
}

export async function POST(request: Request): Promise<Response> {
  const guard = await requireOrgRole(request, WORKSPACE_WRITE_ROLES);
  if (!guard.ok) return guard.response;

  const body = await parseJsonBody(request, CreateProjectSchema);
  if (!body.ok) return body.response;

  const { db } = await getDb();
  const [ownerClient] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(
      and(
        eq(clients.id, body.data.clientId),
        eq(clients.organizationId, guard.actor.organizationId)
      )
    )
    .limit(1);

  if (!ownerClient) {
    return jsonError(404, { error: "Cliente não encontrado", code: "NOT_FOUND" });
  }

  const slug = body.data.slug ?? slugify(body.data.name);

  try {
    const [created] = await db
      .insert(projects)
      .values({
        clientId: ownerClient.id,
        name: body.data.name,
        slug,
        description: body.data.description ?? null,
        defaultDevelopmentStrategy: body.data.defaultDevelopmentStrategy,
      })
      .returning();

    if (!created) {
      throw new Error("CREATE_PROJECT_FAILED");
    }

    const createdRepos: (typeof projectRepositories.$inferSelect)[] = [];
    if (body.data.repository) {
      const [repo] = await db
        .insert(projectRepositories)
        .values({
          projectId: created.id,
          name: body.data.repository.name,
          localPath: body.data.repository.localPath,
          remoteUrl: body.data.repository.remoteUrl ?? null,
          defaultBranch: body.data.repository.defaultBranch,
        })
        .returning();
      if (repo) {
        createdRepos.push(repo);
      }
    }

    const result = mapProject(created, createdRepos);
    return NextResponse.json(result, { status: 201 });
  } catch (error: unknown) {
    if (isPgUniqueViolation(error)) {
      return jsonError(409, {
        error: "Já existe um projeto com este slug para este cliente.",
        code: "DUPLICATE_SLUG",
      });
    }
    throw error;
  }
}
