#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const evalModulePath = path.join(
  repoRoot,
  "packages",
  "mastra-runtime",
  "dist",
  "evals",
  "trajectory-evals.js"
);

async function main() {
  const mod = await import(pathToFileURL(evalModulePath).href);
  if (typeof mod.runTrajectoryEvalSuite !== "function") {
    console.error(
      `[audit:trajectories] FAIL — runTrajectoryEvalSuite não exportada em ${evalModulePath}`
    );
    process.exit(1);
  }

  const report = await mod.runTrajectoryEvalSuite();
  console.log(
    `[audit:trajectories] Suíte: ${report.suiteName} | Total: ${report.totalCases} | Passaram: ${report.passedCases} | Falharam: ${report.failedCases}`
  );

  for (const res of report.results) {
    const statusLabel = res.passed ? "PASS" : "FAIL";
    const details = res.passed
      ? `required=${res.calledRequiredTools.length} order=${String(res.toolOrderRespected)} lock=${String(res.testLockRespected)} (${res.durationMs}ms)`
      : `motivos=[${res.failureReasons.join(" | ")}]`;
    console.log(
      `  [${statusLabel}] ${res.caseId} (${res.agentRole}) — ${details}`
    );
  }

  if (!report.passed) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(
    "[audit:trajectories] Erro ao executar suíte de trajetórias:",
    err instanceof Error ? err.message : String(err)
  );
  process.exit(1);
});
