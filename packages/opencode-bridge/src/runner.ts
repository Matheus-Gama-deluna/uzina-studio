import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  OpenCodeRunSessionOptionsSchema,
  OpenCodeSessionResultSchema,
  StuckAlertV2ExtensionSchema,
  type OpenCodeRunSessionOptionsInput,
  type OpenCodeSessionResult,
  type StuckAlertV2Extension,
} from "@uzina/contracts";
import {
  assertPathInsideWorkspace,
  decryptSecret,
  formatSkillsForPrompt,
  loadNativeSkills,
  redactError,
  redactSecrets,
  redactSecretsInValue,
  StuckDetector,
  type StuckDetectorConfig,
  type StuckThreeStrikeDirective,
} from "@uzina/core";
import { z } from "zod";
import {
  MissingProviderApiKeyError,
  PlanModeWriteViolationError,
  PromptCacheModelSwitchError,
  StructuredOutputValidationError,
  VaultDecryptionError,
} from "./errors.js";
import {
  resolveLockedModelTarget,
  type OpenCodeTransport,
  type TransportSessionHandle,
  type TransportTurnEvent,
} from "./transport.js";

const PLAN_MODE_READONLY_TOOLS = new Set([
  "read",
  "glob",
  "grep",
  "list",
  "ls",
  "find",
  "search",
  "view",
]);

function readGitStatusSnapshot(workspacePath: string): string | null {
  if (!fs.existsSync(workspacePath)) {
    return null;
  }
  try {
    const inside = execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: workspacePath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    }).trim();
    if (inside !== "true") {
      return null;
    }
    return execFileSync("git", ["status", "--porcelain"], {
      cwd: workspacePath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
  } catch {
    return null;
  }
}

export interface OpenCodeRunnerOptions {
  transport: OpenCodeTransport;
  masterKey?: Buffer;
  stuckConfig?: Partial<StuckDetectorConfig>;
}

export interface RunSessionExtraOptions<
  TSchema extends z.ZodTypeAny = z.ZodUnknown,
> {
  outputSchema?: TSchema;
  signal?: AbortSignal;
  stuckDetector?: StuckDetector;
  onThreeStrikeDirective?: (
    directive: StuckThreeStrikeDirective
  ) => Promise<void> | void;
}

export type RunSessionOutput<TSchema extends z.ZodTypeAny = z.ZodUnknown> =
  Omit<OpenCodeSessionResult, "structuredOutput" | "stuckAlert"> & {
    structuredOutput?: z.infer<TSchema>;
    stuckAlert: StuckAlertV2Extension | OpenCodeSessionResult["stuckAlert"];
  };

export class OpenCodeRunner {
  private readonly transport: OpenCodeTransport;
  private readonly masterKey?: Buffer;
  private readonly stuckConfig?: Partial<StuckDetectorConfig>;

  constructor(options: OpenCodeRunnerOptions) {
    this.transport = options.transport;
    this.masterKey = options.masterKey;
    this.stuckConfig = options.stuckConfig;
  }

  async runSession<TSchema extends z.ZodTypeAny = z.ZodUnknown>(
    options: OpenCodeRunSessionOptionsInput & RunSessionExtraOptions<TSchema>
  ): Promise<RunSessionOutput<TSchema>> {
    const startedAt = Date.now();
    const {
      outputSchema,
      signal: externalSignal,
      stuckDetector: customDetector,
      ...rawContract
    } = options;
    const parsed = OpenCodeRunSessionOptionsSchema.parse(rawContract);
    const workspaceRoot = path.resolve(parsed.workspacePath);

    const lockedTarget = resolveLockedModelTarget(
      parsed.providerConfig,
      parsed.role
    );

    const skills = loadNativeSkills({
      skillsDir: parsed.skillsDir,
      roles: parsed.skillNames ? undefined : [parsed.role],
      names: parsed.skillNames,
    });
    const skillsPrompt = formatSkillsForPrompt(skills);
    const staticSystemPrompt = [parsed.systemPromptPrefix?.trim(), skillsPrompt]
      .filter(Boolean)
      .join("\n\n");

    if (externalSignal?.aborted) {
      return OpenCodeSessionResultSchema.parse({
        sessionId: null,
        status: "aborted",
        mode: parsed.mode,
        role: parsed.role,
        lockedModelId: lockedTarget.canonicalId,
        finalText: "",
        stuckAlert: null,
        touchedFiles: [],
        commandsExecuted: [],
        tokenUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
        turns: 0,
        durationMs: Date.now() - startedAt,
      }) as RunSessionOutput<TSchema>;
    }

    const gitStatusBefore =
      parsed.mode === "plan" ? readGitStatusSnapshot(workspaceRoot) : null;

    let ephemeralApiKey: string | undefined;
    const secretsToRedact: string[] = [];
    const detector = customDetector ?? new StuckDetector(this.stuckConfig);
    const sessionAbortController = new AbortController();
    let timedOut = false;
    let reachedMaxSteps = false;

    const onExternalAbort = () => {
      sessionAbortController.abort();
    };
    if (externalSignal) {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      sessionAbortController.abort();
    }, parsed.timeoutMs);

    let handle: TransportSessionHandle | null = null;
    const touchedFilesSet = new Set<string>();
    const commandsExecuted: string[] = [];
    let turnViolationError: Error | null = null;
    let detectedStuckAlert: StuckAlertV2Extension | OpenCodeSessionResult["stuckAlert"] = null;
    let turnCount = 0;

    try {
      if (parsed.providerConfig.encryptedApiKey) {
        if (!this.masterKey) {
          throw new VaultDecryptionError(
            "masterKey é obrigatória para descriptografar encryptedApiKey da organização."
          );
        }
        try {
          ephemeralApiKey = decryptSecret({
            encrypted: parsed.providerConfig.encryptedApiKey,
            masterKey: this.masterKey,
            organizationId: parsed.providerConfig.organizationId,
            providerType: parsed.providerConfig.providerType,
          });
          secretsToRedact.push(ephemeralApiKey);
        } catch (err) {
          throw new VaultDecryptionError(
            "Falha ao descriptografar credencial AES-256-GCM do provedor.",
            err
          );
        }
      } else if (parsed.providerConfig.providerType !== "ollama") {
        throw new MissingProviderApiKeyError(parsed.providerConfig.providerType);
      }

      handle = await this.transport.createSession({
        workspacePath: workspaceRoot,
        mode: parsed.mode,
        role: parsed.role,
        title: `uzina:${parsed.role}:${parsed.mode}`,
        lockedTarget,
        providerBaseUrl: parsed.providerConfig.baseUrl,
        apiKey: ephemeralApiKey,
      });

      // Limpa referencia local no runner imediatamente apos handoff ao transporte
      ephemeralApiKey = undefined;

      const jsonSchema = outputSchema
        ? (z.toJSONSchema(outputSchema) as Record<string, unknown>)
        : undefined;

      const handleTurn = async (turn: TransportTurnEvent): Promise<void> => {
        if (turnViolationError || detectedStuckAlert || reachedMaxSteps) {
          return;
        }
        if (turnCount >= parsed.maxSteps) {
          reachedMaxSteps = true;
          await handle?.abort();
          sessionAbortController.abort();
          return;
        }
        turnCount += 1;

        if (turn.modelId !== lockedTarget.canonicalId) {
          turnViolationError = new PromptCacheModelSwitchError(
            lockedTarget.canonicalId,
            turn.modelId
          );
          await handle?.abort();
          sessionAbortController.abort();
          return;
        }

        if (turn.touchedFiles && turn.touchedFiles.length > 0) {
          for (const rawFile of turn.touchedFiles) {
            try {
              const safeAbs = assertPathInsideWorkspace(workspaceRoot, rawFile);
              touchedFilesSet.add(safeAbs);
            } catch (err) {
              turnViolationError =
                err instanceof Error ? err : new Error(String(err));
              await handle?.abort();
              sessionAbortController.abort();
              return;
            }
          }

          if (parsed.mode === "plan") {
            turnViolationError = new PlanModeWriteViolationError(
              `Modo 'plan' é estritamente read-only, mas arquivos foram tocados: ${turn.touchedFiles.join(", ")}`
            );
            await handle?.abort();
            sessionAbortController.abort();
            return;
          }
        }

        if (
          parsed.mode === "plan" &&
          turn.observation.actionType === "tool_call" &&
          turn.observation.toolName
        ) {
          const normalizedTool = turn.observation.toolName.toLowerCase();
          if (!PLAN_MODE_READONLY_TOOLS.has(normalizedTool)) {
            turnViolationError = new PlanModeWriteViolationError(
              `Ferramenta não autorizada em modo 'plan' read-only: '${turn.observation.toolName}'.`
            );
            await handle?.abort();
            sessionAbortController.abort();
            return;
          }
        }

        if (turn.commandsExecuted) {
          commandsExecuted.push(...turn.commandsExecuted);
        }

        const alert = detector.recordTurn(turn.observation);
        if (alert) {
          detectedStuckAlert = alert;
          await handle?.abort();
          sessionAbortController.abort();
          return;
        }

        const strikeStatus = detector.getStrikeStatus();
        if (
          strikeStatus.requiresRootCauseHypothesis &&
          strikeStatus.directiveMessage
        ) {
          await options.onThreeStrikeDirective?.(strikeStatus);
        }
      };

      const runOutput = await handle.run({
        prompt: parsed.prompt,
        systemPrompt: staticSystemPrompt,
        jsonSchema,
        maxSteps: parsed.maxSteps,
        signal: sessionAbortController.signal,
        onTurn: handleTurn,
      });

      const safeCommands = redactSecretsInValue(
        commandsExecuted,
        secretsToRedact
      );

      if (turnViolationError) {
        throw turnViolationError;
      }

      if (detectedStuckAlert) {
        const redactedAlert = redactSecretsInValue(
          detectedStuckAlert,
          secretsToRedact
        );
        const baseResult = OpenCodeSessionResultSchema.parse({
          sessionId: handle.sessionId,
          status: "stuck",
          mode: parsed.mode,
          role: parsed.role,
          lockedModelId: lockedTarget.canonicalId,
          finalText: redactSecrets(runOutput.finalText, secretsToRedact),
          stuckAlert: redactedAlert,
          touchedFiles: Array.from(touchedFilesSet),
          commandsExecuted: safeCommands,
          tokenUsage: runOutput.tokenUsage,
          turns: Math.max(turnCount, runOutput.turnsExecuted),
          durationMs: Date.now() - startedAt,
        });
        const v2Parsed = StuckAlertV2ExtensionSchema.safeParse(redactedAlert);
        return {
          ...baseResult,
          ...(v2Parsed.success ? { stuckAlert: v2Parsed.data } : {}),
        } as RunSessionOutput<TSchema>;
      }

      if (timedOut) {
        return OpenCodeSessionResultSchema.parse({
          sessionId: handle.sessionId,
          status: "timed_out",
          mode: parsed.mode,
          role: parsed.role,
          lockedModelId: lockedTarget.canonicalId,
          finalText: redactSecrets(runOutput.finalText, secretsToRedact),
          stuckAlert: null,
          touchedFiles: Array.from(touchedFilesSet),
          commandsExecuted: safeCommands,
          tokenUsage: runOutput.tokenUsage,
          turns: Math.max(turnCount, runOutput.turnsExecuted),
          durationMs: Date.now() - startedAt,
        }) as RunSessionOutput<TSchema>;
      }

      if (externalSignal?.aborted || (runOutput.aborted && !reachedMaxSteps)) {
        return OpenCodeSessionResultSchema.parse({
          sessionId: handle.sessionId,
          status: "aborted",
          mode: parsed.mode,
          role: parsed.role,
          lockedModelId: lockedTarget.canonicalId,
          finalText: redactSecrets(runOutput.finalText, secretsToRedact),
          stuckAlert: null,
          touchedFiles: Array.from(touchedFilesSet),
          commandsExecuted: safeCommands,
          tokenUsage: runOutput.tokenUsage,
          turns: Math.max(turnCount, runOutput.turnsExecuted),
          durationMs: Date.now() - startedAt,
        }) as RunSessionOutput<TSchema>;
      }

      if (parsed.mode === "plan" && gitStatusBefore !== null) {
        const gitStatusAfter = readGitStatusSnapshot(workspaceRoot);
        if (gitStatusAfter !== null && gitStatusAfter !== gitStatusBefore) {
          throw new PlanModeWriteViolationError(
            "Modo 'plan' alterou arquivos no worktree (diferença detectada em git status --porcelain)."
          );
        }
      }

      const sanitizedText = redactSecrets(runOutput.finalText, secretsToRedact);
      let validatedStructuredOutput: unknown = redactSecretsInValue(
        runOutput.structuredOutput,
        secretsToRedact
      );

      if (outputSchema && !reachedMaxSteps) {
        const parsedStructured = outputSchema.safeParse(validatedStructuredOutput);
        if (!parsedStructured.success) {
          throw new StructuredOutputValidationError(
            `StructuredOutput não atende ao schema Zod esperado: ${parsedStructured.error.message}`,
            parsedStructured.error
          );
        }
        validatedStructuredOutput = parsedStructured.data;
      }

      return OpenCodeSessionResultSchema.parse({
        sessionId: handle.sessionId,
        status: "completed",
        mode: parsed.mode,
        role: parsed.role,
        lockedModelId: lockedTarget.canonicalId,
        finalText: sanitizedText,
        structuredOutput: validatedStructuredOutput,
        stuckAlert: null,
        touchedFiles: Array.from(touchedFilesSet),
        commandsExecuted: safeCommands,
        tokenUsage: runOutput.tokenUsage,
        turns: reachedMaxSteps
          ? parsed.maxSteps
          : Math.max(turnCount, runOutput.turnsExecuted),
        durationMs: Date.now() - startedAt,
      }) as RunSessionOutput<TSchema>;
    } catch (error) {
      throw redactError(error, secretsToRedact);
    } finally {
      ephemeralApiKey = undefined;
      clearTimeout(timeoutHandle);
      if (externalSignal) {
        externalSignal.removeEventListener("abort", onExternalAbort);
      }
      if (handle) {
        await handle.close().catch(() => undefined);
      }
    }
  }
}
