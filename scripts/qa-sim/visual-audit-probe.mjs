import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(
  path.resolve(process.cwd(), "apps/web/package.json")
);
const { chromium } = require("@playwright/test");

const BASE_URL = process.argv[2] ?? "http://127.0.0.1:3050";
const SCREENSHOT_DIR =
  process.argv[3] ??
  "C:\\Users\\gamam\\.gemini\\antigravity\\brain\\b6e0762f-92c3-4891-8bde-5e1cf56b72e4";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  const failedResponses = [];

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

  // 1. Signup no ambiente Live Postgres (porta 3050)
  await page.goto(`${BASE_URL}/login`);
  await page.getByTestId("tab-signup").click();
  const suffix = Date.now();
  await page.getByPlaceholder("Ex.: Matheus Gama").fill("Auditor Visual Live");
  await page
    .getByPlaceholder("operador@uzina.studio")
    .fill(`visual-live-${suffix}@uzina.local`);
  await page.getByPlaceholder("••••••••").fill("UzinaVisual123!");
  await page.getByTestId("auth-submit").click();
  await page.waitForURL("**/app**");

  // Cria projeto para testar Chat, Estúdio, Entregas, etc.
  await page.getByTestId("btn-new-project").click();
  await page
    .getByPlaceholder("Ex.: Cockpit Operacional")
    .fill(`Clinica VidaPlena Visual ${suffix}`);
  await page.getByTestId("submit-project").click();
  await page.waitForURL("**/app?projectId=**");
  await page.getByTestId("agency-chat-input").waitFor({ state: "visible" });

  // Verifica comportamento de /exec
  await page.goto(`${BASE_URL}/exec`);
  const execFinalUrl = page.url();

  // Volta ao /app para medir escalas A-, A, A+ em 1440x900
  await page.goto(`${BASE_URL}/app`);
  await page.getByTestId("agency-chat-input").waitFor({ state: "visible" });

  const fontScaleMetrics = {};
  for (const scale of ["compact", "comfortable", "large"]) {
    await page.getByTestId(`font-scale-${scale}`).click();
    const metrics = await page.evaluate(() => {
      const submitBtn = document.querySelector(
        '[data-testid="agency-chat-submit"]'
      );
      const rect = submitBtn ? submitBtn.getBoundingClientRect() : null;
      return {
        overflowX: document.documentElement.scrollWidth > window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        submitBottomY: rect ? Math.round(rect.y + rect.height) : null,
        submitFitsFirstFold900: rect ? rect.y + rect.height <= 900 : false,
      };
    });
    fontScaleMetrics[scale] = metrics;
    if (scale === "large") {
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "qa-desktop-aplus-app.png"),
      });
    }
  }
  await page.getByTestId("font-scale-comfortable").click();

  // Screenshot 1: Desktop Dark /app
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, "qa-desktop-dark-app.png"),
  });

  // Testa Cmd+K e Escape
  await page.keyboard.press("Control+k");
  const paletteVisible = await page
    .getByRole("dialog")
    .isVisible()
    .catch(() => false);
  await page.keyboard.press("Escape");

  // Gera protótipo no Estúdio para screenshot e verificação
  await page.goto(`${BASE_URL}/app/studio`);
  const genBtn = page.getByTestId("btn-generate-initial-prototype");
  const protoFrame = page.getByTestId("visual-prototype-frame");
  await genBtn.or(protoFrame).waitFor({ state: "visible", timeout: 15_000 });
  if (await genBtn.isVisible()) {
    await genBtn.click();
    await protoFrame.waitFor({ state: "visible", timeout: 15_000 });
  }
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, "qa-studio-preview.png"),
  });

  // Varrer todas as rotas em Desktop Dark, Tablet 768x1024 e Mobile 390x844
  const routes = [
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
    "/offline",
  ];

  const routeAudit = [];
  for (const route of routes) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE_URL}${route}`);
    await page.waitForLoadState("networkidle").catch(() => undefined);

    const desktopDark = await page.evaluate(() => {
      const accentBtns = Array.from(document.querySelectorAll("button, a")).filter(
        (el) => {
          const cls = el.className || "";
          return typeof cls === "string" && cls.includes("bg-accent") && el.getBoundingClientRect().width > 0;
        }
      );
      const bodyFontSize = Number.parseFloat(
        getComputedStyle(document.body).fontSize || "14"
      );
      const tabularCount = document.querySelectorAll(".tabular-nums").length;
      return {
        overflowX: document.documentElement.scrollWidth > window.innerWidth,
        accentCtaCount: accentBtns.length,
        bodyFontSize,
        tabularCount,
      };
    });

    await page.setViewportSize({ width: 768, height: 1024 });
    const tabletOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );

    routeAudit.push({
      route,
      desktopDark,
      tabletOverflow,
      mobileOverflow,
    });
  }

  // Screenshot Mobile 390px + Bottom Sheet "Mais"
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/app`);
  await page.getByTestId("mobile-bottom-more-btn").click();
  await page.getByTestId("mobile-more-sheet").waitFor({ state: "visible" });
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, "qa-mobile-390-sheet.png"),
  });
  await page.keyboard.press("Escape");

  // Screenshot Desktop Light /app/finops
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE_URL}/app/finops`);
  await page.getByTestId("theme-toggle").click();
  const activeTheme = await page.evaluate(
    () => document.documentElement.dataset.theme ?? "dark"
  );
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, "qa-desktop-light-finops.png"),
  });

  const outSummary = {
    execFinalUrl,
    paletteVisible,
    activeThemeAfterToggle: activeTheme,
    fontScaleMetrics,
    routeAudit,
    consoleErrors,
    pageErrors,
    failedResponses,
  };

  const outJsonPath = path.join(SCREENSHOT_DIR, "scratch", "visual-audit.json");
  fs.mkdirSync(path.dirname(outJsonPath), { recursive: true });
  fs.writeFileSync(outJsonPath, JSON.stringify(outSummary, null, 2), "utf8");
  console.log(JSON.stringify(outSummary, null, 2));

  await browser.close();
}

run();
