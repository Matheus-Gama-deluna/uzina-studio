import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createOpencodeClient,
  type Config as OpenCodeServerConfig,
  type Event,
  type OpencodeClient,
  type Part,
  type PermissionRuleset,
  type TextPart,
  type ToolPart,
} from "@opencode-ai/sdk/v2";
import {
  HttpUrlSchema,
  type AgentRole,
  type AgentTurnObservationInput,
  type OpenCodeMode,
  type OpenCodeProviderConfig,
  type TokenUsage,
} from "@uzina/contracts";
import { z } from "zod";
import {
  MissingRoleBindingError,
  OpenCodeTransportError,
} from "./errors.js";
import { sanitizeChildEnv } from "./workspace.js";

export interface LockedModelTarget {
  providerID: string;
  modelID: string;
  canonicalId: string;
}

export function resolveLockedModelTarget(
  providerConfig: OpenCodeProviderConfig,
  role: AgentRole
): LockedModelTarget {
  const binding = providerConfig.roleBindings[role];
  const rawModelId = binding?.modelId?.trim();
  if (!rawModelId) {
    throw new MissingRoleBindingError(role);
  }

  const slashIndex = rawModelId.indexOf("/");
  if (slashIndex > 0 && slashIndex < rawModelId.length - 1) {
    const providerID = rawModelId.slice(0, slashIndex);
    const modelID = rawModelId.slice(slashIndex + 1);
    return {
      providerID,
      modelID,
      canonicalId: `${providerID}/${modelID}`,
    };
  }

  return {
    providerID: providerConfig.providerType,
    modelID: rawModelId,
    canonicalId: `${providerConfig.providerType}/${rawModelId}`,
  };
}

export interface TransportTurnEvent {
  observation: AgentTurnObservationInput;
  modelId: string;
  touchedFiles?: string[];
  commandsExecuted?: string[];
}

export interface TransportCreateSessionInput {
  workspacePath: string;
  mode: OpenCodeMode;
  role: AgentRole;
  title: string;
  lockedTarget: LockedModelTarget;
  providerBaseUrl?: string | null;
  apiKey?: string;
}

export interface TransportRunInput {
  prompt: string;
  systemPrompt: string;
  jsonSchema?: Record<string, unknown>;
  maxSteps: number;
  signal?: AbortSignal;
  onTurn: (turn: TransportTurnEvent) => Promise<void> | void;
}

export interface TransportRunOutput {
  finalText: string;
  structuredOutput?: unknown;
  tokenUsage: TokenUsage;
  turnsExecuted: number;
  aborted?: boolean;
}

export interface TransportSessionHandle {
  readonly sessionId: string;
  run(input: TransportRunInput): Promise<TransportRunOutput>;
  abort(): Promise<void>;
  close(): Promise<void>;
}

export interface OpenCodeTransport {
  createSession(
    input: TransportCreateSessionInput
  ): Promise<TransportSessionHandle>;
}

const SdkOpenCodeTransportOptionsSchema = z
  .object({
    serverMode: z.enum(["embedded", "remote"]),
    serverUrl: HttpUrlSchema.optional(),
    serverHeaders: z.record(z.string(), z.string()).optional(),
    startupTimeoutMs: z.number().int().min(500).max(120_000).optional(),
    forwardApiKeyToRemoteServer: z.boolean().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.serverMode === "remote" && !val.serverUrl) {
      ctx.addIssue({
        code: "custom",
        path: ["serverUrl"],
        message: "serverUrl é obrigatória quando serverMode é 'remote'.",
      });
    }
  });

export type SdkOpenCodeTransportOptions = z.input<
  typeof SdkOpenCodeTransportOptionsSchema
>;

const PLAN_MODE_PERMISSION_RULESET: PermissionRuleset = [
  { permission: "edit", pattern: "*", action: "deny" },
  { permission: "write", pattern: "*", action: "deny" },
  { permission: "patch", pattern: "*", action: "deny" },
  { permission: "multiedit", pattern: "*", action: "deny" },
  { permission: "apply_patch", pattern: "*", action: "deny" },
  { permission: "bash", pattern: "*", action: "deny" },
  { permission: "task", pattern: "*", action: "deny" },
  { permission: "todowrite", pattern: "*", action: "deny" },
  { permission: "external_directory", pattern: "*", action: "deny" },
  { permission: "webfetch", pattern: "*", action: "deny" },
  { permission: "websearch", pattern: "*", action: "deny" },
];

const BUILD_MODE_PERMISSION_RULESET: PermissionRuleset = [
  { permission: "external_directory", pattern: "*", action: "deny" },
];

function extractTouchedFilesFromToolPart(part: ToolPart): string[] {
  if (part.state.status !== "completed") {
    return [];
  }
  const files: string[] = [];
  const input = part.state.input;
  const candidateKeys = ["filePath", "path", "targetPath", "file"];
  const writeTools = new Set([
    "write",
    "edit",
    "patch",
    "multiedit",
    "apply_patch",
  ]);
  if (writeTools.has(part.tool.toLowerCase())) {
    for (const key of candidateKeys) {
      const v = input[key];
      if (typeof v === "string" && v.trim()) {
        files.push(v.trim());
      }
    }
  }
  return files;
}

function extractCommandFromToolPart(part: ToolPart): string[] {
  if (part.state.status !== "completed" && part.state.status !== "error") {
    return [];
  }
  if (
    part.tool.toLowerCase() === "bash" ||
    part.tool.toLowerCase() === "shell"
  ) {
    const cmd = part.state.input.command;
    if (typeof cmd === "string" && cmd.trim()) {
      return [cmd.trim()];
    }
  }
  return [];
}

function buildObservationFromToolPart(
  part: ToolPart,
  turnIndex: number
): AgentTurnObservationInput | null {
  const toolInputSummary = JSON.stringify(part.state.input);
  const actionSignature = `${part.tool}:${toolInputSummary}`;

  if (part.state.status === "completed") {
    return {
      turnIndex,
      actionType: "tool_call",
      toolName: part.tool,
      actionSignature,
      observationSignature: part.state.output.slice(0, 256) || "ok",
    };
  }
  if (part.state.status === "error") {
    return {
      turnIndex,
      actionType: "error",
      toolName: part.tool,
      actionSignature,
      errorMessage: part.state.error,
    };
  }
  return null;
}

function extractFinalTextFromParts(parts: readonly Part[]): string {
  const texts: string[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      const tp = part as TextPart;
      if (!tp.ignored && tp.text) {
        texts.push(tp.text);
      }
    }
  }
  return texts.join("\n").trim();
}

/**
 * Inicializa o servidor OpenCode em processo isolado sem herdar `process.env`
 * irrestrito (protege `MASTER_ENCRYPTION_KEY`, `DATABASE_URL`, etc.) e sem mutar
 * variáveis globais `XDG_*` no processo pai Node.js.
 */
async function spawnIsolatedEmbeddedServer(params: {
  xdgTempDir: string;
  config: OpenCodeServerConfig;
  timeoutMs: number;
}): Promise<{ url: string; close(): void }> {
  const env = {
    ...sanitizeChildEnv(process.env),
    XDG_DATA_HOME: path.join(params.xdgTempDir, "data"),
    XDG_CONFIG_HOME: path.join(params.xdgTempDir, "config"),
    XDG_STATE_HOME: path.join(params.xdgTempDir, "state"),
    OPENCODE_CONFIG_CONTENT: JSON.stringify(params.config),
  };

  const proc = spawn(
    "opencode",
    ["serve", "--hostname=127.0.0.1", "--port=0"],
    {
      env,
      shell: false,
      windowsHide: true,
    }
  );

  const url = await new Promise<string>((resolve, reject) => {
    let output = "";
    let resolved = false;

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(
        new OpenCodeTransportError(
          `Timeout aguardando opencode server iniciar após ${params.timeoutMs}ms.`
        )
      );
    }, params.timeoutMs);

    proc.stdout?.on("data", (chunk: Buffer) => {
      if (resolved) return;
      output += chunk.toString("utf8");
      for (const line of output.split("\n")) {
        if (line.startsWith("opencode server listening")) {
          const match = /on\s+(https?:\/\/[^\s]+)/.exec(line);
          if (!match || !match[1]) {
            clearTimeout(timer);
            proc.kill("SIGKILL");
            reject(
              new OpenCodeTransportError(
                `Falha ao extrair URL do opencode server: ${line}`
              )
            );
            return;
          }
          clearTimeout(timer);
          resolved = true;
          resolve(match[1]);
          return;
        }
      }
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(
        new OpenCodeTransportError(
          "Falha ao iniciar processo opencode em modo embedded.",
          err
        )
      );
    });

    proc.on("exit", (code) => {
      if (resolved) return;
      clearTimeout(timer);
      reject(
        new OpenCodeTransportError(
          `Servidor opencode encerrou prematuramente com código ${String(code)}: ${output.trim()}`
        )
      );
    });
  });

  return {
    url,
    close() {
      proc.kill("SIGTERM");
    },
  };
}

export class SdkOpenCodeTransport implements OpenCodeTransport {
  private readonly options: z.infer<typeof SdkOpenCodeTransportOptionsSchema>;

  constructor(options: SdkOpenCodeTransportOptions) {
    const parsed = SdkOpenCodeTransportOptionsSchema.safeParse(options);
    if (!parsed.success) {
      throw new OpenCodeTransportError(
        `Opções inválidas do SdkOpenCodeTransport: ${parsed.error.message}`,
        parsed.error
      );
    }
    this.options = parsed.data;
  }

  async createSession(
    input: TransportCreateSessionInput
  ): Promise<TransportSessionHandle> {
    let embeddedServer: { url: string; close(): void } | null = null;
    let xdgTempDir: string | null = null;
    let client: OpencodeClient;

    try {
      if (this.options.serverMode === "remote") {
        client = createOpencodeClient({
          baseUrl: this.options.serverUrl,
          directory: input.workspacePath,
          headers: this.options.serverHeaders,
          throwOnError: true,
        });

        if (this.options.forwardApiKeyToRemoteServer && input.apiKey) {
          await client.auth.set({
            providerID: input.lockedTarget.providerID,
            auth: { type: "api", key: input.apiKey },
          });
        }
      } else {
        xdgTempDir = fs.mkdtempSync(
          path.join(os.tmpdir(), "uzina-opencode-xdg-")
        );
        const providerOptions: Record<string, string> = {};
        if (input.providerBaseUrl) {
          providerOptions.baseURL = input.providerBaseUrl;
        }

        embeddedServer = await spawnIsolatedEmbeddedServer({
          xdgTempDir,
          timeoutMs: this.options.startupTimeoutMs ?? 15_000,
          config: {
            model: input.lockedTarget.canonicalId,
            provider: {
              [input.lockedTarget.providerID]: {
                options: providerOptions,
              },
            },
          },
        });

        client = createOpencodeClient({
          baseUrl: embeddedServer.url,
          directory: input.workspacePath,
          throwOnError: true,
        });

        // Credencial e enviada por HTTP pós-boot apenas para XDG_DATA_HOME efêmero da sessão
        if (input.apiKey) {
          await client.auth.set({
            providerID: input.lockedTarget.providerID,
            auth: { type: "api", key: input.apiKey },
          });
        }
      }

      const created = await client.session.create({
        directory: input.workspacePath,
        title: input.title,
        agent: input.mode,
        model: {
          providerID: input.lockedTarget.providerID,
          id: input.lockedTarget.modelID,
        },
        permission:
          input.mode === "plan"
            ? PLAN_MODE_PERMISSION_RULESET
            : BUILD_MODE_PERMISSION_RULESET,
      });

      const sessionId = created.data?.id;
      if (!sessionId) {
        throw new OpenCodeTransportError(
          "Servidor OpenCode não retornou session.id ao criar sessão."
        );
      }

      const workspacePath = input.workspacePath;
      const lockedCanonicalId = input.lockedTarget.canonicalId;
      const defaultProviderId = input.lockedTarget.providerID;
      const defaultModelId = input.lockedTarget.modelID;

      return {
        sessionId,
        async run(runInput: TransportRunInput): Promise<TransportRunOutput> {
          const sseAbort = new AbortController();
          const promptAbort = new AbortController();
          let turnCounter = 0;
          let callbackError: unknown = null;
          let aborted = false;

          const handshake: {
            resolve?: () => void;
            reject?: (err: Error) => void;
          } = {};
          const settleHandshake = (err?: Error) => {
            if (err) {
              handshake.reject?.(err);
            } else {
              handshake.resolve?.();
            }
            handshake.resolve = undefined;
            handshake.reject = undefined;
          };

          const forwardExternalAbort = () => {
            aborted = true;
            settleHandshake();
            promptAbort.abort();
            sseAbort.abort();
            void client.session
              .abort({ sessionID: sessionId, directory: workspacePath })
              .catch(() => undefined);
          };

          if (runInput.signal?.aborted) {
            forwardExternalAbort();
            return {
              finalText: "",
              tokenUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
              turnsExecuted: 0,
              aborted: true,
            };
          }
          runInput.signal?.addEventListener("abort", forwardExternalAbort, {
            once: true,
          });

          // Fail-closed: monitoramento SSE em tempo real e obrigatorio; aguarda handshake inicial antes do prompt
          const sseHandshakePromise = new Promise<void>((resolve, reject) => {
            handshake.resolve = resolve;
            handshake.reject = reject;
          });

          const sub = await client.event.subscribe(
            { directory: workspacePath },
            {
              signal: sseAbort.signal,
              sseMaxRetryAttempts: 1,
              onSseEvent: () => {
                settleHandshake();
              },
              onSseError: (sseErr) => {
                if (sseAbort.signal.aborted) {
                  return;
                }
                const transportErr = new OpenCodeTransportError(
                  "Falha no stream SSE /event do servidor OpenCode (fail-closed).",
                  sseErr
                );
                callbackError = transportErr;
                settleHandshake(transportErr);
                sseAbort.abort();
                promptAbort.abort();
              },
            }
          );

          const messageHadTool = new Set<string>();
          const emittedTextMessageIds = new Set<string>();
          const idleSignal: { resolve?: () => void } = {};
          const sseIdlePromise = new Promise<void>((resolve) => {
            idleSignal.resolve = resolve;
          });

          const sseLoop = (async () => {
            try {
              for await (const rawEvent of sub.stream) {
                settleHandshake();
                if (sseAbort.signal.aborted || promptAbort.signal.aborted) {
                  break;
                }
                const event = rawEvent as Event;
                if (
                  event.type === "session.idle" &&
                  event.properties.sessionID === sessionId
                ) {
                  idleSignal.resolve?.();
                  idleSignal.resolve = undefined;
                  break;
                }
                if (event.type === "message.part.updated") {
                  const part = event.properties.part;
                  if (part.sessionID !== sessionId) continue;

                  if (part.type === "tool") {
                    messageHadTool.add(part.messageID);
                    const obs = buildObservationFromToolPart(part, turnCounter);
                    if (!obs) continue;
                    turnCounter += 1;
                    await runInput.onTurn({
                      observation: obs,
                      modelId: lockedCanonicalId,
                      touchedFiles: extractTouchedFilesFromToolPart(part),
                      commandsExecuted: extractCommandFromToolPart(part),
                    });
                  } else if (
                    part.type === "text" &&
                    part.time?.end !== undefined &&
                    !messageHadTool.has(part.messageID) &&
                    !emittedTextMessageIds.has(part.messageID)
                  ) {
                    emittedTextMessageIds.add(part.messageID);
                    turnCounter += 1;
                    await runInput.onTurn({
                      observation: {
                        turnIndex: turnCounter - 1,
                        actionType: "assistant_text",
                      },
                      modelId: lockedCanonicalId,
                    });
                  }
                } else if (event.type === "message.updated") {
                  const info = event.properties.info;
                  if (info.sessionID === sessionId && info.role === "assistant") {
                    const turnModel = `${info.providerID}/${info.modelID}`;
                    if (info.error) {
                      const errName = info.error.name;
                      turnCounter += 1;
                      await runInput.onTurn({
                        observation: {
                          turnIndex: turnCounter - 1,
                          actionType: "error",
                          errorMessage: `${errName}: ${JSON.stringify(info.error.data)}`,
                          isContextOverflow: errName === "ContextOverflowError",
                        },
                        modelId: turnModel,
                      });
                    } else if (turnModel !== lockedCanonicalId) {
                      turnCounter += 1;
                      await runInput.onTurn({
                        observation: {
                          turnIndex: turnCounter - 1,
                          actionType: "assistant_text",
                        },
                        modelId: turnModel,
                      });
                    }
                  }
                }

                if (turnCounter > runInput.maxSteps) {
                  await client.session
                    .abort({ sessionID: sessionId, directory: workspacePath })
                    .catch(() => undefined);
                  promptAbort.abort();
                  sseAbort.abort();
                  break;
                }
              }
            } catch (err) {
              if (!sseAbort.signal.aborted && !promptAbort.signal.aborted) {
                callbackError = err;
              }
            }
          })();

          try {
            await sseHandshakePromise;

            const promptRes = await client.session.prompt(
              {
                sessionID: sessionId,
                directory: workspacePath,
                agent: input.mode,
                model: {
                  providerID: defaultProviderId,
                  modelID: defaultModelId,
                },
                system: runInput.systemPrompt,
                format: runInput.jsonSchema
                  ? {
                      type: "json_schema",
                      schema: runInput.jsonSchema,
                    }
                  : undefined,
                parts: [{ type: "text", text: runInput.prompt }],
              },
              { signal: promptAbort.signal }
            );

            // Aguarda drenagem do stream SSE ate session.idle (ou timeout curto fallback) antes de abortar leitor
            let idleTimeoutId: ReturnType<typeof setTimeout> | undefined;
            await Promise.race([
              sseIdlePromise,
              new Promise<void>((resolve) => {
                idleTimeoutId = setTimeout(resolve, 35);
              }),
            ]);
            if (idleTimeoutId) {
              clearTimeout(idleTimeoutId);
            }
            idleSignal.resolve?.();
            idleSignal.resolve = undefined;

            sseAbort.abort();
            await sub.stream.return?.(undefined).catch(() => undefined);
            await sseLoop;

            if (callbackError) {
              throw callbackError;
            }

            const data = promptRes.data;
            if (!data) {
              throw new OpenCodeTransportError(
                "Resposta vazia recebida de client.session.prompt."
              );
            }

            const respModel = `${data.info.providerID}/${data.info.modelID}`;
            if (respModel !== lockedCanonicalId) {
              turnCounter += 1;
              await runInput.onTurn({
                observation: {
                  turnIndex: turnCounter - 1,
                  actionType: "assistant_text",
                },
                modelId: respModel,
              });
            }

            return {
              finalText: extractFinalTextFromParts(data.parts),
              structuredOutput: data.info.structured,
              tokenUsage: {
                inputTokens: data.info.tokens.input,
                outputTokens: data.info.tokens.output,
                cacheReadTokens: data.info.tokens.cache.read,
              },
              turnsExecuted: Math.max(turnCounter, 1),
              aborted,
            };
          } catch (err) {
            sseAbort.abort();
            await sub.stream.return?.(undefined).catch(() => undefined);
            await sseLoop.catch(() => undefined);
            if (callbackError) {
              throw callbackError;
            }
            if (aborted || runInput.signal?.aborted) {
              return {
                finalText: "",
                tokenUsage: {
                  inputTokens: 0,
                  outputTokens: 0,
                  cacheReadTokens: 0,
                },
                turnsExecuted: turnCounter,
                aborted: true,
              };
            }
            if (turnCounter >= runInput.maxSteps && promptAbort.signal.aborted) {
              return {
                finalText: "",
                tokenUsage: {
                  inputTokens: 0,
                  outputTokens: 0,
                  cacheReadTokens: 0,
                },
                turnsExecuted: turnCounter,
                aborted: false,
              };
            }
            throw err;
          } finally {
            runInput.signal?.removeEventListener("abort", forwardExternalAbort);
          }
        },
        async abort(): Promise<void> {
          await client.session
            .abort({ sessionID: sessionId, directory: workspacePath })
            .catch(() => undefined);
        },
        async close(): Promise<void> {
          embeddedServer?.close();
          if (xdgTempDir && fs.existsSync(/*turbopackIgnore: true*/ xdgTempDir)) {
            fs.rmSync(/*turbopackIgnore: true*/ xdgTempDir, {
              recursive: true,
              force: true,
              maxRetries: 3,
              retryDelay: 100,
            });
          }
        },
      };
    } catch (error) {
      embeddedServer?.close();
      if (xdgTempDir && fs.existsSync(/*turbopackIgnore: true*/ xdgTempDir)) {
        fs.rmSync(/*turbopackIgnore: true*/ xdgTempDir, {
          recursive: true,
          force: true,
        });
      }
      if (error instanceof OpenCodeTransportError) {
        throw error;
      }
      throw new OpenCodeTransportError(
        "Falha ao inicializar sessão no SdkOpenCodeTransport.",
        error
      );
    }
  }
}
