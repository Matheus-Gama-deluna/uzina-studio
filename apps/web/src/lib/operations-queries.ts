import fs from "node:fs";
import path from "node:path";
import {
  DecisionSchema,
  ExecutionEventSchema,
  SecurityFindingDTOSchema,
  SecurityScanResultSchema,
  type Decision,
  type DecisionStatus,
  type ExecutionEvent,
  type IngestSecurityScanInput,
  type RunSecurityScanInput,
  type SecurityFindingDTO,
  type SecurityScanResult,
  type SecurityScanStatus,
  type SecuritySeverity,
  type UpdateFindingTriageInput,
} from "@uzina/contracts";
import { assertPathInsideWorkspace, redactSensitiveText } from "@uzina/core";
import {
  clients,
  decisions,
  deliverables,
  executionEvents,
  projectRepositories,
  projects,
  securityFindings,
  securityScans,
  type UzinaDb,
} from "@uzina/db";
import type {
  ExecutedSecurityScanOutput,
  FindingSuppressionLookup,
} from "@uzina/security-engine";
import { and, desc, eq, inArray } from "drizzle-orm";

const SEVERITY_RANK: Record<SecuritySeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export function mapDecisionRecord(
  row: typeof decisions.$inferSelect,
  meta?: {
    deliverableTitle?: string;
    projectId?: string;
    projectName?: string;
  }
): Decision {
  return DecisionSchema.parse({
    id: row.id,
    deliverableId: row.deliverableId,
    deliverableTitle: meta?.deliverableTitle,
    projectId: meta?.projectId,
    projectName: meta?.projectName,
    mastraStepId: row.mastraStepId,
    decisionType: row.decisionType,
    summary: row.summary,
    payloadJson: row.payloadJson,
    status: row.status,
    humanFeedback: row.humanFeedback,
    resolvedBy: row.resolvedBy,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export function mapFindingRecord(
  row: typeof securityFindings.$inferSelect
): SecurityFindingDTO {
  return SecurityFindingDTOSchema.parse({
    id: row.id,
    scanId: row.scanId,
    projectId: row.projectId,
    ruleId: row.ruleId,
    scanner: row.scanner,
    severity: row.severity,
    filePath: row.filePath,
    lineStart: row.lineStart,
    title: row.title,
    description: row.description,
    fingerprint: row.fingerprint,
    triageVerdict: row.triageVerdict,
    triageRationale: row.triageRationale,
    suppressedInMemory: row.suppressedInMemory,
    povTestStatus: row.povTestStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export function mapScanRecord(
  row: typeof securityScans.$inferSelect,
  options?: {
    includeSarif?: boolean;
    findings?: SecurityFindingDTO[];
  }
): SecurityScanResult {
  return SecurityScanResultSchema.parse({
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    deliverableId: row.deliverableId,
    mode: row.mode,
    targetType: row.targetType,
    targetRef: row.targetRef,
    scannersRun: row.scannersRun,
    scannerStatuses: row.scannerStatusesJson ?? [],
    summaryCountsJson: row.summaryCountsJson,
    status: row.status,
    sarifRawJson: options?.includeSarif ? row.sarifRawJson : undefined,
    findings: options?.findings,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export async function listScopedDecisions(
  db: UzinaDb,
  organizationId: string,
  filters: {
    status?: DecisionStatus;
    projectId?: string;
    deliverableId?: string;
    limit?: number;
  } = {}
): Promise<Decision[]> {
  const conditions = [eq(clients.organizationId, organizationId)];
  if (filters.status) {
    conditions.push(eq(decisions.status, filters.status));
  }
  if (filters.projectId) {
    conditions.push(eq(projects.id, filters.projectId));
  }
  if (filters.deliverableId) {
    conditions.push(eq(decisions.deliverableId, filters.deliverableId));
  }

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 100);

  const rows = await db
    .select({
      decision: decisions,
      deliverableTitle: deliverables.title,
      projectId: projects.id,
      projectName: projects.name,
    })
    .from(decisions)
    .innerJoin(deliverables, eq(decisions.deliverableId, deliverables.id))
    .innerJoin(projects, eq(deliverables.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(and(...conditions))
    .orderBy(desc(decisions.createdAt))
    .limit(limit);

  return rows.map((r) =>
    mapDecisionRecord(r.decision, {
      deliverableTitle: r.deliverableTitle,
      projectId: r.projectId,
      projectName: r.projectName,
    })
  );
}

export async function getScopedDecisionGate(
  db: UzinaDb,
  decisionId: string,
  organizationId: string
): Promise<{
  id: string;
  deliverableId: string;
  decisionType: string;
  status: DecisionStatus;
} | null> {
  const [row] = await db
    .select({
      id: decisions.id,
      deliverableId: decisions.deliverableId,
      decisionType: decisions.decisionType,
      status: decisions.status,
    })
    .from(decisions)
    .innerJoin(deliverables, eq(decisions.deliverableId, deliverables.id))
    .innerJoin(projects, eq(deliverables.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(
      and(
        eq(decisions.id, decisionId),
        eq(clients.organizationId, organizationId)
      )
    )
    .limit(1);

  return row ?? null;
}

export async function listScopedSecurityScans(
  db: UzinaDb,
  organizationId: string,
  filters: {
    projectId?: string;
    deliverableId?: string;
    status?: SecurityScanStatus;
    limit?: number;
  } = {}
): Promise<SecurityScanResult[]> {
  const conditions = [eq(securityScans.organizationId, organizationId)];
  if (filters.projectId) {
    conditions.push(eq(securityScans.projectId, filters.projectId));
  }
  if (filters.deliverableId) {
    conditions.push(eq(securityScans.deliverableId, filters.deliverableId));
  }
  if (filters.status) {
    conditions.push(eq(securityScans.status, filters.status));
  }

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 100);

  const rows = await db
    .select()
    .from(securityScans)
    .where(and(...conditions))
    .orderBy(desc(securityScans.createdAt))
    .limit(limit);

  return rows.map((row) => mapScanRecord(row, { includeSarif: false }));
}

export async function getScopedSecurityScan(
  db: UzinaDb,
  scanId: string,
  organizationId: string,
  options: { includeSarif?: boolean } = {}
): Promise<SecurityScanResult | null> {
  const [scanRow] = await db
    .select()
    .from(securityScans)
    .where(
      and(
        eq(securityScans.id, scanId),
        eq(securityScans.organizationId, organizationId)
      )
    )
    .limit(1);

  if (!scanRow) return null;

  const findingRows = await db
    .select()
    .from(securityFindings)
    .where(eq(securityFindings.scanId, scanRow.id));

  const findings = findingRows
    .map(mapFindingRecord)
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

  return mapScanRecord(scanRow, {
    includeSarif: options.includeSarif,
    findings,
  });
}

export async function getScopedSecurityFinding(
  db: UzinaDb,
  findingId: string,
  organizationId: string
): Promise<{
  finding: typeof securityFindings.$inferSelect;
  scanId: string;
} | null> {
  const [row] = await db
    .select({
      finding: securityFindings,
      scanId: securityScans.id,
    })
    .from(securityFindings)
    .innerJoin(securityScans, eq(securityFindings.scanId, securityScans.id))
    .where(
      and(
        eq(securityFindings.id, findingId),
        eq(securityScans.organizationId, organizationId)
      )
    )
    .limit(1);

  return row ?? null;
}

export async function updateScopedFindingTriage(
  db: UzinaDb,
  params: {
    findingId: string;
    organizationId: string;
    input: UpdateFindingTriageInput;
  }
): Promise<SecurityFindingDTO | null> {
  const scoped = await getScopedSecurityFinding(
    db,
    params.findingId,
    params.organizationId
  );
  if (!scoped) {
    return null;
  }

  const [updated] = await db
    .update(securityFindings)
    .set({
      triageVerdict: params.input.triageVerdict,
      triageRationale:
        params.input.triageRationale !== undefined
          ? params.input.triageRationale
          : scoped.finding.triageRationale,
      suppressedInMemory:
        params.input.suppressedInMemory !== undefined
          ? params.input.suppressedInMemory
          : scoped.finding.suppressedInMemory,
      povTestStatus:
        params.input.povTestStatus !== undefined
          ? params.input.povTestStatus
          : scoped.finding.povTestStatus,
      updatedAt: new Date(),
    })
    .where(eq(securityFindings.id, scoped.finding.id))
    .returning();

  const allFindings = await db
    .select()
    .from(securityFindings)
    .where(eq(securityFindings.scanId, scoped.scanId));

  const [scanRow] = await db
    .select()
    .from(securityScans)
    .where(eq(securityScans.id, scoped.scanId))
    .limit(1);

  if (scanRow) {
    const counts = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
      total: allFindings.length,
      confirmedCount: 0,
      suppressedCount: 0,
      skippedScannersCount: scanRow.summaryCountsJson.skippedScannersCount,
    };
    for (const f of allFindings) {
      counts[f.severity] += 1;
      if (f.triageVerdict === "confirmed") counts.confirmedCount += 1;
      if (f.suppressedInMemory || f.triageVerdict === "false_positive") {
        counts.suppressedCount += 1;
      }
    }
    await db
      .update(securityScans)
      .set({ summaryCountsJson: counts, updatedAt: new Date() })
      .where(eq(securityScans.id, scoped.scanId));
  }

  return mapFindingRecord(updated!);
}

export async function assertScopedProjectOrDeliverable(
  db: UzinaDb,
  organizationId: string,
  ids: { projectId?: string | null; deliverableId?: string | null }
): Promise<{ ok: true; resolvedProjectId: string | null } | { ok: false; message: string }> {
  let resolvedProjectId: string | null = ids.projectId ?? null;

  if (ids.deliverableId) {
    const [deliv] = await db
      .select({ projectId: deliverables.projectId })
      .from(deliverables)
      .innerJoin(projects, eq(deliverables.projectId, projects.id))
      .innerJoin(clients, eq(projects.clientId, clients.id))
      .where(
        and(
          eq(deliverables.id, ids.deliverableId),
          eq(clients.organizationId, organizationId)
        )
      )
      .limit(1);

    if (!deliv) {
      return {
        ok: false,
        message: "deliverableId não encontrado na organização.",
      };
    }
    if (resolvedProjectId && resolvedProjectId !== deliv.projectId) {
      return {
        ok: false,
        message: "deliverableId não pertence ao projectId informado.",
      };
    }
    resolvedProjectId = deliv.projectId;
  } else if (resolvedProjectId) {
    const [proj] = await db
      .select({ id: projects.id })
      .from(projects)
      .innerJoin(clients, eq(projects.clientId, clients.id))
      .where(
        and(
          eq(projects.id, resolvedProjectId),
          eq(clients.organizationId, organizationId)
        )
      )
      .limit(1);

    if (!proj) {
      return {
        ok: false,
        message: "projectId não encontrado na organização.",
      };
    }
  }

  return { ok: true, resolvedProjectId };
}

export function buildProjectSuppressionLookup(
  db: UzinaDb,
  projectId: string | null
): FindingSuppressionLookup | undefined {
  if (!projectId) return undefined;
  return {
    async getSuppressedFingerprints(fingerprints) {
      if (fingerprints.length === 0) return new Set();
      const rows = await db
        .select({ fingerprint: securityFindings.fingerprint })
        .from(securityFindings)
        .where(
          and(
            eq(securityFindings.projectId, projectId),
            eq(securityFindings.suppressedInMemory, true),
            inArray(securityFindings.fingerprint, [...fingerprints])
          )
        );
      return new Set(rows.map((r) => r.fingerprint));
    },
  };
}

export async function resolveServerScanTarget(
  db: UzinaDb,
  organizationId: string,
  input: RunSecurityScanInput
): Promise<
  | {
      ok: true;
      targetType: "git_repo" | "git_diff" | "staging_url";
      targetPath?: string;
      targetRef: string;
      projectId: string | null;
      deliverableId: string | null;
    }
  | { ok: false; statusCode: 404 | 422; code: string; message: string }
> {
  if (input.targetType === "staging_url") {
    const scoped = await assertScopedProjectOrDeliverable(db, organizationId, {
      projectId: input.projectId ?? null,
      deliverableId: input.deliverableId ?? null,
    });
    if (!scoped.ok) {
      return {
        ok: false,
        statusCode: 404,
        code: "NOT_FOUND",
        message: scoped.message,
      };
    }

    return {
      ok: true,
      targetType: "staging_url",
      targetRef: input.stagingUrl!,
      projectId: scoped.resolvedProjectId,
      deliverableId: input.deliverableId ?? null,
    };
  }

  let baseDir: string | null = null;
  let targetRef = "HEAD";
  let resolvedProjectId: string | null = input.projectId ?? null;

  if (input.deliverableId) {
    const [deliv] = await db
      .select({
        deliverable: deliverables,
        projectId: projects.id,
      })
      .from(deliverables)
      .innerJoin(projects, eq(deliverables.projectId, projects.id))
      .innerJoin(clients, eq(projects.clientId, clients.id))
      .where(
        and(
          eq(deliverables.id, input.deliverableId),
          eq(clients.organizationId, organizationId)
        )
      )
      .limit(1);

    if (!deliv) {
      return {
        ok: false,
        statusCode: 404,
        code: "NOT_FOUND",
        message: "Entregável não encontrado na organização.",
      };
    }

    resolvedProjectId = deliv.projectId;
    if (
      deliv.deliverable.worktreePath &&
      fs.existsSync(/*turbopackIgnore: true*/ deliv.deliverable.worktreePath)
    ) {
      baseDir = deliv.deliverable.worktreePath;
      targetRef = deliv.deliverable.branchName || "HEAD";
    } else if (deliv.deliverable.repositoryId) {
      const [repo] = await db
        .select()
        .from(projectRepositories)
        .where(eq(projectRepositories.id, deliv.deliverable.repositoryId))
        .limit(1);
      if (repo && fs.existsSync(/*turbopackIgnore: true*/ repo.localPath)) {
        baseDir = repo.localPath;
        targetRef = repo.defaultBranch || "main";
      }
    }
  } else if (resolvedProjectId) {
    const [proj] = await db
      .select({ id: projects.id })
      .from(projects)
      .innerJoin(clients, eq(projects.clientId, clients.id))
      .where(
        and(
          eq(projects.id, resolvedProjectId),
          eq(clients.organizationId, organizationId)
        )
      )
      .limit(1);

    if (!proj) {
      return {
        ok: false,
        statusCode: 404,
        code: "NOT_FOUND",
        message: "Projeto não encontrado na organização.",
      };
    }

    const [repo] = await db
      .select()
      .from(projectRepositories)
      .where(eq(projectRepositories.projectId, proj.id))
      .limit(1);

    if (repo && fs.existsSync(/*turbopackIgnore: true*/ repo.localPath)) {
      baseDir = repo.localPath;
      targetRef = repo.defaultBranch || "main";
    }
  }

  if (!baseDir) {
    return {
      ok: false,
      statusCode: 422,
      code: "TARGET_UNAVAILABLE",
      message:
        "Nenhum repositório local ou worktree ativo disponível para executar o scan no servidor.",
    };
  }

  let effectivePath = path.resolve(/*turbopackIgnore: true*/ baseDir);
  if (input.relativeSubpath) {
    try {
      effectivePath = assertPathInsideWorkspace(
        effectivePath,
        input.relativeSubpath
      );
    } catch {
      return {
        ok: false,
        statusCode: 422,
        code: "INVALID_SUBPATH",
        message: "Subcaminho fora dos limites do workspace autorizado.",
      };
    }
    if (!fs.existsSync(/*turbopackIgnore: true*/ effectivePath)) {
      return {
        ok: false,
        statusCode: 422,
        code: "TARGET_UNAVAILABLE",
        message: "Subcaminho informado não existe no repositório.",
      };
    }
  }

  return {
    ok: true,
    targetType: input.targetType,
    targetPath: effectivePath,
    targetRef,
    projectId: resolvedProjectId,
    deliverableId: input.deliverableId ?? null,
  };
}

export async function persistExecutedSecurityScan(
  db: UzinaDb,
  params: {
    organizationId: string;
    projectId: string | null;
    deliverableId: string | null;
    output: ExecutedSecurityScanOutput;
  }
): Promise<SecurityScanResult> {
  const [scanRow] = await db
    .insert(securityScans)
    .values({
      organizationId: params.organizationId,
      projectId: params.projectId,
      deliverableId: params.deliverableId,
      mode: params.output.mode,
      targetType: params.output.targetType,
      targetRef: params.output.targetRef,
      scannersRun: params.output.scannersRun,
      scannerStatusesJson: params.output.scannerStatuses,
      sarifRawJson: params.output.sarifRawJson,
      summaryCountsJson: params.output.summaryCountsJson,
      status: params.output.status,
    })
    .returning();

  const insertedFindings: SecurityFindingDTO[] = [];
  if (params.output.findings.length > 0) {
    const rows = await db
      .insert(securityFindings)
      .values(
        params.output.findings.map((f) => ({
          scanId: scanRow!.id,
          projectId: params.projectId,
          ruleId: f.ruleId,
          scanner: f.scanner,
          severity: f.severity,
          filePath: f.filePath,
          lineStart: f.lineStart,
          title: redactSensitiveText(f.title),
          description: redactSensitiveText(f.description),
          fingerprint: f.fingerprint,
          triageVerdict: f.triageVerdict,
          triageRationale: f.triageRationale,
          suppressedInMemory: f.suppressedInMemory,
          povTestStatus: f.povTestStatus,
        }))
      )
      .returning();

    insertedFindings.push(
      ...rows
        .map(mapFindingRecord)
        .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    );
  }

  return mapScanRecord(scanRow!, {
    includeSarif: true,
    findings: insertedFindings,
  });
}

export async function persistIngestedSecurityScan(
  db: UzinaDb,
  params: {
    organizationId: string;
    projectId: string | null;
    deliverableId: string | null;
    input: IngestSecurityScanInput;
  }
): Promise<SecurityScanResult> {
  const [scanRow] = await db
    .insert(securityScans)
    .values({
      organizationId: params.organizationId,
      projectId: params.projectId,
      deliverableId: params.deliverableId,
      mode: "standalone",
      targetType: params.input.targetType,
      targetRef: params.input.targetRef,
      scannersRun: params.input.scannersRun,
      scannerStatusesJson: params.input.scannerStatuses ?? [],
      sarifRawJson: params.input.sarifRawJson,
      summaryCountsJson: params.input.summaryCountsJson,
      status: params.input.status ?? "completed",
    })
    .returning();

  const insertedFindings: SecurityFindingDTO[] = [];
  if (params.input.findings.length > 0) {
    const rows = await db
      .insert(securityFindings)
      .values(
        params.input.findings.map((f) => ({
          scanId: scanRow!.id,
          projectId: params.projectId,
          ruleId: f.ruleId,
          scanner: f.scanner,
          severity: f.severity,
          filePath: f.filePath ?? null,
          lineStart: f.lineStart ?? null,
          title: redactSensitiveText(f.title),
          description: redactSensitiveText(f.description),
          fingerprint: f.fingerprint,
          triageVerdict: f.triageVerdict ?? "pending",
          triageRationale: f.triageRationale
            ? redactSensitiveText(f.triageRationale)
            : null,
          suppressedInMemory: f.suppressedInMemory ?? false,
          povTestStatus: f.povTestStatus ?? "not_applicable",
        }))
      )
      .returning();

    insertedFindings.push(...rows.map(mapFindingRecord));
  }

  return mapScanRecord(scanRow!, {
    includeSarif: true,
    findings: insertedFindings,
  });
}

export async function isScopedDeliverable(
  db: UzinaDb,
  deliverableId: string,
  organizationId: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: deliverables.id })
    .from(deliverables)
    .innerJoin(projects, eq(deliverables.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(
      and(
        eq(deliverables.id, deliverableId),
        eq(clients.organizationId, organizationId)
      )
    )
    .limit(1);

  return Boolean(row);
}

export async function listDeliverableEventsScoped(
  db: UzinaDb,
  deliverableId: string,
  options: { afterEventId?: string | null; limit?: number } = {}
): Promise<ExecutionEvent[]> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 100);
  const rows = await db
    .select()
    .from(executionEvents)
    .where(eq(executionEvents.deliverableId, deliverableId))
    .orderBy(executionEvents.createdAt);

  const mapped = rows.map((row) =>
    ExecutionEventSchema.parse({
      id: row.id,
      deliverableId: row.deliverableId,
      stage: row.stage,
      actorRole: row.actorRole,
      eventType: row.eventType,
      tokensInput: row.tokensInput,
      tokensOutput: row.tokensOutput,
      cacheReadTokens: row.cacheReadTokens,
      estimatedCostUsd: Number(row.estimatedCostUsd),
      payloadJson: row.payloadJson,
      createdAt: row.createdAt.toISOString(),
    })
  );

  if (options.afterEventId) {
    const idx = mapped.findIndex((e) => e.id === options.afterEventId);
    if (idx !== -1) {
      return mapped.slice(idx + 1, idx + 1 + limit);
    }
  }

  return mapped.slice(-limit);
}
