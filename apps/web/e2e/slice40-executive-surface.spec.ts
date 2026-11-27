import { expect, test } from "@playwright/test";

const EXEC_DECISION_ID = "90000000-0000-4000-8000-000000000040";
const EXEC_DELIVERABLE_ID = "90000000-0000-4000-8000-000000000041";
const EXEC_PROJECT_ID = "90000000-0000-4000-8000-000000000042";

test.describe("Slice 40 — Superfície Executiva /exec, Aprovação & Barreira de Domínio", () => {
  test("renderiza /exec real após cadastro, aprova pendência, alterna Dark/Light e valida zero vazamento técnico", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const failedResponses: Array<{ url: string; status: number }> = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });
    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("response", (res) => {
      if (res.status() >= 400) {
        failedResponses.push({ url: res.url(), status: res.status() });
      }
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");
    await page.getByTestId("tab-signup").click();

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    await page.getByPlaceholder("Ex.: Matheus Gama").fill("Diretoria Executiva");
    await page
      .getByPlaceholder("operador@uzina.studio")
      .fill(`exec-e2e-${suffix}@uzina.local`);
    await page.getByPlaceholder("••••••••").fill("UzinaExec123!");
    await page.getByTestId("auth-submit").click();
    await page.waitForURL("**/app**");

    // Cria projeto + entregável real no backend antes de navegar ao /exec
    const seedRes = await page.evaluate(async (tag) => {
      const clientsRes = await fetch("/api/clients");
      const clientsJson = (await clientsRes.json()) as {
        items: Array<{ id: string }>;
      };
      const clientId = clientsJson.items[0]!.id;

      const projRes = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientId,
          name: `Produto Executivo ${tag}`,
          description: "Portal de acompanhamento para clientes e liderança.",
        }),
      });
      const projJson = (await projRes.json()) as { id: string };

      const delivRes = await fetch(`/api/projects/${projJson.id}/deliverables`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Portal de Acompanhamento v1",
          description: "Visão consolidada de entregas.",
        }),
      });
      return {
        projStatus: projRes.status,
        delivStatus: delivRes.status,
      };
    }, suffix);

    expect(seedRes.projStatus).toBe(201);
    expect(seedRes.delivStatus).toBe(201);

    // 1. Valida /exec contra a API real (/api/exec/overview)
    await page.goto("/exec");
    await expect(page.getByTestId("executive-cockpit-root")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByRole("heading", {
        name: `Produto Executivo ${suffix}`,
        exact: true,
      })
    ).toBeVisible();
    await expect(page.getByText("Portal de Acompanhamento v1")).toBeVisible();
    await expect(page.getByTestId("exec-progress-percent")).toHaveText("0%");

    // Barreira de Domínio no DOM real
    const realBodyText = await page.locator("main").innerText();
    expect(realBodyText).not.toMatch(/worktreePath|branchName|SARIF|tokensInput/i);

    // 2. Valida aprovação interativa + zero overflow em 1440x900 e 390x844 (Dark & Light)
    let resolvedCalled = false;
    await page.route("**/api/exec/overview*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          project: {
            id: EXEC_PROJECT_ID,
            name: `Produto Executivo ${suffix}`,
            clientName: "Cliente Corporativo",
            description: "Entrega executiva pronta para decisão.",
            status: "active",
            updatedAt: new Date().toISOString(),
          },
          projects: [
            {
              id: EXEC_PROJECT_ID,
              name: `Produto Executivo ${suffix}`,
              clientName: "Cliente Corporativo",
            },
          ],
          prdExcerptMarkdown: "# Visão Executiva\nEscopo validado com o cliente.",
          progressPercent: resolvedCalled ? 100 : 50,
          counts: {
            total: 2,
            delivered: resolvedCalled ? 2 : 1,
            inProgress: resolvedCalled ? 0 : 1,
            awaitingApproval: resolvedCalled ? 0 : 1,
          },
          latestPrototype: null,
          pendingApprovals: resolvedCalled
            ? []
            : [
                {
                  decisionId: EXEC_DECISION_ID,
                  deliverableId: EXEC_DELIVERABLE_ID,
                  deliverableTitle: "Checkout Executivo v1",
                  decisionType: "prototype_approve",
                  summary: "Protótipo visual e fluxo de aprovação prontos.",
                  confidenceScore: 0.94,
                  spokenSummary: "Checkout Executivo pronto para aprovação.",
                  createdAt: new Date().toISOString(),
                },
              ],
          timeline: [
            {
              id: EXEC_DELIVERABLE_ID,
              title: "Checkout Executivo v1",
              description: "Fluxo de aprovação simplificado.",
              executiveStage: resolvedCalled ? "entregue" : "aguardando_aprovacao",
              stageLabel: resolvedCalled
                ? "Aprovado e Entregue"
                : "Aguardando Sua Aprovação",
              hasUi: true,
              updatedAt: new Date().toISOString(),
            },
          ],
        }),
      });
    });

    let resolvedPayload: { status?: string; humanFeedback?: string } = {};
    await page.route(
      `**/api/decisions/${EXEC_DECISION_ID}/resolve`,
      async (route) => {
        expect(route.request().method()).toBe("POST");
        resolvedPayload = route.request().postDataJSON() as {
          status?: string;
          humanFeedback?: string;
        };
        resolvedCalled = true;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
      }
    );

    await page.reload();
    await expect(page.getByTestId("exec-approvals-section")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId(`exec-approve-btn-${EXEC_DECISION_ID}`).click();
    await expect(page.getByText("Aprovação registrada com sucesso.")).toBeVisible();
    expect(resolvedPayload.status).toBe("approved");
    await expect(page.getByTestId("exec-progress-percent")).toHaveText("100%");

    for (const theme of ["dark", "light"] as const) {
      if (theme === "light") {
        await page.getByTestId("theme-toggle").click();
      }
      for (const vp of [
        { width: 1440, height: 900 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(vp);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth
        );
        expect(overflow).toBe(false);
      }
    }

    expect(failedResponses).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
