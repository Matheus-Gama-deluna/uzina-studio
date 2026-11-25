import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  AgentEffectivenessMetricsSchema,
  DecisionRiskBriefingSchema,
  EntropyAuditReportSchema,
  SkillsLockManifestSchema,
  VerifierTwoStageOutputSchema,
} from "@uzina/contracts";
import {
  clients,
  closeDb,
  deliverables,
  executionEvents,
  getDb,
  organizations,
  projectRepositories,
  projects,
  users,
} from "@uzina/db";
import { eq } from "drizzle-orm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { POST as authPost } from "../src/app/api/auth/[...all]/route";
import { GET as getClients } from "../src/app/api/clients/route";
import { GET as getEffectiveness } from "../src/app/api/finops/effectiveness/route";
import { GET as getProjectEntropy } from "../src/app/api/projects/[id]/entropy/route";
import { GET as getSkillsCatalog } from "../src/app/api/skills/catalog/route";
import { AgentEffectivenessPanel } from "../src/components/agent-effectiveness-panel";
import { DecisionRiskBriefingCard } from "../src/components/decision-risk-briefing-card";
import {
  SkillsCatalogPanel,
  SkillsCatalogResponseSchema,
} from "../src/components/skills-catalog-panel";
import { resetAuthForTests } from "../src/lib/auth";
import { resetWebWorkflowRuntimeForTests } from "../src/lib/workflow-runtime";
import {
  mockAgentEffectivenessMetrics,
  mockDecisions,
  mockEntropyAuditReport,
  mockSkillsCatalog,
} from "../src/mocks/fixtures";

function cookieOf(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]?.trim() ?? "")
    .filter(Boolean)
    .join("; ");
}

async function signUpCookie(name: string, email: string): Promise<string> {
  const res = await authPost(
    new Request("http://localhost:3000/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, email, password: "StrongPassword!123" }),
    })
  );
  expect(res.status).toBe(200);
  return cookieOf(res);
}

function renderWithQuery(node: React.ReactElement): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderToStaticMarkup(
    React.createElement(QueryClientProvider, { client }, node)
  );
}

describe("Slices 31, 32 & 34 UI + APIs — Risk Briefing, Efetividade, Catálogo de Skills & Entropia", () => {
  let ownerCookie = "";
  let otherOrgCookie = "";
  let organizationId = "";
  let projectId = "";
  let otherProjectId = "";
  const tempDirs: string[] = [];

  beforeAll(async () => {
    await resetWebWorkflowRuntimeForTests();
    resetAuthForTests();
    await closeDb();

    ownerCookie = await signUpCookie("Owner UI", "owner-ui3134@uzina.studio");
    otherOrgCookie = await signUpCookie("Other UI", "other-ui3134@uzina.studio");

    await getClients(
      new Request("http://localhost:3000/api/clients", {
        headers: { cookie: ownerCookie },
      })
    );

    const { db } = await getDb();
    const [ownerRow] = await db
      .select()
      .from(users)
      .where(eq(users.email, "owner-ui3134@uzina.studio"));
    organizationId = ownerRow!.organizationId!;

    const [clientRow] = await db
      .select()
      .from(clients)
      .where(eq(clients.organizationId, organizationId))
      .limit(1);

    const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-web-entropy-"));
    tempDirs.push(tmpRepo);
    fs.mkdirSync(path.join(tmpRepo, "docs", "slices"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpRepo, "docs", "slices", "slice-99-demo.md"),
      "Referência ausente `packages/core/src/nonexistent-demo-file.ts`.\n",
      "utf8"
    );

    const [proj] = await db
      .insert(projects)
      .values({
        clientId: clientRow!.id,
        name: "Projeto UI 31-34",
        slug: `proj-ui-${crypto.randomUUID().slice(0, 6)}`,
      })
      .returning();
    projectId = proj!.id;

    await db.insert(projectRepositories).values({
      projectId,
      name: "repo-demo",
      localPath: tmpRepo,
      defaultBranch: "main",
    });

    const [deliv] = await db
      .insert(deliverables)
      .values({
        projectId,
        title: "Entrega Efetividade",
        status: "merged",
        verifyAttempts: 1,
      })
      .returning();

    await db.insert(executionEvents).values({
      deliverableId: deliv!.id,
      stage: "stage_build",
      actorRole: "builder",
      eventType: "token_usage",
      tokensInput: 1000,
      tokensOutput: 400,
      cacheReadTokens: 200,
      estimatedCostUsd: "0.005000",
      payloadJson: { durationMs: 450 },
    });

    const [otherOrg] = await db
      .insert(organizations)
      .values({
        name: "Org Externa UI",
        slug: `other-ui-${crypto.randomUUID().slice(0, 6)}`,
      })
      .returning();
    await db
      .update(users)
      .set({ organizationId: otherOrg!.id, role: "owner" })
      .where(eq(users.email, "other-ui3134@uzina.studio"));

    const [otherClient] = await db
      .insert(clients)
      .values({
        organizationId: otherOrg!.id,
        name: "Cliente Externo",
        slug: `ext-client-${crypto.randomUUID().slice(0, 6)}`,
      })
      .returning();
    const [otherProj] = await db
      .insert(projects)
      .values({
        clientId: otherClient!.id,
        name: "Projeto Externo",
        slug: `ext-proj-${crypto.randomUUID().slice(0, 6)}`,
      })
      .returning();
    otherProjectId = otherProj!.id;
  });

  afterAll(async () => {
    await resetWebWorkflowRuntimeForTests();
    resetAuthForTests();
    await closeDb();
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("fixtures MSW de Slices 31, 32 e 34 aderem estritamente a @uzina/contracts", () => {
    const decisionPayload = mockDecisions.items[0]!.payloadJson;
    expect(
      DecisionRiskBriefingSchema.safeParse(decisionPayload.riskBriefing).success
    ).toBe(true);
    expect(
      VerifierTwoStageOutputSchema.safeParse(
        decisionPayload.twoStageVerifierOutput
      ).success
    ).toBe(true);
    expect(
      AgentEffectivenessMetricsSchema.safeParse(mockAgentEffectivenessMetrics)
        .success
    ).toBe(true);
    expect(
      SkillsCatalogResponseSchema.safeParse(mockSkillsCatalog).success
    ).toBe(true);
    expect(
      SkillsLockManifestSchema.safeParse(mockSkillsCatalog.lockManifest).success
    ).toBe(true);
    expect(
      EntropyAuditReportSchema.safeParse(mockEntropyAuditReport).success
    ).toBe(true);
  });

  test.each([
    {
      name: "loading skeleton",
      props: { isLoading: true },
      expectedText: 'data-testid="risk-briefing-loading"',
    },
    {
      name: "error com alerta",
      props: { errorMessage: "Falha ao carregar briefing." },
      expectedText: "Falha ao carregar briefing.",
    },
    {
      name: "empty sem payload",
      props: { payloadJson: {} },
      expectedText: 'data-testid="risk-briefing-empty"',
    },
    {
      name: "partial somente com riskBriefing sem matriz",
      props: {
        payloadJson: {
          riskBriefing: mockDecisions.items[0]!.payloadJson.riskBriefing,
        },
      },
      expectedText: 'data-testid="spec-matrix-empty"',
    },
    {
      name: "populated completo com Risk Briefing e Matriz Spec-Teste-Diff",
      props: {
        payloadJson: mockDecisions.items[0]!.payloadJson,
      },
      expectedText: "Confidence 92/100",
    },
  ])(
    "DecisionRiskBriefingCard renderiza estado $name corretamente",
    ({ props, expectedText }) => {
      const html = renderToStaticMarkup(
        React.createElement(DecisionRiskBriefingCard, props)
      );
      expect(html).toContain(expectedText);
      if (props.payloadJson && "twoStageVerifierOutput" in props.payloadJson) {
        expect(html).toContain("AC-1");
        expect(html).toContain("tests/vault.test.ts:4");
        expect(html).toContain("Risco Alto");
      }
    }
  );

  test("GET /api/finops/effectiveness impõe 401/400/404 e retorna AgentEffectivenessMetrics real do PGlite", async () => {
    const unauth = await getEffectiveness(
      new Request("http://localhost:3000/api/finops/effectiveness")
    );
    expect(unauth.status).toBe(401);

    const invalidUuid = await getEffectiveness(
      new Request(
        "http://localhost:3000/api/finops/effectiveness?projectId=not-a-uuid",
        { headers: { cookie: ownerCookie } }
      )
    );
    expect(invalidUuid.status).toBe(400);

    const crossTenant = await getEffectiveness(
      new Request(
        `http://localhost:3000/api/finops/effectiveness?projectId=${otherProjectId}`,
        { headers: { cookie: ownerCookie } }
      )
    );
    expect(crossTenant.status).toBe(404);

    const okRes = await getEffectiveness(
      new Request(
        `http://localhost:3000/api/finops/effectiveness?projectId=${projectId}`,
        { headers: { cookie: ownerCookie } }
      )
    );
    expect(okRes.status).toBe(200);
    const parsed = AgentEffectivenessMetricsSchema.safeParse(await okRes.json());
    expect(parsed.success).toBe(true);
    expect(parsed.data?.firstPassVerifyRate).toBe(100);
    expect(parsed.data?.byRole.tech_lead.runs).toBeGreaterThanOrEqual(1);
  });

  test("GET /api/skills/catalog e GET /api/projects/[id]/entropy validam RBAC, multi-tenant e contratos Zod", async () => {
    const unauthCatalog = await getSkillsCatalog(
      new Request("http://localhost:3000/api/skills/catalog")
    );
    expect(unauthCatalog.status).toBe(401);

    const okCatalog = await getSkillsCatalog(
      new Request("http://localhost:3000/api/skills/catalog", {
        headers: { cookie: ownerCookie },
      })
    );
    expect(okCatalog.status).toBe(200);
    const catalogJson = SkillsCatalogResponseSchema.parse(
      await okCatalog.json()
    );
    expect(catalogJson.skills.length).toBeGreaterThanOrEqual(8);
    expect(catalogJson.lockValid).toBe(true);

    const unauthEntropy = await getProjectEntropy(
      new Request(`http://localhost:3000/api/projects/${projectId}/entropy`),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(unauthEntropy.status).toBe(401);

    const crossTenantEntropy = await getProjectEntropy(
      new Request(`http://localhost:3000/api/projects/${projectId}/entropy`, {
        headers: { cookie: otherOrgCookie },
      }),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(crossTenantEntropy.status).toBe(404);

    const okEntropy = await getProjectEntropy(
      new Request(`http://localhost:3000/api/projects/${projectId}/entropy`, {
        headers: { cookie: ownerCookie },
      }),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(okEntropy.status).toBe(200);
    const entropyParsed = EntropyAuditReportSchema.parse(await okEntropy.json());
    expect(entropyParsed.docSpecDrifts.length).toBeGreaterThanOrEqual(1);
    expect(entropyParsed.docSpecDrifts[0]?.missingTarget).toContain(
      "nonexistent-demo-file.ts"
    );
  });

  test("AgentEffectivenessPanel e SkillsCatalogPanel renderizam métricas, lockfile e entropia com tabular-nums", () => {
    const effHtml = renderWithQuery(
      React.createElement(AgentEffectivenessPanel, {
        initialData: mockAgentEffectivenessMetrics,
      })
    );
    expect(effHtml).toContain("84.5%");
    expect(effHtml).toContain("1.18");
    expect(effHtml).toContain("93.0%");
    expect(effHtml).toContain("89/100");
    expect(effHtml).toContain("tabular-nums");
    expect(effHtml).toContain("Tech Lead &amp; Builder");

    const skillsHtml = renderWithQuery(
      React.createElement(SkillsCatalogPanel, {
        initialCatalog: mockSkillsCatalog,
        initialEntropy: {
          deadCodeCandidates: [],
          docSpecDrifts: [
            {
              specPath: "docs/slices/slice-demo.md",
              missingTarget: "packages/core/src/ghost.ts",
              detail: "Referência ausente",
            },
          ],
          orphanWorktrees: [],
          unusedDependencies: [],
        },
        defaultProjectId: projectId,
      })
    );
    expect(skillsHtml).toContain("Lock Íntegro");
    expect(skillsHtml).toContain("discovery-interview");
    expect(skillsHtml).toContain("secure-code-audit");
    expect(skillsHtml).toContain("packages/core/src/ghost.ts");
  });
});
