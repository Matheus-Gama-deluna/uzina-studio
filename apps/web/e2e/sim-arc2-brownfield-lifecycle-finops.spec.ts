import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

function runSeedLegacyPay(targetDir: string): {
  outDir: string;
  gabarito: { expectedQmd: { query: string } };
} {
  const scriptPath = path.resolve(
    process.cwd(),
    "../../scripts/qa-sim/seed-legacypay-fixture.mjs"
  );
  execFileSync("node", [scriptPath, "--out", targetDir], { stdio: "pipe" });
  const gabaritoRaw = fs.readFileSync(
    path.join(targetDir, "gabarito.json"),
    "utf8"
  );
  return {
    outDir: targetDir,
    gabarito: JSON.parse(gabaritoRaw) as { expectedQmd: { query: string } },
  };
}

async function signUpTechLead(page: import("@playwright/test").Page) {
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
  await page.getByPlaceholder("Ex.: Matheus Gama").fill("Tech Lead Brownfield");
  await page
    .getByPlaceholder("operador@uzina.studio")
    .fill(`techlead-${suffix}@uzina.local`);
  await page.getByPlaceholder("••••••••").fill("UzinaBrownfield123!");
  await page.getByTestId("auth-submit").click();
  await page.waitForURL("**/app**");

  return { consoleErrors, pageErrors, failedResponses, suffix };
}

test.describe("Simulação Arco 2 — Brownfield Poliglota, AST, QMD, FinOps & Tool Policies", () => {
  test("indexa LegacyPay (TS/PY/SQL), consulta AST e QMD, e persiste políticas granulares em FinOps", async ({
    page,
  }) => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "uzina-e2e-legacypay-")
    );
    const { outDir, gabarito } = runSeedLegacyPay(tempRoot);

    try {
      const { consoleErrors, pageErrors, failedResponses, suffix } =
        await signUpTechLead(page);

      // Cria projeto Brownfield ligado ao repositório LegacyPay real via sessão autenticada
      const created = await page.evaluate(
        async ({ repoPath, projName }) => {
          const clientsRes = await fetch("/api/clients");
          const clientsData = (await clientsRes.json()) as {
            items: Array<{ id: string }>;
          };
          const clientId = clientsData.items[0]!.id;

          const projRes = await fetch("/api/projects", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              clientId,
              name: projName,
              description: "Simulação E2E Brownfield TS + Python + SQL",
              defaultDevelopmentStrategy: "domain_first",
              repository: {
                name: "legacypay-gateway",
                localPath: repoPath,
                defaultBranch: "main",
              },
            }),
          });
          const projData = (await projRes.json()) as {
            id: string;
            repositories: Array<{ id: string }>;
          };
          return {
            status: projRes.status,
            projectId: projData.id,
            repositoryId: projData.repositories[0]!.id,
          };
        },
        { repoPath: outDir, projName: `LegacyPay E2E ${suffix}` }
      );
      expect(created.status).toBe(201);

      // 1. Navega para Mapa do Código AST e dispara indexação poliglota
      await page.goto(`/app/projects/${created.projectId}/code`);
      await expect(page.getByTestId("project-codebase-root")).toBeVisible();
      await page.getByTestId("codebase-reindex-btn").click();
      await expect(
        page.getByText("processPaymentCapture").first()
      ).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("settle_batch").first()).toBeVisible();
      await expect(page.getByText("merchant_accounts").first()).toBeVisible();

      // 2. Reindexa QMD explicitamente com projectId (achado P1: o botão UI em memories-manager.tsx:233
      //    não envia projectId ao /api/qmd/reindex) e valida a busca híbrida na UI /app/memories
      const qmdReindexStatus = await page.evaluate(async (pid) => {
        const res = await fetch("/api/qmd/reindex", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId: pid, includeDocs: true, force: true }),
        });
        return res.status;
      }, created.projectId);
      expect(qmdReindexStatus).toBe(200);

      await page.goto(`/app/memories?projectId=${created.projectId}`);
      await expect(page.getByTestId("qmd-search-input")).toBeVisible();
      await page
        .getByTestId("qmd-search-input")
        .fill(gabarito.expectedQmd.query);
      await page.getByTestId("qmd-search-submit").click();
      await expect(page.getByTestId("qmd-hit-card").first()).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByTestId("qmd-hit-card").first()).toContainText(
        /Idempotência|adr-010/i
      );

      // 3. Navega para FinOps & Motores, altera toolPolicies e confirma persistência após reload
      await page.goto("/app/finops");
      await expect(page.getByTestId("engine-config-panel")).toBeVisible();
      await page.getByTestId("tool-policy-gitFinalize").selectOption("ask");
      await page.getByTestId("engine-config-save-btn").click();
      await page.reload();
      await expect(page.getByTestId("tool-policy-gitFinalize")).toHaveValue(
        "ask"
      );

      // 4. Navega para Entregas & Docs do projeto Brownfield, cria entregável pela UI e valida inspetor
      await page.goto(`/app/deliverables?projectId=${created.projectId}`);
      await expect(page.getByTestId("deliverables-docs-hub")).toBeVisible();
      await page.getByTestId("btn-new-deliverable").click();
      await page
        .getByPlaceholder("Ex.: Painel de Auditoria AppSec")
        .fill(`Blindar SQL LegacyPay ${suffix}`);
      await page.getByTestId("submit-deliverable").click();
      await expect(
        page.getByText(`Blindar SQL LegacyPay ${suffix}`).first()
      ).toBeVisible({ timeout: 15_000 });
      await page.getByText(`Blindar SQL LegacyPay ${suffix}`).first().click();
      await expect(page.getByTestId("slice-artifact-inspector")).toBeVisible();
      await expect(page.getByTestId("worktrees-governance-panel")).toBeVisible();

      expect(failedResponses).toEqual([]);
      expect(consoleErrors).toEqual([]);
      expect(pageErrors).toEqual([]);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
