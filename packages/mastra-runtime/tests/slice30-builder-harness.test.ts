import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MastraLanguageModelV2Mock,
  simulateReadableStream,
} from "@mastra/core/test-utils/llm-mock";
import { WORKSPACE_TOOLS } from "@mastra/core/workspace";
import {
  DEFAULT_TOOL_POLICIES,
  type OpenCodeProviderConfig,
} from "@uzina/contracts";
import {
  StuckDetector,
  evaluateConsecutiveErrorStrike,
  validateMigrationSafety,
  type StuckThreeStrikeDirective,
} from "@uzina/core";
import {
  clients,
  closeDb,
  deliverables,
  ensureDefaultOrgAndInternalClient,
  executionEvents,
  getDb,
  projectRepositories,
  projects,
  type UzinaDb,
} from "@uzina/db";
import { OpenCodeRunner } from "@uzina/opencode-bridge";
import { InMemoryOpenCodeTransport } from "@uzina/opencode-bridge/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  MastraWorkspaceExecutorAdapter,
  assertAllowedTargetPackage,
  assertAllowedUnitTestPath,
  createScopedMicroLoopTools,
  type ScopedSubprocessRunner,
} from "../src/workspace-adapter.js";

const tempDirs: string[] = [];

function createTempWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-s30-ws-"));
  tempDirs.push(dir);
  return dir;
}

function createScriptedToolMockModel(params: {
  toolName: string;
  toolInput: Record<string, unknown>;
  finalText: string;
}) {
  const usage = { inputTokens: 25, outputTokens: 15, totalTokens: 40 };
  let step = 0;
  const serializedInput = JSON.stringify(params.toolInput);

  const nextKind = (): "tool-call" | "text" => {
    if (step === 0) {
      step += 1;
      return "tool-call";
    }
    return "text";
  };

  return new MastraLanguageModelV2Mock({
    provider: "mock-s30",
    modelId: "mock-s30-builder",
    doGenerate: async () => {
      const kind = nextKind();
      if (kind === "tool-call") {
        return {
          content: [
            {
              type: "tool-call" as const,
              toolCallId: "tc-s30-1",
              toolName: params.toolName,
              input: serializedInput,
            },
          ],
          finishReason: "tool-calls" as const,
          usage,
          warnings: [],
          rawCall: { rawPrompt: null, rawSettings: {} },
          request: { body: {} },
          response: { headers: {} },
          stream: simulateReadableStream({ chunks: [] }),
        };
      }
      return {
        content: [{ type: "text" as const, text: params.finalText }],
        finishReason: "stop" as const,
        usage,
        warnings: [],
        rawCall: { rawPrompt: null, rawSettings: {} },
        request: { body: {} },
        response: { headers: {} },
        stream: simulateReadableStream({ chunks: [] }),
      };
    },
    doStream: async () => {
      const kind = nextKind();
      if (kind === "tool-call") {
        return {
          rawCall: { rawPrompt: null, rawSettings: {} },
          warnings: [],
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              {
                type: "response-metadata",
                id: "id-s30-tc",
                modelId: "mock-s30-builder",
                timestamp: new Date(0),
              },
              {
                type: "tool-input-start",
                id: "tc-s30-1",
                toolName: params.toolName,
              },
              {
                type: "tool-input-delta",
                id: "tc-s30-1",
                delta: serializedInput,
              },
              {
                type: "tool-input-end",
                id: "tc-s30-1",
              },
              {
                type: "tool-call",
                toolCallId: "tc-s30-1",
                toolName: params.toolName,
                input: serializedInput,
              },
              {
                type: "finish",
                finishReason: "tool-calls",
                usage,
              },
            ],
          }),
        };
      }

      return {
        rawCall: { rawPrompt: null, rawSettings: {} },
        warnings: [],
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            {
              type: "response-metadata",
              id: "id-s30-txt",
              modelId: "mock-s30-builder",
              timestamp: new Date(0),
            },
            { type: "text-start", id: "t-s30" },
            { type: "text-delta", id: "t-s30", delta: params.finalText },
            { type: "text-end", id: "t-s30" },
            {
              type: "finish",
              finishReason: "stop",
              usage,
            },
          ],
        }),
      };
    },
  });
}

describe("Slice 30 — Builder Harness: Test Lock, Micro-Loop, Migration Safety & 3-Strikes", () => {
  let db: UzinaDb;
  let organizationId: string;
  let projectId: string;
  let repositoryId: string;
  const masterKey = crypto.randomBytes(32);

  beforeAll(async () => {
    const conn = await getDb({ dataDir: ":memory:" });
    db = conn.db;
    const seed = await ensureDefaultOrgAndInternalClient(db);
    organizationId = seed.organizationId;

    const [client] = await db
      .select()
      .from(clients)
      .where(eq(clients.organizationId, organizationId))
      .limit(1);

    const [proj] = await db
      .insert(projects)
      .values({
        clientId: client!.id,
        name: "Slice 30 Harness Project",
        slug: "slice-30-harness",
      })
      .returning();
    projectId = proj!.id;

    const [repo] = await db
      .insert(projectRepositories)
      .values({
        projectId,
        name: "s30-repo",
        localPath: os.tmpdir(),
        defaultBranch: "main",
      })
      .returning();
    repositoryId = repo!.id;
  });

  afterAll(async () => {
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

  const makeProviderConfig = (): OpenCodeProviderConfig => ({
    providerType: "ollama",
    baseUrl: "http://127.0.0.1:11434",
    encryptedApiKey: null,
    organizationId,
    roleBindings: {
      builder: { modelId: "ollama/qwen2.5-coder:14b" },
    },
  });

  describe("Test Lock (Anti-Reward Hacking no MastraWorkspaceExecutorAdapter)", () => {
    test.each([
      {
        label: "WRITE_FILE com barra invertida Windows",
        toolName: WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE,
        lockedPath: "tests\\contract.test.ts",
        targetRel: "tests/contract.test.ts",
        toolInput: {
          path: "./tests/contract.test.ts",
          content: "export const hacked = true;\n",
          overwrite: true,
        },
      },
      {
        label: "EDIT_FILE em arquivo de teste bloqueado",
        toolName: WORKSPACE_TOOLS.FILESYSTEM.EDIT_FILE,
        lockedPath: "tests/contract.test.ts",
        targetRel: "tests/contract.test.ts",
        toolInput: {
          path: "tests\\contract.test.ts",
          old_string: "expect(1).toBe(2)",
          new_string: "expect(1).toBe(1)",
          replace_all: false,
        },
      },
      {
        label: "DELETE em arquivo de teste bloqueado",
        toolName: WORKSPACE_TOOLS.FILESYSTEM.DELETE,
        lockedPath: "tests/contract.test.ts",
        targetRel: "tests/contract.test.ts",
        toolInput: {
          path: "tests/contract.test.ts",
          recursive: false,
        },
      },
      {
        label: "APPLY_PATCH (formato OpenCode/Codex) em arquivo de teste bloqueado",
        toolName: WORKSPACE_TOOLS.FILESYSTEM.APPLY_PATCH,
        lockedPath: "tests/contract.test.ts",
        targetRel: "tests/contract.test.ts",
        toolInput: {
          patch: [
            "*** Begin Patch",
            "*** Update File: tests/contract.test.ts",
            "@@",
            "-expect(1).toBe(2);",
            "+expect(1).toBe(1);",
            "*** End Patch",
          ].join("\n"),
        },
      },
    ])(
      "bloqueia mutação ($label) em lockedReadOnlyPaths e registra erro em executionEvents",
      async ({ toolName, lockedPath, targetRel, toolInput }) => {
        const ws = createTempWorkspace();
        const testAbs = path.join(ws, targetRel);
        fs.mkdirSync(path.dirname(testAbs), { recursive: true });
        const originalContent =
          "import { expect, test } from 'vitest';\ntest('spec', () => { expect(1).toBe(2); });\n";
        fs.writeFileSync(testAbs, originalContent, "utf8");

        const [deliv] = await db
          .insert(deliverables)
          .values({
            projectId,
            repositoryId,
            title: `Test Lock ${crypto.randomUUID().slice(0, 6)}`,
            status: "building",
            hasUi: false,
          })
          .returning();

        const adapter = new MastraWorkspaceExecutorAdapter({ masterKey });
        const result = await adapter.runSession({
          workspacePath: ws,
          mode: "build",
          role: "builder",
          providerConfig: makeProviderConfig(),
          prompt: "Corrija o bug de produção.",
          db,
          projectId,
          deliverableId: deliv!.id,
          stage: "stage_build",
          toolPolicies: DEFAULT_TOOL_POLICIES,
          lockedReadOnlyPaths: [lockedPath],
          modelOverride: createScriptedToolMockModel({
            toolName,
            toolInput,
            finalText: "Vou corrigir o código de produção.",
          }),
        });

        expect(result.status).toBe("completed");
        expect(fs.readFileSync(testAbs, "utf8")).toBe(originalContent);
        expect(result.touchedFiles).not.toContain(targetRel);

        const events = await db
          .select()
          .from(executionEvents)
          .where(
            and(
              eq(executionEvents.deliverableId, deliv!.id),
              eq(executionEvents.eventType, "tool_call")
            )
          );

        const lockErrorEvent = events.find((ev) => {
          const payload = ev.payloadJson as {
            status?: string;
            summary?: string;
            toolName?: string;
          };
          return (
            payload.toolName === toolName &&
            payload.status === "error" &&
            typeof payload.summary === "string" &&
            payload.summary.includes("Test Lock")
          );
        });
        expect(lockErrorEvent).not.toBeUndefined();
        expect(
          (lockErrorEvent!.payloadJson as { summary: string }).summary
        ).toContain("código de produção");
      }
    );

    test("permite escrita em arquivo de produção não bloqueado enquanto lockedReadOnlyPaths protege testes", async () => {
      const ws = createTempWorkspace();
      fs.mkdirSync(path.join(ws, "tests"), { recursive: true });
      fs.writeFileSync(
        path.join(ws, "tests", "contract.test.ts"),
        "export const locked = true;\n",
        "utf8"
      );

      const adapter = new MastraWorkspaceExecutorAdapter({ masterKey });
      const result = await adapter.runSession({
        workspacePath: ws,
        mode: "build",
        role: "builder",
        providerConfig: makeProviderConfig(),
        prompt: "Implemente src/feature.ts.",
        toolPolicies: DEFAULT_TOOL_POLICIES,
        lockedReadOnlyPaths: ["tests/contract.test.ts"],
        modelOverride: createScriptedToolMockModel({
          toolName: WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE,
          toolInput: {
            path: "src/feature.ts",
            content: "export const sum = (a: number, b: number) => a + b;\n",
            overwrite: true,
          },
          finalText: "Implementado em src/feature.ts.",
        }),
      });

      expect(result.status).toBe("completed");
      expect(result.touchedFiles).toContain("src/feature.ts");
      expect(
        fs.readFileSync(path.join(ws, "src", "feature.ts"), "utf8")
      ).toContain("export const sum");
    });
  });

  describe("Micro-Loop Allowlisted (run_scoped_typecheck & run_scoped_unit_test)", () => {
    test.each([
      { policy: "deny" as const, toolKey: "run_scoped_typecheck" as const },
      { policy: "ask" as const, toolKey: "run_scoped_typecheck" as const },
      { policy: "deny" as const, toolKey: "run_scoped_unit_test" as const },
      { policy: "ask" as const, toolKey: "run_scoped_unit_test" as const },
    ])(
      "$toolKey respeita toolPolicies.runTests=$policy sem disparar subprocesso",
      async ({ policy, toolKey }) => {
        const ws = createTempWorkspace();
        fs.mkdirSync(path.join(ws, "tests"), { recursive: true });
        fs.writeFileSync(
          path.join(ws, "tests", "sample.test.ts"),
          "export {};\n",
          "utf8"
        );

        let subprocessCalled = false;
        const mockRunner: ScopedSubprocessRunner = async () => {
          subprocessCalled = true;
          return {
            exitCode: 0,
            stdout: "ok",
            stderr: "",
            durationMs: 10,
            timedOut: false,
          };
        };

        const tools = createScopedMicroLoopTools({
          workspaceRoot: ws,
          toolPolicies: { ...DEFAULT_TOOL_POLICIES, runTests: policy },
          runSubprocess: mockRunner,
        });

        const out =
          toolKey === "run_scoped_typecheck"
            ? await tools.run_scoped_typecheck.execute!(
                { targetPackage: "@uzina/core" },
                {}
              )
            : await tools.run_scoped_unit_test.execute!(
                {
                  targetPackage: "@uzina/core",
                  testFilePath: "tests/sample.test.ts",
                },
                {}
              );

        expect(subprocessCalled).toBe(false);
        expect(out.passed).toBe(false);
        expect(out.diagnostics[0]?.code).toBe("TOOL_POLICY_BLOCKED");
        expect(out.truncatedOutput).toContain(`runTests=${policy}`);
      }
    );

    test.each([
      {
        kind: "package" as const,
        value: "@uzina/core; rm -rf /",
        label: "shell metacharacter em targetPackage",
      },
      {
        kind: "package" as const,
        value: "--filter=@uzina/core",
        label: "flag iniciando com '-' em targetPackage",
      },
      {
        kind: "package" as const,
        value: "../packages/core",
        label: "traversal '..' em targetPackage",
      },
      {
        kind: "package" as const,
        value: "unknown-package",
        label: "pacote fora da allowlist",
      },
      {
        kind: "testPath" as const,
        value: "../outside.test.ts",
        label: "traversal '..' em testFilePath",
      },
      {
        kind: "testPath" as const,
        value: "--reporter=verbose",
        label: "flag iniciando com '-' em testFilePath",
      },
      {
        kind: "testPath" as const,
        value: "src/index.ts",
        label: "arquivo não-teste em testFilePath",
      },
      {
        kind: "testPath" as const,
        value: "tests/sample.test.ts;echo",
        label: "shell metacharacter em testFilePath",
      },
    ])("rejeita argumento malicioso ($label)", ({ kind, value }) => {
      const ws = createTempWorkspace();
      if (kind === "package") {
        expect(() => assertAllowedTargetPackage(value)).toThrow();
      } else {
        expect(() => assertAllowedUnitTestPath(ws, value)).toThrow();
      }
    });

    test("executa run_scoped_typecheck e run_scoped_unit_test com timeout <= 30s, diagnósticos e redação de segredos", async () => {
      const ws = createTempWorkspace();
      fs.mkdirSync(path.join(ws, "tests"), { recursive: true });
      fs.writeFileSync(
        path.join(ws, "tests", "unit.test.ts"),
        "export {};\n",
        "utf8"
      );

      const capturedCalls: Array<{
        binary: string;
        args: readonly string[];
        timeoutMs: number;
      }> = [];
      const secret = "sk-scoped-secret-123456";

      const mockRunner: ScopedSubprocessRunner = async (
        binary,
        args,
        options
      ) => {
        capturedCalls.push({ binary, args, timeoutMs: options.timeoutMs });
        if (args.includes("typecheck")) {
          return {
            exitCode: 1,
            stdout: `src/foo.ts(14,5): error TS2322: Type mismatch with token=${secret}`,
            stderr: "",
            durationMs: 120,
            timedOut: false,
          };
        }
        return {
          exitCode: 0,
          stdout: "1 test file passed",
          stderr: "",
          durationMs: 85,
          timedOut: false,
        };
      };

      const tools = createScopedMicroLoopTools({
        workspaceRoot: ws,
        toolPolicies: { ...DEFAULT_TOOL_POLICIES, runTests: "allow" },
        knownSecrets: [secret],
        timeoutMs: 90_000,
        runSubprocess: mockRunner,
      });

      const tscRes = await tools.run_scoped_typecheck.execute!(
        {
          targetPackage: "@uzina/core",
        },
        {}
      );
      expect(tscRes.passed).toBe(false);
      expect(tscRes.diagnostics).toHaveLength(1);
      expect(tscRes.diagnostics[0]).toMatchObject({
        file: "src/foo.ts",
        line: 14,
        code: "TS2322",
      });
      expect(tscRes.truncatedOutput).not.toContain(secret);
      expect(tscRes.truncatedOutput).toContain("[REDACTED]");

      const unitRes = await tools.run_scoped_unit_test.execute!(
        {
          targetPackage: "@uzina/core",
          testFilePath: "tests\\unit.test.ts",
        },
        {}
      );
      expect(unitRes.passed).toBe(true);
      expect(unitRes.command).toBe(
        "pnpm --filter @uzina/core test -- tests/unit.test.ts"
      );
      expect(capturedCalls).toHaveLength(2);
      expect(capturedCalls[0]!.timeoutMs).toBeLessThanOrEqual(30_000);
      expect(capturedCalls[1]!.timeoutMs).toBeLessThanOrEqual(30_000);
      expect(capturedCalls[1]!.args).toContain("tests/unit.test.ts");
    });
  });

  describe("Migration Safety (validateMigrationSafety + tool)", () => {
    test.each([
      {
        label: "DROP TABLE bloqueante",
        sql: "DROP TABLE projects;",
        expectedPassed: false,
        expectedRule: "no_drop_table",
        expectedSeverity: "blocking",
      },
      {
        label: "DROP COLUMN bloqueante",
        sql: "ALTER TABLE projects DROP COLUMN slug;",
        expectedPassed: false,
        expectedRule: "no_drop_column",
        expectedSeverity: "blocking",
      },
      {
        label: "TRUNCATE bloqueante",
        sql: "TRUNCATE TABLE execution_events;",
        expectedPassed: false,
        expectedRule: "no_truncate",
        expectedSeverity: "blocking",
      },
      {
        label: "ADD COLUMN NOT NULL sem DEFAULT bloqueante",
        sql: "ALTER TABLE deliverables ADD COLUMN flag boolean NOT NULL;",
        expectedPassed: false,
        expectedRule: "no_add_column_not_null_without_default",
        expectedSeverity: "blocking",
      },
      {
        label: "ALTER COLUMN TYPE bloqueante",
        sql: "ALTER TABLE deliverables ALTER COLUMN title TYPE varchar(40);",
        expectedPassed: false,
        expectedRule: "unsafe_alter_column_type",
        expectedSeverity: "blocking",
      },
      {
        label: "CREATE INDEX sem CONCURRENTLY gera warning sem bloquear",
        sql: "CREATE INDEX idx_projects_slug ON projects(slug);",
        expectedPassed: true,
        expectedRule: "create_index_without_concurrently",
        expectedSeverity: "warning",
      },
      {
        label: "Migração segura com DEFAULT e CONCURRENTLY passa sem issues",
        sql: [
          "ALTER TABLE deliverables ADD COLUMN flag boolean NOT NULL DEFAULT false;",
          "CREATE INDEX CONCURRENTLY idx_deliv_proj ON deliverables(project_id);",
        ].join("\n"),
        expectedPassed: true,
        expectedRule: null,
        expectedSeverity: null,
      },
    ])(
      "$label",
      ({ sql, expectedPassed, expectedRule, expectedSeverity }) => {
        const report = validateMigrationSafety(
          sql,
          "packages/db/drizzle/0010_test.sql"
        );
        expect(report.passed).toBe(expectedPassed);
        if (expectedRule === null) {
          expect(report.issues).toHaveLength(0);
        } else {
          expect(report.issues[0]?.rule).toBe(expectedRule);
          expect(report.issues[0]?.severity).toBe(expectedSeverity);
        }
      }
    );

    test("tool validate_migration_safety lê arquivo no workspace e bloqueia .env/traversal", async () => {
      const ws = createTempWorkspace();
      fs.mkdirSync(path.join(ws, "drizzle"), { recursive: true });
      fs.writeFileSync(
        path.join(ws, "drizzle", "0001_bad.sql"),
        "DROP TABLE legacy_items;\n",
        "utf8"
      );

      const tools = createScopedMicroLoopTools({ workspaceRoot: ws });

      const res = await tools.validate_migration_safety.execute!(
        {
          filePath: "drizzle/0001_bad.sql",
        },
        {}
      );
      expect(res.passed).toBe(false);
      expect(res.issues[0]?.rule).toBe("no_drop_table");

      await expect(
        tools.validate_migration_safety.execute!({ filePath: ".env" }, {})
      ).rejects.toThrow();
      await expect(
        tools.validate_migration_safety.execute!(
          { filePath: "../secret.sql" },
          {}
        )
      ).rejects.toThrow();
    });
  });

  describe("3-Strikes Scientific Debugging (StuckDetector + OpenCodeRunner)", () => {
    test("exige causa-raiz no 2º strike e escala ao Arquiteto no 3º strike", () => {
      const detector = new StuckDetector();

      const t1 = detector.recordTurn({
        turnIndex: 0,
        actionType: "error",
        toolName: "bash",
        actionSignature: "pnpm test",
        errorMessage: "TypeError: cannot read id",
      });
      expect(t1).toBeNull();
      expect(detector.getStrikeStatus().strikeCount).toBe(1);
      expect(detector.getStrikeStatus().requiresRootCauseHypothesis).toBe(
        false
      );

      const t2 = detector.recordTurn({
        turnIndex: 1,
        actionType: "error",
        toolName: "bash",
        actionSignature: "pnpm test",
        errorMessage: "TypeError: cannot read id",
      });
      expect(t2).toBeNull();
      const strike2 = detector.getStrikeStatus();
      expect(strike2.strikeCount).toBe(2);
      expect(strike2.requiresRootCauseHypothesis).toBe(true);
      expect(strike2.escalateToArchitect).toBe(false);
      expect(strike2.directiveMessage).toContain("Pare de editar");

      detector.recordRootCauseHypothesis(
        "Objeto project retornado sem join de clientId."
      );

      const t3 = detector.recordTurn({
        turnIndex: 2,
        actionType: "error",
        toolName: "bash",
        actionSignature: "pnpm test",
        errorMessage: "TypeError: cannot read id",
      });
      expect(t3).not.toBeNull();
      expect(t3?.strikeCount).toBe(3);
      expect(t3?.escalatedToArchitect).toBe(true);
      expect(t3?.rootCauseHypothesis).toBe(
        "Objeto project retornado sem join de clientId."
      );

      const directEval = evaluateConsecutiveErrorStrike([
        {
          turnIndex: 0,
          actionType: "error",
          toolName: "tsc",
          actionSignature: "tsc --noEmit",
          errorMessage: "TS2322",
        },
        {
          turnIndex: 1,
          actionType: "error",
          toolName: "tsc",
          actionSignature: "tsc --noEmit",
          errorMessage: "TS2322",
        },
      ]);
      expect(directEval.strikeCount).toBe(2);
      expect(directEval.requiresRootCauseHypothesis).toBe(true);
    });

    test("OpenCodeRunner dispara onThreeStrikeDirective no 2º erro e retorna StuckAlertV2Extension no 3º erro", async () => {
      const ws = createTempWorkspace();
      const directives: StuckThreeStrikeDirective[] = [];

      const transport = new InMemoryOpenCodeTransport({
        turns: [0, 1, 2].map((turnIndex) => ({
          observation: {
            turnIndex,
            actionType: "error" as const,
            toolName: "bash",
            actionSignature: "pnpm --filter @uzina/core test",
            errorMessage: "AssertionError: expected 2 to be 4",
          },
          modelId: "ollama/qwen2.5-coder:14b",
        })),
      });

      const runner = new OpenCodeRunner({ transport });
      const res = await runner.runSession({
        workspacePath: ws,
        mode: "build",
        role: "builder",
        providerConfig: makeProviderConfig(),
        prompt: "Corrija o cálculo",
        onThreeStrikeDirective: (directive) => {
          directives.push(directive);
        },
      });

      expect(directives).toHaveLength(1);
      expect(directives[0]?.strikeCount).toBe(2);
      expect(directives[0]?.requiresRootCauseHypothesis).toBe(true);
      expect(directives[0]?.escalateToArchitect).toBe(false);

      expect(res.status).toBe("stuck");
      expect(res.stuckAlert).toMatchObject({
        detected: true,
        pattern: "repeated_action_error",
        strikeCount: 3,
        escalatedToArchitect: true,
      });
      expect(
        "rootCauseHypothesis" in (res.stuckAlert ?? {}) &&
          typeof (res.stuckAlert as { rootCauseHypothesis?: string })
            .rootCauseHypothesis === "string"
      ).toBe(true);
    });
  });
});
