import { expect, test } from "@playwright/test";

async function signUpMobileAndDesktop(page: import("@playwright/test").Page) {
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

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  await page.getByPlaceholder("Ex.: Matheus Gama").fill("Mobile PWA E2E");
  await page
    .getByPlaceholder("operador@uzina.studio")
    .fill(`mobile-${suffix}@uzina.local`);
  await page.getByPlaceholder("••••••••").fill("UzinaMobile123!");
  await page.getByTestId("auth-submit").click();
  await page.waitForURL("**/app**");

  return { consoleErrors, pageErrors, failedResponses, suffix };
}

test.describe("Slices 36–38 — PWA, Bottom Tab Bar 390px, Voz & Notificações", () => {
  test("valida manifest, sw.js, navegação mobile sem overflow, controles de voz e configurações", async ({
    page,
    request,
  }) => {
    // 1. Manifest e Service Worker servindo corretamente
    const manifestRes = await request.get("/manifest.webmanifest");
    expect(manifestRes.status()).toBe(200);
    const manifestJson = (await manifestRes.json()) as {
      display?: string;
      short_name?: string;
      share_target?: { action?: string };
    };
    expect(manifestJson.display).toBe("standalone");
    expect(manifestJson.short_name).toBe("Uzina");
    expect(manifestJson.share_target?.action).toBe("/api/share");

    const swRes = await request.get("/sw.js");
    expect(swRes.status()).toBe(200);
    expect(swRes.headers()["cache-control"]).toContain("no-cache");

    // 2. Autentica no fluxo real e valida Desktop (1440x900)
    const { consoleErrors, pageErrors, failedResponses, suffix } =
      await signUpMobileAndDesktop(page);

    await expect(page.getByTestId("mobile-bottom-nav")).toBeHidden();
    await expect(page.getByTestId("notifications-bell-btn")).toBeVisible();

    // Cria projeto para exibir Chat da Engenharia com controles de voz
    await page.getByTestId("btn-new-project").click();
    await page
      .getByPlaceholder("Ex.: Cockpit Operacional")
      .fill(`App Voz ${suffix}`);
    await page.getByTestId("submit-project").click();
    await page.waitForURL("**/app?projectId=**");

    await expect(page.getByTestId("voice-mic-btn")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("voice-mode-toggle")).toBeVisible();

    // 3. Alterna para Mobile 390x844 e valida Bottom Tab Bar + zero overflow
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId("mobile-bottom-nav")).toBeVisible();

    const chatOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    );
    expect(chatOverflow).toBe(true);

    // Abre Bottom Sheet "Mais"
    await page.getByTestId("mobile-bottom-more-btn").click();
    await expect(page.getByTestId("mobile-more-sheet")).toBeVisible();

    // Navega para /app/settings via sheet
    await page
      .getByTestId("mobile-more-sheet")
      .getByRole("link", { name: "Celular & Alertas" })
      .click();
    await page.waitForURL("**/app/settings**");
    await expect(page.getByTestId("btn-enable-web-push")).toBeVisible();
    await expect(page.getByTestId("quiet-hours-toggle")).toBeVisible();

    // Dispara notificação de teste, verifica badge no Sino, abre drawer mobile e marca como lida
    await page.getByTestId("btn-test-notification").click();
    await expect(page.getByTestId("notifications-unread-badge")).toBeVisible({
      timeout: 10_000,
    });
    await page.getByTestId("notifications-bell-btn").click();
    await expect(page.getByTestId("notifications-mobile-sheet")).toBeVisible();
    await page.getByTestId("notifications-mark-all-read").click();
    await expect(page.getByTestId("notifications-unread-badge")).toBeHidden({
      timeout: 10_000,
    });
    await page
      .getByTestId("notifications-mobile-sheet")
      .getByRole("button", { name: "Fechar Central de Notificações" })
      .click();

    // Ativa Quiet Hours, salva e verifica persistência após reload
    await page.getByTestId("quiet-hours-toggle").check();
    await page.getByTestId("btn-save-notification-prefs").click();
    await page.reload();
    await expect(page.getByTestId("quiet-hours-toggle")).toBeChecked();

    const settingsOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    );
    expect(settingsOverflow).toBe(true);

    // Verifica página de Ideias em 390px com controles de voz
    await page.goto("/app/ideas");
    await expect(page.getByTestId("voice-mic-btn")).toBeVisible();
    const ideasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    );
    expect(ideasOverflow).toBe(true);

    // Verifica página de Provedores com presets de Voz
    await page.goto("/app/providers");
    await expect(page.getByTestId("preset-voice-groq")).toBeVisible();
    await expect(page.getByTestId("preset-voice-kokoro")).toBeVisible();

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(failedResponses).toEqual([]);
  });
});
