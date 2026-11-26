import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Mastra } from "@mastra/core/mastra";
import { DEFAULT_PROJECT_STAGE_AUTOMATION } from "@uzina/contracts";
import { encryptSecret } from "@uzina/core";
import {
  clients,
  closeDb,
  deliverables,
  ensureDefaultOrgAndInternalClient,
  getDb,
  projectRepositories,
  projects,
  providerProfiles,
  type UzinaDb,
} from "@uzina/db";
import type { OpenCodeTransport, TransportRunInput } from "@uzina/opencode-bridge";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  createDeliverableLifecycleWorkflow,
  getMastraStorageSingleton,
  resetAgentControllerForTests,
  resetMastraStorageForTests,
  runEntropyAudit,
  runVisualA11yVerify,
  type VisualA11yViewportRunner,
} from "../src/index.js";

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function initGitRepoWithBranch(dir: string): void {
  execFileSync("git", ["init", "-b", "main"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Uzina S34"], {
    cwd: dir,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.email", "s34@uzina.studio"], {
    cwd: dir,
    stdio: "ignore",
  });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "s34-ui-demo", private: true }, null, 2),
    "utf8"
  );
  execFileSync("git", ["add", "."], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "chore: initial"], {
    cwd: dir,
    stdio: "ignore",
  });
}

describe("Slice 34 — Visual/A11y Runner, stageVerify Hook & Entropy Audit", () => {
  let db: UzinaDb;
  let organizationId: string;
  let internalClientId: string;
  const masterKey = crypto.randomBytes(32);

  beforeAll(async () => {
    resetAgentControllerForTests();
    resetMastraStorageForTests();
    const conn = await getDb({ dataDir: ":memory:" });
    db = conn.db;
    const seed = await ensureDefaultOrgAndInternalClient(db);
    organizationId = seed.organizationId;

    const [client] = await db
      .select()
      .from(clients)
      .where(eq(clients.organizationId, organizationId))
      .limit(1);
    internalClientId = client!.id;

    await db.insert(providerProfiles).values({
      organizationId,
      name: "Ollama S34",
      providerType: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      encryptedApiKey: encryptSecret({
        plaintext: "ollama-local",
        masterKey,
        organizationId,
        providerType: "ollama",
      }),
      isDefault: true,
      roleBindingsJson: {
        discovery: { modelId: "ollama/qwen2.5-coder:14b" },
        architect: { modelId: "ollama/qwen2.5-coder:14b" },
        visual: { modelId: "ollama/qwen2.5-coder:14b" },
        builder: { modelId: "ollama/qwen2.5-coder:14b" },
        verifier: { modelId: "ollama/qwen2.5-coder:14b" },
        security: { modelId: "ollama/qwen2.5-coder:14b" },
      },
    });
  });

  afterAll(async () => {
    resetMastraStorageForTests();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        fs.rmSync(dir, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 100,
        });
      }
    }
    await closeDb();
  });

  describe("runVisualA11yVerify (multi-viewport 1440x900 & 390x844)", () => {
    test.each([
      {
        label: "aprova quando ambos viewports não têm erros nem violações",
        runner: (async () => ({
          consoleErrors: [],
          horizontalOverflowPx: 0,
          axeViolations: [],
        })) satisfies VisualA11yViewportRunner,
        expectedStatus: "passed" as const,
        expectedExecuted: true,
      },
      {
        label: "reprova em violação axe critical/serious",
        runner: (async ({ viewport }) => ({
          consoleErrors: [],
          horizontalOverflowPx: 0,
          axeViolations:
            viewport.label === "390x844"
              ? [
                  {
                    id: "color-contrast",
                    impact: "serious" as const,
                    nodesCount: 2,
                    help: "Contraste insuficiente < 4.5:1",
                  },
                ]
              : [],
        })) satisfies VisualA11yViewportRunner,
        expectedStatus: "failed" as const,
        expectedExecuted: true,
      },
      {
        label: "reprova em overflow horizontal no mobile 390x844",
        runner: (async ({ viewport }) => ({
          consoleErrors: [],
          horizontalOverflowPx: viewport.label === "390x844" ? 24 : 0,
          axeViolations: [],
        })) satisfies VisualA11yViewportRunner,
        expectedStatus: "failed" as const,
        expectedExecuted: true,
      },
      {
        label: "reprova em erro de console no navegador",
        runner: (async () => ({
          consoleErrors: ["Uncaught TypeError: cannot read properties"],
          horizontalOverflowPx: 0,
          axeViolations: [],
        })) satisfies VisualA11yViewportRunner,
        expectedStatus: "failed" as const,
        expectedExecuted: true,
      },
    ])(
      "$label",
      async ({ runner, expectedStatus, expectedExecuted }) => {
        const seenViewports: string[] = [];
        const wrappedRunner: VisualA11yViewportRunner = async (params) => {
          seenViewports.push(params.viewport.label);
          return runner(params);
        };

        const report = await runVisualA11yVerify({
          previewUrl: "http://127.0.0.1:3000/app/finops",
          runner: wrappedRunner,
        });

        expect(seenViewports).toEqual(["1440x900", "390x844"]);
        expect(report.executed).toBe(expectedExecuted);
        expect(report.status).toBe(expectedStatus);
      }
    );

    test("degrada graciosamente para skipped_missing_binary quando sem previewUrl ou sem Playwright", async () => {
      const noUrlReport = await runVisualA11yVerify({});
      expect(noUrlReport.executed).toBe(false);
      expect(noUrlReport.status).toBe("skipped_missing_binary");
      expect(noUrlReport.viewports).toEqual(["1440x900", "390x844"]);
    });
  });

  describe("Hook visual:a11y no stageVerify do deliverable-lifecycle", () => {
    test("reprova stageVerify quando hasUi=true e runner A11y reporta violação critical", async () => {
      const repoDir = createTempDir("uzina-s34-repo-fail-");
      const wtRoot = createTempDir("uzina-s34-wt-fail-");
      initGitRepoWithBranch(repoDir);

      const suffix = crypto.randomUUID().slice(0, 6);
      const [proj] = await db
        .insert(projects)
        .values({
          clientId: internalClientId,
          name: `Proj A11y Fail ${suffix}`,
          slug: `proj-a11y-fail-${suffix}`,
          stageAutomationJson: {
            ...DEFAULT_PROJECT_STAGE_AUTOMATION,
            discovery: "auto",
            spec_review: "auto",
            visual_studio: "auto",
            contract_tests: "auto",
            building: "auto",
            verifying: "auto",
            decision_pending: "manual",
          },
        })
        .returning();

      const [repo] = await db
        .insert(projectRepositories)
        .values({
          projectId: proj!.id,
          name: "repo-a11y",
          localPath: repoDir,
          defaultBranch: "main",
          stackMetadataJson: { previewUrl: "http://127.0.0.1:3100" },
        })
        .returning();

      const [deliv] = await db
        .insert(deliverables)
        .values({
          projectId: proj!.id,
          repositoryId: repo!.id,
          title: "UI com violação WCAG",
          status: "contract_tests",
          hasUi: true,
          maxVerifyAttempts: 1,
          developmentStrategy: "frontend_first_msw",
          specMarkdown: "## Spec\nTela responsiva.",
        })
        .returning();

      const scriptedTransport: OpenCodeTransport = {
        async createSession(sessionInput) {
          return {
            sessionId: `s34-${crypto.randomUUID()}`,
            async run(runInput: TransportRunInput) {
              if (runInput.prompt.includes("stage_contract_and_tests")) {
                fs.mkdirSync(
                  path.join(sessionInput.workspacePath, "tests"),
                  { recursive: true }
                );
                fs.writeFileSync(
                  path.join(
                    sessionInput.workspacePath,
                    "tests",
                    "ui.test.ts"
                  ),
                  "import { expect, test } from 'vitest';\ntest('ui', () => { expect(1 + 1).toBe(2); });\n",
                  "utf8"
                );
              } else if (runInput.prompt.includes("stage_build")) {
                fs.mkdirSync(path.join(sessionInput.workspacePath, "src"), {
                  recursive: true,
                });
                fs.writeFileSync(
                  path.join(sessionInput.workspacePath, "src", "ui.ts"),
                  "export const label = 'ok';\n",
                  "utf8"
                );
              }
              return {
                finalText:
                  '{"verdict":"approved","summary":"ok","issues":[]}',
                structuredOutput: {
                  verdict: "approved",
                  summary: "ok",
                  issues: [],
                },
                tokenUsage: {
                  inputTokens: 100,
                  outputTokens: 40,
                  cacheReadTokens: 0,
                },
                turnsExecuted: 1,
                aborted: false,
              };
            },
            async abort() {
              return;
            },
            async close() {
              return;
            },
          };
        },
      };

      const storage = await getMastraStorageSingleton({ dataDir: ":memory:" });
      const workflow = createDeliverableLifecycleWorkflow({
        db,
        masterKey,
        worktreesRootDir: wtRoot,
        transportFactory: () => scriptedTransport,
        verifyRunner: async () => [
          { name: "typecheck", passed: true, durationMs: 5, summary: "ok" },
        ],
        visualA11yVerifyRunner: async () => ({
          consoleErrors: [],
          horizontalOverflowPx: 0,
          axeViolations: [
            {
              id: "button-name",
              impact: "critical",
              nodesCount: 1,
              help: "Botão sem texto acessível",
            },
          ],
        }),
        securityRunnerDeps: {
          scanRunner: async () => ({
            findings: [],
            scannersRun: ["semgrep"],
            skippedScanners: [],
          }),
        },
      });

      const mastra = new Mastra({
        storage,
        workflows: { deliverableLifecycle: workflow },
      });
      const wf = mastra.getWorkflow("deliverableLifecycle");
      const run = await wf.createRun({
        runId: crypto.randomUUID(),
        resourceId: organizationId,
      });

      await run.start({
        inputData: {
          deliverableId: deliv!.id,
          organizationId,
        },
        initialState: {
          deliverableId: deliv!.id,
          organizationId,
          projectId: proj!.id,
          hasUi: true,
          discoveryRound: 1,
          discoveryRounds: [],
          allAnswers: [],
          specMarkdown: "## Spec\nTela responsiva.",
          blueprint: null,
          designMdContent: null,
          worktreeHandle: null,
          contractTestFiles: [],
          stageHistory: [],
          stuckAttempts: 0,
          verifyAttempts: 0,
          maxVerifyAttempts: 1,
          verifyPassed: false,
          verifyChecks: [],
          testAuditPassed: false,
          testAuditViolationsCount: 0,
          lastSecurityScanId: null,
          securitySummary: null,
          verifierVerdict: null,
          verifierNotes: null,
          evidencePack: null,
          tokensInput: 0,
          tokensOutput: 0,
          cacheReadTokens: 0,
          estimatedCostUsd: 0,
          humanFeedback: null,
          rejected: false,
        },
      });

      const [stored] = await db
        .select()
        .from(deliverables)
        .where(eq(deliverables.id, deliv!.id));
      expect(stored?.status).toBe("failed");
      const evidence = stored?.evidencePackJson as {
        verifyChecks?: Array<{ name: string; passed: boolean; summary: string }>;
      } | null;
      const a11yCheck = evidence?.verifyChecks?.find(
        (c) => c.name === "visual:a11y"
      );
      expect(a11yCheck?.passed).toBe(false);
      expect(a11yCheck?.summary).toContain("button-name(critical)");
    });
  });

  describe("runEntropyAudit (worktrees órfãos, drift de specs, dead code & deps)", () => {
    test("detecta drift de spec, worktree órfão, dependência não usada e dead code ignorando entrypoints", async () => {
      const ws = createTempDir("uzina-s34-entropy-");
      initGitRepoWithBranch(ws);

      // 1. Worktree órfão em .worktrees/ (não associado a deliverable ativo)
      fs.mkdirSync(path.join(ws, ".worktrees", "task-orphan-99"), {
        recursive: true,
      });

      // 2. Spec citando arquivo inexistente vs existente
      fs.mkdirSync(path.join(ws, "docs", "slices"), { recursive: true });
      fs.mkdirSync(path.join(ws, "packages", "demo", "src"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(ws, "packages", "demo", "package.json"),
        JSON.stringify(
          {
            name: "@uzina/demo-entropy",
            dependencies: {
              zod: "4.6.7",
              "unused-lib": "1.0.0",
            },
          },
          null,
          2
        ),
        "utf8"
      );
      fs.writeFileSync(
        path.join(ws, "packages", "demo", "src", "index.ts"),
        'import { z } from "zod";\nexport const ENTRY_SCHEMA = z.string();\n',
        "utf8"
      );
      fs.writeFileSync(
        path.join(ws, "packages", "demo", "src", "helpers.ts"),
        "export function unusedDeadHelper(x: number): number { return x + 1; }\n",
        "utf8"
      );
      fs.writeFileSync(
        path.join(ws, "docs", "slices", "slice-99.md"),
        [
          "# Slice 99",
          "Usa `packages/demo/src/helpers.ts` e `packages/demo/src/deleted-file.ts`.",
        ].join("\n"),
        "utf8"
      );

      const suffix = crypto.randomUUID().slice(0, 6);
      const [proj] = await db
        .insert(projects)
        .values({
          clientId: internalClientId,
          name: `Proj Entropy ${suffix}`,
          slug: `proj-entropy-${suffix}`,
        })
        .returning();

      const report = await runEntropyAudit({
        workspaceRoot: ws,
        db,
        organizationId,
        projectId: proj!.id,
      });

      expect(
        report.orphanWorktrees.some((w) =>
          w.workspacePath.includes("task-orphan-99")
        )
      ).toBe(true);
      expect(report.docSpecDrifts).toHaveLength(1);
      expect(report.docSpecDrifts[0]?.missingTarget).toBe(
        "packages/demo/src/deleted-file.ts"
      );
      expect(
        report.deadCodeCandidates.some((c) => c.symbol === "unusedDeadHelper")
      ).toBe(true);
      expect(
        report.deadCodeCandidates.some((c) => c.symbol === "ENTRY_SCHEMA")
      ).toBe(false);
      expect(report.unusedDependencies).toEqual([
        {
          packageName: "@uzina/demo-entropy",
          dependencyName: "unused-lib",
        },
      ]);
    });
  });
});
