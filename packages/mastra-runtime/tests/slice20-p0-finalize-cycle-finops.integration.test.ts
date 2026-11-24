import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { encryptSecret } from "@uzina/core";
import {
  closeDb,
  decisions,
  deliverables,
  ensureDefaultOrgAndInternalClient,
  getDb,
  projectRepositories,
  projects,
  providerProfiles,
  type UzinaDb,
} from "@uzina/db";
import type {
  OpenCodeTransport,
  TransportRunInput,
  TransportSessionHandle,
} from "@uzina/opencode-bridge";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  createMastraRuntime,
  getFinopsSummaryScoped,
  resetAgentControllerForTests,
  resetControllerProjectCostsForTests,
  resetMastraStorageForTests,
} from "../src/index.js";

function initBrownfieldGitRepo(): string {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-s20-git-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Uzina Slice20"], {
    cwd: repoDir,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.email", "s20@uzina.studio"], {
    cwd: repoDir,
    stdio: "ignore",
  });
  fs.writeFileSync(
    path.join(repoDir, "package.json"),
    JSON.stringify({ name: "s20-demo", private: true }, null, 2),
    "utf8"
  );
  fs.writeFileSync(
    path.join(repoDir, "AGENTS.md"),
    "# S20 Demo\nUse strict checks.\n",
    "utf8"
  );
  execFileSync("git", ["add", "."], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "chore: initial"], {
    cwd: repoDir,
    stdio: "ignore",
  });
  // Arquivo untracked simulando .env local (NAO deve bloquear local_merge!)
  fs.writeFileSync(path.join(repoDir, ".env"), "FAKE_SECRET=1234\n", "utf8");
  return repoDir;
}

function createCodingScriptedTransport(params?: {
  tokensInput?: number;
  tokensOutput?: number;
}): OpenCodeTransport {
  return {
    async createSession(sessionInput) {
      let aborted = false;
      return {
        sessionId: `s20-${crypto.randomUUID()}`,
        async run(runInput: TransportRunInput) {
          if (aborted || runInput.signal?.aborted) {
            return {
              finalText: "",
              tokenUsage: {
                inputTokens: 0,
                outputTokens: 0,
                cacheReadTokens: 0,
              },
              turnsExecuted: 0,
              aborted: true,
            };
          }

          if (runInput.prompt.includes("stage_contract_and_tests")) {
            fs.mkdirSync(path.join(sessionInput.workspacePath, "tests"), {
              recursive: true,
            });
            fs.writeFileSync(
              path.join(sessionInput.workspacePath, "tests", "calc.test.ts"),
              "import { expect, test } from 'vitest';\ntest('calc', () => { expect(1 + 1).toBe(2); });\n",
              "utf8"
            );
          } else if (runInput.prompt.includes("stage_build")) {
            fs.mkdirSync(path.join(sessionInput.workspacePath, "src"), {
              recursive: true,
            });
            fs.writeFileSync(
              path.join(sessionInput.workspacePath, "src", "calc.ts"),
              "export const soma = (a: number, b: number) => a + b;\n",
              "utf8"
            );
          }

          const isVerifier =
            sessionInput.mode === "plan" ||
            runInput.prompt.includes("Verifier independente");
          return {
            finalText: isVerifier
              ? '{"verdict":"approved","summary":"Implementação validada.","issues":[]}'
              : "ok",
            structuredOutput: isVerifier
              ? {
                  verdict: "approved",
                  summary: "Implementação validada.",
                  issues: [],
                }
              : undefined,
            tokenUsage: {
              inputTokens: params?.tokensInput ?? 1500,
              outputTokens: params?.tokensOutput ?? 500,
              cacheReadTokens: 0,
            },
            turnsExecuted: 1,
            aborted: false,
          };
        },
        async abort() {
          aborted = true;
        },
        async close() {
          return;
        },
      } satisfies TransportSessionHandle;
    },
  };
}

describe("Slice 20 — P0 Finalize Git, Cycle Autônomo, Budget Tokens & FinOps LLM", () => {
  let db: UzinaDb;
  let organizationId: string;
  let internalClientId: string;
  const masterKey = crypto.randomBytes(32);
  const tempDirs: string[] = [];

  beforeAll(async () => {
    await resetAgentControllerForTests();
    resetControllerProjectCostsForTests();
    await resetMastraStorageForTests();
    await closeDb();
    const conn = await getDb({ dataDir: ":memory:" });
    db = conn.db;
    const seed = await ensureDefaultOrgAndInternalClient(db);
    organizationId = seed.organizationId;
    internalClientId = seed.internalClientId;

    await db.insert(providerProfiles).values({
      organizationId,
      name: "OmniRouter S20",
      providerType: "omniroute",
      baseUrl: "https://omnirouter.example.com/v1",
      encryptedApiKey: encryptSecret({
        plaintext: "sk-s20-dummy-key-123456",
        masterKey,
        organizationId,
        providerType: "omniroute",
      }),
      keyPreview: "sk-s...3456",
      roleBindingsJson: {
        builder: { modelId: "omni-fast" },
        verifier: { modelId: "omni-fast" },
      },
      customPricingJson: {},
      isDefault: true,
    });
  });

  afterAll(async () => {
    await resetAgentControllerForTests();
    resetControllerProjectCostsForTests();
    await resetMastraStorageForTests();
    await closeDb();
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("local_merge mescla commit real em main mesmo com .env untracked e getFinopsSummaryScoped contabiliza LLM + customPricing", async () => {
    const repoDir = initBrownfieldGitRepo();
    tempDirs.push(repoDir);
    const initialSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoDir,
      encoding: "utf8",
    }).trim();

    // Atualiza customPricing para omni-fast
    await db
      .update(providerProfiles)
      .set({
        customPricingJson: {
          "omni-fast": {
            inputPer1MUsd: 1.0,
            outputPer1MUsd: 2.0,
          },
        },
      })
      .where(eq(providerProfiles.organizationId, organizationId));

    const suffix = crypto.randomUUID().slice(0, 8);
    const [proj] = await db
      .insert(projects)
      .values({
        clientId: internalClientId,
        name: `Proj Merge ${suffix}`,
        slug: `proj-merge-${suffix}`,
        finalizePolicy: "local_merge",
        stageAutomationJson: {
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
        name: "s20-demo",
        localPath: repoDir,
        defaultBranch: "main",
      })
      .returning();

    const [deliv] = await db
      .insert(deliverables)
      .values({
        projectId: proj!.id,
        repositoryId: repo!.id,
        title: "Função soma em src/calc.ts",
        description: "Implementar soma.",
        status: "contract_tests",
        hasUi: false,
        developmentStrategy: "api_contract_first",
        specMarkdown: "# Spec\nCriar `soma`.",
      })
      .returning();

    const runtime = await createMastraRuntime({
      db,
      dataDir: ":memory:",
      masterKey,
      transportFactory: () =>
        createCodingScriptedTransport({ tokensInput: 100_000, tokensOutput: 50_000 }),
      verifyRunner: async ({ attemptNumber }) => [
        {
          name: "vitest",
          passed: true,
          durationMs: 12,
          summary: `Attempt ${attemptNumber} OK`,
        },
      ],
    });

    try {
      const startState = await runtime.startDeliverableWorkflow({
        deliverableId: deliv!.id,
        organizationId,
        input: {},
      });
      expect(startState.deliverableStatus).toBe("decision_pending");

      const [pendingDec] = await db
        .select()
        .from(decisions)
        .where(eq(decisions.deliverableId, deliv!.id));
      expect(pendingDec?.status).toBe("pending");

      const resolved = await runtime.resolveDecision({
        decisionId: pendingDec!.id,
        organizationId,
        actorRole: "owner",
        input: { status: "approved" },
      });
      expect(resolved.workflowState?.deliverableStatus).toBe("merged");

      const mainAfterSha = execFileSync("git", ["rev-parse", "main"], {
        cwd: repoDir,
        encoding: "utf8",
      }).trim();
      expect(mainAfterSha).not.toBe(initialSha);
      expect(fs.existsSync(path.join(repoDir, "src", "calc.ts"))).toBe(true);

      const excludePath = path.join(repoDir, ".git", "info", "exclude");
      expect(fs.readFileSync(excludePath, "utf8")).toContain("/.worktrees/");

      const [finalDeliv] = await db
        .select()
        .from(deliverables)
        .where(eq(deliverables.id, deliv!.id));
      expect(finalDeliv?.evidencePackJson).toMatchObject({
        finalizeInfo: {
          mode: "local_merge",
          commitSha: mainAfterSha,
        },
      });

      const finops = await getFinopsSummaryScoped(db, {
        organizationId,
        query: { projectId: proj!.id },
      });
      expect(finops.totalLlmTokens).toBeGreaterThanOrEqual(300_000);
      expect(finops.totalLlmCostUsd).toBeGreaterThan(0);
      expect(finops.recentLlmCalls.length).toBeGreaterThanOrEqual(2);
      expect(finops.recentLlmCalls[0]?.modelId).toBe("omni-fast");
    } finally {
      await runtime.close();
      await db
        .update(providerProfiles)
        .set({ customPricingJson: {} })
        .where(eq(providerProfiles.organizationId, organizationId));
    }
  });

  test("branch_only preserva main, mergeDeliverableBranch bloqueia antes de approved (409) e mescla após approved", async () => {
    const repoDir = initBrownfieldGitRepo();
    tempDirs.push(repoDir);
    const initialSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoDir,
      encoding: "utf8",
    }).trim();

    const suffix = crypto.randomUUID().slice(0, 8);
    const [proj] = await db
      .insert(projects)
      .values({
        clientId: internalClientId,
        name: `Proj BranchOnly ${suffix}`,
        slug: `proj-branch-${suffix}`,
        finalizePolicy: "branch_only",
        stageAutomationJson: {
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
        name: "s20-branch",
        localPath: repoDir,
        defaultBranch: "main",
      })
      .returning();

    const [deliv] = await db
      .insert(deliverables)
      .values({
        projectId: proj!.id,
        repositoryId: repo!.id,
        title: "Entrega somente branch",
        status: "contract_tests",
        hasUi: false,
        developmentStrategy: "api_contract_first",
        specMarkdown: "# Spec",
      })
      .returning();

    const runtime = await createMastraRuntime({
      db,
      dataDir: ":memory:",
      masterKey,
      transportFactory: () => createCodingScriptedTransport(),
      verifyRunner: async () => [
        { name: "vitest", passed: true, durationMs: 5, summary: "OK" },
      ],
    });

    try {
      await runtime.startDeliverableWorkflow({
        deliverableId: deliv!.id,
        organizationId,
        input: {},
      });

      // Antes da aprovação HITL, merge manual deve ser bloqueado (409)
      await expect(
        runtime.mergeDeliverableBranch({
          deliverableId: deliv!.id,
          organizationId,
        })
      ).rejects.toMatchObject({ statusCode: 409 });

      const [pendingDec] = await db
        .select()
        .from(decisions)
        .where(eq(decisions.deliverableId, deliv!.id));

      await runtime.resolveDecision({
        decisionId: pendingDec!.id,
        organizationId,
        actorRole: "owner",
        input: { status: "approved" },
      });

      // main continua intacta pois finalizePolicy === "branch_only"
      const shaAfterApprove = execFileSync("git", ["rev-parse", "main"], {
        cwd: repoDir,
        encoding: "utf8",
      }).trim();
      expect(shaAfterApprove).toBe(initialSha);

      // Simula working tree suja (arquivo rastreado modificado) bloqueando merge local
      fs.writeFileSync(
        path.join(repoDir, "AGENTS.md"),
        "# Modified tracked file\n",
        "utf8"
      );
      const blockedMerge = await runtime.mergeDeliverableBranch({
        deliverableId: deliv!.id,
        organizationId,
      });
      expect(blockedMerge.ok).toBe(false);
      expect(blockedMerge.mode).toBe("local_branch_ready");
      expect(blockedMerge.message).toContain("suja");
      execFileSync("git", ["checkout", "--", "AGENTS.md"], {
        cwd: repoDir,
        stdio: "ignore",
      });

      // Agora repositório limpo: operador solicita merge sob demanda via service/API
      const manualMerge = await runtime.mergeDeliverableBranch({
        deliverableId: deliv!.id,
        organizationId,
      });
      expect(manualMerge.ok).toBe(true);
      expect(manualMerge.mode).toBe("local_merge");

      const shaAfterManualMerge = execFileSync("git", ["rev-parse", "main"], {
        cwd: repoDir,
        encoding: "utf8",
      }).trim();
      expect(shaAfterManualMerge).not.toBe(initialSha);
      expect(fs.existsSync(path.join(repoDir, "src", "calc.ts"))).toBe(true);
    } finally {
      await runtime.close();
    }
  });

  test("budgetCapTokens pausa execução mesmo com custo USD=0, cleanupDeliverableWorktree limpa órfão e runProjectAutonomousCycle evita duplicidade", async () => {
    const repoDir = initBrownfieldGitRepo();
    tempDirs.push(repoDir);

    const suffix = crypto.randomUUID().slice(0, 8);
    const [proj] = await db
      .insert(projects)
      .values({
        clientId: internalClientId,
        name: `Proj TokenCap ${suffix}`,
        slug: `proj-tokcap-${suffix}`,
        budgetCapTokens: 1500, // menor que os 2000 tokens de 1 turno
        stageAutomationJson: {
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
        name: "s20-tokcap",
        localPath: repoDir,
        defaultBranch: "main",
      })
      .returning();

    const [deliv] = await db
      .insert(deliverables)
      .values({
        projectId: proj!.id,
        repositoryId: repo!.id,
        title: "Entrega estoura tokens",
        status: "contract_tests",
        hasUi: false,
        developmentStrategy: "api_contract_first",
        specMarkdown: "# Spec",
      })
      .returning();

    const runtime = await createMastraRuntime({
      db,
      dataDir: ":memory:",
      masterKey,
      transportFactory: () =>
        createCodingScriptedTransport({ tokensInput: 1200, tokensOutput: 800 }),
    });

    try {
      const cycleRes1 = await runtime.runProjectAutonomousCycle({
        projectId: proj!.id,
        organizationId,
      });
      expect(cycleRes1.dispatched).toBe(true);
      expect(cycleRes1.alreadyRunning).toBe(false);
      expect(cycleRes1.deliverableId).toBe(deliv!.id);

      // 2a chamada imediata deve detectar task ativa sem duplicar
      const cycleRes2 = await runtime.runProjectAutonomousCycle({
        projectId: proj!.id,
        organizationId,
      });
      expect(cycleRes2.dispatched).toBe(false);
      expect(cycleRes2.alreadyRunning).toBe(true);

      // Tentativa de limpar worktree durante execução ativa deve retornar 409
      await expect(
        runtime.cleanupDeliverableWorktree({
          deliverableId: deliv!.id,
          organizationId,
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        code: "WORKFLOW_ALREADY_RUNNING",
      });

      await runtime.backgroundTasks.waitForIdle();

      const finopsZeroCost = await getFinopsSummaryScoped(db, {
        organizationId,
        query: { projectId: proj!.id },
      });
      expect(finopsZeroCost.totalLlmCostUsd).toBe(0);
      expect(finopsZeroCost.totalLlmTokens).toBeGreaterThanOrEqual(2000);

      const [pausedRow] = await db
        .select()
        .from(deliverables)
        .where(eq(deliverables.id, deliv!.id));
      expect(pausedRow?.status).toBe("paused");
      expect(pausedRow?.worktreePath).toBeTruthy();

      const [capDec] = await db
        .select()
        .from(decisions)
        .where(eq(decisions.deliverableId, deliv!.id));
      expect(capDec?.decisionType).toBe("budget_cap_pause");
      expect(capDec?.summary).toContain("tokens");

      const wtPath = pausedRow!.worktreePath!;
      expect(fs.existsSync(wtPath)).toBe(true);

      const cleanRes = await runtime.cleanupDeliverableWorktree({
        deliverableId: deliv!.id,
        organizationId,
      });
      expect(cleanRes.cleaned).toBe(true);
      expect(fs.existsSync(wtPath)).toBe(false);

      const [afterClean] = await db
        .select()
        .from(deliverables)
        .where(eq(deliverables.id, deliv!.id));
      expect(afterClean?.worktreePath).toBeNull();
    } finally {
      await runtime.close();
    }
  });
});
