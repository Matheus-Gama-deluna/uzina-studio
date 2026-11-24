import { expect, test } from "@playwright/test";

test.describe("Uzina Studio — Smoke E2E Fase 1", () => {
  test("GET /api/health retorna status ok e serviço uzina-studio", async ({
    request,
  }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      status: string;
      service: string;
    };
    expect(body.status).toBe("ok");
    expect(body.service).toBe("uzina-studio");
  });

  test("executa jornada completa: signup -> projeto -> entrega -> páginas operacionais -> Co-piloto SSE sem erros", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const serverErrors: Array<{ url: string; status: number }> = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });
    page.on("pageerror", (error) => {
      pageErrors.push(error.message);
    });
    page.on("response", (res) => {
      if (res.status() >= 500) {
        serverErrors.push({ url: res.url(), status: res.status() });
      }
    });

    await page.goto("/login");
    await page.getByTestId("tab-signup").click();

    const suffix = Date.now();
    await page.getByPlaceholder("Ex.: Matheus Gama").fill("Operador E2E");
    await page
      .getByPlaceholder("operador@uzina.studio")
      .fill(`e2e-${suffix}@uzina.local`);
    await page.getByPlaceholder("••••••••").fill("UzinaE2e123!");
    await page.getByTestId("auth-submit").click();

    await page.waitForURL("**/app**");
    await expect(
      page.getByRole("heading", { name: "O que vamos construir hoje?" })
    ).toBeVisible({ timeout: 15_000 });

    await page.getByTestId("btn-new-project").click();
    await page
      .getByPlaceholder("Ex.: Cockpit Operacional")
      .fill(`Projeto E2E ${suffix}`);
    await page.getByTestId("submit-project").click();
    await page.waitForURL("**/app?projectId=**");
    await expect(
      page.getByTestId("sidebar-project-switcher")
    ).toContainText(`Projeto E2E ${suffix}`);

    await page.goto("/app/deliverables");
    await expect(page.getByTestId("deliverables-docs-hub")).toBeVisible();

    await page.getByTestId("btn-new-deliverable").click();
    await page
      .getByPlaceholder("Ex.: Painel de Auditoria AppSec")
      .fill(`Entrega E2E ${suffix}`);
    await page.getByTestId("submit-deliverable").click();
    await expect(
      page.getByText(`Entrega E2E ${suffix}`).first()
    ).toBeVisible();

    await page.getByTestId("view-kanban").click();
    await expect(page.getByTestId("kanban-board")).toBeVisible();
    await expect(
      page.getByTestId("kanban-stage-lock-decision_pending")
    ).toContainText("Manual (HITL)");
    const discoverySwitch = page.getByTestId("kanban-stage-mode-discovery");
    await expect(discoverySwitch).toHaveAttribute("aria-checked", "false");
    await discoverySwitch.click();
    await expect(discoverySwitch).toHaveAttribute("aria-checked", "true");

    await page.goto("/app/ideas");
    await expect(page.getByTestId("ideas-hub-root")).toBeVisible();

    await page.goto("/app/studio");
    await expect(page.getByTestId("visual-studio-workspace")).toBeVisible();

    const operationalRoutes = [
      {
        path: "/app/providers",
        heading: "Provedores & Cofre Criptográfico",
      },
      {
        path: "/app/decisions",
        heading: "Caixa de Decisões & Pacote de Evidências",
      },
      {
        path: "/app/security",
        heading: "Auditoria de Segurança (@uzina/security-engine)",
      },
      {
        path: "/app/memories",
        heading: "Memórias (Organização, Cliente e Projeto)",
      },
      {
        path: "/app/finops",
        heading: "FinOps de Tokens & Isolamento",
      },
    ];

    for (const route of operationalRoutes) {
      await page.goto(route.path);
      await expect(
        page.getByRole("heading", { name: route.heading })
      ).toBeVisible();
    }

    const codingSelect = page.getByTestId("engine-coding-executor-select");
    await expect(codingSelect).toBeVisible();
    await codingSelect.selectOption("mastra_coding_agent");
    await expect(codingSelect).toHaveValue("mastra_coding_agent");

    await page.getByTestId("open-copilot-drawer").click();
    await page.getByRole("button", { name: "Resumo Executivo" }).click();
    await expect(page.getByText("read_workspace_overview")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/Resumo Executivo:\s*\d+\s*cliente\(s\)/)).toBeVisible({
      timeout: 15_000,
    });

    const hasHorizontalOverflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth > window.innerWidth
    );
    expect(hasHorizontalOverflow).toBe(false);
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(serverErrors).toEqual([]);
  });
});
