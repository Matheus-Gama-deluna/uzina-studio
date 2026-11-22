import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DecisionListResponseSchema,
  SecurityFindingDTOSchema,
  SecurityScanResultSchema,
} from "@uzina/contracts";
import {
  closeDb,
  decisions,
  deliverables,
  getDb,
  organizations,
  users,
} from "@uzina/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { POST as authPost } from "../src/app/api/auth/[...all]/route";
import { GET as getDecisions } from "../src/app/api/decisions/route";
import { POST as resolveDecisionRoute } from "../src/app/api/decisions/[id]/resolve/route";
import { GET as getDeliverableEvents } from "../src/app/api/deliverables/[id]/events/route";
import { POST as resumeWorkflow } from "../src/app/api/deliverables/[id]/workflow/resume/route";
import { POST as startWorkflow } from "../src/app/api/deliverables/[id]/workflow/start/route";
import { GET as getClients } from "../src/app/api/clients/route";
import { POST as createDeliverable } from "../src/app/api/projects/[id]/deliverables/route";
import { POST as createRepository } from "../src/app/api/projects/[id]/repositories/route";
import { POST as createProject } from "../src/app/api/projects/route";
import { PATCH as patchSecurityFinding } from "../src/app/api/security/findings/[id]/route";
import { GET as getSecurityScanById } from "../src/app/api/security/scans/[id]/route";
import { POST as ingestSecurityScan } from "../src/app/api/security/scans/ingest/route";
import {
  GET as getSecurityScans,
  POST as runSecurityScanRoute,
} from "../src/app/api/security/scans/route";
import { resetAuthForTests } from "../src/lib/auth";
import { resetWebWorkflowRuntimeForTests } from "../src/lib/workflow-runtime";

function cookieOf(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]?.trim() ?? "")
    .filter(Boolean)
    .join("; ");
}

async function signUp(name: string, email: string): Promise<{
  cookie: string;
  bearerToken: string;
}> {
  const res = await authPost(
    new Request("http://localhost:3000/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, email, password: "StrongPassword!123" }),
    })
  );
  expect(res.status).toBe(200);
  const payload = (await res.json()) as { token?: string };
  return {
    cookie: cookieOf(res),
    bearerToken: payload.token ?? "",
  };
}

describe("Slice 4 APIs — Security Engine, Bearer Ingest, Decisions HITL, RBAC & SSE", () => {
  let ownerCookie = "";
  let ownerBearer = "";
  let devCookie = "";
  let otherOrgCookie = "";
  let organizationId = "";
  let projectId = "";
  let deliverableId = "";
  let repoDir = "";

  beforeAll(async () => {
    await resetWebWorkflowRuntimeForTests();
    resetAuthForTests();
    await closeDb();

    const ownerAuth = await signUp("Owner S4", "owner-s4@uzina.studio");
    ownerCookie = ownerAuth.cookie;
    ownerBearer = ownerAuth.bearerToken;

    const devAuth = await signUp("Dev S4", "dev-s4@uzina.studio");
    devCookie = devAuth.cookie;

    const otherAuth = await signUp("Other Org S4", "other-s4@uzina.studio");
    otherOrgCookie = otherAuth.cookie;

    // Seed org do owner via primeira requisição autenticada
    await getClients(
      new Request("http://localhost:3000/api/clients", {
        headers: { cookie: ownerCookie },
      })
    );

    const { db } = await getDb();
    const [ownerRow] = await db
      .select()
      .from(users)
      .where(eq(users.email, "owner-s4@uzina.studio"));
    organizationId = ownerRow!.organizationId!;

    // Coloca Dev S4 na mesma organização como developer e Other Org em organização separada
    await db
      .update(users)
      .set({ organizationId, role: "developer" })
      .where(eq(users.email, "dev-s4@uzina.studio"));

    const [otherOrg] = await db
      .insert(organizations)
      .values({ name: "Tenant Isolado", slug: `isolated-${crypto.randomUUID().slice(0, 6)}` })
      .returning();
    await db
      .update(users)
      .set({ organizationId: otherOrg!.id, role: "owner" })
      .where(eq(users.email, "other-s4@uzina.studio"));

    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-s4-api-repo-"));
    fs.writeFileSync(
      path.join(repoDir, "leak.ts"),
      'export const apiKey = "ghp_1234567890abcdefghijklmnopqrstuvwxyz1234";\n',
      "utf8"
    );

    const clientsRes = await getClients(
      new Request("http://localhost:3000/api/clients", {
        headers: { cookie: ownerCookie },
      })
    );
    const clientsBody = (await clientsRes.json()) as {
      items: Array<{ id: string }>;
    };
    const internalClientId = clientsBody.items[0]!.id;

    const projRes = await createProject(
      new Request("http://localhost:3000/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({
          clientId: internalClientId,
          name: "Projeto Segurança S4",
        }),
      })
    );
    expect(projRes.status).toBe(201);
    const proj = (await projRes.json()) as { id: string };
    projectId = proj.id;

    const repoRes = await createRepository(
      new Request(`http://localhost:3000/api/projects/${projectId}/repositories`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({
          name: "main-repo",
          localPath: repoDir,
          defaultBranch: "main",
        }),
      }),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(repoRes.status).toBe(201);

    const delivRes = await createDeliverable(
      new Request(`http://localhost:3000/api/projects/${projectId}/deliverables`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({
          title: "Entrega Auditada S4",
          hasUi: false,
        }),
      }),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(delivRes.status).toBe(201);
    const deliv = (await delivRes.json()) as { id: string };
    deliverableId = deliv.id;
  });

  afterAll(async () => {
    await resetWebWorkflowRuntimeForTests();
    resetAuthForTests();
    await closeDb();
    if (repoDir) {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test("executa scan no servidor sem vazar segredo, bloqueia path traversal/DAST arbitrário e aplica RBAC na triagem", async () => {
    // 1. Bloqueia path traversal e allowlistedHosts vindo do cliente
    const badPathRes = await runSecurityScanRoute(
      new Request("http://localhost:3000/api/security/scans", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({
          projectId,
          targetType: "git_repo",
          relativeSubpath: "../outside",
        }),
      })
    );
    expect(badPathRes.status).toBe(400);

    const badClientAllowlistRes = await runSecurityScanRoute(
      new Request("http://localhost:3000/api/security/scans", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({
          targetType: "staging_url",
          stagingUrl: "http://169.254.169.254/latest",
          allowlistedHosts: ["169.254.169.254"],
        }),
      })
    );
    expect(badClientAllowlistRes.status).toBe(400);

    // 2. DAST sem allowlist do servidor retorna 422 DAST_GUARD_BLOCKED e staging_url com projectId fora da org retorna 404
    const blockedDastRes = await runSecurityScanRoute(
      new Request("http://localhost:3000/api/security/scans", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({
          targetType: "staging_url",
          stagingUrl: "https://staging.example.com/app",
        }),
      })
    );
    expect(blockedDastRes.status).toBe(422);

    const crossProjectStagingRes = await runSecurityScanRoute(
      new Request("http://localhost:3000/api/security/scans", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({
          projectId: crypto.randomUUID(),
          targetType: "staging_url",
          stagingUrl: "https://staging.example.com/app",
        }),
      })
    );
    expect(crossProjectStagingRes.status).toBe(404);

    // 3. Scan válido no projeto detecta segredo e aplica redação
    const scanRes = await runSecurityScanRoute(
      new Request("http://localhost:3000/api/security/scans", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({
          projectId,
          targetType: "git_repo",
        }),
      })
    );
    expect(scanRes.status).toBe(201);
    const createdScan = SecurityScanResultSchema.parse(await scanRes.json());
    expect(createdScan.findings!.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(createdScan)).not.toContain(
      "ghp_1234567890abcdefghijklmnopqrstuvwxyz1234"
    );

    const criticalFinding = createdScan.findings!.find(
      (f) => f.severity === "critical" || f.severity === "high"
    )!;

    // 4. IDOR cross-org recebe 404 e lista vazia
    const otherListRes = await getSecurityScans(
      new Request("http://localhost:3000/api/security/scans", {
        headers: { cookie: otherOrgCookie },
      })
    );
    expect(otherListRes.status).toBe(200);
    const otherList = (await otherListRes.json()) as { items: unknown[] };
    expect(otherList.items).toHaveLength(0);

    const otherDetailRes = await getSecurityScanById(
      new Request(`http://localhost:3000/api/security/scans/${createdScan.id}`, {
        headers: { cookie: otherOrgCookie },
      }),
      { params: Promise.resolve({ id: createdScan.id }) }
    );
    expect(otherDetailRes.status).toBe(404);

    // 5. RBAC: developer bloqueado para suprimir ou marcar critical/high como false_positive
    const devSuppressRes = await patchSecurityFinding(
      new Request(
        `http://localhost:3000/api/security/findings/${criticalFinding.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json", cookie: devCookie },
          body: JSON.stringify({
            triageVerdict: "false_positive",
            suppressedInMemory: true,
          }),
        }
      ),
      { params: Promise.resolve({ id: criticalFinding.id }) }
    );
    expect(devSuppressRes.status).toBe(403);

    // Owner consegue suprimir e marcar false_positive
    const ownerSuppressRes = await patchSecurityFinding(
      new Request(
        `http://localhost:3000/api/security/findings/${criticalFinding.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json", cookie: ownerCookie },
          body: JSON.stringify({
            triageVerdict: "false_positive",
            triageRationale: "Chave sintética de teste aprovada pelo AppSec.",
            suppressedInMemory: true,
          }),
        }
      ),
      { params: Promise.resolve({ id: criticalFinding.id }) }
    );
    expect(ownerSuppressRes.status).toBe(200);
    const updatedFinding = SecurityFindingDTOSchema.parse(
      await ownerSuppressRes.json()
    );
    expect(updatedFinding.suppressedInMemory).toBe(true);
    expect(updatedFinding.triageVerdict).toBe("false_positive");
  });

  test("ingere scan da CLI stateless via Authorization: Bearer sem cookie e valida 413 > 5 MiB", async () => {
    expect(ownerBearer.length).toBeGreaterThan(10);

    const ingestRes = await ingestSecurityScan(
      new Request("http://localhost:3000/api/security/scans/ingest", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${ownerBearer}`,
        },
        body: JSON.stringify({
          projectId,
          targetType: "git_repo",
          targetRef: "cli-standalone",
          scannersRun: ["native_secrets"],
          sarifRawJson: {
            version: "2.1.0",
            runs: [{ tool: { driver: { name: "uzina-sec" } }, results: [] }],
          },
          summaryCountsJson: {
            critical: 0,
            high: 0,
            medium: 0,
            low: 1,
            info: 0,
            total: 1,
            confirmedCount: 0,
            suppressedCount: 0,
            skippedScannersCount: 0,
          },
          findings: [
            {
              ruleId: "uzina/cli-note",
              scanner: "native_secrets",
              severity: "low",
              title: "Nota CLI",
              description: "Token mascarado ghp_1234567890abcdefghijklmnopqrstuvwxyz1234",
              fingerprint: "1".repeat(64),
            },
          ],
        }),
      })
    );
    expect(ingestRes.status).toBe(201);
    const saved = SecurityScanResultSchema.parse(await ingestRes.json());
    expect(saved.mode).toBe("standalone");

    // Developer NÃO pode injetar supressão em memória via ingest (403 FORBIDDEN)
    const devSuppressIngestRes = await ingestSecurityScan(
      new Request("http://localhost:3000/api/security/scans/ingest", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: devCookie,
        },
        body: JSON.stringify({
          projectId,
          targetType: "git_repo",
          targetRef: "cli-standalone",
          scannersRun: ["native_secrets"],
          sarifRawJson: {
            version: "2.1.0",
            runs: [{ tool: { driver: { name: "uzina-sec" } }, results: [] }],
          },
          summaryCountsJson: {
            critical: 1,
            high: 0,
            medium: 0,
            low: 0,
            info: 0,
            total: 1,
            confirmedCount: 0,
            suppressedCount: 1,
            skippedScannersCount: 0,
          },
          findings: [
            {
              ruleId: "uzina/bypass",
              scanner: "native_secrets",
              severity: "critical",
              title: "Tentativa de supressão por developer",
              description: "Bypass não autorizado",
              fingerprint: "2".repeat(64),
              triageVerdict: "false_positive",
              suppressedInMemory: true,
            },
          ],
        }),
      })
    );
    expect(devSuppressIngestRes.status).toBe(403);
    expect(saved.findings![0]!.description).toContain("[REDACTED_GITHUB_TOKEN]");

    // Cross-org projectId deve falhar com 404
    const crossIngest = await ingestSecurityScan(
      new Request("http://localhost:3000/api/security/scans/ingest", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: otherOrgCookie,
        },
        body: JSON.stringify({
          projectId,
          targetType: "git_repo",
          targetRef: "idor",
          scannersRun: ["native_secrets"],
          sarifRawJson: {
            version: "2.1.0",
            runs: [{ tool: { driver: { name: "uzina-sec" } }, results: [] }],
          },
          summaryCountsJson: {
            critical: 0,
            high: 0,
            medium: 0,
            low: 0,
            info: 0,
            total: 0,
            confirmedCount: 0,
            suppressedCount: 0,
            skippedScannersCount: 0,
          },
          findings: [],
        }),
      })
    );
    expect(crossIngest.status).toBe(404);

    // Payload > 5 MiB retorna 413
    const hugeRes = await ingestSecurityScan(
      new Request("http://localhost:3000/api/security/scans/ingest", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(6 * 1024 * 1024),
          authorization: `Bearer ${ownerBearer}`,
        },
        body: "{}",
      })
    );
    expect(hugeRes.status).toBe(413);
  });

  test("impõe RBAC VAULT_WRITE_ROLES no portão pr_evidence_approve, resolve decisão operacional e transmite SSE", async () => {
    // 1. Inicia workflow -> suspende em discovery_confirm
    const started = await startWorkflow(
      new Request(
        `http://localhost:3000/api/deliverables/${deliverableId}/workflow/start`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie: ownerCookie },
          body: JSON.stringify({}),
        }
      ),
      { params: Promise.resolve({ id: deliverableId }) }
    );
    expect(started.status).toBe(200);

    // 2. Developer lista decisão pending de discovery_confirm e resolve normalmente
    const decRes = await getDecisions(
      new Request("http://localhost:3000/api/decisions?status=pending", {
        headers: { cookie: devCookie },
      })
    );
    expect(decRes.status).toBe(200);
    const decList = DecisionListResponseSchema.parse(await decRes.json());
    const discoveryDec = decList.items.find(
      (d) =>
        d.deliverableId === deliverableId &&
        d.decisionType === "discovery_confirm"
    );
    expect(discoveryDec).toBeDefined();

    const resolvedDisc = await resolveDecisionRoute(
      new Request(
        `http://localhost:3000/api/decisions/${discoveryDec!.id}/resolve`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie: devCookie },
          body: JSON.stringify({ status: "approved" }),
        }
      ),
      { params: Promise.resolve({ id: discoveryDec!.id }) }
    );
    expect(resolvedDisc.status).toBe(200);

    // 3. Reproduz portão pr_evidence_approve diretamente para validar trava RBAC VAULT_WRITE_ROLES
    const { db } = await getDb();
    const [prDecision] = await db
      .insert(decisions)
      .values({
        deliverableId,
        mastraStepId: "stage_decision",
        decisionType: "pr_evidence_approve",
        summary: "Aprovação de PR simulada para RBAC",
        payloadJson: { gate: "pr_evidence_approve" },
        status: "pending",
      })
      .returning();

    const devBlockedPrRes = await resolveDecisionRoute(
      new Request(
        `http://localhost:3000/api/decisions/${prDecision!.id}/resolve`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie: devCookie },
          body: JSON.stringify({ status: "approved" }),
        }
      ),
      { params: Promise.resolve({ id: prDecision!.id }) }
    );
    expect(devBlockedPrRes.status).toBe(403);

    // Cross-org também falha no SSE e decisões
    const crossSse = await getDeliverableEvents(
      new Request(
        `http://localhost:3000/api/deliverables/${deliverableId}/events?snapshot=true`,
        { headers: { cookie: otherOrgCookie } }
      ),
      { params: Promise.resolve({ id: deliverableId }) }
    );
    expect(crossSse.status).toBe(404);

    // SSE válido da organização transmite eventos gravados
    const sseRes = await getDeliverableEvents(
      new Request(
        `http://localhost:3000/api/deliverables/${deliverableId}/events?snapshot=true`,
        { headers: { cookie: ownerCookie } }
      ),
      { params: Promise.resolve({ id: deliverableId }) }
    );
    expect(sseRes.status).toBe(200);
    const sseText = await sseRes.text();
    expect(sseText).toContain("event: stage_change");
    expect(sseText).toContain("event: snapshot_end");

    // Limpa decisão de teste para manter DB consistente e evita dangling state
    await db.delete(decisions).where(eq(decisions.id, prDecision!.id));

    // Valida /workflow/resume diretamente: 400 UUID inválido, 403 auditor (sem role escrita), 404 cross-org
    const resumeBadUuid = await resumeWorkflow(
      new Request("http://localhost:3000/api/deliverables/bad-id/workflow/resume", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({ decision: "approved" }),
      }),
      { params: Promise.resolve({ id: "bad-id" }) }
    );
    expect(resumeBadUuid.status).toBe(400);

    const resumeCrossOrg = await resumeWorkflow(
      new Request(
        `http://localhost:3000/api/deliverables/${deliverableId}/workflow/resume`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie: otherOrgCookie },
          body: JSON.stringify({ decision: "approved" }),
        }
      ),
      { params: Promise.resolve({ id: deliverableId }) }
    );
    expect(resumeCrossOrg.status).toBe(404);

    const [curDeliv] = await db
      .select()
      .from(deliverables)
      .where(eq(deliverables.id, deliverableId));
    expect(curDeliv?.projectId).toBe(projectId);
  });
});
