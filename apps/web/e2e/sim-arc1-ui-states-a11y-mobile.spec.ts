import { expect, test } from "@playwright/test";

async function signUpQaOperator(
  page: import("@playwright/test").Page,
  prefix: string
) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedResponses: Array<{ url: string; status: number }> = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      if (
        text.includes("Blocked script execution") &&
        text.includes("/api/prototypes/")
      ) {
        return;
      }
      consoleErrors.push(text);
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
  await page.getByPlaceholder("Ex.: Matheus Gama").fill("Simulador UI UX");
  await page
    .getByPlaceholder("operador@uzina.studio")
    .fill(`${prefix}-${suffix}@uzina.local`);
  await page.getByPlaceholder("••••••••").fill("UzinaUiQa123!");
  await page.getByTestId("auth-submit").click();
  await page.waitForURL("**/app**");

  return { consoleErrors, pageErrors, failedResponses, suffix };
}

test.describe("Simulação Arco 1 — UI/UX, Escalas A-|A|A+, Dark/Light, Dense State & Offline", () => {
  test("valida /exec redirect, escalas A-|A|A+ na 1ª dobra, Dark/Light, 3 viewports e Cmd+K", async ({
    page,
  }) => {
    const { consoleErrors, pageErrors, failedResponses, suffix } =
      await signUpQaOperator(page, "arc1-ui");

    // Cria projeto para ativar fluxo completo da barra lateral e chat
    await page.getByTestId("btn-new-project").click();
    await page
      .getByPlaceholder("Ex.: Cockpit Operacional")
      .fill(`Clinica VidaPlena ${suffix}`);
    await page.getByTestId("submit-project").click();
    await page.waitForURL("**/app?projectId=**");
    await expect(page.getByTestId("agency-chat-input")).toBeVisible({
      timeout: 15_000,
    });

    // Comportamento atual da rota /exec (redireciona para /app)
    await page.goto("/exec");
    await page.waitForURL("**/app**");

    // Escalas tipográficas A- | A | A+ no Desktop 1440x900 preservando Enviar Mensagem na 1ª dobra
    for (const scale of ["compact", "comfortable", "large"] as const) {
      await page.getByTestId(`font-scale-${scale}`).click();
      const box = await page.getByTestId("agency-chat-submit").boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y + box!.height).toBeLessThanOrEqual(900);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth
      );
      expect(overflow).toBe(false);
    }
    await page.getByTestId("font-scale-comfortable").click();

    // Paleta de comandos via teclado (Ctrl+K), verificação de foco no dialog e fechamento via Escape
    await page.keyboard.press("Control+k");
    const cmdDialog = page.getByRole("dialog");
    await expect(cmdDialog).toBeVisible();
    const focusedInsideDialog = await cmdDialog.evaluate((el) =>
      el.contains(document.activeElement)
    );
    expect(focusedInsideDialog).toBe(true);
    await page.keyboard.press("Escape");
    await expect(cmdDialog).toBeHidden();

    // Alternância Warm Stone Dark <-> Light
    await page.getByTestId("theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    // Matriz de rotas em Desktop 1440x900, Tablet 768x1024 e Mobile 390x844
    const targetRoutes = [
      "/app",
      "/app/ideas",
      "/app/studio",
      "/app/deliverables",
      "/app/decisions",
      "/app/memories",
      "/app/providers",
      "/app/security",
      "/app/finops",
      "/app/settings",
    ];
    const viewports = [
      { width: 1440, height: 900 },
      { width: 768, height: 1024 },
      { width: 390, height: 844 },
    ];

    for (const route of targetRoutes) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(route);
      await expect(page.locator("main")).toBeVisible();
      await expect(page.locator("h1").first()).toBeVisible();
      for (const vp of viewports) {
        await page.setViewportSize(vp);
        const hasHorizontalOverflow = await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth
        );
        expect(hasHorizontalOverflow).toBe(false);
        if (vp.width === 390) {
          const moreBtnBox = await page
            .getByTestId("mobile-bottom-more-btn")
            .boundingBox();
          expect(moreBtnBox).not.toBeNull();
          expect(moreBtnBox!.height).toBeGreaterThanOrEqual(40);
        }
      }
    }

    expect(failedResponses).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test("valida Dense State (25+ itens em Entregas) e resiliência em modo Offline", async ({
    context,
    page,
  }) => {
    const { consoleErrors, pageErrors, failedResponses, suffix } =
      await signUpQaOperator(page, "arc1-dense");

    await page.getByTestId("btn-new-project").click();
    await page
      .getByPlaceholder("Ex.: Cockpit Operacional")
      .fill(`Projeto Dense ${suffix}`);
    await page.getByTestId("submit-project").click();
    await page.waitForURL("**/app?projectId=**");

    const projectId = new URL(page.url()).searchParams.get("projectId");
    expect(projectId).toMatch(/^[0-9a-f-]{36}$/i);

    // Popula 25 entregas reais via API autenticada do navegador (Dense State)
    const createdCount = await page.evaluate(async (pid) => {
      const requests = Array.from({ length: 25 }, (_, idx) =>
        fetch(`/api/projects/${pid}/deliverables`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: `Slice Dense #${String(idx + 1).padStart(2, "0")}`,
            hasUi: false,
          }),
        })
      );
      const responses = await Promise.all(requests);
      return responses.filter((r) => r.status === 201).length;
    }, projectId);
    expect(createdCount).toBe(25);

    await page.goto(`/app/deliverables?projectId=${projectId}`);
    await expect(page.getByTestId("deliverables-docs-hub")).toBeVisible();
    await expect(
      page.getByText("Slice Dense #25").first()
    ).toBeVisible({ timeout: 15_000 });

    const denseOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(denseOverflow).toBe(false);

    // Rota /offline + simulação real de perda e retomada de conectividade
    await page.goto("/offline");
    await expect(
      page.getByRole("heading", { name: "Sem conexão no momento" })
    ).toBeVisible();

    await page.goto(`/app/ideas?projectId=${projectId}`);
    await expect(page.getByTestId("ideas-hub-root")).toBeVisible();
    await context.setOffline(true);
    const offlineState = await page.evaluate(() => navigator.onLine);
    expect(offlineState).toBe(false);
    await page.getByTestId("ideas-prompt-input").fill("Ideia capturada offline");
    await expect(page.getByTestId("ideas-prompt-input")).toHaveValue(
      "Ideia capturada offline"
    );

    await context.setOffline(false);
    const onlineState = await page.evaluate(() => navigator.onLine);
    expect(onlineState).toBe(true);
    await page.reload();
    await expect(page.getByTestId("ideas-hub-root")).toBeVisible();

    expect(failedResponses).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
