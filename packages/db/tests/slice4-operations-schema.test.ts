import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  clients,
  closeDb,
  decisions,
  deliverables,
  ensureDefaultOrgAndInternalClient,
  executionEvents,
  getDb,
  projects,
  securityFindings,
  securityScans,
  users,
  type UzinaDb,
} from "../src/index.js";

describe("@uzina/db — Slice 4 Operations Schema (decisions, security_scans, security_findings, execution_events)", () => {
  let db: UzinaDb;
  let organizationId: string;
  let internalClientId: string;

  beforeAll(async () => {
    await closeDb();
    const ctx = await getDb({ dataDir: ":memory:" });
    db = ctx.db;
    const seeded = await ensureDefaultOrgAndInternalClient(db);
    organizationId = seeded.organizationId;
    internalClientId = seeded.internalClientId;

    const [client] = await db
      .select()
      .from(clients)
      .where(eq(clients.id, internalClientId));
    expect(client?.organizationId).toBe(organizationId);
  });

  afterAll(async () => {
    await closeDb();
  });

  async function seedHierarchy() {
    const suffix = crypto.randomUUID().slice(0, 8);
    const [user] = await db
      .insert(users)
      .values({
        name: `Operador ${suffix}`,
        email: `operador-${suffix}@uzina.local`,
        organizationId,
        role: "owner",
      })
      .returning();

    const [project] = await db
      .insert(projects)
      .values({
        clientId: internalClientId,
        name: `Projeto Slice 4 ${suffix}`,
        slug: `projeto-slice-4-${suffix}`,
      })
      .returning();

    const [deliverable] = await db
      .insert(deliverables)
      .values({
        projectId: project!.id,
        title: `Entrega Slice 4 ${suffix}`,
        status: "decision_pending",
      })
      .returning();

    return {
      user: user!,
      project: project!,
      deliverable: deliverable!,
    };
  }

  test("insere e atualiza atomicamente decisions e preserva resolvedBy set null ao excluir usuário", async () => {
    const { user, deliverable } = await seedHierarchy();

    const [created] = await db
      .insert(decisions)
      .values({
        deliverableId: deliverable.id,
        mastraStepId: "stage_decision",
        decisionType: "pr_evidence_approve",
        summary: "Aprovar PR e pacote de evidências",
        payloadJson: { branchName: "uzina/demo", verifyPassed: true },
      })
      .returning();

    expect(created?.status).toBe("pending");

    const updatedFirst = await db
      .update(decisions)
      .set({
        status: "approved",
        resolvedBy: user.id,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(eq(decisions.id, created!.id), eq(decisions.status, "pending"))
      )
      .returning();

    expect(updatedFirst).toHaveLength(1);
    expect(updatedFirst[0]?.resolvedBy).toBe(user.id);

    // Segunda tentativa concorrente com guarda status = 'pending' não deve alterar nenhuma linha
    const updatedSecond = await db
      .update(decisions)
      .set({ status: "rejected", updatedAt: new Date() })
      .where(
        and(eq(decisions.id, created!.id), eq(decisions.status, "pending"))
      )
      .returning();

    expect(updatedSecond).toHaveLength(0);

    // Excluir usuário deve setar resolved_by para null (set null), sem apagar a decisão
    await db.delete(users).where(eq(users.id, user.id));
    const [afterUserDelete] = await db
      .select()
      .from(decisions)
      .where(eq(decisions.id, created!.id));

    expect(afterUserDelete?.resolvedBy).toBeNull();
    expect(afterUserDelete?.status).toBe("approved");
  });

  test("persiste security_scans + security_findings com cascade no scan e set null ao excluir project", async () => {
    const { project, deliverable } = await seedHierarchy();
    const fingerprint = "b".repeat(64);

    const [scan] = await db
      .insert(securityScans)
      .values({
        organizationId,
        projectId: project.id,
        deliverableId: deliverable.id,
        mode: "embedded",
        targetType: "git_diff",
        targetRef: "uzina/slice4-test",
        scannersRun: ["native_secrets", "gitleaks"],
        scannerStatusesJson: [
          {
            scanner: "native_secrets",
            status: "executed",
            binaryName: null,
            installHint: null,
            findingsCount: 1,
            durationMs: 14,
            errorMessage: null,
          },
          {
            scanner: "gitleaks",
            status: "skipped_missing_binary",
            binaryName: "gitleaks",
            installHint: "uzina-sec install-tools",
            findingsCount: 0,
            durationMs: 1,
            errorMessage: "Binário ausente no PATH",
          },
        ],
        sarifRawJson: {
          version: "2.1.0",
          runs: [
            {
              tool: { driver: { name: "uzina-security-engine" } },
              results: [],
            },
          ],
        },
        summaryCountsJson: {
          critical: 0,
          high: 1,
          medium: 0,
          low: 0,
          info: 0,
          total: 1,
          confirmedCount: 0,
          suppressedCount: 0,
          skippedScannersCount: 1,
        },
        status: "completed",
      })
      .returning();

    expect(scan?.id).toBeDefined();
    expect(scan?.status).toBe("completed");

    const [finding] = await db
      .insert(securityFindings)
      .values({
        scanId: scan!.id,
        projectId: project.id,
        ruleId: "uzina/native-secret",
        scanner: "native_secrets",
        severity: "high",
        filePath: "src/config.ts",
        lineStart: 12,
        title: "Chave exposta detectada",
        description: "Valor mascarado: [REDACTED_API_KEY]",
        fingerprint,
      })
      .returning();

    expect(finding?.triageVerdict).toBe("pending");
    expect(finding?.suppressedInMemory).toBe(false);
    expect(finding?.povTestStatus).toBe("not_applicable");

    // Excluir projeto deve preservar scan/finding com projectId = null
    await db.delete(projects).where(eq(projects.id, project.id));

    const [orphanScan] = await db
      .select()
      .from(securityScans)
      .where(eq(securityScans.id, scan!.id));
    const [orphanFinding] = await db
      .select()
      .from(securityFindings)
      .where(eq(securityFindings.id, finding!.id));

    expect(orphanScan?.projectId).toBeNull();
    expect(orphanFinding?.projectId).toBeNull();

    // Excluir scan remove findings por cascade
    await db.delete(securityScans).where(eq(securityScans.id, scan!.id));
    const remainingFindings = await db
      .select()
      .from(securityFindings)
      .where(eq(securityFindings.id, finding!.id));
    expect(remainingFindings).toHaveLength(0);
  });

  test("persiste execution_events com numeric de custo e cascade ao excluir deliverable", async () => {
    const { deliverable } = await seedHierarchy();

    const [event] = await db
      .insert(executionEvents)
      .values({
        deliverableId: deliverable.id,
        stage: "stage_verify",
        actorRole: "verifier",
        eventType: "verify_result",
        tokensInput: 1500,
        tokensOutput: 450,
        cacheReadTokens: 800,
        estimatedCostUsd: "0.012345",
        payloadJson: { verifyAttempt: 1, passed: true },
      })
      .returning();

    expect(event?.estimatedCostUsd).toBe("0.012345");
    expect(event?.tokensInput).toBe(1500);

    await db.delete(deliverables).where(eq(deliverables.id, deliverable.id));
    const afterDelete = await db
      .select()
      .from(executionEvents)
      .where(eq(executionEvents.deliverableId, deliverable.id));
    expect(afterDelete).toHaveLength(0);
  });
});
