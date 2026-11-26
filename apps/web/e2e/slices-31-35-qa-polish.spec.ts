import { expect, test } from "@playwright/test";

const POPULATED_DECISION_ID = "90000000-0000-4000-8000-000000000035";
const POPULATED_DELIV_ID = "80000000-0000-4000-8000-000000000035";
const POPULATED_PROJECT_ID = "70000000-0000-4000-8000-000000000035";
const POPULATED_SCAN_ID = "91000000-0000-4000-8000-000000000035";
const POPULATED_FINDING_ID = "92000000-0000-4000-8000-000000000035";
const NOW_ISO = "2026-11-25T20:00:00.000Z";

async function signUpFreshUser(
  page: import("@playwright/test").Page,
  emailPrefix: string
) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedResponses: Array<{ url: string; status: number }> = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      // O preview sandboxed (<iframe sandbox="">) bloqueia propositalmente scripts por segurança
      if (
        text.includes("Blocked script execution") &&
        text.includes("/api/prototypes/")
      ) {
        return;
      }
      consoleErrors.push(text);
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  page.on("response", (res) => {
    if (res.status() >= 400) {
      failedResponses.push({ url: res.url(), status: res.status() });
    }
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/login");
  await page.getByTestId("tab-signup").click();

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  await page.getByPlaceholder("Ex.: Matheus Gama").fill("QA Polish E2E");
  await page
    .getByPlaceholder("operador@uzina.studio")
    .fill(`${emailPrefix}-${suffix}@uzina.local`);
  await page.getByPlaceholder("••••••••").fill("UzinaPolish123!");
  await page.getByTestId("auth-submit").click();
  await page.waitForURL("**/app**");

  return { consoleErrors, pageErrors, failedResponses, suffix };
}

test.describe("Slice 35 — QA Real & Estados Populados (Desktop + Mobile 390px)", () => {
  test("valida correções P1/P2 em /app, /app/studio, /app/finops, /app/decisions e /app/providers", async ({
    page,
  }) => {
    const { consoleErrors, pageErrors, failedResponses, suffix } =
      await signUpFreshUser(page, "polish");

    // 1. Criar projeto Greenfield e testar Chat + Sidebar sticky footer + Drawer Configurações
    await page.getByTestId("btn-new-project").click();
    await page
      .getByPlaceholder("Ex.: Cockpit Operacional")
      .fill(`Gestor QA ${suffix}`);
    await page.getByTestId("submit-project").click();
    await page.waitForURL("**/app?projectId=**");

    await expect(page.getByTestId("agency-chat-input")).toBeVisible({
      timeout: 15_000,
    });
    await page
      .getByTestId("agency-chat-input")
      .fill("Crie o fluxo inicial do sistema de faturamento recorrente.");
    await page.getByTestId("agency-chat-submit").click();

    await expect(page.getByTestId("btn-session-abort")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("btn-session-abort")).toBeDisabled();

    // Sidebar: expandir Fábrica & Sistema e garantir "Sair da sessão" dentro da dobra 900px
    const factoryGroupToggle = page.getByTestId("toggle-factory-nav-group");
    if ((await factoryGroupToggle.getAttribute("aria-expanded")) === "false") {
      await factoryGroupToggle.click();
    }
    const signOutBtn = page.getByRole("button", { name: "Sair da sessão" });
    await expect(signOutBtn).toBeVisible();
    const signOutBox = await signOutBtn.boundingBox();
    expect(signOutBox).not.toBeNull();
    expect(signOutBox!.y + signOutBox!.height).toBeLessThanOrEqual(900);

    // Drawer Configurações não empurra o botão Enviar Mensagem
    await page.getByTestId("toggle-session-settings-btn").click();
    await expect(page.getByTestId("session-settings-panel")).toBeVisible();
    const chatSubmitBox = await page
      .getByTestId("agency-chat-submit")
      .boundingBox();
    expect(chatSubmitBox).not.toBeNull();
    expect(chatSubmitBox!.y + chatSubmitBox!.height).toBeLessThanOrEqual(900);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("session-settings-panel")).toBeHidden();

    // 2. Estúdio Visual: Desktop > Tablet > Celular
    await page.goto("/app/studio");
    const generateBtn = page.getByTestId("btn-generate-initial-prototype");
    const prototypeFrame = page.getByTestId("visual-prototype-frame");
    await expect(generateBtn.or(prototypeFrame)).toBeVisible({
      timeout: 15_000,
    });
    if (await generateBtn.isVisible()) {
      await generateBtn.click();
    }
    await expect(prototypeFrame).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId("viewport-desktop").click();
    const desktopWidth = (
      await page.getByTestId("visual-prototype-frame").boundingBox()
    )!.width;
    await page.getByTestId("viewport-tablet").click();
    const tabletWidth = (
      await page.getByTestId("visual-prototype-frame").boundingBox()
    )!.width;
    await page.getByTestId("viewport-mobile").click();
    const mobileWidth = (
      await page.getByTestId("visual-prototype-frame").boundingBox()
    )!.width;
    expect(desktopWidth).toBeGreaterThan(tabletWidth);
    expect(tabletWidth).toBeGreaterThan(mobileWidth);

    // 3. FinOps: Empty state de Economia por Técnica + Busca/Filtro em 16 Skills + Mobile 390px
    await page.goto("/app/finops");
    await expect(page.getByTestId("finops-by-technique-empty")).toBeVisible();
    await expect(page.getByTestId("skills-search-input")).toBeVisible();
    await expect(page.getByTestId("skills-filtered-count")).toContainText(
      "Exibindo 16 de 16"
    );
    await page.getByTestId("skills-search-input").fill("stride");
    await expect(
      page.getByTestId("skill-item-threat-modeling-stride-fmea")
    ).toBeVisible();
    await expect(page.getByTestId("skills-filtered-count")).toContainText(
      "Exibindo 1 de 16"
    );
    await page
      .getByTestId("skill-item-threat-modeling-stride-fmea")
      .getByRole("button")
      .click();
    await expect(
      page.getByTestId("skill-detail-threat-modeling-stride-fmea")
    ).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    const finopsOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(finopsOverflow).toBe(false);

    // 4. Caixa de Decisões em Mobile 390px: zero overflow e abas na mesma linha
    await page.goto("/app/decisions");
    const decisionsTabs = page
      .getByRole("tablist", { name: "Filtrar decisões por status" })
      .getByRole("tab");
    await expect(decisionsTabs).toHaveCount(5);
    const firstTabBox = await decisionsTabs.nth(0).boundingBox();
    const lastTabBox = await decisionsTabs.nth(4).boundingBox();
    expect(firstTabBox).not.toBeNull();
    expect(lastTabBox).not.toBeNull();
    expect(Math.abs(firstTabBox!.y - lastTabBox!.y)).toBeLessThanOrEqual(4);
    const decisionsOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(decisionsOverflow).toBe(false);

    // 5. Provedores: 6 cartões, OmniRoute omni-fast, GitHub PAT sem Ping LLM
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/app/providers");
    await expect(page.getByTestId("empty-providers-state")).toContainText(
      "Escolha um dos 6 cartões acima"
    );
    await page.getByTestId("quick-provider-preset-omniroute").click();
    await expect(page.locator("#bind-builder")).toHaveValue("omni-fast");
    await page.keyboard.press("Escape");

    await page.getByTestId("quick-provider-preset-github_pat").click();
    await expect(page.getByTestId("btn-test-provider-modal")).toHaveCount(0);
    await expect(page.getByTestId("submit-provider")).toBeVisible();

    expect(failedResponses).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test("renderiza estados populados de DecisionRiskBriefingCard, AgentEffectivenessPanel e AppSec SARIF", async ({
    page,
  }) => {
    const { consoleErrors, pageErrors, failedResponses } = await signUpFreshUser(
      page,
      "populated"
    );

    await page.route(`**/api/deliverables/${POPULATED_DELIV_ID}/events*`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: ": keepalive\n\n",
      });
    });

    await page.route("**/api/decisions*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            {
              id: POPULATED_DECISION_ID,
              deliverableId: POPULATED_DELIV_ID,
              deliverableTitle: "Autenticação Multi-Tenant & Cofre AES",
              projectId: POPULATED_PROJECT_ID,
              projectName: "Portal Corporativo",
              mastraStepId: "stage_decision",
              decisionType: "pr_evidence_approve",
              summary: "PR pronto com Two-Stage Verifier e Risk Briefing",
              payloadJson: {
                riskBriefing: {
                  riskLevel: "medium",
                  confidenceScore: 92,
                  changedSurface: {
                    dbMigrations: false,
                    authOrRbac: true,
                    cryptoOrSecrets: true,
                    newDependencies: [],
                    newEnvVars: ["MASTER_ENCRYPTION_KEY"],
                  },
                  rollbackPlan:
                    "Reverter commit da feature e invalidar sessões temporárias.",
                  finopsSummary: {
                    tokensTotal: 5400,
                    estimatedCostUsd: 0.0142,
                  },
                },
                twoStageVerifierOutput: {
                  passed: true,
                  confidenceScore: 92,
                  summary: "Spec 100% coberta e auditoria AppSec sem achados críticos.",
                  stage1SpecCompliance: {
                    passed: true,
                    matrix: [
                      {
                        criterionId: "BDD-01",
                        criterionText: "Isolar queries por organizationId",
                        testFile: "tests/auth-isolation.test.ts",
                        testLine: 24,
                        sourceFile: "src/lib/auth.ts",
                        sourceLine: 40,
                        status: "covered",
                      },
                    ],
                  },
                  stage2QualityAndSecurity: {
                    passed: true,
                    refutingChecksPerformed: [
                      "Tentativa de leitura cross-tenant bloqueada com 403.",
                    ],
                    survivingMutantRisks: [],
                  },
                },
              },
              status: "pending",
              humanFeedback: null,
              resolvedBy: null,
              resolvedAt: null,
              createdAt: NOW_ISO,
            },
          ],
        }),
      });
    });

    await page.route("**/api/finops/effectiveness*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          firstPassVerifyRate: 84.5,
          averageVerifyAttempts: 1.18,
          skillAdherenceRate: 93.0,
          averageConfidenceScore: 89.2,
          reworkCostUsd: 0.0124,
          byRole: {
            orchestrator: { runs: 4, avgTokens: 1200, avgLatencyMs: 650, failureRate: 0 },
            product_discovery: { runs: 6, avgTokens: 1850, avgLatencyMs: 920, failureRate: 0 },
            software_architect: { runs: 5, avgTokens: 3200, avgLatencyMs: 1450, failureRate: 0.1 },
            ux_designer: { runs: 4, avgTokens: 2800, avgLatencyMs: 1320, failureRate: 0 },
            tech_lead: { runs: 12, avgTokens: 4600, avgLatencyMs: 2150, failureRate: 0.15 },
            qa_appsec: { runs: 8, avgTokens: 2100, avgLatencyMs: 1100, failureRate: 0.05 },
          },
        }),
      });
    });

    await page.route("**/api/security/scans", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items: [
              {
                id: POPULATED_SCAN_ID,
                projectId: POPULATED_PROJECT_ID,
                deliverableId: null,
                targetType: "git_repo",
                targetRef: "HEAD",
                mode: "strict",
                scannerStatuses: [
                  {
                    scanner: "native_slopsquatting",
                    status: "executed",
                    findingsCount: 1,
                    durationMs: 18,
                  },
                ],
                summaryCountsJson: {
                  critical: 0,
                  high: 0,
                  medium: 1,
                  low: 0,
                  info: 0,
                  total: 1,
                  confirmedCount: 0,
                  suppressedCount: 0,
                  skippedScannersCount: 0,
                },
                status: "completed",
                createdAt: NOW_ISO,
                updatedAt: NOW_ISO,
              },
            ],
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.route(`**/api/security/scans/${POPULATED_SCAN_ID}*`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: POPULATED_SCAN_ID,
          projectId: POPULATED_PROJECT_ID,
          deliverableId: null,
          targetType: "git_repo",
          targetRef: "HEAD",
          mode: "strict",
          scannerStatuses: [
            {
              scanner: "native_slopsquatting",
              status: "executed",
              findingsCount: 1,
              durationMs: 18,
            },
          ],
          summaryCountsJson: {
            critical: 0,
            high: 0,
            medium: 1,
            low: 0,
            info: 0,
            total: 1,
            confirmedCount: 0,
            suppressedCount: 0,
            skippedScannersCount: 0,
          },
          status: "completed",
          sarifRawJson: {
            version: "2.1.0",
            runs: [
              {
                tool: { driver: { name: "uzina-security-engine", version: "0.1.0" } },
                results: [],
              },
            ],
          },
          findings: [
            {
              id: POPULATED_FINDING_ID,
              scanId: POPULATED_SCAN_ID,
              projectId: POPULATED_PROJECT_ID,
              ruleId: "uzina/unpinned-dependency",
              scanner: "native_slopsquatting",
              severity: "medium",
              filePath: "package.json",
              lineStart: 12,
              title: "Dependência não pinada detectada",
              description: "Pinagem estrita recomendada em produção.",
              fingerprint: "f".repeat(64),
              triageVerdict: "unknown",
              triageRationale: null,
              suppressedInMemory: false,
              povTestStatus: "not_applicable",
              createdAt: NOW_ISO,
              updatedAt: NOW_ISO,
            },
          ],
          createdAt: NOW_ISO,
          updatedAt: NOW_ISO,
        }),
      });
    });

    // 1. /app/decisions populado (Slice 31 UI)
    await page.goto("/app/decisions");
    await expect(page.getByTestId("decision-risk-briefing-card")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("risk-briefing-confidence")).toContainText(
      "Confidence 92/100"
    );
    await expect(page.getByTestId("risk-surface-checklist")).toContainText(
      "MASTER_ENCRYPTION_KEY"
    );
    await expect(page.getByText("Isolar queries por organizationId")).toBeVisible();

    // 2. /app/finops populado (Slice 32 UI)
    await page.goto("/app/finops");
    await expect(page.getByTestId("effectiveness-first-pass")).toContainText(
      "84.5%"
    );
    await expect(page.getByTestId("effectiveness-by-role-table")).toContainText(
      "Tech Lead & Builder"
    );

    // 3. /app/security populado (AppSec SARIF)
    await page.goto("/app/security");
    await expect(page.getByText("uzina/unpinned-dependency")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByText("Dependência não pinada detectada")
    ).toBeVisible();

    expect(failedResponses).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
