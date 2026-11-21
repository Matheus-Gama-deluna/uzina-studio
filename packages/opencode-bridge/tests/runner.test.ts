import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  OpenCodeProviderConfig,
  StuckPattern,
} from "@uzina/contracts";
import { encryptSecret, WorkspaceBoundaryError } from "@uzina/core";
import { afterEach, describe, expect, test } from "vitest";
import { z } from "zod";
import {
  MissingProviderApiKeyError,
  MissingRoleBindingError,
  OpenCodeRunner,
  PlanModeWriteViolationError,
  PromptCacheModelSwitchError,
  StructuredOutputValidationError,
  VaultDecryptionError,
} from "../src/index.js";
import {
  InMemoryOpenCodeTransport,
  type InMemoryTurnScript,
} from "../src/testing.js";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const MASTER_KEY = Buffer.from("a".repeat(64), "hex");
const tempDirs: string[] = [];

function createWorkspaceDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-runner-ws-"));
  tempDirs.push(dir);
  execFileSync("git", ["init", "-b", "main"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "t@uzina.local"], {
    cwd: dir,
    stdio: "pipe",
  });
  fs.writeFileSync(path.join(dir, "index.ts"), "export const x = 1;\n", "utf8");
  execFileSync("git", ["add", "index.ts"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: dir, stdio: "pipe" });
  return dir;
}

function makeProviderConfig(
  overrides: Partial<OpenCodeProviderConfig> = {}
): OpenCodeProviderConfig {
  return {
    providerType: "omniroute",
    baseUrl: "http://127.0.0.1:20128/v1",
    encryptedApiKey: encryptSecret({
      plaintext: "sk-super-secret-token-xyz-999",
      masterKey: MASTER_KEY,
      organizationId: ORG_ID,
      providerType: "omniroute",
    }),
    organizationId: ORG_ID,
    roleBindings: {
      architect: { modelId: "anthropic/claude-sonnet-4-5" },
      builder: { modelId: "gpt-5.1-codex" },
    },
    ...overrides,
  };
}

afterEach(() => {
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
});

describe("OpenCodeRunner — Prompt Cache, Plan Isolation, Vault, StuckDetector & StructuredOutput", () => {
  test("injeta skills do papel no prefixo estático, trava modelo por papel e valida StructuredOutput", async () => {
    const ws = createWorkspaceDir();
    const transport = new InMemoryOpenCodeTransport({
      turns: [
        {
          observation: {
            turnIndex: 0,
            actionType: "tool_call",
            toolName: "read",
            actionSignature: "read:index.ts",
            observationSignature: "ok",
          },
          modelId: "anthropic/claude-sonnet-4-5",
        },
      ],
      finalText: "Blueprint gerado.",
      structuredOutput: { strategy: "domain_first", slices: ["s1"] },
    });

    const OutputSchema = z.object({
      strategy: z.literal("domain_first"),
      slices: z.array(z.string()).min(1),
    });

    const runner = new OpenCodeRunner({
      transport,
      masterKey: MASTER_KEY,
    });

    const result = await runner.runSession({
      workspacePath: ws,
      mode: "plan",
      role: "architect",
      providerConfig: makeProviderConfig(),
      prompt: "Desenhe o blueprint",
      outputSchema: OutputSchema,
    });

    expect(result.status).toBe("completed");
    expect(result.lockedModelId).toBe("anthropic/claude-sonnet-4-5");
    expect(result.structuredOutput).toEqual({
      strategy: "domain_first",
      slices: ["s1"],
    });
    expect(transport.lastSessionInput?.apiKey).toBe("sk-super-secret-token-xyz-999");
    expect(transport.lastRunInput?.systemPrompt).toContain("architecture-blueprint");
    expect(transport.lastHandle?.closed).toBe(true);
  });

  test("executa providerType ollama sem apiKey e sem masterKey configurados", async () => {
    const ws = createWorkspaceDir();
    const transport = new InMemoryOpenCodeTransport({
      turns: [],
      finalText: "Resposta local Ollama.",
    });
    const runner = new OpenCodeRunner({ transport });

    const result = await runner.runSession({
      workspacePath: ws,
      mode: "plan",
      role: "architect",
      providerConfig: {
        providerType: "ollama",
        baseUrl: "http://127.0.0.1:11434",
        encryptedApiKey: null,
        organizationId: ORG_ID,
        roleBindings: { architect: { modelId: "qwen2.5-coder:14b" } },
      },
      prompt: "Analise local",
    });

    expect(result.status).toBe("completed");
    expect(result.lockedModelId).toBe("ollama/qwen2.5-coder:14b");
    expect(transport.lastSessionInput?.apiKey).toBeUndefined();
  });

  test("falha fail-fast sem roleBinding e aborta em troca de modelo no meio da sessão", async () => {
    const ws = createWorkspaceDir();
    const transport = new InMemoryOpenCodeTransport({
      turns: [
        {
          observation: {
            turnIndex: 0,
            actionType: "tool_call",
            toolName: "read",
            actionSignature: "read:index.ts",
            observationSignature: "ok",
          },
          modelId: "openai/gpt-4o-mini",
        },
      ],
    });
    const runner = new OpenCodeRunner({ transport, masterKey: MASTER_KEY });

    await expect(
      runner.runSession({
        workspacePath: ws,
        mode: "plan",
        role: "verifier",
        providerConfig: makeProviderConfig(),
        prompt: "Revise",
      })
    ).rejects.toThrowError(MissingRoleBindingError);

    await expect(
      runner.runSession({
        workspacePath: ws,
        mode: "plan",
        role: "architect",
        providerConfig: makeProviderConfig(),
        prompt: "Revise",
      })
    ).rejects.toThrowError(PromptCacheModelSwitchError);
    expect(transport.lastHandle?.aborted).toBe(true);
    expect(transport.lastHandle?.closed).toBe(true);
  });

  test.each([
    { toolName: "apply_patch" },
    { toolName: "write" },
    { toolName: "bash" },
    { toolName: "webfetch" },
    { toolName: "todoread" },
  ])("modo plan bloqueia ferramenta não autorizada na allowlist: $toolName", async ({ toolName }) => {
    const ws = createWorkspaceDir();
    const runner = new OpenCodeRunner({
      transport: new InMemoryOpenCodeTransport({
        turns: [
          {
            observation: {
              turnIndex: 0,
              actionType: "tool_call",
              toolName,
              actionSignature: `${toolName}:target`,
              observationSignature: "ok",
            },
            modelId: "anthropic/claude-sonnet-4-5",
          },
        ],
      }),
      masterKey: MASTER_KEY,
    });

    await expect(
      runner.runSession({
        workspacePath: ws,
        mode: "plan",
        role: "architect",
        providerConfig: makeProviderConfig(),
        prompt: "Analise",
      })
    ).rejects.toThrowError(PlanModeWriteViolationError);
  });

  test("modo plan bloqueia mutação silenciosa em disco detectada via git status", async () => {
    const ws = createWorkspaceDir();
    const runner = new OpenCodeRunner({
      transport: new InMemoryOpenCodeTransport({
        turns: [],
        onRunSideEffect: () => {
          fs.writeFileSync(path.join(ws, "sneaky-write.txt"), "oops", "utf8");
        },
      }),
      masterKey: MASTER_KEY,
    });

    await expect(
      runner.runSession({
        workspacePath: ws,
        mode: "plan",
        role: "architect",
        providerConfig: makeProviderConfig(),
        prompt: "Analise apenas",
      })
    ).rejects.toThrowError(PlanModeWriteViolationError);
  });

  test("rejeita path traversal em touchedFiles durante sessão build", async () => {
    const ws = createWorkspaceDir();
    const runner = new OpenCodeRunner({
      transport: new InMemoryOpenCodeTransport({
        turns: [
          {
            observation: {
              turnIndex: 0,
              actionType: "tool_call",
              toolName: "write",
              actionSignature: "write:outside",
              observationSignature: "ok",
            },
            touchedFiles: ["../outside-secret.txt"],
            modelId: "omniroute/gpt-5.1-codex",
          },
        ],
      }),
      masterKey: MASTER_KEY,
    });

    await expect(
      runner.runSession({
        workspacePath: ws,
        mode: "build",
        role: "builder",
        providerConfig: makeProviderConfig(),
        prompt: "Edite",
      })
    ).rejects.toThrowError(WorkspaceBoundaryError);
  });

  test("exige masterKey e falha em AAD divergente ou ausência de apiKey não-Ollama", async () => {
    const ws = createWorkspaceDir();
    const cfg = makeProviderConfig();

    const runnerNoKey = new OpenCodeRunner({
      transport: new InMemoryOpenCodeTransport(),
    });
    await expect(
      runnerNoKey.runSession({
        workspacePath: ws,
        mode: "build",
        role: "builder",
        providerConfig: cfg,
        prompt: "Edite",
      })
    ).rejects.toThrowError(VaultDecryptionError);

    const runnerWithKey = new OpenCodeRunner({
      transport: new InMemoryOpenCodeTransport(),
      masterKey: MASTER_KEY,
    });
    await expect(
      runnerWithKey.runSession({
        workspacePath: ws,
        mode: "build",
        role: "builder",
        providerConfig: {
          ...cfg,
          organizationId: "22222222-2222-4222-8222-222222222222",
        },
        prompt: "Edite",
      })
    ).rejects.toThrowError(VaultDecryptionError);

    await expect(
      runnerWithKey.runSession({
        workspacePath: ws,
        mode: "build",
        role: "builder",
        providerConfig: makeProviderConfig({ encryptedApiKey: null }),
        prompt: "Edite",
      })
    ).rejects.toThrowError(MissingProviderApiKeyError);
  });

  test("redige segredo AES-256-GCM de finalText, commandsExecuted e de erro relançado (message + stack + cause)", async () => {
    const ws = createWorkspaceDir();
    const rawSecret = "sk-leak-check-77665544";
    const encrypted = encryptSecret({
      plaintext: rawSecret,
      masterKey: MASTER_KEY,
      organizationId: ORG_ID,
      providerType: "omniroute",
    });

    const okRunner = new OpenCodeRunner({
      transport: new InMemoryOpenCodeTransport({
        turns: [
          {
            observation: {
              turnIndex: 0,
              actionType: "tool_call",
              toolName: "bash",
              actionSignature: "curl",
              observationSignature: "ok",
            },
            commandsExecuted: [`curl -H "Authorization: Bearer ${rawSecret}" https://example.com`],
            modelId: "omniroute/gpt-5.1-codex",
          },
        ],
        finalText: `Debug header Authorization: Bearer ${rawSecret}`,
      }),
      masterKey: MASTER_KEY,
    });

    const okRes = await okRunner.runSession({
      workspacePath: ws,
      mode: "build",
      role: "builder",
      providerConfig: makeProviderConfig({ encryptedApiKey: encrypted }),
      prompt: "Edite",
    });
    expect(okRes.finalText).toBe("Debug header Authorization: Bearer [REDACTED]");
    expect(okRes.commandsExecuted[0]).toBe(
      'curl -H "Authorization: Bearer [REDACTED]" https://example.com'
    );

    const causeErr = new Error(`Cause key=${rawSecret}`);
    const transportErr = new Error(`Upstream failed with key=${rawSecret}`, {
      cause: causeErr,
    });
    const errRunner = new OpenCodeRunner({
      transport: new InMemoryOpenCodeTransport({ throwError: transportErr }),
      masterKey: MASTER_KEY,
    });

    const caught = await errRunner
      .runSession({
        workspacePath: ws,
        mode: "build",
        role: "builder",
        providerConfig: makeProviderConfig({ encryptedApiKey: encrypted }),
        prompt: "Edite",
      })
      .catch((err: unknown) => err);

    expect(caught).toBeInstanceOf(Error);
    const caughtErr = caught as Error;
    expect(caughtErr.message).toBe("Upstream failed with key=[REDACTED]");
    expect(caughtErr.stack).not.toContain(rawSecret);
    expect((caughtErr.cause as Error).message).toBe("Cause key=[REDACTED]");
  });

  test.each<{ pattern: StuckPattern; turns: InMemoryTurnScript[] }>([
    {
      pattern: "repeated_action_observation",
      turns: [0, 1, 2, 3].map((i) => ({
        observation: {
          turnIndex: i,
          actionType: "tool_call",
          toolName: "read",
          actionSignature: "read:index.ts",
          observationSignature: "same",
        },
        modelId: "omniroute/gpt-5.1-codex",
      })),
    },
    {
      pattern: "repeated_action_error",
      turns: [0, 1, 2].map((i) => ({
        observation: {
          turnIndex: i,
          actionType: "error",
          toolName: "bash",
          actionSignature: "pnpm test",
          errorMessage: "Exit 1",
        },
        modelId: "omniroute/gpt-5.1-codex",
      })),
    },
    {
      pattern: "monologue_no_tool",
      turns: [0, 1, 2].map((i) => ({
        observation: { turnIndex: i, actionType: "assistant_text" },
        modelId: "omniroute/gpt-5.1-codex",
      })),
    },
    {
      pattern: "alternating_ping_pong",
      turns: [0, 1, 2, 3, 4, 5].map((i) => ({
        observation: {
          turnIndex: i,
          actionType: "tool_call",
          toolName: "edit",
          actionSignature: i % 2 === 0 ? "edit:a.ts" : "edit:b.ts",
          observationSignature: "ok",
        },
        modelId: "omniroute/gpt-5.1-codex",
      })),
    },
    {
      pattern: "context_window_overflow",
      turns: [0, 1].map((i) => ({
        observation: {
          turnIndex: i,
          actionType: "error",
          errorMessage: "maximum context length exceeded",
          isContextOverflow: true,
        },
        modelId: "omniroute/gpt-5.1-codex",
      })),
    },
  ])("integra StuckDetector no runner ($pattern) chamando abort() + close()", async ({ pattern, turns }) => {
    const ws = createWorkspaceDir();
    const transport = new InMemoryOpenCodeTransport({ turns });
    const runner = new OpenCodeRunner({ transport, masterKey: MASTER_KEY });

    const res = await runner.runSession({
      workspacePath: ws,
      mode: "build",
      role: "builder",
      providerConfig: makeProviderConfig(),
      prompt: "Execute",
    });

    expect(res.status).toBe("stuck");
    expect(res.stuckAlert?.pattern).toBe(pattern);
    expect(res.stuckAlert?.decisionType).toBe("stuck_intervention");
    expect(transport.lastHandle?.aborted).toBe(true);
    expect(transport.lastHandle?.closed).toBe(true);
  });

  test("impõe maxSteps interrompendo sessão excedente e impedindo alerta tardio", async () => {
    const ws = createWorkspaceDir();
    // 5 turnos seguidos de monologo, mas maxSteps=2 impede chegar ao 3o turno
    const turns: InMemoryTurnScript[] = [0, 1, 2, 3, 4].map((i) => ({
      observation: { turnIndex: i, actionType: "assistant_text" },
      modelId: "anthropic/claude-sonnet-4-5",
    }));
    const transport = new InMemoryOpenCodeTransport({ turns });
    const runner = new OpenCodeRunner({ transport, masterKey: MASTER_KEY });

    const res = await runner.runSession({
      workspacePath: ws,
      mode: "plan",
      role: "architect",
      providerConfig: makeProviderConfig(),
      prompt: "Analise",
      maxSteps: 2,
    });

    expect(res.status).toBe("completed");
    expect(res.turns).toBe(2);
    expect(res.stuckAlert).toBeNull();
  });

  test("respeita AbortSignal (pré-abortado e mid-session), timeoutMs e falha em StructuredOutput inválido", async () => {
    const ws = createWorkspaceDir();

    // Pre-abortado
    const preAborted = new AbortController();
    preAborted.abort();
    const preTransport = new InMemoryOpenCodeTransport();
    const preRunner = new OpenCodeRunner({
      transport: preTransport,
      masterKey: MASTER_KEY,
    });
    const preRes = await preRunner.runSession({
      workspacePath: ws,
      mode: "plan",
      role: "architect",
      providerConfig: makeProviderConfig(),
      prompt: "Analise",
      signal: preAborted.signal,
    });
    expect(preRes.status).toBe("aborted");
    expect(preTransport.lastHandle).toBeNull();

    // Mid-session abort disparado apos 1o turno
    const midController = new AbortController();
    const midTransport = new InMemoryOpenCodeTransport({
      turns: [
        {
          observation: {
            turnIndex: 0,
            actionType: "tool_call",
            toolName: "read",
            actionSignature: "read:index.ts",
            observationSignature: "ok",
          },
          modelId: "anthropic/claude-sonnet-4-5",
        },
        {
          observation: {
            turnIndex: 1,
            actionType: "tool_call",
            toolName: "grep",
            actionSignature: "grep:foo",
            observationSignature: "ok",
          },
          modelId: "anthropic/claude-sonnet-4-5",
        },
      ],
      onRunSideEffect: () => {
        setTimeout(() => midController.abort(), 30);
      },
      delayPerTurnMs: 50,
    });
    const midRunner = new OpenCodeRunner({
      transport: midTransport,
      masterKey: MASTER_KEY,
    });
    const midRes = await midRunner.runSession({
      workspacePath: ws,
      mode: "plan",
      role: "architect",
      providerConfig: makeProviderConfig(),
      prompt: "Analise",
      signal: midController.signal,
    });
    expect(midRes.status).toBe("aborted");
    expect(midTransport.lastHandle?.closed).toBe(true);

    // Timeout
    const timeoutRunner = new OpenCodeRunner({
      transport: new InMemoryOpenCodeTransport({
        turns: [
          {
            observation: { turnIndex: 0, actionType: "assistant_text" },
            modelId: "anthropic/claude-sonnet-4-5",
          },
        ],
        delayPerTurnMs: 1150,
      }),
      masterKey: MASTER_KEY,
    });
    const timeoutRes = await timeoutRunner.runSession({
      workspacePath: ws,
      mode: "plan",
      role: "architect",
      providerConfig: makeProviderConfig(),
      prompt: "Analise",
      timeoutMs: 1000,
    });
    expect(timeoutRes.status).toBe("timed_out");

    // StructuredOutput invalido
    const badJsonRunner = new OpenCodeRunner({
      transport: new InMemoryOpenCodeTransport({
        turns: [],
        structuredOutput: { estrategiaInvalida: 123 },
      }),
      masterKey: MASTER_KEY,
    });
    await expect(
      badJsonRunner.runSession({
        workspacePath: ws,
        mode: "plan",
        role: "architect",
        providerConfig: makeProviderConfig(),
        prompt: "Analise",
        outputSchema: z.object({ strategy: z.string() }),
      })
    ).rejects.toThrowError(StructuredOutputValidationError);
  });
});
