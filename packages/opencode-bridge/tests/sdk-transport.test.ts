import http from "node:http";
import type { OpenCodeProviderConfig } from "@uzina/contracts";
import { afterEach, describe, expect, test } from "vitest";
import { z } from "zod";
import {
  OpenCodeTransportError,
  resolveLockedModelTarget,
  SdkOpenCodeTransport,
} from "../src/index.js";

interface CapturedRequests {
  createQueries: Array<string | null>;
  createBodies: Array<Record<string, unknown>>;
  promptBodies: Array<Record<string, unknown>>;
  abortCalls: number;
  authHeaders: Array<string | undefined>;
}

type ServerScenario =
  | "standard"
  | "repeated_abort_loop"
  | "model_switch_mid_sse"
  | "context_overflow_event"
  | "tool_error_event"
  | "sse_500_error";

function startFakeOpenCodeServer(scenario: ServerScenario) {
  const captured: CapturedRequests = {
    createQueries: [],
    createBodies: [],
    promptBodies: [],
    abortCalls: 0,
    authHeaders: [],
  };

  let sseRes: http.ServerResponse | null = null;
  let aborted = false;

  const server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    captured.authHeaders.push(
      req.headers["x-uzina-server-token"] as string | undefined
    );

    if (req.method === "GET" && reqUrl.pathname === "/event") {
      if (scenario === "sse_500_error") {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "SSE unavailable" }));
        return;
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(
        `data: ${JSON.stringify({ type: "server.connected", properties: {} })}\n\n`
      );
      sseRes = res;
      req.on("close", () => {
        if (sseRes === res) {
          sseRes = null;
        }
      });
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.from(chunk));
    }
    const rawBody = Buffer.concat(chunks).toString("utf8");
    const jsonBody = rawBody
      ? (JSON.parse(rawBody) as Record<string, unknown>)
      : {};

    if (req.method === "POST" && reqUrl.pathname === "/session") {
      captured.createQueries.push(reqUrl.searchParams.get("directory"));
      captured.createBodies.push(jsonBody);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "sess-http-1",
          slug: "sess-http-1",
          projectID: "proj-1",
          directory: reqUrl.searchParams.get("directory") ?? "",
          title: String(jsonBody.title ?? ""),
          version: "1.0.0",
          time: { created: Date.now(), updated: Date.now() },
        })
      );
      return;
    }

    if (req.method === "POST" && reqUrl.pathname === "/session/sess-http-1/abort") {
      captured.abortCalls += 1;
      aborted = true;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("true");
      return;
    }

    if (
      req.method === "POST" &&
      reqUrl.pathname === "/session/sess-http-1/message"
    ) {
      captured.promptBodies.push(jsonBody);

      const emitEvent = (payload: Record<string, unknown>) => {
        if (sseRes && !sseRes.writableEnded) {
          sseRes.write(`data: ${JSON.stringify(payload)}\n\n`);
        }
      };

      if (scenario === "repeated_abort_loop") {
        for (let i = 0; i < 4; i++) {
          if (aborted) break;
          emitEvent({
            type: "message.part.updated",
            properties: {
              part: {
                id: `part-${i}`,
                sessionID: "sess-http-1",
                messageID: "msg-1",
                type: "tool",
                callID: `call-${i}`,
                tool: "read",
                state: {
                  status: "completed",
                  input: { filePath: "README.md" },
                  output: "same-content-hash",
                  title: "Read README.md",
                  metadata: {},
                  time: { start: 1, end: 2 },
                },
              },
            },
          });
          await new Promise((r) => setTimeout(r, 20));
        }
      } else if (scenario === "model_switch_mid_sse") {
        emitEvent({
          type: "message.updated",
          properties: {
            info: {
              id: "msg-mid",
              sessionID: "sess-http-1",
              role: "assistant",
              time: { created: 1, completed: 2 },
              parentID: "user-1",
              modelID: "gpt-4o-mini",
              providerID: "openai",
              mode: "build",
              agent: "build",
              path: { cwd: "/tmp/ws", root: "/tmp/ws" },
              cost: 0.001,
              tokens: {
                input: 10,
                output: 10,
                reasoning: 0,
                cache: { read: 0, write: 0 },
              },
            },
          },
        });
      } else if (scenario === "context_overflow_event") {
        emitEvent({
          type: "message.updated",
          properties: {
            info: {
              id: "msg-err",
              sessionID: "sess-http-1",
              role: "assistant",
              time: { created: 1, completed: 2 },
              error: {
                name: "ContextOverflowError",
                data: { message: "Maximum context window exceeded" },
              },
              parentID: "user-1",
              modelID: "gpt-5",
              providerID: "omniroute",
              mode: "build",
              agent: "build",
              path: { cwd: "/tmp/ws", root: "/tmp/ws" },
              cost: 0,
              tokens: {
                input: 10,
                output: 0,
                reasoning: 0,
                cache: { read: 0, write: 0 },
              },
            },
          },
        });
      } else if (scenario === "tool_error_event") {
        emitEvent({
          type: "message.part.updated",
          properties: {
            part: {
              id: "part-err",
              sessionID: "sess-http-1",
              messageID: "msg-1",
              type: "tool",
              callID: "call-err",
              tool: "bash",
              state: {
                status: "error",
                input: { command: "pnpm test" },
                error: "Exit code 1",
                time: { start: 1, end: 2 },
              },
            },
          },
        });
      } else {
        // standard: tool write + tool bash + assistant text finalizado
        emitEvent({
          type: "message.part.updated",
          properties: {
            part: {
              id: "part-edit",
              sessionID: "sess-http-1",
              messageID: "msg-1",
              type: "tool",
              callID: "call-1",
              tool: "write",
              state: {
                status: "completed",
                input: { filePath: "src/app.ts", content: "x" },
                output: "written",
                title: "Write file",
                metadata: {},
                time: { start: 1, end: 2 },
              },
            },
          },
        });
        emitEvent({
          type: "message.part.updated",
          properties: {
            part: {
              id: "part-bash",
              sessionID: "sess-http-1",
              messageID: "msg-1",
              type: "tool",
              callID: "call-2",
              tool: "bash",
              state: {
                status: "completed",
                input: { command: "pnpm typecheck" },
                output: "ok",
                title: "Run typecheck",
                metadata: {},
                time: { start: 3, end: 4 },
              },
            },
          },
        });
        emitEvent({
          type: "message.part.updated",
          properties: {
            part: {
              id: "part-text",
              sessionID: "sess-http-1",
              messageID: "msg-2",
              type: "text",
              text: "Pensamento sem ferramenta",
              time: { start: 5, end: 6 },
            },
          },
        });
      }

      emitEvent({
        type: "session.idle",
        properties: { sessionID: "sess-http-1" },
      });

      const bodyModel = (jsonBody.model ?? {}) as {
        providerID?: string;
        modelID?: string;
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          info: {
            id: "msg-1",
            sessionID: "sess-http-1",
            role: "assistant",
            time: { created: 1, completed: 2 },
            parentID: "user-1",
            modelID: bodyModel.modelID ?? "claude-sonnet-4-5",
            providerID: bodyModel.providerID ?? "anthropic",
            mode: String(jsonBody.agent ?? "plan"),
            agent: String(jsonBody.agent ?? "plan"),
            path: { cwd: "/tmp/ws", root: "/tmp/ws" },
            cost: 0.01,
            tokens: {
              input: 120,
              output: 45,
              reasoning: 0,
              cache: { read: 80, write: 10 },
            },
            structured: { summary: "Plano pronto", steps: ["step-1"] },
          },
          parts: [
            {
              id: "part-txt",
              sessionID: "sess-http-1",
              messageID: "msg-1",
              type: "text",
              text: "Análise concluída.",
            },
          ],
        })
      );
      return;
    }

    res.writeHead(404);
    res.end();
  });

  return {
    server,
    captured,
    async listen(): Promise<string> {
      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", () => resolve());
      });
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Endereço inválido do servidor HTTP");
      }
      return `http://127.0.0.1:${address.port}`;
    },
    async close(): Promise<void> {
      if (sseRes && !sseRes.writableEnded) {
        sseRes.end();
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

const activeServers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  while (activeServers.length > 0) {
    const srv = activeServers.pop();
    if (srv) {
      await srv.close();
    }
  }
});

describe("SdkOpenCodeTransport — integração wire HTTP + SSE com @opencode-ai/sdk/v2", () => {
  test("envia directory, agent, permissões restritas em plan, model, system, json_schema e extrai tool/text/touchedFiles/commands", async () => {
    const fakeServer = startFakeOpenCodeServer("standard");
    activeServers.push(fakeServer);
    const serverUrl = await fakeServer.listen();

    const transport = new SdkOpenCodeTransport({
      serverMode: "remote",
      serverUrl,
      serverHeaders: { "x-uzina-server-token": "srv-tok-123" },
    });

    const handle = await transport.createSession({
      workspacePath: "/tmp/ws-sdk-1",
      mode: "plan",
      role: "architect",
      title: "Architecture review",
      lockedTarget: {
        providerID: "omniroute",
        modelID: "claude-sonnet-4-5",
        canonicalId: "omniroute/claude-sonnet-4-5",
      },
      providerBaseUrl: "http://127.0.0.1:20128/v1",
      apiKey: "sk-upstream-secret-value",
    });

    const receivedTypes: string[] = [];
    const touchedFiles: string[] = [];
    const commands: string[] = [];
    const outputSchema = z.toJSONSchema(
      z.object({
        summary: z.string(),
        steps: z.array(z.string()),
      })
    );

    try {
      const result = await handle.run({
        prompt: "Analise a arquitetura do projeto",
        systemPrompt: "Prefixo estático",
        jsonSchema: outputSchema,
        maxSteps: 10,
        onTurn: async (turn) => {
          receivedTypes.push(
            `${turn.observation.actionType}:${turn.observation.toolName ?? ""}`
          );
          if (turn.touchedFiles) touchedFiles.push(...turn.touchedFiles);
          if (turn.commandsExecuted) commands.push(...turn.commandsExecuted);
        },
      });

      expect(result.finalText).toBe("Análise concluída.");
      expect(result.structuredOutput).toEqual({
        summary: "Plano pronto",
        steps: ["step-1"],
      });
      expect(result.tokenUsage).toEqual({
        inputTokens: 120,
        outputTokens: 45,
        cacheReadTokens: 80,
      });
      expect(receivedTypes).toEqual([
        "tool_call:write",
        "tool_call:bash",
        "assistant_text:",
      ]);
      expect(touchedFiles).toEqual(["src/app.ts"]);
      expect(commands).toEqual(["pnpm typecheck"]);
      expect(fakeServer.captured.authHeaders).toContain("srv-tok-123");
      expect(fakeServer.captured.createQueries[0]).toBe("/tmp/ws-sdk-1");

      const perms = fakeServer.captured.createBodies[0]?.permission as Array<{
        permission: string;
        action: string;
      }>;
      expect(perms).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ permission: "edit", action: "deny" }),
          expect.objectContaining({ permission: "bash", action: "deny" }),
          expect.objectContaining({ permission: "webfetch", action: "deny" }),
          expect.objectContaining({ permission: "external_directory", action: "deny" }),
        ])
      );

      const promptBody = fakeServer.captured.promptBodies[0];
      expect(promptBody?.agent).toBe("plan");
      expect(promptBody?.system).toBe("Prefixo estático");
      expect(promptBody?.model).toEqual({
        providerID: "omniroute",
        modelID: "claude-sonnet-4-5",
      });
      expect(promptBody?.format).toEqual({
        type: "json_schema",
        schema: outputSchema,
      });
    } finally {
      await handle.close();
    }
  });

  test("aborto em onTurn interrompe loop no servidor antes de completar os 4 turnos", async () => {
    const fakeServer = startFakeOpenCodeServer("repeated_abort_loop");
    activeServers.push(fakeServer);
    const serverUrl = await fakeServer.listen();

    const transport = new SdkOpenCodeTransport({
      serverMode: "remote",
      serverUrl,
    });

    const handle = await transport.createSession({
      workspacePath: "/tmp/ws-sdk-abort",
      mode: "build",
      role: "builder",
      title: "Loop test",
      lockedTarget: {
        providerID: "omniroute",
        modelID: "gpt-5",
        canonicalId: "omniroute/gpt-5",
      },
    });

    let count = 0;
    try {
      const result = await handle.run({
        prompt: "Execute loop",
        systemPrompt: "System",
        maxSteps: 10,
        onTurn: async () => {
          count += 1;
          if (count >= 2) {
            await handle.abort();
          }
        },
      });
      expect(fakeServer.captured.abortCalls).toBeGreaterThanOrEqual(1);
      expect(result.turnsExecuted).toBeLessThan(4);
    } finally {
      await handle.close();
    }
  });

  test("detecta ContextOverflowError, erro de ferramenta e troca de modelo em tempo real via SSE", async () => {
    const scenarios: Array<{
      scenario: ServerScenario;
      verify: (turns: Array<{ modelId: string; actionType: string; isContextOverflow?: boolean; toolName?: string; errorMessage?: string }>) => void;
    }> = [
      {
        scenario: "context_overflow_event",
        verify: (turns) => {
          expect(turns[0]).toMatchObject({
            actionType: "error",
            isContextOverflow: true,
          });
        },
      },
      {
        scenario: "tool_error_event",
        verify: (turns) => {
          expect(turns[0]).toMatchObject({
            actionType: "error",
            toolName: "bash",
            errorMessage: "Exit code 1",
          });
        },
      },
      {
        scenario: "model_switch_mid_sse",
        verify: (turns) => {
          expect(turns.some((t) => t.modelId === "openai/gpt-4o-mini")).toBe(true);
        },
      },
    ];

    for (const item of scenarios) {
      const fakeServer = startFakeOpenCodeServer(item.scenario);
      activeServers.push(fakeServer);
      const serverUrl = await fakeServer.listen();

      const transport = new SdkOpenCodeTransport({
        serverMode: "remote",
        serverUrl,
      });
      const handle = await transport.createSession({
        workspacePath: "/tmp/ws-sse",
        mode: "build",
        role: "builder",
        title: item.scenario,
        lockedTarget: {
          providerID: "omniroute",
          modelID: "gpt-5",
          canonicalId: "omniroute/gpt-5",
        },
      });

      const recorded: Array<{
        modelId: string;
        actionType: string;
        isContextOverflow?: boolean;
        toolName?: string;
        errorMessage?: string;
      }> = [];

      try {
        await handle.run({
          prompt: "Teste",
          systemPrompt: "Sys",
          maxSteps: 10,
          onTurn: (t) => {
            recorded.push({
              modelId: t.modelId,
              actionType: t.observation.actionType,
              isContextOverflow: t.observation.isContextOverflow,
              toolName: t.observation.toolName,
              errorMessage: t.observation.errorMessage,
            });
          },
        });
        item.verify(recorded);
      } finally {
        await handle.close();
      }
    }
  });

  test("falha fechado (fail-closed) se assinatura SSE /event falhar e valida opções e resolveLockedModelTarget", async () => {
    expect(
      () => new SdkOpenCodeTransport({ serverMode: "remote" })
    ).toThrowError(OpenCodeTransportError);

    const fakeServer = startFakeOpenCodeServer("sse_500_error");
    activeServers.push(fakeServer);
    const serverUrl = await fakeServer.listen();

    const transport = new SdkOpenCodeTransport({
      serverMode: "remote",
      serverUrl,
    });
    const handle = await transport.createSession({
      workspacePath: "/tmp/ws-500",
      mode: "plan",
      role: "architect",
      title: "SSE fail-closed",
      lockedTarget: {
        providerID: "omniroute",
        modelID: "gpt-5",
        canonicalId: "omniroute/gpt-5",
      },
    });
    try {
      await expect(
        handle.run({
          prompt: "Teste",
          systemPrompt: "Sys",
          maxSteps: 5,
          onTurn: () => undefined,
        })
      ).rejects.toThrowError(OpenCodeTransportError);
    } finally {
      await handle.close();
    }

    const cfg: OpenCodeProviderConfig = {
      providerType: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      organizationId: "11111111-1111-4111-8111-111111111111",
      roleBindings: {
        builder: { modelId: "qwen2.5-coder:14b" },
        architect: { modelId: "anthropic/claude-sonnet-4-5" },
      },
    };
    expect(resolveLockedModelTarget(cfg, "builder")).toEqual({
      providerID: "ollama",
      modelID: "qwen2.5-coder:14b",
      canonicalId: "ollama/qwen2.5-coder:14b",
    });
    expect(resolveLockedModelTarget(cfg, "architect")).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet-4-5",
      canonicalId: "anthropic/claude-sonnet-4-5",
    });
  });
});
