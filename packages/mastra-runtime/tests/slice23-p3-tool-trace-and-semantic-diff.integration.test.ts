import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  EvidencePackSchema,
  ToolCallTracePayloadSchema,
} from "@uzina/contracts";
import { encryptSecret } from "@uzina/core";
import {
  closeDb,
  deliverables,
  ensureDefaultOrgAndInternalClient,
  executionEvents,
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
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  createMastraRuntime,
  resetAgentControllerForTests,
  resetControllerProjectCostsForTests,
  resetMastraStorageForTests,
} from "../src/index.js";

function initMultiFileGitRepo(): string {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-s23-git-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Uzina Slice23"], {
    cwd: repoDir,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.email", "s23@uzina.studio"], {
    cwd: repoDir,
    stdio: "ignore",
  });
  fs.writeFileSync(
    path.join(repoDir, "package.json"),
    JSON.stringify({ name: "s23-demo", version: "0.1.0", private: true }, null, 2),
    "utf8"
  );
  fs.writeFileSync(
    path.join(repoDir, "AGENTS.md"),
    "# S23 Demo\nKeep clean code.\n",
    "utf8"
  );
  execFileSync("git", ["add", "."], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "chore: initial"], {
    cwd: repoDir,
    stdio: "ignore",
  });
  return repoDir;
}

function createMultiFileTransport(): OpenCodeTransport {
  return {
    async createSession(sessionInput) {
      let aborted = false;
      return {
        sessionId: `s23-${crypto.randomUUID()}`,
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
            fs.mkdirSync(path.join(sessionInput.workspacePath, "docs"), {
              recursive: true,
            });
            fs.writeFileSync(
              path.join(sessionInput.workspacePath, "src", "feature.ts"),
              [
                "export function buildGreeting(name: string) {",
                "  const fallbackToken = 'sk-secret-token-999999';",
                "  return `${name}:${fallbackToken}`;",
                "}",
              ].join("\n"),
              "utf8"
            );
            fs.writeFileSync(
              path.join(sessionInput.workspacePath, "package.json"),
              JSON.stringify(
                { name: "s23-demo", version: "0.2.0", private: true },
                null,
                2
              ),
              "utf8"
            );
            fs.writeFileSync(
              path.join(sessionInput.workspacePath, "docs", "guide.md"),
              "# Feature Guide\nDocumentação da feature.\n",
              "utf8"
            );
          }

          const isVerifier =
            sessionInput.mode === "plan" ||
            runInput.prompt.includes("Verifier independente");
          return {
            finalText: isVerifier
              ? '{"verdict":"approved","summary":"Diff semântico aprovado.","issues":[]}'
              : "ok",
            structuredOutput: isVerifier
              ? {
                  verdict: "approved",
                  summary: "Diff semântico aprovado.",
                  issues: [],
                }
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

describe("Slice 23 — P3.1 Tool Trace Timeline & P3.2 Semantic Diff Chunking", () => {
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
      name: "OmniRouter S23",
      providerType: "omniroute",
      baseUrl: "https://omnirouter.example.com/v1",
      encryptedApiKey: encryptSecret({
        plaintext: "sk-s23-dummy-key-123456",
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

  test("emite tool_call estruturado e popula diffSummary.fileDiffs + testCommandOutput redigido no evidencePack", async () => {
    const repoDir = initMultiFileGitRepo();
    tempDirs.push(repoDir);

    const suffix = crypto.randomUUID().slice(0, 8);
    const [proj] = await db
      .insert(projects)
      .values({
        clientId: internalClientId,
        name: `Proj S23 ${suffix}`,
        slug: `proj-s23-${suffix}`,
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
        name: "s23-demo",
        localPath: repoDir,
        defaultBranch: "main",
      })
      .returning();

    const [deliv] = await db
      .insert(deliverables)
      .values({
        projectId: proj!.id,
        repositoryId: repo!.id,
        title: "Feature Multi-Arquivo S23",
        description: "Criar src/feature.ts, tests/feature.test.ts, package.json e docs/guide.md.",
        status: "contract_tests",
        hasUi: false,
        developmentStrategy: "api_contract_first",
        specMarkdown: "# Spec S23\nCriar feature completa.",
      })
      .returning();

    const runtime = await createMastraRuntime({
      db,
      dataDir: ":memory:",
      masterKey,
      transportFactory: () => createMultiFileTransport(),
      verifyRunner: async ({ attemptNumber }) => [
        {
          name: "vitest",
          passed: true,
          durationMs: 18,
          summary: `Attempt ${attemptNumber} OK (token=sk-verify-leak-999999)`,
        },
      ],
    });

    try {
      const state = await runtime.startDeliverableWorkflow({
        deliverableId: deliv!.id,
        organizationId,
        input: {},
      });
      expect(state.deliverableStatus).toBe("decision_pending");

      const [updatedDeliv] = await db
        .select()
        .from(deliverables)
        .where(eq(deliverables.id, deliv!.id));

      const pack = EvidencePackSchema.parse(updatedDeliv?.evidencePackJson);
      expect(pack.verifyPassed).toBe(true);
      expect(pack.diffSummary.fileDiffs?.length ?? 0).toBeGreaterThanOrEqual(4);

      const byPath = new Map(
        pack.diffSummary.fileDiffs!.map((f) => [f.filePath, f])
      );
      expect(byPath.get("src/feature.ts")?.category).toBe("code");
      expect(byPath.get("src/feature.ts")?.additions).toBe(4);
      expect(byPath.get("src/feature.ts")?.hunkPreview).not.toContain(
        "sk-secret-token-999999"
      );
      expect(byPath.get("src/feature.ts")?.hunkPreview).toContain("[REDACTED]");

      expect(byPath.get("tests/feature.test.ts")?.category).toBe("test");
      expect(byPath.get("package.json")?.category).toBe("config");
      expect(byPath.get("docs/guide.md")?.category).toBe("docs");

      expect(pack.testCommandOutput).toContain("[PASS] vitest");
      expect(pack.testCommandOutput).not.toContain("sk-verify-leak-999999");
      expect(pack.testCommandOutput).toContain("[REDACTED]");

      const events = await db
        .select()
        .from(executionEvents)
        .where(eq(executionEvents.deliverableId, deliv!.id))
        .orderBy(asc(executionEvents.createdAt), asc(executionEvents.id));

      const toolEvents = events.filter((ev) => ev.eventType === "tool_call");
      expect(toolEvents.length).toBeGreaterThanOrEqual(6);

      const parsedPayloads = toolEvents.map((ev) =>
        ToolCallTracePayloadSchema.parse(ev.payloadJson)
      );
      for (const expectedTool of ["audit:tests", "verify_runner", "security-engine"]) {
        const startIdx = parsedPayloads.findIndex(
          (p) =>
            p.toolName === expectedTool &&
            p.phase === "start" &&
            p.status === "running"
        );
        const resultIdx = parsedPayloads.findIndex(
          (p) =>
            p.toolName === expectedTool &&
            p.phase === "result" &&
            p.status === "ok" &&
            typeof p.durationMs === "number"
        );
        expect(startIdx).toBeGreaterThanOrEqual(0);
        expect(resultIdx).toBeGreaterThan(startIdx);
      }
    } finally {
      await runtime.close();
    }
  });

  test("emite tool_call com status error e [FAIL] em testCommandOutput quando verifyRunner falha", async () => {
    const repoDir = initMultiFileGitRepo();
    tempDirs.push(repoDir);

    const suffix = crypto.randomUUID().slice(0, 8);
    const [proj] = await db
      .insert(projects)
      .values({
        clientId: internalClientId,
        name: `Proj S23 Err ${suffix}`,
        slug: `proj-s23-err-${suffix}`,
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
        name: "s23-err",
        localPath: repoDir,
        defaultBranch: "main",
      })
      .returning();

    const [deliv] = await db
      .insert(deliverables)
      .values({
        projectId: proj!.id,
        repositoryId: repo!.id,
        title: "Entrega Falha Verify S23",
        description: "Testar trace de erro.",
        status: "contract_tests",
        maxVerifyAttempts: 1,
        hasUi: false,
        developmentStrategy: "api_contract_first",
        specMarkdown: "# Spec S23 Erro",
      })
      .returning();

    const runtime = await createMastraRuntime({
      db,
      dataDir: ":memory:",
      masterKey,
      transportFactory: () => createMultiFileTransport(),
      verifyRunner: async () => [
        {
          name: "vitest",
          passed: false,
          durationMs: 15,
          summary: "1 teste falhou",
        },
      ],
    });

    try {
      const state = await runtime.startDeliverableWorkflow({
        deliverableId: deliv!.id,
        organizationId,
        input: {},
      });
      expect(["decision_pending", "failed"]).toContain(state.deliverableStatus);

      const events = await db
        .select()
        .from(executionEvents)
        .where(eq(executionEvents.deliverableId, deliv!.id))
        .orderBy(asc(executionEvents.createdAt), asc(executionEvents.id));

      const errorTrace = events
        .filter((ev) => ev.eventType === "tool_call")
        .map((ev) => ToolCallTracePayloadSchema.parse(ev.payloadJson))
        .find(
          (p) =>
            p.toolName === "verify_runner" &&
            p.phase === "result" &&
            p.status === "error"
        );
      expect(errorTrace).toMatchObject({
        toolName: "verify_runner",
        phase: "result",
        status: "error",
      });

      const [updatedDeliv] = await db
        .select()
        .from(deliverables)
        .where(eq(deliverables.id, deliv!.id));
      const pack = EvidencePackSchema.parse(updatedDeliv?.evidencePackJson);
      expect(pack.verifyPassed).toBe(false);
      expect(pack.testCommandOutput).toContain("[FAIL] vitest");
    } finally {
      await runtime.close();
    }
  });
});
