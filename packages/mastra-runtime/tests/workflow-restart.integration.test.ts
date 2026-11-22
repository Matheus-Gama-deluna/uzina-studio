import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { encryptSecret } from "@uzina/core";
import {
  acquireDeliverableLock,
  clients,
  closeDb,
  deliverables,
  designAssets,
  ensureDefaultOrgAndInternalClient,
  getDb,
  organizations,
  projectRepositories,
  projects,
  providerProfiles,
  releaseDeliverableLock,
  type UzinaDb,
} from "@uzina/db";
import {
  LocalGitWorktreeWorkspace,
  type OpenCodeTransport,
  type TransportCreateSessionInput,
  type TransportRunInput,
  type TransportSessionHandle,
} from "@uzina/opencode-bridge";
import {
  InMemoryOpenCodeTransport,
  type InMemoryOpenCodeTransportOptions,
} from "@uzina/opencode-bridge/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  createMastraRuntime,
  resetMastraStorageForTests,
  WorkflowRuntimeError,
} from "../src/index.js";

function createDynamicInMemoryTransport(
  resolver: (
    runInput: TransportRunInput,
    sessionInput: TransportCreateSessionInput
  ) => InMemoryOpenCodeTransportOptions
): OpenCodeTransport {
  return {
    async createSession(
      sessionInput: TransportCreateSessionInput
    ): Promise<TransportSessionHandle> {
      let innerHandle: TransportSessionHandle | null = null;
      return {
        sessionId: `dyn-${crypto.randomUUID()}`,
        async run(runInput) {
          const inner = new InMemoryOpenCodeTransport(
            resolver(runInput, sessionInput)
          );
          innerHandle = await inner.createSession(sessionInput);
          return innerHandle.run(runInput);
        },
        async abort() {
          await innerHandle?.abort();
        },
        async close() {
          await innerHandle?.close();
        },
      };
    },
  };
}

function initTempGitRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-wf-git-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: dir, windowsHide: true });
  execFileSync("git", ["config", "user.email", "uzina-test@example.com"], {
    cwd: dir,
    windowsHide: true,
  });
  execFileSync("git", ["config", "user.name", "Uzina Test"], {
    cwd: dir,
    windowsHide: true,
  });
  fs.mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true });
  fs.mkdirSync(path.join(dir, "tests"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify(
      {
        name: "sample-app",
        version: "1.0.0",
        scripts: { test: "vitest run", lint: "eslint .", build: "tsc" },
      },
      null,
      2
    ),
    "utf8"
  );
  fs.writeFileSync(path.join(dir, "README.md"), "# Sample App\n", "utf8");
  fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules/\n", "utf8");
  fs.writeFileSync(path.join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
  fs.writeFileSync(
    path.join(dir, ".github", "workflows", "ci.yml"),
    "name: CI\non: [push]\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(dir, "tests", "smoke.test.ts"),
    "export const ok = true;\n",
    "utf8"
  );
  execFileSync("git", ["add", "."], { cwd: dir, windowsHide: true });
  execFileSync("git", ["commit", "-m", "chore: initial commit"], {
    cwd: dir,
    windowsHide: true,
  });
  return dir;
}

describe("@uzina/mastra-runtime — deliverableLifecycleWorkflow (Durável + Worktree)", () => {
  let db: UzinaDb;
  let organizationId: string;
  let internalClientId: string;
  const masterKey = crypto.randomBytes(32);
  const cleanupDirs: string[] = [];

  beforeAll(async () => {
    await closeDb();
    const ctx = await getDb({ dataDir: ":memory:" });
    db = ctx.db;
    const seeded = await ensureDefaultOrgAndInternalClient(db);
    organizationId = seeded.organizationId;
    internalClientId = seeded.internalClientId;

    const encrypted = encryptSecret({
      plaintext: "sk-uzina-mastra-test-secret-0123456789",
      masterKey,
      organizationId,
      providerType: "openai_compatible",
    });

    await db.insert(providerProfiles).values({
      organizationId,
      name: "OpenAI Principal",
      providerType: "openai_compatible",
      baseUrl: "https://api.openai.com/v1",
      encryptedApiKey: encrypted,
      keyPreview: "sk-u...6789",
      roleBindingsJson: {
        builder: { modelId: "openai/gpt-5.3-codex" },
        architect: { modelId: "openai/gpt-5" },
      },
      isDefault: true,
    });
  });

  afterAll(async () => {
    await resetMastraStorageForTests();
    await closeDb();
    for (const dir of cleanupDirs.splice(0, cleanupDirs.length)) {
      try {
        fs.rmSync(dir, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 150,
        });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EBUSY") {
          throw err;
        }
      }
    }
  });

  async function seedProjectDeliverable(options: {
    hasUi: boolean;
    withRepo?: boolean;
  }) {
    const suffix = crypto.randomUUID().slice(0, 8);
    const repoDir = options.withRepo === false ? null : initTempGitRepo();
    if (repoDir) {
      cleanupDirs.push(repoDir);
    }

    const [client] = await db
      .select()
      .from(clients)
      .where(eq(clients.id, internalClientId));
    expect(client?.id).toBe(internalClientId);

    const [project] = await db
      .insert(projects)
      .values({
        clientId: internalClientId,
        name: `Projeto WF ${suffix}`,
        slug: `projeto-wf-${suffix}`,
      })
      .returning();

    let repositoryId: string | null = null;
    if (repoDir && project) {
      const [repo] = await db
        .insert(projectRepositories)
        .values({
          projectId: project.id,
          name: "repo-principal",
          localPath: repoDir,
          defaultBranch: "main",
        })
        .returning();
      repositoryId = repo?.id ?? null;
    }

    const [deliverable] = await db
      .insert(deliverables)
      .values({
        projectId: project?.id ?? "",
        repositoryId,
        title: `Feature Durável ${suffix}`,
        description: "Painel e API do módulo",
        hasUi: options.hasUi,
      })
      .returning();

    if (project && deliverable && options.hasUi) {
      await db.insert(designAssets).values({
        projectId: project.id,
        deliverableId: deliverable.id,
        assetType: "reference_url",
        title: "Referência Cockpit",
        sourceUrl: "https://linear.app",
        intentionTags: ["copiar:densidade-tabela"],
        approved: false,
      });
    }

    return {
      projectId: project?.id ?? "",
      deliverableId: deliverable?.id ?? "",
      repoDir,
    };
  }

  test("sobrevive a reinício completo de processo entre suspend e resume preservando Discovery rounds e estado", async () => {
    const mastraDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-mastra-db-"));
    cleanupDirs.push(mastraDir);

    const { deliverableId } = await seedProjectDeliverable({
      hasUi: true,
      withRepo: false,
    });

    // Processo 1: inicia workflow e suspende na rodada 1 do Discovery
    const runtime1 = await createMastraRuntime({
      db,
      dataDir: mastraDir,
      masterKey,
    });

    const started = await runtime1.startDeliverableWorkflow({
      deliverableId,
      organizationId,
      input: {},
    });
    expect(started.workflowStatus).toBe("suspended");
    expect(started.suspendedStep).toBe("stage_discovery");
    expect(started.gate).toBe("discovery_confirm");
    expect(started.runId).toBeTruthy();

    // Lock deve ter sido liberado ao suspender
    const [afterSuspendRow] = await db
      .select()
      .from(deliverables)
      .where(eq(deliverables.id, deliverableId));
    expect(afterSuspendRow?.lockedBy).toBeNull();
    expect(afterSuspendRow?.mastraRunId).toBe(started.runId);

    // Simula queda / restart completo do servidor Node.js
    await runtime1.close();
    await resetMastraStorageForTests();

    // Processo 2: nova instância lendo o MESMO arquivo mastra.db e o mesmo DB
    const runtime2 = await createMastraRuntime({
      db,
      dataDir: mastraDir,
      masterKey,
    });

    const reloadedState = await runtime2.getWorkflowState({
      deliverableId,
      organizationId,
    });
    expect(reloadedState.runId).toBe(started.runId);
    expect(reloadedState.workflowStatus).toBe("suspended");
    expect(reloadedState.suspendedStep).toBe("stage_discovery");
    expect(reloadedState.gate).toBe("discovery_confirm");

    // Rodada 2 (changes_requested) sobrevive e gera novas perguntas
    const round2 = await runtime2.resumeDeliverableWorkflow({
      deliverableId,
      organizationId,
      input: {
        decision: "changes_requested",
        feedback: "Detalhar critérios técnicos",
        answers: [
          {
            questionId: "q-objective-user",
            pillar: "objective_and_user",
            answer: "Operador interno do cockpit",
          },
        ],
      },
    });
    expect(round2.workflowStatus).toBe("suspended");
    expect(round2.gate).toBe("discovery_confirm");
    const payloadR2 = round2.suspendPayload as { roundNumber?: number };
    expect(payloadR2.roundNumber).toBe(2);

    // Segundo restart entre rodadas antes da aprovação final do Discovery
    await runtime2.close();
    await resetMastraStorageForTests();

    const runtime3 = await createMastraRuntime({
      db,
      dataDir: mastraDir,
      masterKey,
    });

    const toBlueprint = await runtime3.resumeDeliverableWorkflow({
      deliverableId,
      organizationId,
      input: {
        decision: "approved",
        answers: [
          {
            questionId: "q-acceptance",
            pillar: "acceptance_and_out_of_scope",
            answer: "Testes unitários e APIs Zod",
          },
        ],
      },
    });
    expect(toBlueprint.workflowStatus).toBe("suspended");
    expect(toBlueprint.suspendedStep).toBe("stage_blueprint");
    expect(toBlueprint.gate).toBe("blueprint_approve");
    expect(toBlueprint.deliverableStatus).toBe("spec_review");
    expect(toBlueprint.specMarkdown).toContain("Operador interno do cockpit");

    await runtime3.close();
  });

  test("executa ciclo completo com hasUi=true: Discovery -> Blueprint -> Estúdio (.uzina/DESIGN.md no worktree) -> Contratos antes do Build -> Verifying no mesmo worktree", async () => {
    const mastraDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-mastra-full-"));
    cleanupDirs.push(mastraDir);

    const { projectId, deliverableId, repoDir } = await seedProjectDeliverable({
      hasUi: true,
      withRepo: true,
    });

    const recordedSessions: Array<{ workspacePath: string; title: string }> = [];
    const transport = createDynamicInMemoryTransport((runInput, session) => {
      recordedSessions.push({
        workspacePath: session.workspacePath,
        title: session.title,
      });

      if (runInput.prompt.includes("Verifier independente")) {
        return {
          finalText: "Verificado.",
          structuredOutput: {
            verdict: "approved",
            summary: "Verificação independente aprovada.",
            issues: [],
          },
          turns: [],
        };
      }

      const isContractStage = runInput.prompt.includes(
        "stage_contract_and_tests"
      );

      if (isContractStage) {
        return {
          finalText: "Contratos e testes RED criados.",
          turns: [
            {
              observation: {
                turnIndex: 1,
                actionType: "tool_call",
                toolName: "write",
                actionSignature: "write:tests/slice3-contract.test.ts",
                observationSignature: "ok",
              },
              touchedFiles: ["tests/slice3-contract.test.ts"],
            },
          ],
        };
      }

      return {
        finalText: "Implementação concluída com testes passando.",
        turns: [
          {
            observation: {
              turnIndex: 1,
              actionType: "tool_call",
              toolName: "write",
              actionSignature: "write:src/feature.ts",
              observationSignature: "ok",
            },
            touchedFiles: ["src/feature.ts"],
          },
        ],
      };
    });

    const runtime = await createMastraRuntime({
      db,
      dataDir: mastraDir,
      masterKey,
      workspaceFactory: () => new LocalGitWorktreeWorkspace(),
      transportFactory: () => transport,
    });

    // Start -> Discovery
    const s1 = await runtime.startDeliverableWorkflow({
      deliverableId,
      organizationId,
      input: {},
    });
    expect(s1.gate).toBe("discovery_confirm");

    // Start duplicado deve falhar com 409 WORKFLOW_ALREADY_RUNNING
    await expect(
      runtime.startDeliverableWorkflow({
        deliverableId,
        organizationId,
        input: {},
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "WORKFLOW_ALREADY_RUNNING",
    });

    // Discovery -> Blueprint
    const s2 = await runtime.resumeDeliverableWorkflow({
      deliverableId,
      organizationId,
      input: { decision: "approved" },
    });
    expect(s2.gate).toBe("blueprint_approve");
    expect(s2.blueprint?.developmentStrategy).toBe("frontend_first_msw");

    // Blueprint -> Estúdio Visual (hasUi = true)
    const s3 = await runtime.resumeDeliverableWorkflow({
      deliverableId,
      organizationId,
      input: { decision: "approved" },
    });
    expect(s3.gate).toBe("visual_approve");
    expect(s3.deliverableStatus).toBe("visual_studio");
    expect(s3.designMdContent).toContain("Contrato Visual");

    // Estúdio Visual -> Contract & Tests -> Build -> Verifying
    const s4 = await runtime.resumeDeliverableWorkflow({
      deliverableId,
      organizationId,
      input: { decision: "approved", approveDesignMd: true },
    });

    expect(s4.workflowStatus).toBe("suspended");
    expect(s4.deliverableStatus).toBe("decision_pending");
    expect(s4.gate).toBe("pr_evidence_approve");
    expect(s4.suspendedStep).toBe("stage_decision");
    expect(s4.contractTestFiles).toEqual(["tests/slice3-contract.test.ts"]);
    expect(s4.stageHistory).toEqual([
      "stage_discovery",
      "stage_blueprint",
      "stage_visual_studio",
      "stage_contract_and_tests",
      "stage_build",
      "stage_verify",
      "stage_decision",
    ]);

    // Ordem estrita: Contratos -> Build -> Verify no MESMO worktreePath
    expect(recordedSessions).toHaveLength(3);
    expect(recordedSessions[0]?.workspacePath).toBe(
      recordedSessions[1]?.workspacePath
    );
    expect(recordedSessions[1]?.workspacePath).toBe(
      recordedSessions[2]?.workspacePath
    );

    const worktreePath = recordedSessions[0]?.workspacePath ?? "";
    expect(worktreePath).not.toBe(repoDir);
    expect(
      fs.existsSync(path.join(worktreePath, ".uzina", "DESIGN.md"))
    ).toBe(true);
    // Repositório raiz não foi contaminado com .uzina/DESIGN.md
    if (repoDir) {
      expect(fs.existsSync(path.join(repoDir, ".uzina", "DESIGN.md"))).toBe(
        false
      );
    }

    const [updatedProject] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId));
    expect(updatedProject?.designMdPath).toBe(".uzina/DESIGN.md");

    const [updatedDeliverable] = await db
      .select()
      .from(deliverables)
      .where(eq(deliverables.id, deliverableId));
    expect(updatedDeliverable?.worktreePath).toBe(worktreePath);
    expect(updatedDeliverable?.branchName).toContain("uzina/");
    expect(updatedDeliverable?.status).toBe("decision_pending");

    // Cleanup da worktree gerada
    const ws = new LocalGitWorktreeWorkspace();
    await ws.attach({
      workspacePath: worktreePath,
      branchName: updatedDeliverable?.branchName ?? "",
      repoPath: repoDir ?? "",
      baseBranch: "main",
      deliverableId,
    });
    await ws.cleanup({ deleteBranch: true });

    await runtime.close();
  });

  test("ignora stage_visual_studio quando hasUi=false e executa Contratos -> Build", async () => {
    const mastraDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-mastra-noui-"));
    cleanupDirs.push(mastraDir);

    const { deliverableId, repoDir } = await seedProjectDeliverable({
      hasUi: false,
      withRepo: true,
    });

    const transport = createDynamicInMemoryTransport((runInput) => {
      if (runInput.prompt.includes("Verifier independente")) {
        return {
          finalText: "OK",
          structuredOutput: {
            verdict: "approved",
            summary: "Verificação sem UI aprovada.",
            issues: [],
          },
          turns: [],
        };
      }
      return {
        finalText: "Executado sem UI",
        turns: [
          {
            observation: {
              turnIndex: 1,
              actionType: "tool_call",
              toolName: "write",
              actionSignature: "write:tests/api.test.ts",
              observationSignature: "ok",
            },
            touchedFiles: ["tests/api.test.ts"],
          },
        ],
      };
    });

    const runtime = await createMastraRuntime({
      db,
      dataDir: mastraDir,
      masterKey,
      workspaceFactory: () => new LocalGitWorktreeWorkspace(),
      transportFactory: () => transport,
    });

    await runtime.startDeliverableWorkflow({
      deliverableId,
      organizationId,
      input: {},
    });
    await runtime.resumeDeliverableWorkflow({
      deliverableId,
      organizationId,
      input: { decision: "approved" },
    });
    const afterBlueprint = await runtime.resumeDeliverableWorkflow({
      deliverableId,
      organizationId,
      input: { decision: "approved" },
    });

    expect(afterBlueprint.workflowStatus).toBe("suspended");
    expect(afterBlueprint.deliverableStatus).toBe("decision_pending");
    expect(afterBlueprint.gate).toBe("pr_evidence_approve");
    expect(afterBlueprint.stageHistory).not.toContain("stage_visual_studio");

    const [row] = await db
      .select()
      .from(deliverables)
      .where(eq(deliverables.id, deliverableId));
    if (row?.worktreePath && row?.branchName && repoDir) {
      const ws = new LocalGitWorktreeWorkspace();
      await ws.attach({
        workspacePath: row.worktreePath,
        branchName: row.branchName,
        repoPath: repoDir,
        baseBranch: "main",
        deliverableId,
      });
      await ws.cleanup({ deleteBranch: true });
    }
    await runtime.close();
  });

  test("stuck_intervention pausa entregável em building->paused, retoma com feedback e rejeição faz bail + cleanup para failed", async () => {
    const mastraDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-mastra-stuck-"));
    cleanupDirs.push(mastraDir);

    // Caso A: Stuck -> Retomada -> Verifying
    const d1 = await seedProjectDeliverable({ hasUi: false, withRepo: true });
    let buildAttempt = 0;
    const capturedPrompts: string[] = [];
    const transportA = createDynamicInMemoryTransport((runInput) => {
      capturedPrompts.push(runInput.prompt);
      if (runInput.prompt.includes("Verifier independente")) {
        return {
          finalText: "OK",
          structuredOutput: {
            verdict: "approved",
            summary: "Verify ok pós-stuck",
            issues: [],
          },
          turns: [],
        };
      }
      if (runInput.prompt.includes("stage_contract_and_tests")) {
        return {
          finalText: "Contrato ok",
          turns: [
            {
              observation: {
                turnIndex: 1,
                actionType: "tool_call",
                toolName: "write",
                actionSignature: "write:tests/stuck.test.ts",
                observationSignature: "ok",
              },
              touchedFiles: ["tests/stuck.test.ts"],
            },
          ],
        };
      }
      buildAttempt += 1;
      if (buildAttempt === 1) {
        return {
          turns: [
            {
              observation: {
                turnIndex: 1,
                actionType: "error",
                toolName: "bash",
                actionSignature: "pnpm test",
                errorMessage: "Module not found",
              },
            },
            {
              observation: {
                turnIndex: 2,
                actionType: "error",
                toolName: "bash",
                actionSignature: "pnpm test",
                errorMessage: "Module not found",
              },
            },
            {
              observation: {
                turnIndex: 3,
                actionType: "error",
                toolName: "bash",
                actionSignature: "pnpm test",
                errorMessage: "Module not found",
              },
            },
          ],
        };
      }
      return {
        finalText: "Corrigido após intervenção humana",
        turns: [
          {
            observation: {
              turnIndex: 1,
              actionType: "tool_call",
              toolName: "write",
              actionSignature: "write:src/fixed.ts",
              observationSignature: "ok",
            },
            touchedFiles: ["src/fixed.ts"],
          },
        ],
      };
    });

    const runtimeA = await createMastraRuntime({
      db,
      dataDir: mastraDir,
      masterKey,
      workspaceFactory: () => new LocalGitWorktreeWorkspace(),
      transportFactory: () => transportA,
    });

    await runtimeA.startDeliverableWorkflow({
      deliverableId: d1.deliverableId,
      organizationId,
      input: {},
    });
    await runtimeA.resumeDeliverableWorkflow({
      deliverableId: d1.deliverableId,
      organizationId,
      input: { decision: "approved" },
    });
    const stuckState = await runtimeA.resumeDeliverableWorkflow({
      deliverableId: d1.deliverableId,
      organizationId,
      input: { decision: "approved" },
    });

    expect(stuckState.workflowStatus).toBe("suspended");
    expect(stuckState.suspendedStep).toBe("stage_build");
    expect(stuckState.gate).toBe("stuck_intervention");
    expect(stuckState.deliverableStatus).toBe("paused");

    const [pausedRow] = await db
      .select()
      .from(deliverables)
      .where(eq(deliverables.id, d1.deliverableId));
    expect(pausedRow?.pausedFromStatus).toBe("building");
    expect(pausedRow?.lockedBy).toBeNull();

    const recoveredState = await runtimeA.resumeDeliverableWorkflow({
      deliverableId: d1.deliverableId,
      organizationId,
      input: {
        decision: "approved",
        feedback: "Use helper compartilhado",
      },
    });
    expect(recoveredState.workflowStatus).toBe("suspended");
    expect(recoveredState.deliverableStatus).toBe("decision_pending");
    expect(recoveredState.gate).toBe("pr_evidence_approve");
    expect(
      capturedPrompts.some((p) => p.includes("Use helper compartilhado"))
    ).toBe(true);

    // Cleanup d1 worktree
    const [d1Row] = await db
      .select()
      .from(deliverables)
      .where(eq(deliverables.id, d1.deliverableId));
    if (d1Row?.worktreePath && d1Row.branchName && d1.repoDir) {
      const ws = new LocalGitWorktreeWorkspace();
      await ws.attach({
        workspacePath: d1Row.worktreePath,
        branchName: d1Row.branchName,
        repoPath: d1.repoDir,
        baseBranch: "main",
        deliverableId: d1.deliverableId,
      });
      await ws.cleanup({ deleteBranch: true });
    }
    await runtimeA.close();

    // Caso B: Stuck -> Rejected -> failed + cleanup de worktree
    const d2 = await seedProjectDeliverable({ hasUi: false, withRepo: true });
    const transportB = createDynamicInMemoryTransport((runInput) => {
      if (runInput.prompt.includes("stage_contract_and_tests")) {
        return {
          finalText: "Contrato ok",
          turns: [
            {
              observation: {
                turnIndex: 1,
                actionType: "tool_call",
                toolName: "write",
                actionSignature: "write:tests/reject.test.ts",
                observationSignature: "ok",
              },
              touchedFiles: ["tests/reject.test.ts"],
            },
          ],
        };
      }
      return {
        turns: [
          {
            observation: {
              turnIndex: 1,
              actionType: "error",
              toolName: "bash",
              actionSignature: "pnpm test",
              errorMessage: "Fatal loop",
            },
          },
          {
            observation: {
              turnIndex: 2,
              actionType: "error",
              toolName: "bash",
              actionSignature: "pnpm test",
              errorMessage: "Fatal loop",
            },
          },
          {
            observation: {
              turnIndex: 3,
              actionType: "error",
              toolName: "bash",
              actionSignature: "pnpm test",
              errorMessage: "Fatal loop",
            },
          },
        ],
      };
    });

    const runtimeB = await createMastraRuntime({
      db,
      dataDir: mastraDir,
      masterKey,
      workspaceFactory: () => new LocalGitWorktreeWorkspace(),
      transportFactory: () => transportB,
    });

    await runtimeB.startDeliverableWorkflow({
      deliverableId: d2.deliverableId,
      organizationId,
      input: {},
    });
    await runtimeB.resumeDeliverableWorkflow({
      deliverableId: d2.deliverableId,
      organizationId,
      input: { decision: "approved" },
    });
    const stuckB = await runtimeB.resumeDeliverableWorkflow({
      deliverableId: d2.deliverableId,
      organizationId,
      input: { decision: "approved" },
    });
    expect(stuckB.gate).toBe("stuck_intervention");

    const [beforeRejectRow] = await db
      .select()
      .from(deliverables)
      .where(eq(deliverables.id, d2.deliverableId));
    const createdWtPath = beforeRejectRow?.worktreePath ?? "";
    expect(fs.existsSync(createdWtPath)).toBe(true);

    const rejectedB = await runtimeB.resumeDeliverableWorkflow({
      deliverableId: d2.deliverableId,
      organizationId,
      input: { decision: "rejected", feedback: "Abortar abordagem" },
    });
    expect(rejectedB.workflowStatus).toBe("failed");
    expect(rejectedB.deliverableStatus).toBe("failed");
    expect(fs.existsSync(createdWtPath)).toBe(false);

    await runtimeB.close();
  });

  test("impõe 409 DELIVERABLE_LOCKED quando bloqueado por outro worker e 422 sem repositório vinculado", async () => {
    const mastraDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-mastra-err-"));
    cleanupDirs.push(mastraDir);

    const { deliverableId } = await seedProjectDeliverable({
      hasUi: false,
      withRepo: false,
    });

    const runtime = await createMastraRuntime({
      db,
      dataDir: mastraDir,
      masterKey,
    });

    // Lock externo ativo -> start deve retornar 409 DELIVERABLE_LOCKED
    const extLock = await acquireDeliverableLock(db, {
      deliverableId,
      workerId: "external-worker",
      ttlMinutes: 10,
    });
    expect(extLock.acquired).toBe(true);

    await expect(
      runtime.startDeliverableWorkflow({
        deliverableId,
        organizationId,
        input: {},
      })
    ).rejects.toThrowError(WorkflowRuntimeError);
    await expect(
      runtime.startDeliverableWorkflow({
        deliverableId,
        organizationId,
        input: {},
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "DELIVERABLE_LOCKED",
    });

    await releaseDeliverableLock(db, {
      deliverableId,
      workerId: "external-worker",
    });

    // Agora inicia, aprova Discovery e Blueprint, e deve falhar com 422 por falta de repositório
    await runtime.startDeliverableWorkflow({
      deliverableId,
      organizationId,
      input: {},
    });
    await runtime.resumeDeliverableWorkflow({
      deliverableId,
      organizationId,
      input: { decision: "approved" },
    });

    await expect(
      runtime.resumeDeliverableWorkflow({
        deliverableId,
        organizationId,
        input: { decision: "approved" },
      })
    ).rejects.toMatchObject({
      statusCode: 422,
    });

    await runtime.close();
  });

  test("sobrevive a restarts em stage_blueprint, stage_visual_studio e stage_build (stuck) mantendo state completo", async () => {
    const mastraDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-mastra-late-"));
    cleanupDirs.push(mastraDir);

    const { deliverableId, repoDir } = await seedProjectDeliverable({
      hasUi: true,
      withRepo: true,
    });

    let buildCount = 0;
    const makeTransport = () =>
      createDynamicInMemoryTransport((runInput) => {
        if (runInput.prompt.includes("Verifier independente")) {
          return {
            finalText: "OK",
            structuredOutput: {
              verdict: "approved",
              summary: "Verify ok pós-restart",
              issues: [],
            },
            turns: [],
          };
        }
        if (runInput.prompt.includes("stage_contract_and_tests")) {
          return {
            finalText: "Contratos prontos",
            turns: [
              {
                observation: {
                  turnIndex: 1,
                  actionType: "tool_call",
                  toolName: "write",
                  actionSignature: "write:tests/late-restart.test.ts",
                  observationSignature: "ok",
                },
                touchedFiles: ["tests/late-restart.test.ts"],
              },
            ],
          };
        }
        buildCount += 1;
        if (buildCount === 1) {
          return {
            turns: [
              {
                observation: {
                  turnIndex: 1,
                  actionType: "error",
                  toolName: "bash",
                  actionSignature: "pnpm build",
                  errorMessage: "Loop stuck",
                },
              },
              {
                observation: {
                  turnIndex: 2,
                  actionType: "error",
                  toolName: "bash",
                  actionSignature: "pnpm build",
                  errorMessage: "Loop stuck",
                },
              },
              {
                observation: {
                  turnIndex: 3,
                  actionType: "error",
                  toolName: "bash",
                  actionSignature: "pnpm build",
                  errorMessage: "Loop stuck",
                },
              },
            ],
          };
        }
        return {
          finalText: "Resolvido após restart em stuck_intervention",
          turns: [
            {
              observation: {
                turnIndex: 1,
                actionType: "tool_call",
                toolName: "write",
                actionSignature: "write:src/ok.ts",
                observationSignature: "ok",
              },
              touchedFiles: ["src/ok.ts"],
            },
          ],
        };
      });

    const r1 = await createMastraRuntime({
      db,
      dataDir: mastraDir,
      masterKey,
    });
    await r1.startDeliverableWorkflow({
      deliverableId,
      organizationId,
      input: {},
    });
    const atBlueprint = await r1.resumeDeliverableWorkflow({
      deliverableId,
      organizationId,
      input: { decision: "approved" },
    });
    expect(atBlueprint.gate).toBe("blueprint_approve");
    await r1.close();
    await resetMastraStorageForTests();

    // Restart 1 em stage_blueprint + changes_requested com overrideStrategy
    const r2 = await createMastraRuntime({
      db,
      dataDir: mastraDir,
      masterKey,
    });
    const bpRevised = await r2.resumeDeliverableWorkflow({
      deliverableId,
      organizationId,
      input: {
        decision: "changes_requested",
        overrideStrategy: "api_contract_first",
        feedback: "Testar ajuste de estratégia",
      },
    });
    expect(bpRevised.gate).toBe("blueprint_approve");
    expect(bpRevised.blueprint?.developmentStrategy).toBe("api_contract_first");

    const atVisual = await r2.resumeDeliverableWorkflow({
      deliverableId,
      organizationId,
      input: { decision: "approved" },
    });
    expect(atVisual.gate).toBe("visual_approve");
    await r2.close();
    await resetMastraStorageForTests();

    // Restart 2 em stage_visual_studio + changes_requested + approveDesignMd=false -> 422 + approve -> stuck_intervention
    const r3 = await createMastraRuntime({
      db,
      dataDir: mastraDir,
      masterKey,
      workspaceFactory: () => new LocalGitWorktreeWorkspace(),
      transportFactory: makeTransport,
    });
    const visualRevised = await r3.resumeDeliverableWorkflow({
      deliverableId,
      organizationId,
      input: {
        decision: "changes_requested",
        feedback: "Reforçar densidade tabular",
      },
    });
    expect(visualRevised.gate).toBe("visual_approve");
    expect(visualRevised.designMdContent).toContain("Reforçar densidade tabular");

    await expect(
      r3.resumeDeliverableWorkflow({
        deliverableId,
        organizationId,
        input: { decision: "approved", approveDesignMd: false },
      })
    ).rejects.toMatchObject({ statusCode: 422 });

    const atStuck = await r3.resumeDeliverableWorkflow({
      deliverableId,
      organizationId,
      input: { decision: "approved", approveDesignMd: true },
    });
    expect(atStuck.gate).toBe("stuck_intervention");
    expect(atStuck.contractTestFiles).toEqual(["tests/late-restart.test.ts"]);
    await r3.close();
    await resetMastraStorageForTests();

    // Restart 3 em stuck_intervention preserva worktreeHandle e conclui em verifying
    const r4 = await createMastraRuntime({
      db,
      dataDir: mastraDir,
      masterKey,
      workspaceFactory: () => new LocalGitWorktreeWorkspace(),
      transportFactory: makeTransport,
    });
    const reloadedAtStuck = await r4.getWorkflowState({
      deliverableId,
      organizationId,
    });
    expect(reloadedAtStuck.gate).toBe("stuck_intervention");
    expect(reloadedAtStuck.designMdContent).toContain("Contrato Visual");

    const finalOk = await r4.resumeDeliverableWorkflow({
      deliverableId,
      organizationId,
      input: { decision: "approved", feedback: "Retomada pós-restart" },
    });
    expect(finalOk.workflowStatus).toBe("suspended");
    expect(finalOk.deliverableStatus).toBe("decision_pending");
    expect(finalOk.gate).toBe("pr_evidence_approve");
    expect(finalOk.contractTestFiles).toEqual(["tests/late-restart.test.ts"]);

    const [row] = await db
      .select()
      .from(deliverables)
      .where(eq(deliverables.id, deliverableId));
    if (row?.worktreePath && row.branchName && repoDir) {
      const ws = new LocalGitWorktreeWorkspace();
      await ws.attach({
        workspacePath: row.worktreePath,
        branchName: row.branchName,
        repoPath: repoDir,
        baseBranch: "main",
        deliverableId,
      });
      await ws.cleanup({ deleteBranch: true });
    }
    await r4.close();
  });

  test("cobre limite de 3 rodadas Discovery, rejected em cada gate, 409 not suspended, 404 cross-tenant, 422 sem provider e EXECUTION_FAILED", async () => {
    const mastraDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-mastra-edge-"));
    cleanupDirs.push(mastraDir);

    // 1. Limite de 3 rodadas Discovery + 409 not suspended + 404 cross-tenant + rejected Discovery
    const dDisc = await seedProjectDeliverable({ hasUi: true, withRepo: false });
    const rt = await createMastraRuntime({ db, dataDir: mastraDir, masterKey });

    await expect(
      rt.resumeDeliverableWorkflow({
        deliverableId: dDisc.deliverableId,
        organizationId,
        input: { decision: "approved" },
      })
    ).rejects.toMatchObject({ statusCode: 409, code: "WORKFLOW_NOT_SUSPENDED" });

    await expect(
      rt.getWorkflowState({
        deliverableId: dDisc.deliverableId,
        organizationId: crypto.randomUUID(),
      })
    ).rejects.toMatchObject({ statusCode: 404, code: "DELIVERABLE_NOT_FOUND" });

    await rt.startDeliverableWorkflow({
      deliverableId: dDisc.deliverableId,
      organizationId,
      input: {},
    });
    await rt.resumeDeliverableWorkflow({
      deliverableId: dDisc.deliverableId,
      organizationId,
      input: { decision: "changes_requested" },
    });
    await rt.resumeDeliverableWorkflow({
      deliverableId: dDisc.deliverableId,
      organizationId,
      input: { decision: "changes_requested" },
    });
    await expect(
      rt.resumeDeliverableWorkflow({
        deliverableId: dDisc.deliverableId,
        organizationId,
        input: { decision: "changes_requested" },
      })
    ).rejects.toMatchObject({ statusCode: 422, code: "INVALID_WORKFLOW_INPUT" });

    const rejDisc = await rt.resumeDeliverableWorkflow({
      deliverableId: dDisc.deliverableId,
      organizationId,
      input: { decision: "rejected" },
    });
    expect(rejDisc.workflowStatus).toBe("failed");
    expect(rejDisc.deliverableStatus).toBe("failed");

    // 2. Rejected em stage_blueprint e stage_visual_studio
    const dBp = await seedProjectDeliverable({ hasUi: true, withRepo: false });
    await rt.startDeliverableWorkflow({ deliverableId: dBp.deliverableId, organizationId, input: {} });
    await rt.resumeDeliverableWorkflow({ deliverableId: dBp.deliverableId, organizationId, input: { decision: "approved" } });
    const rejBp = await rt.resumeDeliverableWorkflow({ deliverableId: dBp.deliverableId, organizationId, input: { decision: "rejected" } });
    expect(rejBp.workflowStatus).toBe("failed");
    expect(rejBp.deliverableStatus).toBe("failed");

    const dVis = await seedProjectDeliverable({ hasUi: true, withRepo: false });
    await rt.startDeliverableWorkflow({ deliverableId: dVis.deliverableId, organizationId, input: {} });
    await rt.resumeDeliverableWorkflow({ deliverableId: dVis.deliverableId, organizationId, input: { decision: "approved" } });
    await rt.resumeDeliverableWorkflow({ deliverableId: dVis.deliverableId, organizationId, input: { decision: "approved" } });
    const rejVis = await rt.resumeDeliverableWorkflow({ deliverableId: dVis.deliverableId, organizationId, input: { decision: "rejected" } });
    expect(rejVis.workflowStatus).toBe("failed");
    expect(rejVis.deliverableStatus).toBe("failed");

    // 3. Organização sem providerProfile -> 422 MISSING_PRECONDITION
    const orgSlug = `org-noprov-${crypto.randomUUID().slice(0, 6)}`;
    const [otherOrg] = await db
      .insert(organizations)
      .values({ name: "Org Sem Provider", slug: orgSlug })
      .returning();
    const [otherClient] = await db
      .insert(clients)
      .values({ organizationId: otherOrg?.id ?? "", name: "Internos", slug: "internos", isDefaultInternal: true })
      .returning();
    const otherRepoDir = initTempGitRepo();
    cleanupDirs.push(otherRepoDir);
    const [otherProj] = await db
      .insert(projects)
      .values({ clientId: otherClient?.id ?? "", name: "Proj NoProv", slug: `proj-noprov-${orgSlug}` })
      .returning();
    const [otherRepo] = await db
      .insert(projectRepositories)
      .values({ projectId: otherProj?.id ?? "", name: "repo", localPath: otherRepoDir, defaultBranch: "main" })
      .returning();
    const [otherDeliv] = await db
      .insert(deliverables)
      .values({ projectId: otherProj?.id ?? "", repositoryId: otherRepo?.id ?? null, title: "Sem Provider", hasUi: false })
      .returning();

    await rt.startDeliverableWorkflow({ deliverableId: otherDeliv?.id ?? "", organizationId: otherOrg?.id ?? "", input: {} });
    await rt.resumeDeliverableWorkflow({ deliverableId: otherDeliv?.id ?? "", organizationId: otherOrg?.id ?? "", input: { decision: "approved" } });
    await expect(
      rt.resumeDeliverableWorkflow({ deliverableId: otherDeliv?.id ?? "", organizationId: otherOrg?.id ?? "", input: { decision: "approved" } })
    ).rejects.toMatchObject({ statusCode: 422, code: "MISSING_PRECONDITION" });

    await rt.close();

    // 4. EXECUTION_FAILED em stage_build mantém worktree em disco para diagnóstico
    const dFail = await seedProjectDeliverable({ hasUi: false, withRepo: true });
    const failTransport: OpenCodeTransport = {
      async createSession(sessionInput) {
        let innerHandle: TransportSessionHandle | null = null;
        return {
          sessionId: `dyn-fail-${crypto.randomUUID()}`,
          async run(runInput) {
            if (runInput.prompt.includes("stage_contract_and_tests")) {
              const inner = new InMemoryOpenCodeTransport({
                finalText: "ok",
                turns: [
                  {
                    observation: {
                      turnIndex: 1,
                      actionType: "tool_call",
                      toolName: "write",
                      actionSignature: "write:tests/fail.test.ts",
                      observationSignature: "ok",
                    },
                    touchedFiles: ["tests/fail.test.ts"],
                  },
                ],
              });
              innerHandle = await inner.createSession(sessionInput);
              return innerHandle.run(runInput);
            }
            return {
              finalText: "",
              tokenUsage: {
                inputTokens: 0,
                outputTokens: 0,
                cacheReadTokens: 0,
              },
              turnsExecuted: 1,
              aborted: true,
            };
          },
          async abort() {
            await innerHandle?.abort();
          },
          async close() {
            await innerHandle?.close();
          },
        };
      },
    };
    const rtFail = await createMastraRuntime({
      db,
      dataDir: mastraDir,
      masterKey,
      workspaceFactory: () => new LocalGitWorktreeWorkspace(),
      transportFactory: () => failTransport,
    });
    await rtFail.startDeliverableWorkflow({ deliverableId: dFail.deliverableId, organizationId, input: {} });
    await rtFail.resumeDeliverableWorkflow({ deliverableId: dFail.deliverableId, organizationId, input: { decision: "approved" } });
    await expect(
      rtFail.resumeDeliverableWorkflow({ deliverableId: dFail.deliverableId, organizationId, input: { decision: "approved" } })
    ).rejects.toMatchObject({ statusCode: 500, code: "EXECUTION_FAILED" });

    const [failedRow] = await db
      .select()
      .from(deliverables)
      .where(eq(deliverables.id, dFail.deliverableId));
    expect(failedRow?.status).toBe("failed");
    expect(failedRow?.worktreePath).toBeTruthy();
    if (failedRow?.worktreePath && failedRow.branchName && dFail.repoDir) {
      expect(fs.existsSync(failedRow.worktreePath)).toBe(true);
      const ws = new LocalGitWorktreeWorkspace();
      await ws.attach({
        workspacePath: failedRow.worktreePath,
        branchName: failedRow.branchName,
        repoPath: dFail.repoDir,
        baseBranch: "main",
        deliverableId: dFail.deliverableId,
      });
      await ws.cleanup({ deleteBranch: true });
    }
    await rtFail.close();
  });
});
