import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_TOOL_POLICIES } from "@uzina/contracts";
import { encryptSecret } from "@uzina/core";
import {
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
  type UzinaDb,
} from "@uzina/db";
import {
  OpenCodeRunner,
  DockerExecutionWorkspace,
  LocalGitWorktreeWorkspace,
  type OpenCodeTransport,
  type TransportRunInput,
  type TransportSessionHandle,
} from "@uzina/opencode-bridge";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import {
  collectOrganizationKnownSecrets,
  createCodingExecutorAdapter,
  createConfiguredExecutionWorkspaceScoped,
  createGitHubDraftPrViaApi,
  createMastraRuntime,
  createTenantModelResolver,
  getEngineConfigScoped,
  getSystemReadinessScoped,
  parseGitHubOwnerRepo,
  resetAgentControllerForTests,
  resetControllerProjectCostsForTests,
  resetMastraStorageForTests,
  resolveAgencyTeamWithTieringScoped,
  resolveOrganizationGitHubPat,
  resolveOrganizationModelConfig,
  testProviderLlmConnectionScoped,
  updateEngineConfigScoped,
} from "../src/index.js";

function initGitRepo(): string {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-s25-git-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Uzina Slice25"], {
    cwd: repoDir,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.email", "s25@uzina.studio"], {
    cwd: repoDir,
    stdio: "ignore",
  });
  fs.writeFileSync(
    path.join(repoDir, "package.json"),
    JSON.stringify({ name: "s25-demo", private: true }, null, 2),
    "utf8"
  );
  execFileSync("git", ["add", "."], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "chore: initial"], {
    cwd: repoDir,
    stdio: "ignore",
  });
  return repoDir;
}

function createScriptedTransport(): OpenCodeTransport {
  return {
    async createSession(sessionInput) {
      let aborted = false;
      return {
        sessionId: `s25-${crypto.randomUUID()}`,
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
              path.join(sessionInput.workspacePath, "tests", "feature.test.ts"),
              "import { expect, test } from 'vitest';\ntest('feature', () => { expect(2 + 2).toBe(4); });\n",
              "utf8"
            );
          } else if (runInput.prompt.includes("stage_build")) {
            fs.mkdirSync(path.join(sessionInput.workspacePath, "src"), {
              recursive: true,
            });
            fs.writeFileSync(
              path.join(sessionInput.workspacePath, "src", "feature.ts"),
              "export const double = (n: number) => n * 2;\n",
              "utf8"
            );
          }

          const isVerifier =
            sessionInput.mode === "plan" ||
            runInput.prompt.includes("Verifier independente");

          return {
            finalText: isVerifier
              ? '{"verdict":"approved","summary":"Aprovado.","issues":[]}'
              : "ok",
            structuredOutput: isVerifier
              ? { verdict: "approved", summary: "Aprovado.", issues: [] }
              : undefined,
            tokenUsage: {
              inputTokens: 1200,
              outputTokens: 300,
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

describe("Slice 25 — P3.5 + P3.6 (Docker Hot-Reload, Tool Policies & GitHub Draft PR)", () => {
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
      name: "OmniRouter S25",
      providerType: "omniroute",
      baseUrl: "https://omnirouter.example.com/v1",
      encryptedApiKey: encryptSecret({
        plaintext: "sk-s25-dummy-llm-key-1234",
        masterKey,
        organizationId,
        providerType: "omniroute",
      }),
      keyPreview: "sk-s...1234",
      roleBindingsJson: {
        builder: { modelId: "omni-fast" },
        verifier: { modelId: "omni-fast" },
      },
      customPricingJson: {},
      isDefault: true,
    });
  });

  beforeEach(async () => {
    await updateEngineConfigScoped(db, {
      organizationId,
      input: {
        workspaceKind: "worktree",
        toolPolicies: { ...DEFAULT_TOOL_POLICIES },
      },
      dockerProbe: async () => ({ ready: false, version: null }),
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

  test.each([
    {
      remoteUrl: "https://github.com/uzina-studio/app.git",
      expected: { owner: "uzina-studio", repo: "app" },
    },
    {
      remoteUrl: "https://github.com/uzina-studio/app",
      expected: { owner: "uzina-studio", repo: "app" },
    },
    {
      remoteUrl: "git@github.com:uzina-studio/app.git",
      expected: { owner: "uzina-studio", repo: "app" },
    },
    {
      remoteUrl: "https://evil.com/uzina-studio/app.git",
      expected: null,
    },
    {
      remoteUrl: "http://127.0.0.1:8080/uzina-studio/app.git",
      expected: null,
    },
    {
      remoteUrl: "https://github.com/only-owner",
      expected: null,
    },
  ])("parseGitHubOwnerRepo($remoteUrl) valida remote estritamente", ({
    remoteUrl,
    expected,
  }) => {
    expect(parseGitHubOwnerRepo(remoteUrl)).toEqual(expected);
  });

  test("createConfiguredExecutionWorkspaceScoped faz hot-reload Docker e registra fallback_to_worktree auditável quando daemon está offline", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const [proj] = await db
      .insert(projects)
      .values({
        clientId: internalClientId,
        name: `Proj Docker ${suffix}`,
        slug: `proj-docker-${suffix}`,
      })
      .returning();
    const [deliv] = await db
      .insert(deliverables)
      .values({
        projectId: proj!.id,
        title: "Teste Docker Hot-Reload",
        status: "contract_tests",
      })
      .returning();

    const updated = await updateEngineConfigScoped(db, {
      organizationId,
      input: {
        workspaceKind: "docker",
        dockerCpuLimit: "2.0",
        dockerMemoryLimit: "1024m",
      },
      dockerProbe: async () => ({
        ready: true,
        version: "27.0.1",
      }),
    });

    expect(updated.config.workspaceKind).toBe("docker");
    expect(updated.dockerReady).toBe(true);
    expect(updated.dockerVersion).toBe("27.0.1");

    const dockerRes = await createConfiguredExecutionWorkspaceScoped(db, {
      organizationId,
      deliverableId: deliv!.id,
      stage: "stage_build",
      dockerProbe: async () => ({
        ready: true,
        version: "27.0.1",
      }),
    });
    expect(dockerRes.effectiveKind).toBe("docker");
    expect(dockerRes.fellBackToWorktree).toBe(false);
    expect(dockerRes.workspace).toBeInstanceOf(DockerExecutionWorkspace);

    const fallbackRes = await createConfiguredExecutionWorkspaceScoped(db, {
      organizationId,
      deliverableId: deliv!.id,
      stage: "stage_build",
      dockerProbe: async () => ({
        ready: false,
        version: null,
        errorCode: "DOCKER_UNAVAILABLE",
      }),
    });
    expect(fallbackRes.effectiveKind).toBe("worktree");
    expect(fallbackRes.fellBackToWorktree).toBe(true);
    expect(fallbackRes.workspace).toBeInstanceOf(LocalGitWorktreeWorkspace);

    const fallbackTimeoutRes = await createConfiguredExecutionWorkspaceScoped(db, {
      organizationId,
      deliverableId: deliv!.id,
      stage: "stage_build",
      dockerProbe: async () => ({
        ready: false,
        version: null,
        errorCode: "DOCKER_TIMEOUT",
      }),
    });
    expect(fallbackTimeoutRes.effectiveKind).toBe("worktree");
    expect(fallbackTimeoutRes.fellBackToWorktree).toBe(true);

    const fallbackEvents = await db
      .select()
      .from(executionEvents)
      .where(
        and(
          eq(executionEvents.deliverableId, deliv!.id),
          eq(executionEvents.eventType, "fallback_to_worktree")
        )
      );
    expect(fallbackEvents).toHaveLength(2);
    expect(fallbackEvents[0]!.payloadJson).toMatchObject({
      requestedKind: "docker",
      effectiveKind: "worktree",
      reason: "DOCKER_UNAVAILABLE",
    });
    expect(fallbackEvents[1]!.payloadJson).toMatchObject({
      reason: "DOCKER_TIMEOUT",
    });
  });

  test("GitHub PAT fica isolado de provedores LLM, é descriptografado com AAD correto e cria Draft PR via REST API com redação de segredos", async () => {
    const secretPat = "ghp_slice25SecretTokenValue987654321";

    const [isoOrg] = await db
      .insert(organizations)
      .values({
        name: "Org Apenas PAT",
        slug: `org-pat-${crypto.randomUUID().slice(0, 8)}`,
      })
      .returning();

    await db.insert(providerProfiles).values({
      organizationId: isoOrg!.id,
      name: "GitHub PAT Isolado",
      providerType: "github_pat",
      baseUrl: "https://api.github.com",
      encryptedApiKey: encryptSecret({
        plaintext: secretPat,
        masterKey,
        organizationId: isoOrg!.id,
        providerType: "github_pat",
      }),
      keyPreview: "ghp...4321",
      roleBindingsJson: {},
      customPricingJson: {},
      isDefault: false,
    });

    const resolvedPat = await resolveOrganizationGitHubPat(db, {
      organizationId: isoOrg!.id,
      masterKey,
    });
    expect(resolvedPat).toBe(secretPat);

    const readinessOnlyPat = await getSystemReadinessScoped(
      db,
      isoOrg!.id
    );
    expect(readinessOnlyPat.llmProviderConfigured).toBe(false);

    const team = await resolveAgencyTeamWithTieringScoped(db, organizationId);
    expect(team[0]?.boundModelId).toContain("openai/");

    let capturedUrl = "";
    let capturedAuth = "";
    let capturedDraft = false;
    const okRes = await createGitHubDraftPrViaApi({
      owner: "uzina-studio",
      repo: "demo-app",
      head: "feat/deliverable-1",
      base: "main",
      title: "[Uzina] Demo PR",
      body: "Corpo do PR",
      pat: secretPat,
      fetchImpl: async (input, init) => {
        capturedUrl = String(input);
        const headers = init?.headers as Record<string, string>;
        capturedAuth = headers.Authorization ?? "";
        const parsedBody = JSON.parse(String(init?.body ?? "{}")) as {
          draft?: boolean;
        };
        capturedDraft = Boolean(parsedBody.draft);
        return new Response(
          JSON.stringify({
            html_url: "https://github.com/uzina-studio/demo-app/pull/42",
            number: 42,
          }),
          {
            status: 201,
            headers: { "content-type": "application/json" },
          }
        );
      },
    });

    expect(capturedUrl).toBe(
      "https://api.github.com/repos/uzina-studio/demo-app/pulls"
    );
    expect(capturedAuth).toBe(`Bearer ${secretPat}`);
    expect(capturedDraft).toBe(true);
    expect(okRes).toEqual({
      ok: true,
      prUrl: "https://github.com/uzina-studio/demo-app/pull/42",
      number: 42,
    });

    const errRes = await createGitHubDraftPrViaApi({
      owner: "uzina-studio",
      repo: "demo-app",
      head: "feat/deliverable-1",
      base: "main",
      title: "[Uzina] Erro",
      body: "Corpo",
      pat: secretPat,
      fetchImpl: async () => {
        throw new Error(`Falha ao autenticar token ${secretPat} no GitHub`);
      },
    });
    expect(errRes.ok).toBe(false);
    expect(errRes.prUrl).toBeNull();
    expect(errRes.error).toContain("Falha ao autenticar token");
    expect(errRes.error).not.toContain(secretPat);

    const http422Res = await createGitHubDraftPrViaApi({
      owner: "uzina-studio",
      repo: "demo-app",
      head: "feat/deliverable-1",
      base: "main",
      title: "[Uzina] Erro 422",
      body: "Corpo",
      pat: secretPat,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ message: `Bad credentials ${secretPat}` }),
          { status: 422, headers: { "content-type": "application/json" } }
        ),
    });
    expect(http422Res.ok).toBe(false);
    expect(http422Res.error).toContain("Bad credentials");
    expect(http422Res.error).not.toContain(secretPat);

    const ac = new AbortController();
    ac.abort();
    const abortedRes = await createGitHubDraftPrViaApi({
      owner: "uzina-studio",
      repo: "demo-app",
      head: "feat/deliverable-1",
      base: "main",
      title: "[Uzina] Abort",
      body: "Corpo",
      pat: secretPat,
      signal: ac.signal,
    });
    expect(abortedRes.ok).toBe(false);
    expect(abortedRes.error).toContain("AbortSignal");

    const missingPat = await resolveOrganizationGitHubPat(db, {
      organizationId,
      masterKey,
    });
    expect(missingPat).toBeNull();

    const wrongKeyPat = await resolveOrganizationGitHubPat(db, {
      organizationId: isoOrg!.id,
      masterKey: crypto.randomBytes(32),
    });
    expect(wrongKeyPat).toBeNull();

    const knownSecrets = await collectOrganizationKnownSecrets(db, {
      organizationId: isoOrg!.id,
      masterKey,
    });
    expect(knownSecrets).toContain(secretPat);

    const [isoPatRow] = await db
      .select()
      .from(providerProfiles)
      .where(eq(providerProfiles.organizationId, isoOrg!.id));
    let ssrfFetchCalled = false;
    const overrideBlocked = await testProviderLlmConnectionScoped(db, {
      organizationId: isoOrg!.id,
      masterKey,
      request: {
        providerId: isoPatRow!.id,
        providerType: "omniroute",
        baseUrl: "http://127.0.0.1:9999/v1",
      },
      fetchImpl: async () => {
        ssrfFetchCalled = true;
        return new Response("{}", { status: 200 });
      },
    });
    expect(overrideBlocked.ok).toBe(false);
    expect(ssrfFetchCalled).toBe(false);
    expect(overrideBlocked.error).toContain("providerType");

    // Regressão: github_pat com isDefault=true mais recente não pode sequestrar model-resolver / OM
    await db.insert(providerProfiles).values({
      organizationId,
      name: "GitHub PAT Default Mais Recente",
      providerType: "github_pat",
      baseUrl: "https://api.github.com",
      encryptedApiKey: encryptSecret({
        plaintext: secretPat,
        masterKey,
        organizationId,
        providerType: "github_pat",
      }),
      keyPreview: "ghp...4321",
      roleBindingsJson: {},
      customPricingJson: {},
      isDefault: true,
      updatedAt: new Date(Date.now() + 60_000),
    });

    const resolvedModel = await resolveOrganizationModelConfig(db, {
      organizationId,
      agentRole: "builder",
      masterKey,
    });
    expect(resolvedModel?.providerType).toBe("omniroute");

    const resolver = createTenantModelResolver({ db, masterKey });
    const omModel = await resolver.resolveOmModel(
      organizationId,
      "google/gemini-2.5-flash"
    );
    expect(omModel).toBeDefined();
    expect(
      await resolveOrganizationGitHubPat(db, { organizationId, masterKey })
    ).toBe(secretPat);
  });

  test("toolPolicies impõe ask em writeFiles (tool_policy_approval) e deny em gitFinalize preservando branch", async () => {
    const repoDir = initGitRepo();
    tempDirs.push(repoDir);

    const cfgAfterPut = await updateEngineConfigScoped(db, {
      organizationId,
      input: {
        toolPolicies: {
          readCode: "allow",
          runTests: "allow",
          writeFiles: "ask",
          gitFinalize: "deny",
        },
      },
      dockerProbe: async () => ({ ready: false, version: null }),
    });
    expect(cfgAfterPut.config.toolPolicies).toEqual({
      readCode: "allow",
      runTests: "allow",
      writeFiles: "ask",
      gitFinalize: "deny",
    });

    const fetchedCfg = await getEngineConfigScoped(db, {
      organizationId,
      dockerProbe: async () => ({ ready: false, version: null }),
    });
    expect(fetchedCfg.config.toolPolicies.writeFiles).toBe("ask");

    const suffix = crypto.randomUUID().slice(0, 8);
    const [proj] = await db
      .insert(projects)
      .values({
        clientId: internalClientId,
        name: `Proj Policies ${suffix}`,
        slug: `proj-policies-${suffix}`,
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
        name: "s25-repo",
        localPath: repoDir,
        defaultBranch: "main",
      })
      .returning();

    const [deliv] = await db
      .insert(deliverables)
      .values({
        projectId: proj!.id,
        repositoryId: repo!.id,
        title: "Feature sob Políticas Granulares",
        status: "contract_tests",
        hasUi: false,
        developmentStrategy: "api_contract_first",
        specMarkdown: "# Spec\nFeature controlada.",
      })
      .returning();

    let finalizeRunnerCalled = false;
    const runtime = await createMastraRuntime({
      db,
      dataDir: ":memory:",
      masterKey,
      dockerProbe: async () => ({ ready: false, version: null }),
      transportFactory: () => createScriptedTransport(),
      verifyRunner: async () => [
        { name: "vitest", passed: true, durationMs: 10, summary: "OK" },
      ],
      finalizeRunner: async () => {
        finalizeRunnerCalled = true;
        return {
          mode: "local_merge",
          commitSha: "deadbeef",
          prUrl: null,
          shouldDeleteBranchOnCleanup: true,
          mergeBlockedReason: null,
        };
      },
    });

    try {
      const startState = await runtime.startDeliverableWorkflow({
        deliverableId: deliv!.id,
        organizationId,
        input: {},
      });
      expect(startState.workflowStatus).toBe("suspended");

      const pendingContractDecisions = await db
        .select()
        .from(decisions)
        .where(
          and(
            eq(decisions.deliverableId, deliv!.id),
            eq(decisions.status, "pending")
          )
        );
      expect(pendingContractDecisions).toHaveLength(1);
      expect(pendingContractDecisions[0]!.decisionType).toBe(
        "tool_policy_approval"
      );
      expect(pendingContractDecisions[0]!.payloadJson).toMatchObject({
        gate: "tool_policy_approval",
        stage: "contract_tests",
        toolClass: "writeFiles",
      });

      const afterApproveContract = await runtime.resolveDecision({
        decisionId: pendingContractDecisions[0]!.id,
        organizationId,
        actorRole: "owner",
        input: { status: "approved" },
      });
      expect(afterApproveContract.workflowState?.workflowStatus).toBe(
        "suspended"
      );

      const pendingToolDecisions = await db
        .select()
        .from(decisions)
        .where(
          and(
            eq(decisions.deliverableId, deliv!.id),
            eq(decisions.status, "pending")
          )
        );
      expect(pendingToolDecisions).toHaveLength(1);
      expect(pendingToolDecisions[0]!.decisionType).toBe("tool_policy_approval");
      expect(pendingToolDecisions[0]!.payloadJson).toMatchObject({
        gate: "tool_policy_approval",
        stage: "building",
        toolClass: "writeFiles",
      });

      const afterApproveTool = await runtime.resolveDecision({
        decisionId: pendingToolDecisions[0]!.id,
        organizationId,
        actorRole: "owner",
        input: { status: "approved" },
      });
      expect(afterApproveTool.workflowState?.deliverableStatus).toBe(
        "decision_pending"
      );

      const finalPending = await db
        .select()
        .from(decisions)
        .where(
          and(
            eq(decisions.deliverableId, deliv!.id),
            eq(decisions.status, "pending")
          )
        );
      expect(finalPending).toHaveLength(1);
      expect(finalPending[0]!.decisionType).toBe("pr_evidence_approve");

      const finalized = await runtime.resolveDecision({
        decisionId: finalPending[0]!.id,
        organizationId,
        actorRole: "owner",
        input: { status: "approved" },
      });
      expect(finalizeRunnerCalled).toBe(false);
      expect(finalized.workflowState?.deliverableStatus).toBe("merged");

      const [stored] = await db
        .select()
        .from(deliverables)
        .where(eq(deliverables.id, deliv!.id));
      expect(stored?.branchName).toBeTruthy();
      expect(stored?.evidencePackJson).toMatchObject({
        finalizeInfo: {
          mode: "local_branch_ready",
          mergeBlockedReason: expect.stringContaining("gitFinalize=deny"),
        },
      });

      const finalizeEvents = await db
        .select()
        .from(executionEvents)
        .where(
          and(
            eq(executionEvents.deliverableId, deliv!.id),
            eq(executionEvents.stage, "stage_finalize"),
            eq(executionEvents.eventType, "tool_call")
          )
        );
      expect(
        finalizeEvents.some(
          (e) =>
            (e.payloadJson as { toolName?: string; status?: string })
              .toolName === "git_finalize" &&
            (e.payloadJson as { status?: string }).status === "error"
        )
      ).toBe(true);
    } finally {
      await runtime.close();
    }
  });

  test("toolPolicies runTests=deny bloqueia verifyRunner e registra falha determinística policy:runTests", async () => {
    const repoDir = initGitRepo();
    tempDirs.push(repoDir);

    await updateEngineConfigScoped(db, {
      organizationId,
      input: {
        toolPolicies: {
          readCode: "allow",
          runTests: "deny",
          writeFiles: "allow",
          gitFinalize: "allow",
        },
      },
      dockerProbe: async () => ({ ready: false, version: null }),
    });

    const suffix = crypto.randomUUID().slice(0, 8);
    const [proj] = await db
      .insert(projects)
      .values({
        clientId: internalClientId,
        name: `Proj Deny Tests ${suffix}`,
        slug: `proj-deny-tests-${suffix}`,
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
        name: "s25-deny-tests",
        localPath: repoDir,
        defaultBranch: "main",
      })
      .returning();

    const [deliv] = await db
      .insert(deliverables)
      .values({
        projectId: proj!.id,
        repositoryId: repo!.id,
        title: "Entregável com runTests=deny",
        status: "contract_tests",
        hasUi: false,
        maxVerifyAttempts: 1,
        developmentStrategy: "api_contract_first",
        specMarkdown: "# Spec\nSem execução de testes.",
      })
      .returning();

    let verifyRunnerCalled = false;
    const runtime = await createMastraRuntime({
      db,
      dataDir: ":memory:",
      masterKey,
      dockerProbe: async () => ({ ready: false, version: null }),
      transportFactory: () => createScriptedTransport(),
      verifyRunner: async () => {
        verifyRunnerCalled = true;
        return [{ name: "vitest", passed: true, durationMs: 5, summary: "OK" }];
      },
    });

    try {
      const state = await runtime.startDeliverableWorkflow({
        deliverableId: deliv!.id,
        organizationId,
        input: {},
      });
      expect(verifyRunnerCalled).toBe(false);
      expect(state.deliverableStatus).toBe("failed");

      const verifyToolEvents = await db
        .select()
        .from(executionEvents)
        .where(
          and(
            eq(executionEvents.deliverableId, deliv!.id),
            eq(executionEvents.stage, "stage_verify"),
            eq(executionEvents.eventType, "tool_call")
          )
        );
      expect(
        verifyToolEvents.some(
          (e) =>
            (e.payloadJson as { toolName?: string; status?: string })
              .toolName === "verify_runner" &&
            (e.payloadJson as { status?: string }).status === "error"
        )
      ).toBe(true);
    } finally {
      await runtime.close();
    }
  });

  test("OpenCodeExecutorAdapter bloqueia readCode=deny e stage_finalize suspende em gitFinalize=ask antes de mesclar", async () => {
    const repoDir = initGitRepo();
    tempDirs.push(repoDir);

    const dummyRunner = new OpenCodeRunner({
      transport: createScriptedTransport(),
      masterKey,
    });
    const opencodeAdapter = createCodingExecutorAdapter({
      mode: "opencode",
      runner: dummyRunner,
      masterKey,
    });
    const blockedRead = await opencodeAdapter.runSession({
      workspacePath: repoDir,
      mode: "plan",
      role: "builder",
      prompt: "ler arquivo",
      toolPolicies: {
        readCode: "deny",
        runTests: "allow",
        writeFiles: "allow",
        gitFinalize: "allow",
      },
      providerConfig: {
        organizationId,
        providerType: "omniroute",
        roleBindings: { builder: { modelId: "omni-fast" } },
      },
    });
    expect(blockedRead.status).toBe("error");
    expect(blockedRead.errorMessage).toContain("readCode=deny");

    await updateEngineConfigScoped(db, {
      organizationId,
      input: {
        toolPolicies: {
          readCode: "allow",
          runTests: "allow",
          writeFiles: "allow",
          gitFinalize: "ask",
        },
      },
      dockerProbe: async () => ({ ready: false, version: null }),
    });

    const suffix = crypto.randomUUID().slice(0, 8);
    const [proj] = await db
      .insert(projects)
      .values({
        clientId: internalClientId,
        name: `Proj Ask Finalize ${suffix}`,
        slug: `proj-ask-finalize-${suffix}`,
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
        name: "s25-ask-finalize",
        localPath: repoDir,
        defaultBranch: "main",
      })
      .returning();

    const [deliv] = await db
      .insert(deliverables)
      .values({
        projectId: proj!.id,
        repositoryId: repo!.id,
        title: "Entregável com gitFinalize=ask",
        status: "contract_tests",
        hasUi: false,
        developmentStrategy: "api_contract_first",
        specMarkdown: "# Spec\nAprovar gitFinalize.",
      })
      .returning();

    let finalizeCalls = 0;
    const runtime = await createMastraRuntime({
      db,
      dataDir: ":memory:",
      masterKey,
      dockerProbe: async () => ({ ready: false, version: null }),
      transportFactory: () => createScriptedTransport(),
      verifyRunner: async () => [
        { name: "vitest", passed: true, durationMs: 8, summary: "OK" },
      ],
      finalizeRunner: async () => {
        finalizeCalls += 1;
        return {
          mode: "local_merge",
          commitSha: "cafebabe",
          prUrl: null,
          shouldDeleteBranchOnCleanup: true,
          mergeBlockedReason: null,
        };
      },
    });

    try {
      const startState = await runtime.startDeliverableWorkflow({
        deliverableId: deliv!.id,
        organizationId,
        input: {},
      });
      expect(startState.deliverableStatus).toBe("decision_pending");

      const [evDec] = await db
        .select()
        .from(decisions)
        .where(
          and(
            eq(decisions.deliverableId, deliv!.id),
            eq(decisions.status, "pending")
          )
        );
      const afterEvidence = await runtime.resolveDecision({
        decisionId: evDec!.id,
        organizationId,
        actorRole: "owner",
        input: { status: "approved" },
      });
      expect(finalizeCalls).toBe(0);
      expect(afterEvidence.workflowState?.workflowStatus).toBe("suspended");

      const [gitPolicyDec] = await db
        .select()
        .from(decisions)
        .where(
          and(
            eq(decisions.deliverableId, deliv!.id),
            eq(decisions.status, "pending")
          )
        );
      expect(gitPolicyDec?.decisionType).toBe("tool_policy_approval");
      expect(gitPolicyDec?.payloadJson).toMatchObject({
        gate: "tool_policy_approval",
        stage: "stage_finalize",
        toolClass: "gitFinalize",
      });

      const completed = await runtime.resolveDecision({
        decisionId: gitPolicyDec!.id,
        organizationId,
        actorRole: "owner",
        input: { status: "approved" },
      });
      expect(finalizeCalls).toBe(1);
      expect(completed.workflowState?.deliverableStatus).toBe("merged");
    } finally {
      await runtime.close();
    }
  });
});
