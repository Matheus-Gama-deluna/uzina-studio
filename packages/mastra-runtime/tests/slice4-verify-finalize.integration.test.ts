import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  clients,
  closeDb,
  decisions,
  deliverables,
  ensureDefaultOrgAndInternalClient,
  executionEvents,
  getDb,
  organizations,
  projectRepositories,
  projects,
  providerProfiles,
  securityScans,
  users,
  type UzinaDb,
} from "@uzina/db";
import { encryptSecret } from "@uzina/core";
import {
  LocalGitWorktreeWorkspace,
  type OpenCodeTransport,
  type TransportRunInput,
  type TransportSessionHandle,
} from "@uzina/opencode-bridge";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  createMastraRuntime,
  getExecutionEventBus,
  resetMastraStorageForTests,
} from "../src/index.js";

function initTempGitRepo(remoteUrl?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-slice4-repo-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "ci@uzina.local"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Uzina CI"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "README.md"), "# Demo Repo\n", "utf8");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-m", "chore: initial"], { cwd: dir });
  if (remoteUrl) {
    execFileSync("git", ["remote", "add", "origin", remoteUrl], { cwd: dir });
  }
  return dir;
}

function createScriptedTransport(
  handler: (input: TransportRunInput) => {
    finalText?: string;
    structuredOutput?: unknown;
    touchedFiles?: string[];
    writeFiles?: Record<string, string>;
    inputTokens?: number;
    outputTokens?: number;
  }
): OpenCodeTransport {
  return {
    async createSession(sessionInput) {
      let aborted = false;
      return {
        sessionId: `s4-${crypto.randomUUID()}`,
        async run(runInput) {
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
          const res = handler(runInput);
          if (res.writeFiles) {
            for (const [relPath, content] of Object.entries(res.writeFiles)) {
              const abs = path.join(sessionInput.workspacePath, relPath);
              fs.mkdirSync(path.dirname(abs), { recursive: true });
              fs.writeFileSync(abs, content, "utf8");
            }
          }
          return {
            finalText: res.finalText ?? "ok",
            structuredOutput: res.structuredOutput,
            tokenUsage: {
              inputTokens: res.inputTokens ?? 250,
              outputTokens: res.outputTokens ?? 90,
              cacheReadTokens: 40,
            },
            turnsExecuted: 1,
            aborted: false,
            events: (res.touchedFiles ?? []).map((filePath, idx) => ({
              observation: {
                turnIndex: idx + 1,
                actionType: "tool_call" as const,
                toolName: "write",
                actionSignature: `write:${filePath}`,
                observationSignature: "ok",
              },
              modelId: sessionInput.modelId,
              touchedFiles: [filePath],
            })),
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

describe("@uzina/mastra-runtime — Slice 4 (Verify Loop, Security Gate, Decisions HITL & Finalize)", () => {
  let db: UzinaDb;
  let organizationId: string;
  let internalClientId: string;
  let ownerUserId: string;
  const masterKey = crypto.randomBytes(32);
  const cleanupDirs: string[] = [];

  beforeAll(async () => {
    await resetMastraStorageForTests();
    await closeDb();
    const ctx = await getDb({ dataDir: ":memory:" });
    db = ctx.db;
    const seeded = await ensureDefaultOrgAndInternalClient(db);
    organizationId = seeded.organizationId;
    internalClientId = seeded.internalClientId;

    const [orgRow] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId));
    expect(orgRow?.id).toBe(organizationId);

    const [owner] = await db
      .insert(users)
      .values({
        name: "Owner Slice 4",
        email: `owner-s4-${crypto.randomUUID().slice(0, 6)}@uzina.local`,
        organizationId,
        role: "owner",
      })
      .returning();
    ownerUserId = owner!.id;

    const encrypted = encryptSecret({
      plaintext: "sk-test-slice4-secret-value-1234",
      masterKey,
      organizationId,
      providerType: "openai_compatible",
    });

    await db.insert(providerProfiles).values({
      organizationId,
      name: "OpenAI Slice 4",
      providerType: "openai_compatible",
      baseUrl: "https://api.openai.com/v1",
      encryptedApiKey: encrypted,
      keyPreview: "sk-t...1234",
      roleBindingsJson: {
        builder: { modelId: "anthropic/claude-sonnet-4" },
        verifier: { modelId: "openai/gpt-4o" },
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

  async function seedDeliverable(opts: {
    maxVerifyAttempts?: number;
    remoteUrl?: string | null;
  }) {
    const suffix = crypto.randomUUID().slice(0, 8);
    const repoDir = initTempGitRepo(opts.remoteUrl ?? undefined);
    cleanupDirs.push(repoDir);

    const [client] = await db
      .select()
      .from(clients)
      .where(eq(clients.id, internalClientId));
    expect(client?.organizationId).toBe(organizationId);

    const [project] = await db
      .insert(projects)
      .values({
        clientId: internalClientId,
        name: `Projeto S4 ${suffix}`,
        slug: `projeto-s4-${suffix}`,
      })
      .returning();

    const [repo] = await db
      .insert(projectRepositories)
      .values({
        projectId: project!.id,
        name: "repo",
        localPath: repoDir,
        defaultBranch: "main",
        remoteUrl: opts.remoteUrl ?? null,
      })
      .returning();

    const [deliverable] = await db
      .insert(deliverables)
      .values({
        projectId: project!.id,
        repositoryId: repo!.id,
        title: `Entrega S4 ${suffix}`,
        description: "Implementar módulo com segurança e testes reais.",
        hasUi: false,
        maxVerifyAttempts: opts.maxVerifyAttempts ?? 3,
      })
      .returning();

    return {
      projectId: project!.id,
      deliverableId: deliverable!.id,
      repoDir,
    };
  }

  const missingScannerRunner = async () => ({
    status: "missing_binary" as const,
    exitCode: null,
    stdout: "",
    stderr: "ENOENT",
    durationMs: 1,
  });

  test("executa fluxo ponta a ponta com auto-fix no Verify, isolamento Builder vs Verifier, Caixa de Decisões (resolveDecision + 409) e Finalize PR", async () => {
    const mastraDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-s4-e2e-"));
    cleanupDirs.push(mastraDir);

    const { deliverableId } = await seedDeliverable({
      remoteUrl: "https://github.com/uzina/demo.git",
    });

    const receivedBusEvents: string[] = [];
    const unsubscribe = getExecutionEventBus().subscribe(deliverableId, (ev) => {
      receivedBusEvents.push(`${ev.stage}:${ev.eventType}`);
    });

    const verifierPrompts: string[] = [];
    let verifyRunCount = 0;

    const transport = createScriptedTransport((runInput) => {
      if (runInput.prompt.includes("stage_contract_and_tests")) {
        return {
          touchedFiles: ["tests/feature.test.ts"],
          writeFiles: {
            "tests/feature.test.ts":
              'import { describe, expect, it } from "vitest";\ndescribe("feature", () => {\n  it("works", () => {\n    expect(1 + 1).toBe(2);\n  });\n});\n',
          },
        };
      }
      if (runInput.prompt.includes("stage_build")) {
        return {
          finalText: "BUILDER_INTERNAL_THOUGHT_DO_NOT_LEAK",
          touchedFiles: ["src/feature.ts"],
          writeFiles: {
            "src/feature.ts": "export const value = 42;\n",
          },
        };
      }
      verifierPrompts.push(runInput.prompt);
      return {
        structuredOutput: {
          verdict: "approved",
          summary: "Implementação verificada com sucesso.",
          issues: [],
        },
      };
    });

    let finalizedCalledWith: { remoteUrl: string | null; branchName: string } | null =
      null;

    const runtime = await createMastraRuntime({
      db,
      dataDir: mastraDir,
      masterKey,
      workspaceFactory: () => new LocalGitWorktreeWorkspace(),
      transportFactory: () => transport,
      securityRunnerDeps: { commandRunner: missingScannerRunner },
      verifyRunner: async () => {
        verifyRunCount += 1;
        if (verifyRunCount === 1) {
          return [
            {
              name: "typecheck",
              passed: false,
              durationMs: 10,
              summary: "Erro TS2322 na tentativa 1",
            },
          ];
        }
        return [
          {
            name: "typecheck",
            passed: true,
            durationMs: 12,
            summary: "0 erros de compilação",
          },
        ];
      },
      finalizeRunner: async (ctx) => {
        finalizedCalledWith = {
          remoteUrl: ctx.remoteUrl,
          branchName: ctx.branchName,
        };
        return {
          mode: "draft_pr",
          commitSha: "abc123def456",
          prUrl: "https://github.com/uzina/demo/pull/99",
          shouldDeleteBranchOnCleanup: false,
        };
      },
    });

    try {
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

      // Aprova Blueprint -> roda Contract -> Build1 -> Verify1(falha) -> Build2 -> Verify2(passa) -> suspende Decision
      const suspendedDecision = await runtime.resumeDeliverableWorkflow({
        deliverableId,
        organizationId,
        input: { decision: "approved" },
      });

      expect(suspendedDecision.workflowStatus).toBe("suspended");
      expect(suspendedDecision.gate).toBe("pr_evidence_approve");
      expect(suspendedDecision.deliverableStatus).toBe("decision_pending");
      expect(verifyRunCount).toBe(2);

      // Verifier nunca recebeu pensamento/CoT interno do Builder
      expect(verifierPrompts).toHaveLength(1);
      expect(verifierPrompts[0]).not.toContain(
        "BUILDER_INTERNAL_THOUGHT_DO_NOT_LEAK"
      );

      const pendingDecisions = await db
        .select()
        .from(decisions)
        .where(eq(decisions.deliverableId, deliverableId));
      const prDecision = pendingDecisions.find(
        (d) =>
          d.decisionType === "pr_evidence_approve" && d.status === "pending"
      );
      expect(prDecision).toBeDefined();

      // Aprova via resolveDecision()
      const resolved = await runtime.resolveDecision({
        decisionId: prDecision!.id,
        organizationId,
        resolvedByUserId: ownerUserId,
        input: { status: "approved" },
      });

      expect(resolved.decision.status).toBe("approved");
      expect(resolved.decision.resolvedBy).toBe(ownerUserId);
      expect(resolved.workflowState?.deliverableStatus).toBe("merged");
      expect(resolved.workflowState?.workflowStatus).toBe("completed");
      expect(finalizedCalledWith?.remoteUrl).toBe(
        "https://github.com/uzina/demo.git"
      );

      // Tentativa concorrente/duplicada deve retornar 409 DECISION_ALREADY_RESOLVED
      await expect(
        runtime.resolveDecision({
          decisionId: prDecision!.id,
          organizationId,
          resolvedByUserId: ownerUserId,
          input: { status: "rejected" },
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        code: "DECISION_ALREADY_RESOLVED",
      });

      const [finalDeliv] = await db
        .select()
        .from(deliverables)
        .where(eq(deliverables.id, deliverableId));
      expect(finalDeliv?.status).toBe("merged");
      expect(finalDeliv?.verifyAttempts).toBe(2);
      expect(finalDeliv?.worktreePath).toBeNull();
      expect(finalDeliv?.evidencePackJson).toMatchObject({
        verifyAttempts: 2,
        verifyPassed: true,
        finalizeInfo: {
          mode: "draft_pr",
          prUrl: "https://github.com/uzina/demo/pull/99",
        },
      });

      const storedScans = await db
        .select()
        .from(securityScans)
        .where(eq(securityScans.deliverableId, deliverableId));
      expect(storedScans.length).toBeGreaterThanOrEqual(1);

      const storedEvents = await db
        .select()
        .from(executionEvents)
        .where(eq(executionEvents.deliverableId, deliverableId));
      expect(storedEvents.length).toBeGreaterThanOrEqual(4);
      expect(receivedBusEvents.length).toBeGreaterThanOrEqual(4);
    } finally {
      unsubscribe();
      await runtime.close();
    }
  });

  test("changes_requested zera verifyAttempts para 0 e rejected limpa worktree levando a failed", async () => {
    const mastraDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-s4-loop-"));
    cleanupDirs.push(mastraDir);

    const { deliverableId } = await seedDeliverable({ maxVerifyAttempts: 3 });
    const transport = createScriptedTransport((runInput) => {
      if (runInput.prompt.includes("stage_contract_and_tests")) {
        return {
          touchedFiles: ["tests/ok.test.ts"],
          writeFiles: {
            "tests/ok.test.ts":
              'import { expect, test } from "vitest";\ntest("ok", () => { expect(2).toBe(2); });\n',
          },
        };
      }
      if (runInput.prompt.includes("stage_build")) {
        return {
          touchedFiles: ["src/mod.ts"],
          writeFiles: { "src/mod.ts": "export const ok = true;\n" },
        };
      }
      return {
        structuredOutput: {
          verdict: "approved",
          summary: "OK",
          issues: [],
        },
      };
    });

    const runtime = await createMastraRuntime({
      db,
      dataDir: mastraDir,
      masterKey,
      workspaceFactory: () => new LocalGitWorktreeWorkspace(),
      transportFactory: () => transport,
      securityRunnerDeps: { commandRunner: missingScannerRunner },
      verifyRunner: async () => [
        { name: "lint", passed: true, durationMs: 5, summary: "ok" },
      ],
    });

    try {
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
      await runtime.resumeDeliverableWorkflow({
        deliverableId,
        organizationId,
        input: { decision: "approved" },
      });

      const [firstDecision] = await db
        .select()
        .from(decisions)
        .where(eq(decisions.deliverableId, deliverableId))
        .orderBy(decisions.createdAt);
      expect(firstDecision).toBeDefined();

      const allDecisions1 = await db
        .select()
        .from(decisions)
        .where(eq(decisions.deliverableId, deliverableId));
      const prDec1 = allDecisions1.find(
        (d) =>
          d.decisionType === "pr_evidence_approve" && d.status === "pending"
      );
      expect(prDec1).toBeDefined();

      // changes_requested volta a building, zera verifyAttempts para 0 e gera nova decisão pending após novo build/verify
      const afterChanges = await runtime.resolveDecision({
        decisionId: prDec1!.id,
        organizationId,
        resolvedByUserId: ownerUserId,
        input: {
          status: "changes_requested",
          humanFeedback: "Melhorar cobertura do endpoint.",
        },
      });
      expect(afterChanges.decision.status).toBe("changes_requested");
      expect(afterChanges.workflowState?.gate).toBe("pr_evidence_approve");

      const allDecisions2 = await db
        .select()
        .from(decisions)
        .where(eq(decisions.deliverableId, deliverableId));
      const prDec2 = allDecisions2.find(
        (d) =>
          d.decisionType === "pr_evidence_approve" && d.status === "pending"
      );
      expect(prDec2).toBeDefined();
      expect(prDec2?.id).not.toBe(prDec1?.id);

      const [beforeRejectRow] = await db
        .select()
        .from(deliverables)
        .where(eq(deliverables.id, deliverableId));
      const capturedWorktreePath = beforeRejectRow?.worktreePath ?? "";
      expect(fs.existsSync(capturedWorktreePath)).toBe(true);

      // Rejeição final transita para failed e remove worktree
      const afterReject = await runtime.resolveDecision({
        decisionId: prDec2!.id,
        organizationId,
        resolvedByUserId: ownerUserId,
        input: {
          status: "rejected",
          humanFeedback: "Escopo cancelado",
        },
      });
      expect(afterReject.decision.status).toBe("rejected");
      expect(afterReject.workflowState?.deliverableStatus).toBe("failed");

      const [afterRejectRow] = await db
        .select()
        .from(deliverables)
        .where(eq(deliverables.id, deliverableId));
      expect(afterRejectRow?.status).toBe("failed");
      expect(afterRejectRow?.worktreePath).toBeNull();
      expect(fs.existsSync(capturedWorktreePath)).toBe(false);
    } finally {
      await runtime.close();
    }
  });

  test("estouro de maxVerifyAttempts e curto-circuito AppSec bloqueam antes do Verifier e levam a failed", async () => {
    const mastraDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "uzina-s4-max-verify-")
    );
    cleanupDirs.push(mastraDir);

    const { deliverableId } = await seedDeliverable({ maxVerifyAttempts: 2 });
    let verifierCalled = 0;

    const transport = createScriptedTransport((runInput) => {
      if (runInput.prompt.includes("stage_contract_and_tests")) {
        return {
          touchedFiles: ["tests/bad.test.ts"],
          writeFiles: {
            "tests/bad.test.ts":
              'import { expect, it } from "vitest";\nit("valid", () => { expect(1).toBe(1); });\n',
          },
        };
      }
      if (runInput.prompt.includes("stage_build")) {
        return {
          touchedFiles: ["src/leak.ts"],
          writeFiles: {
            "src/leak.ts":
              'export const leaked = "ghp_1234567890abcdefghijklmnopqrstuvwxyz1234";\n',
          },
        };
      }
      verifierCalled += 1;
      return {
        structuredOutput: {
          verdict: "approved",
          summary: "Não deveria rodar",
          issues: [],
        },
      };
    });

    const runtime = await createMastraRuntime({
      db,
      dataDir: mastraDir,
      masterKey,
      workspaceFactory: () => new LocalGitWorktreeWorkspace(),
      transportFactory: () => transport,
      securityRunnerDeps: { commandRunner: missingScannerRunner },
      verifyRunner: async () => [
        { name: "typecheck", passed: true, durationMs: 4, summary: "ok" },
      ],
    });

    try {
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
      const finalState = await runtime.resumeDeliverableWorkflow({
        deliverableId,
        organizationId,
        input: { decision: "approved" },
      });

      expect(verifierCalled).toBe(0);
      expect(finalState.deliverableStatus).toBe("failed");
      expect(finalState.workflowStatus).toBe("failed");

      const [row] = await db
        .select()
        .from(deliverables)
        .where(eq(deliverables.id, deliverableId));
      expect(row?.verifyAttempts).toBe(2);
      expect(row?.status).toBe("failed");
    } finally {
      await runtime.close();
    }
  });
});
