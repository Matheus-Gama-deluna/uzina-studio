import { ExecutiveProjectOverviewSchema } from "@uzina/contracts";
import {
  clients,
  closeDb,
  decisions,
  deliverables,
  getDb,
  projects,
  securityScans,
  tokenSavingsEvents,
  users,
} from "@uzina/db";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { POST as authPost } from "../src/app/api/auth/[...all]/route";
import { GET as getClients } from "../src/app/api/clients/route";
import { GET as getExecutiveOverview } from "../src/app/api/exec/overview/route";
import { resetAuthForTests } from "../src/lib/auth";

function cookieOf(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]?.trim() ?? "")
    .filter(Boolean)
    .join("; ");
}

async function signUpUser(email: string, name: string): Promise<{
  cookie: string;
  organizationId: string;
}> {
  const signUpRes = await authPost(
    new Request("http://localhost:3000/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({
        name,
        email,
        password: "StrongPassword!123",
      }),
    })
  );
  expect(signUpRes.status).toBe(200);
  const cookie = cookieOf(signUpRes);

  await getClients(
    new Request("http://localhost:3000/api/clients", {
      headers: { cookie },
    })
  );

  const { db } = await getDb();
  const [userRow] = await db
    .select()
    .from(users)
    .where(
      (await import("drizzle-orm")).eq(users.email, email)
    );
  expect(userRow?.organizationId).toMatch(/^[0-9a-f-]{36}$/i);
  return { cookie, organizationId: userRow!.organizationId! };
}

describe("Slice 40 — Superfície Executiva /exec & Barreira de Domínio", () => {
  let ownerCookie = "";
  let ownerOrgId = "";
  let otherOrgCookie = "";
  let otherProjectId = "";

  beforeAll(async () => {
    resetAuthForTests();
    await closeDb();

    const ts = Date.now();
    const owner = await signUpUser(`exec-owner-${ts}@uzina.studio`, "CEO Owner");
    ownerCookie = owner.cookie;
    ownerOrgId = owner.organizationId;

    const other = await signUpUser(`exec-other-${ts}@uzina.studio`, "Other Org");
    otherOrgCookie = other.cookie;

    const { db } = await getDb();
    const [otherClient] = await db
      .insert(clients)
      .values({
        organizationId: other.organizationId,
        name: "Cliente Secreto B",
        slug: `cliente-b-${ts}`,
      })
      .returning();

    const [otherProj] = await db
      .insert(projects)
      .values({
        clientId: otherClient!.id,
        name: "Projeto Cross-Tenant Secreto",
        slug: `proj-b-${ts}`,
      })
      .returning();
    otherProjectId = otherProj!.id;
  });

  afterAll(async () => {
    resetAuthForTests();
    await closeDb();
  });

  test("rejeita requisição sem sessão autenticada com HTTP 401", async () => {
    const res = await getExecutiveOverview(
      new Request("http://localhost:3000/api/exec/overview")
    );
    expect(res.status).toBe(401);
  });

  test("retorna estado vazio válido quando a organização ainda não possui projetos", async () => {
    const res = await getExecutiveOverview(
      new Request("http://localhost:3000/api/exec/overview", {
        headers: { cookie: ownerCookie },
      })
    );
    expect(res.status).toBe(200);
    const parsed = ExecutiveProjectOverviewSchema.parse(await res.json());
    expect(parsed.project).toBeNull();
    expect(parsed.projects).toEqual([]);
    expect(parsed.counts).toEqual({
      total: 0,
      delivered: 0,
      inProgress: 0,
      awaitingApproval: 0,
    });
    expect(parsed.progressPercent).toBe(0);
  });

  test("bloqueia projectId inválido (400) e acesso cross-tenant de outra organização (404)", async () => {
    const invalidRes = await getExecutiveOverview(
      new Request("http://localhost:3000/api/exec/overview?projectId=not-a-uuid", {
        headers: { cookie: ownerCookie },
      })
    );
    expect(invalidRes.status).toBe(400);

    const crossTenantRes = await getExecutiveOverview(
      new Request(
        `http://localhost:3000/api/exec/overview?projectId=${otherProjectId}`,
        {
          headers: { cookie: ownerCookie },
        }
      )
    );
    expect(crossTenantRes.status).toBe(404);

    const validOtherRes = await getExecutiveOverview(
      new Request(
        `http://localhost:3000/api/exec/overview?projectId=${otherProjectId}`,
        {
          headers: { cookie: otherOrgCookie },
        }
      )
    );
    expect(validOtherRes.status).toBe(200);
  });

  test("preserva Barreira de Domínio e nunca expõe worktreePath, branchName, SARIF, blueprint ou tokens", async () => {
    const { db } = await getDb();
    const ts = Date.now();
    const [client] = await db
      .insert(clients)
      .values({
        organizationId: ownerOrgId,
        name: "Acme Holdings",
        slug: `acme-${ts}`,
      })
      .returning();

    const [project] = await db
      .insert(projects)
      .values({
        clientId: client!.id,
        name: "Portal Executivo Acme",
        slug: `portal-acme-${ts}`,
        description: "Visão de entrega contínua para diretoria.",
      })
      .returning();

    const [deliv1] = await db
      .insert(deliverables)
      .values({
        projectId: project!.id,
        title: "Painel de Faturamento Mensal",
        description: "Consolidado gerencial para diretoria.",
        status: "decision_pending",
        hasUi: true,
        worktreePath: "/secret/worktree/task-99",
        branchName: "feat/internal-secret-branch",
        specMarkdown: "# Visão de Produto\nResumo executivo do módulo financeiro.",
        blueprintJson: { secretBlueprint: "step-alpha", internalAgent: "coder" },
        evidencePackJson: { internalEvidence: "vitest-raw-trace" },
      })
      .returning();

    await db.insert(deliverables).values({
      projectId: project!.id,
      title: "Relatório Trimestral PDF",
      status: "approved",
      hasUi: false,
    });

    await db.insert(decisions).values({
      deliverableId: deliv1!.id,
      mastraStepId: "spec_review",
      decisionType: "blueprint_approve",
      summary: "Aprovar escopo executivo da primeira entrega.",
      payloadJson: {
        confidenceScore: 0.92,
        internalWorktreeRef: "task-99-hidden",
      },
      status: "pending",
    });

    await db.insert(securityScans).values({
      organizationId: ownerOrgId,
      projectId: project!.id,
      deliverableId: deliv1!.id,
      mode: "embedded",
      targetType: "git_repo",
      targetRef: "/secret/worktree/task-99",
      scannersRun: ["opengrep", "trivy"],
      scannerStatusesJson: [],
      sarifRawJson: {
        version: "2.1.0",
        runs: [
          {
            tool: { driver: { name: "SARIF_SECRET_FINDING" } },
            results: [],
          },
        ],
      },
      summaryCountsJson: {
        critical: 1,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
        total: 1,
        confirmedCount: 1,
        suppressedCount: 0,
        skippedScannersCount: 0,
      },
      status: "completed",
    });

    await db.insert(tokenSavingsEvents).values({
      organizationId: ownerOrgId,
      deliverableId: deliv1!.id,
      technique: "qmd",
      tokensBaseline: 12000,
      tokensActual: 3000,
    });

    const res = await getExecutiveOverview(
      new Request(
        `http://localhost:3000/api/exec/overview?projectId=${project!.id}`,
        { headers: { cookie: ownerCookie } }
      )
    );
    expect(res.status).toBe(200);
    const body = ExecutiveProjectOverviewSchema.parse(await res.json());

    expect(body.project?.id).toBe(project!.id);
    expect(body.counts).toEqual({
      total: 2,
      delivered: 1,
      inProgress: 1,
      awaitingApproval: 1,
    });
    expect(body.progressPercent).toBe(50);
    expect(body.pendingApprovals).toHaveLength(1);
    expect(body.pendingApprovals[0]?.deliverableTitle).toBe(
      "Painel de Faturamento Mensal"
    );
    expect(body.pendingApprovals[0]?.confidenceScore).toBe(0.92);
    expect(body.prdExcerptMarkdown).toContain("PRD Vivo — Portal Executivo Acme");
    expect(body.prdExcerptMarkdown).toContain(
      "Visão de entrega contínua para diretoria."
    );

    const rawSerialized = JSON.stringify(body);
    const forbiddenLeaks = [
      "worktreePath",
      "/secret/worktree/task-99",
      "branchName",
      "feat/internal-secret-branch",
      "SARIF_SECRET_FINDING",
      "opengrep",
      "blueprintJson",
      "secretBlueprint",
      "internalEvidence",
      "tokensBaseline",
      "tokensActual",
      "internalWorktreeRef",
    ];
    for (const token of forbiddenLeaks) {
      expect(rawSerialized).not.toContain(token);
    }
  });
});
