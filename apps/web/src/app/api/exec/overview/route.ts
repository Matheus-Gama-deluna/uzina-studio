import {
  DeliverableStatusSchema,
  ExecutiveProjectOverviewSchema,
  type DeliverableStatus,
  type ExecutiveStage,
} from "@uzina/contracts";
import {
  clients,
  decisions,
  deliverables,
  designPrototypes,
  getDb,
  projects,
} from "@uzina/db";
import { buildSpokenSummary } from "@uzina/mastra-runtime";
import { getAgencyOverviewScoped } from "@uzina/mastra-runtime/agency";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { isUuid, jsonError } from "@/lib/api-utils";
import { READ_ROLES, requireOrgRole } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mapStatusToExecutiveStage(status: DeliverableStatus): {
  stage: ExecutiveStage;
  label: string;
} {
  switch (status) {
    case "discovery":
    case "spec_review":
      return { stage: "ideacao", label: "Descoberta & Escopo" };
    case "visual_studio":
      return { stage: "design_visual", label: "Protótipo Visual" };
    case "contract_tests":
    case "building":
      return { stage: "construcao", label: "Em Construção" };
    case "verifying":
      return { stage: "validacao_qualidade", label: "Validação de Qualidade" };
    case "decision_pending":
      return { stage: "aguardando_aprovacao", label: "Aguardando Sua Aprovação" };
    case "approved":
    case "merged":
      return { stage: "entregue", label: "Aprovado e Entregue" };
    case "paused":
      return { stage: "pausado", label: "Pausado" };
    case "failed":
      return { stage: "atencao", label: "Requer Atenção" };
  }
}

export async function GET(request: Request): Promise<Response> {
  const guard = await requireOrgRole(request, READ_ROLES);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const requestedProjectId = url.searchParams.get("projectId")?.trim() || null;
  if (requestedProjectId && !isUuid(requestedProjectId)) {
    return jsonError(400, {
      error: "projectId inválido.",
      code: "INVALID_UUID",
    });
  }

  const { db } = await getDb();
  const projectRows = await db
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      status: projects.status,
      updatedAt: projects.updatedAt,
      clientName: clients.name,
    })
    .from(projects)
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(eq(clients.organizationId, guard.actor.organizationId))
    .orderBy(desc(projects.updatedAt));

  if (requestedProjectId) {
    const found = projectRows.find((p) => p.id === requestedProjectId);
    if (!found) {
      return jsonError(404, {
        error: "Projeto não encontrado na organização.",
        code: "NOT_FOUND",
      });
    }
  }

  const selected = requestedProjectId
    ? projectRows.find((p) => p.id === requestedProjectId) ?? null
    : projectRows[0] ?? null;

  const projectSelectorList = projectRows.map((p) => ({
    id: p.id,
    name: p.name,
    clientName: p.clientName,
  }));

  if (!selected) {
    return NextResponse.json(
      ExecutiveProjectOverviewSchema.parse({
        project: null,
        projects: [],
        prdExcerptMarkdown: null,
        progressPercent: 0,
        counts: {
          total: 0,
          delivered: 0,
          inProgress: 0,
          awaitingApproval: 0,
        },
        latestPrototype: null,
        pendingApprovals: [],
        timeline: [],
      }),
      { status: 200 }
    );
  }

  // Seleciona estritamente campos não-técnicos para preservar a barreira de domínio
  const [deliverableRows, prototypeRows, agencyOverview] = await Promise.all([
    db
      .select({
        id: deliverables.id,
        title: deliverables.title,
        description: deliverables.description,
        status: deliverables.status,
        hasUi: deliverables.hasUi,
        specMarkdown: deliverables.specMarkdown,
        updatedAt: deliverables.updatedAt,
      })
      .from(deliverables)
      .where(eq(deliverables.projectId, selected.id))
      .orderBy(asc(deliverables.createdAt), asc(deliverables.id)),
    db
      .select({
        id: designPrototypes.id,
        title: designPrototypes.title,
        approved: designPrototypes.approved,
        createdAt: designPrototypes.createdAt,
      })
      .from(designPrototypes)
      .where(eq(designPrototypes.projectId, selected.id))
      .orderBy(asc(designPrototypes.createdAt), asc(designPrototypes.id)),
    getAgencyOverviewScoped(db, {
      organizationId: guard.actor.organizationId,
      projectId: selected.id,
    }).catch(() => null),
  ]);

  const deliverableIds = deliverableRows.map((d) => d.id);
  const pendingDecisionRows =
    deliverableIds.length > 0
      ? await db
          .select({
            id: decisions.id,
            deliverableId: decisions.deliverableId,
            decisionType: decisions.decisionType,
            summary: decisions.summary,
            payloadJson: decisions.payloadJson,
            createdAt: decisions.createdAt,
          })
          .from(decisions)
          .where(
            and(
              inArray(decisions.deliverableId, deliverableIds),
              eq(decisions.status, "pending")
            )
          )
          .orderBy(desc(decisions.createdAt))
      : [];

  const titleByDeliverableId = new Map(
    deliverableRows.map((d) => [d.id, d.title])
  );

  const timeline = deliverableRows.map((d) => {
    const parsedStatus = DeliverableStatusSchema.safeParse(d.status);
    const safeStatus: DeliverableStatus = parsedStatus.success
      ? parsedStatus.data
      : "discovery";
    const mapped = mapStatusToExecutiveStage(safeStatus);
    return {
      id: d.id,
      title: d.title,
      description: d.description,
      executiveStage: mapped.stage,
      stageLabel: mapped.label,
      hasUi: d.hasUi,
      updatedAt: d.updatedAt.toISOString(),
    };
  });

  const delivered = timeline.filter((t) => t.executiveStage === "entregue").length;
  const awaitingApproval = pendingDecisionRows.length;
  const inProgress = timeline.filter(
    (t) =>
      t.executiveStage !== "entregue" &&
      t.executiveStage !== "pausado" &&
      t.executiveStage !== "atencao"
  ).length;
  const total = timeline.length;
  const progressPercent =
    total > 0 ? Math.round((delivered / total) * 100) : 0;

  const prdArtifact = agencyOverview?.activeProjectState?.longTermArtifacts.find(
    (a) => a.kind === "prd_vision"
  );
  const firstSpec = deliverableRows.find((d) => Boolean(d.specMarkdown?.trim()));
  const rawPrd =
    prdArtifact?.contentMarkdown?.trim() ||
    firstSpec?.specMarkdown?.trim() ||
    selected.description ||
    null;
  const prdExcerptMarkdown = rawPrd ? rawPrd.slice(0, 7900) : null;

  const latestProto =
    prototypeRows.length > 0 ? prototypeRows[prototypeRows.length - 1]! : null;

  const pendingApprovals = pendingDecisionRows.map((dec) => {
    const payload = dec.payloadJson ?? {};
    const rawConf = payload.confidenceScore;
    const confidenceScore =
      typeof rawConf === "number" &&
      Number.isFinite(rawConf) &&
      rawConf >= 0 &&
      rawConf <= 1
        ? rawConf
        : null;
    const delivTitle =
      titleByDeliverableId.get(dec.deliverableId) ?? "Entrega do projeto";
    return {
      decisionId: dec.id,
      deliverableId: dec.deliverableId,
      deliverableTitle: delivTitle,
      decisionType: dec.decisionType,
      summary: dec.summary.slice(0, 1000),
      confidenceScore,
      spokenSummary: buildSpokenSummary(
        `Aprovação pendente para ${delivTitle}. ${dec.summary}`,
        420
      ),
      createdAt: dec.createdAt.toISOString(),
    };
  });

  return NextResponse.json(
    ExecutiveProjectOverviewSchema.parse({
      project: {
        id: selected.id,
        name: selected.name,
        clientName: selected.clientName,
        description: selected.description,
        status: selected.status,
        updatedAt: selected.updatedAt.toISOString(),
      },
      projects: projectSelectorList,
      prdExcerptMarkdown,
      progressPercent,
      counts: {
        total,
        delivered,
        inProgress,
        awaitingApproval,
      },
      latestPrototype: latestProto
        ? {
            id: latestProto.id,
            title: latestProto.title,
            version: prototypeRows.length,
            approved: latestProto.approved,
            previewUrl: `/api/prototypes/${latestProto.id}/preview`,
          }
        : null,
      pendingApprovals,
      timeline,
    }),
    { status: 200 }
  );
}
