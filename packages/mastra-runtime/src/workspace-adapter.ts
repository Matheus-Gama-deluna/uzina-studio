import fs from "node:fs";
import path from "node:path";
import { Agent } from "@mastra/core/agent";
import type { MastraModelConfig } from "@mastra/core/llm";
import { RequestContext } from "@mastra/core/request-context";
import {
  LocalFilesystem,
  WORKSPACE_TOOLS,
  Workspace,
  type CopyOptions,
  type FileContent,
  type FileEntry,
  type FileStat,
  type ListOptions,
  type ReadOptions,
  type RemoveOptions,
  type WorkspaceToolAfterHookContext,
  type WorkspaceToolHookContext,
  type WriteOptions,
} from "@mastra/core/workspace";
import {
  OpenCodeSessionResultSchema,
  ToolCallTracePayloadSchema,
  type CodingExecutorMode,
  type OpenCodeRunSessionOptionsInput,
  type ToolPoliciesMap,
  type WorkspaceKind,
} from "@uzina/contracts";
import { assertPathInsideWorkspace, redactSensitiveText } from "@uzina/core";
import type { UzinaDb } from "@uzina/db";
import {
  OpenCodeRunner,
  type RunSessionExtraOptions,
  type RunSessionOutput,
} from "@uzina/opencode-bridge";
import { z } from "zod";
import { recordExecutionEvent } from "./event-bus.js";
import {
  collectOrganizationKnownSecrets,
  createTenantModelResolver,
} from "./model-resolver.js";
import {
  createBudgetGuardProcessor,
  createSecretRedactionProcessor,
  createUzinaAgentsMdInjector,
  createUzinaErrorProcessors,
  createUzinaSkillsContext,
  isSensitiveWorkspaceFile,
} from "./processors.js";

function normalizeTrackerKey(targetPath: string, root: string): string {
  const abs = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(root, targetPath);
  return process.platform === "win32" ? abs.toLowerCase() : abs;
}

function resolveCandidateInsideRoot(
  root: string,
  inputPath: string,
  allowRoot = false
): string {
  const trimmed = inputPath.trim();
  if (!trimmed || trimmed.includes("\0")) {
    throw new Error("Caminho de arquivo inválido ou contendo null-byte.");
  }
  const absCandidate = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(root, trimmed);

  if (isSensitiveWorkspaceFile(trimmed) || isSensitiveWorkspaceFile(absCandidate)) {
    throw new Error(
      `Acesso negado ao arquivo sensível '${path.basename(absCandidate)}'.`
    );
  }

  const canonicalRoot = assertPathInsideWorkspace(root, root, {
    allowRoot: true,
  });
  const canonicalTarget = assertPathInsideWorkspace(canonicalRoot, absCandidate, {
    allowRoot,
  });

  const relFromRoot = path.relative(canonicalRoot, canonicalTarget);
  if (
    isSensitiveWorkspaceFile(canonicalTarget) ||
    (relFromRoot.length > 0 &&
      relFromRoot.split(/[\\/]+/).some((seg) => isSensitiveWorkspaceFile(seg)))
  ) {
    throw new Error("Acesso negado por política de contenção de segredos.");
  }

  return canonicalTarget;
}

/**
 * Filesystem contido para o Workspace Mastra: reforça `assertPathInsideWorkspace`
 * contra ADS, nomes reservados Windows, symlinks, aliases 8.3 e leitura de
 * arquivos sensíveis (.env*, .master-key, *.pem, *.key, .git/config),
 * inclusive bloqueando listagem e grep desses alvos.
 */
export class UzinaContainedFilesystem extends LocalFilesystem {
  constructor(options: { basePath: string; readOnly?: boolean }) {
    super({
      id: "uzina-contained-fs",
      basePath: options.basePath,
      contained: true,
      readOnly: options.readOnly ?? false,
    });
  }

  private assertSafePath(inputPath: string, allowRoot = false): string {
    return resolveCandidateInsideRoot(this.basePath, inputPath, allowRoot);
  }

  override async readFile(
    inputPath: string,
    options?: ReadOptions
  ): Promise<string | Buffer> {
    const safe = this.assertSafePath(inputPath);
    return super.readFile(safe, options);
  }

  override async writeFile(
    inputPath: string,
    content: FileContent,
    options?: WriteOptions
  ): Promise<void> {
    const safe = this.assertSafePath(inputPath);
    return super.writeFile(safe, content, options);
  }

  override async appendFile(
    inputPath: string,
    content: FileContent
  ): Promise<void> {
    const safe = this.assertSafePath(inputPath);
    return super.appendFile(safe, content);
  }

  override async deleteFile(
    inputPath: string,
    options?: RemoveOptions
  ): Promise<void> {
    const safe = this.assertSafePath(inputPath);
    return super.deleteFile(safe, options);
  }

  override async copyFile(
    src: string,
    dest: string,
    options?: CopyOptions
  ): Promise<void> {
    const safeSrc = this.assertSafePath(src);
    const safeDest = this.assertSafePath(dest);
    return super.copyFile(safeSrc, safeDest, options);
  }

  override async moveFile(
    src: string,
    dest: string,
    options?: CopyOptions
  ): Promise<void> {
    const safeSrc = this.assertSafePath(src);
    const safeDest = this.assertSafePath(dest);
    return super.moveFile(safeSrc, safeDest, options);
  }

  override async mkdir(
    inputPath: string,
    options?: { recursive?: boolean }
  ): Promise<void> {
    const safe = this.assertSafePath(inputPath, true);
    return super.mkdir(safe, options);
  }

  override async rmdir(
    inputPath: string,
    options?: RemoveOptions
  ): Promise<void> {
    const safe = this.assertSafePath(inputPath);
    return super.rmdir(safe, options);
  }

  override async readdir(
    inputPath: string,
    options?: ListOptions
  ): Promise<FileEntry[]> {
    const safe = this.assertSafePath(inputPath, true);
    const entries = await super.readdir(safe, options);
    return entries.filter((entry) => !isSensitiveWorkspaceFile(entry.name));
  }

  override async exists(inputPath: string): Promise<boolean> {
    try {
      const safe = this.assertSafePath(inputPath, true);
      return await super.exists(safe);
    } catch {
      return false;
    }
  }

  override async stat(inputPath: string): Promise<FileStat> {
    const safe = this.assertSafePath(inputPath, true);
    return super.stat(safe);
  }

  override async realpath(inputPath: string): Promise<string> {
    const safe = this.assertSafePath(inputPath, true);
    return super.realpath(safe);
  }
}

export function extractPatchTargetPaths(patchText: string): string[] {
  const targets: string[] = [];
  for (const line of patchText.split(/\r?\n/)) {
    const headerMatch = /^(?:---|\+\+\+)\s+(?:[ab]\/)?(.+)$/.exec(line.trim());
    if (headerMatch?.[1] && headerMatch[1] !== "/dev/null") {
      targets.push(headerMatch[1].trim());
    }
  }
  return targets;
}

function collectHookCandidatePaths(input: unknown): string[] {
  if (!input || typeof input !== "object") return [];
  const rec = input as Record<string, unknown>;
  const candidates: string[] = [];
  for (const key of ["path", "src", "dest", "filePath", "directory"]) {
    if (typeof rec[key] === "string") {
      candidates.push(rec[key] as string);
    }
  }
  if (Array.isArray(rec.paths)) {
    for (const item of rec.paths) {
      if (typeof item === "string") candidates.push(item);
    }
  }
  if (typeof rec.patch === "string") {
    candidates.push(...extractPatchTargetPaths(rec.patch));
  }
  return candidates;
}

export interface CodingAdapterExecutionOptions<
  TSchema extends z.ZodTypeAny = z.ZodUnknown,
> extends RunSessionExtraOptions<TSchema> {
  db?: UzinaDb;
  projectId?: string;
  deliverableId?: string;
  stage?: string;
  budgetCapUsd?: number | null;
  workspaceKind?: WorkspaceKind;
  toolPolicies?: ToolPoliciesMap;
  modelOverride?: MastraModelConfig;
}

export interface CodingExecutorAdapter {
  readonly mode: CodingExecutorMode;
  runSession<TSchema extends z.ZodTypeAny = z.ZodUnknown>(
    options: OpenCodeRunSessionOptionsInput & CodingAdapterExecutionOptions<TSchema>
  ): Promise<RunSessionOutput<TSchema>>;
}

export class OpenCodeExecutorAdapter implements CodingExecutorAdapter {
  readonly mode: CodingExecutorMode = "opencode";

  constructor(private readonly runner: OpenCodeRunner) {}

  async runSession<TSchema extends z.ZodTypeAny = z.ZodUnknown>(
    options: OpenCodeRunSessionOptionsInput & CodingAdapterExecutionOptions<TSchema>
  ): Promise<RunSessionOutput<TSchema>> {
    const mode = options.mode ?? "build";
    const blockedClass =
      options.toolPolicies?.readCode === "deny" ||
      options.toolPolicies?.readCode === "ask"
        ? ("readCode" as const)
        : mode === "build" &&
            (options.toolPolicies?.writeFiles === "deny" ||
              options.toolPolicies?.writeFiles === "ask")
          ? ("writeFiles" as const)
          : null;

    if (blockedClass) {
      const blockedAction = options.toolPolicies![blockedClass];
      const msg = `Execução OpenCode bloqueada pela política granular '${blockedClass}=${blockedAction}'.`;
      if (options.db && options.deliverableId) {
        await recordExecutionEvent(options.db, {
          deliverableId: options.deliverableId,
          stage: options.stage ?? "stage_build",
          actorRole: options.role,
          eventType: "tool_call",
          payload: {
            phase: "result",
            toolName: `tool_policy:${blockedClass}`,
            status: "error",
            summary: msg,
          },
        }).catch(() => undefined);
      }
      return OpenCodeSessionResultSchema.parse({
        sessionId: null,
        status: "error",
        mode,
        role: options.role,
        lockedModelId:
          options.providerConfig.roleBindings[options.role]?.modelId ??
          "opencode-policy-blocked",
        finalText: "",
        stuckAlert: null,
        touchedFiles: [],
        commandsExecuted: [],
        tokenUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
        turns: 0,
        durationMs: 0,
        errorMessage: msg,
      }) as RunSessionOutput<TSchema>;
    }

    return this.runner.runSession({
      ...options,
      outputSchema: options.outputSchema,
      signal: options.signal,
      stuckDetector: options.stuckDetector,
    });
  }
}

export class MastraWorkspaceExecutorAdapter implements CodingExecutorAdapter {
  readonly mode: CodingExecutorMode = "mastra_coding_agent";

  constructor(
    private readonly deps: {
      masterKey?: Buffer;
      fallbackOpenCodeAdapter?: OpenCodeExecutorAdapter;
    }
  ) {}

  async runSession<TSchema extends z.ZodTypeAny = z.ZodUnknown>(
    options: OpenCodeRunSessionOptionsInput & CodingAdapterExecutionOptions<TSchema>
  ): Promise<RunSessionOutput<TSchema>> {
    if (
      options.workspaceKind === "docker" &&
      this.deps.fallbackOpenCodeAdapter
    ) {
      return this.deps.fallbackOpenCodeAdapter.runSession(options);
    }

    const startedAt = Date.now();
    const workspaceRoot = path.resolve(options.workspacePath);
    const modelIdLabel =
      options.providerConfig.roleBindings[options.role]?.modelId ??
      "mastra-workspace-agent";

    if (options.signal?.aborted) {
      return OpenCodeSessionResultSchema.parse({
        sessionId: null,
        status: "aborted",
        mode: options.mode ?? "build",
        role: options.role,
        lockedModelId: modelIdLabel,
        finalText: "",
        stuckAlert: null,
        touchedFiles: [],
        commandsExecuted: [],
        tokenUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
        turns: 0,
        durationMs: Date.now() - startedAt,
      }) as RunSessionOutput<TSchema>;
    }

    const fsProvider = new UzinaContainedFilesystem({
      basePath: workspaceRoot,
      readOnly: options.mode === "plan",
    });

    const readFilesNormalized = new Set<string>();
    const touchedFilesSet = new Set<string>();
    const toolStartTimes = new Map<string, number[]>();
    let knownSecrets: string[] = [];
    let budgetExceeded = false;
    const internalAbort = new AbortController();
    const forwardAbort = () => internalAbort.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", forwardAbort, { once: true });

    const traceStage = options.stage ?? "stage_build";
    const resolveTargetPathPreview = (input: unknown): string | undefined => {
      const candidate = collectHookCandidatePaths(input)[0];
      if (!candidate) return undefined;
      return redactSensitiveText(candidate, knownSecrets).slice(0, 512);
    };

    const emitToolTrace = async (payload: unknown) => {
      if (!options.db || !options.deliverableId) return;
      try {
        const parsed = ToolCallTracePayloadSchema.parse(payload);
        await recordExecutionEvent(options.db, {
          deliverableId: options.deliverableId,
          stage: traceStage,
          actorRole: options.role,
          eventType: "tool_call",
          payload: parsed,
        });
      } catch {
        // Telemetria best-effort não interrompe execução do agente
      }
    };

    const beforeToolHook = async (ctx: WorkspaceToolHookContext) => {
      const candidates = collectHookCandidatePaths(ctx.input);
      for (const candidate of candidates) {
        try {
          resolveCandidateInsideRoot(workspaceRoot, candidate, true);
        } catch (err) {
          return {
            proceed: false as const,
            output: {
              error:
                err instanceof Error
                  ? err.message
                  : "Caminho bloqueado pela contenção do workspace.",
            },
          };
        }
      }

      const isWriteOp =
        ctx.workspaceToolName === WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE ||
        ctx.workspaceToolName === WORKSPACE_TOOLS.FILESYSTEM.EDIT_FILE ||
        ctx.workspaceToolName === WORKSPACE_TOOLS.FILESYSTEM.AST_EDIT ||
        ctx.workspaceToolName === WORKSPACE_TOOLS.FILESYSTEM.DELETE ||
        ctx.workspaceToolName === WORKSPACE_TOOLS.FILESYSTEM.APPLY_PATCH;

      const isReadOp =
        ctx.workspaceToolName === WORKSPACE_TOOLS.FILESYSTEM.READ_FILE ||
        ctx.workspaceToolName === WORKSPACE_TOOLS.FILESYSTEM.LIST_FILES ||
        ctx.workspaceToolName === WORKSPACE_TOOLS.FILESYSTEM.FILE_STAT ||
        ctx.workspaceToolName === WORKSPACE_TOOLS.FILESYSTEM.GREP;

      const policyClass = isWriteOp
        ? ("writeFiles" as const)
        : isReadOp
          ? ("readCode" as const)
          : null;
      const policyAction = policyClass
        ? options.toolPolicies?.[policyClass]
        : undefined;

      if (policyAction === "deny" || policyAction === "ask") {
        const denyMsg = `Execução bloqueada pela política granular '${policyClass}=${policyAction}'.`;
        if (options.db && options.deliverableId) {
          const targetPath = resolveTargetPathPreview(ctx.input);
          await emitToolTrace({
            phase: "result",
            toolName: ctx.workspaceToolName,
            ...(targetPath ? { targetPath } : {}),
            durationMs: 0,
            status: "error",
            summary: denyMsg,
          });
        }
        return {
          proceed: false as const,
          output: { error: denyMsg },
        };
      }

      if (ctx.workspaceToolName === WORKSPACE_TOOLS.FILESYSTEM.READ_FILE) {
        for (const c of candidates) {
          readFilesNormalized.add(normalizeTrackerKey(c, workspaceRoot));
        }
      }

      if (isWriteOp && options.mode === "plan") {
        return {
          proceed: false as const,
          output: { error: "Escrita bloqueada no modo plan." },
        };
      }

      if (isWriteOp) {
        for (const c of candidates) {
          const abs = path.isAbsolute(c)
            ? path.resolve(c)
            : path.resolve(workspaceRoot, c);
          if (
            ctx.workspaceToolName !== WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE &&
            fs.existsSync(abs) &&
            !readFilesNormalized.has(normalizeTrackerKey(c, workspaceRoot))
          ) {
            return {
              proceed: false as const,
              output: {
                error:
                  "Leia o arquivo antes de editá-lo (requireReadBeforeWrite).",
              },
            };
          }
          const rel = path.relative(workspaceRoot, abs).replace(/\\/g, "/");
          if (rel && !rel.startsWith("..")) {
            touchedFilesSet.add(rel);
          }
        }
      }

      if (options.db && options.deliverableId) {
        const queue = toolStartTimes.get(ctx.workspaceToolName) ?? [];
        queue.push(Date.now());
        toolStartTimes.set(ctx.workspaceToolName, queue);
        const targetPath = resolveTargetPathPreview(ctx.input);
        await emitToolTrace({
          phase: "start",
          toolName: ctx.workspaceToolName,
          ...(targetPath ? { targetPath } : {}),
          status: "running",
        });
      }
      return undefined;
    };

    const afterToolHook = async (ctx: WorkspaceToolAfterHookContext) => {
      if (!options.db || !options.deliverableId) return;
      const queue = toolStartTimes.get(ctx.workspaceToolName);
      const started = queue?.shift();
      const durationMs =
        typeof started === "number" ? Math.max(0, Date.now() - started) : 0;
      const targetPath = resolveTargetPathPreview(ctx.input);
      const outputRecord =
        ctx.output && typeof ctx.output === "object"
          ? (ctx.output as Record<string, unknown>)
          : null;
      const outputErr =
        outputRecord && typeof outputRecord.error === "string"
          ? outputRecord.error
          : null;
      const hasError = Boolean(ctx.error) || Boolean(outputErr);
      const rawSummary = ctx.error
        ? ctx.error instanceof Error
          ? ctx.error.message
          : String(ctx.error)
        : outputErr;
      const summary = rawSummary
        ? redactSensitiveText(rawSummary, knownSecrets).slice(0, 1000)
        : undefined;

      await emitToolTrace({
        phase: "result",
        toolName: ctx.workspaceToolName,
        ...(targetPath ? { targetPath } : {}),
        durationMs,
        status: hasError ? "error" : "ok",
        ...(summary ? { summary } : {}),
      });
    };

    const workspace = new Workspace({
      id: `uzina-ws-${options.role}`,
      filesystem: fsProvider,
      tools: {
        hooks: {
          beforeToolCall: beforeToolHook,
          afterToolCall: afterToolHook,
        },
        [WORKSPACE_TOOLS.SANDBOX.EXECUTE_COMMAND]: { enabled: false },
        [WORKSPACE_TOOLS.SANDBOX.GET_PROCESS_OUTPUT]: { enabled: false },
        [WORKSPACE_TOOLS.SANDBOX.KILL_PROCESS]: { enabled: false },
      },
    });
    await workspace.init();

    try {
      const db = options.db;
      knownSecrets = db
        ? await collectOrganizationKnownSecrets(db, {
            organizationId: options.providerConfig.organizationId,
            masterKey: this.deps.masterKey,
          })
        : [];

      let resolvedModel: MastraModelConfig | undefined = options.modelOverride;
      if (!resolvedModel && db) {
        const resolver = createTenantModelResolver({
          db,
          masterKey: this.deps.masterKey,
        });
        const agencyRole =
          options.role === "architect"
            ? "software_architect"
            : options.role === "verifier" || options.role === "security"
              ? "qa_appsec"
              : "tech_lead";
        const modelInfo = await resolver.resolveForRole(
          options.providerConfig.organizationId,
          agencyRole
        );
        resolvedModel = modelInfo?.mastraModel.model;
      }

      if (!resolvedModel) {
        throw new Error(
          "MISSING_BUILDER_MODEL: Nenhum modelo configurado para MastraWorkspaceExecutorAdapter."
        );
      }

      const skillsCtx = createUzinaSkillsContext(options.skillsDir);
      const systemInstructions = [
        options.systemPromptPrefix ?? "",
        skillsCtx.catalogMarkdown,
      ]
        .filter(Boolean)
        .join("\n\n");

      const outputProcessors = [
        createSecretRedactionProcessor({ knownSecrets }),
        ...(db && options.projectId && options.budgetCapUsd
          ? [
              createBudgetGuardProcessor({
                db,
                projectId: options.projectId,
                budgetCapUsd: options.budgetCapUsd,
                modelId: modelIdLabel,
                onBudgetExceeded: () => {
                  budgetExceeded = true;
                  internalAbort.abort("BUDGET_CAP_EXCEEDED");
                },
              }),
            ]
          : []),
      ];

      const agent = new Agent({
        id: `uzina_workspace_executor_${options.role}`,
        name: `Uzina Workspace ${options.role}`,
        instructions: systemInstructions,
        model: resolvedModel,
        workspace,
        inputProcessors: [
          createSecretRedactionProcessor({ knownSecrets }),
          createUzinaAgentsMdInjector({ workspaceRoot }),
        ],
        outputProcessors,
        errorProcessors: createUzinaErrorProcessors(),
      });

      const rc = new RequestContext();
      rc.set("workspaceRoot", workspaceRoot);

      const genResult = await agent.generate(
        redactSensitiveText(options.prompt, knownSecrets),
        {
          requestContext: rc,
          maxSteps: options.maxSteps ?? 12,
          abortSignal: internalAbort.signal,
        }
      );

      let structuredOutput: unknown = undefined;
      if (options.outputSchema && genResult.text) {
        try {
          const fencedMatch = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/i.exec(
            genResult.text
          );
          const rawJson =
            fencedMatch?.[1] ?? /\{[\s\S]*\}/.exec(genResult.text)?.[0];
          if (rawJson) {
            structuredOutput = options.outputSchema.parse(JSON.parse(rawJson));
          }
        } catch {
          structuredOutput = undefined;
        }
      }

      const usage = genResult.totalUsage ?? genResult.usage;
      return OpenCodeSessionResultSchema.parse({
        sessionId: `ws-${Date.now()}`,
        status: budgetExceeded
          ? "aborted"
          : internalAbort.signal.aborted
            ? "aborted"
            : "completed",
        mode: options.mode ?? "build",
        role: options.role,
        lockedModelId: modelIdLabel,
        finalText: redactSensitiveText(genResult.text ?? "", knownSecrets),
        structuredOutput,
        stuckAlert: null,
        touchedFiles: Array.from(touchedFilesSet),
        commandsExecuted: [],
        tokenUsage: {
          inputTokens: usage?.inputTokens ?? 0,
          outputTokens: usage?.outputTokens ?? 0,
          cacheReadTokens: 0,
        },
        turns: genResult.steps?.length ?? 1,
        durationMs: Date.now() - startedAt,
        ...(budgetExceeded ? { errorMessage: "BUDGET_CAP_EXCEEDED" } : {}),
      }) as RunSessionOutput<TSchema>;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isBudgetAbort =
        budgetExceeded ||
        msg.includes("BUDGET_CAP_EXCEEDED") ||
        String(internalAbort.signal.reason ?? "").includes("BUDGET_CAP_EXCEEDED");

      if (isBudgetAbort || options.signal?.aborted) {
        return OpenCodeSessionResultSchema.parse({
          sessionId: null,
          status: "aborted",
          mode: options.mode ?? "build",
          role: options.role,
          lockedModelId: modelIdLabel,
          finalText: "",
          stuckAlert: null,
          touchedFiles: Array.from(touchedFilesSet),
          commandsExecuted: [],
          tokenUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
          turns: 1,
          durationMs: Date.now() - startedAt,
          errorMessage: isBudgetAbort
            ? "BUDGET_CAP_EXCEEDED"
            : "ABORTED_BY_USER",
        }) as RunSessionOutput<TSchema>;
      }

      return OpenCodeSessionResultSchema.parse({
        sessionId: null,
        status: "error",
        mode: options.mode ?? "build",
        role: options.role,
        lockedModelId: modelIdLabel,
        finalText: "",
        stuckAlert: null,
        touchedFiles: Array.from(touchedFilesSet),
        commandsExecuted: [],
        tokenUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
        turns: 0,
        durationMs: Date.now() - startedAt,
        errorMessage: redactSensitiveText(msg),
      }) as RunSessionOutput<TSchema>;
    } finally {
      options.signal?.removeEventListener("abort", forwardAbort);
      await workspace.destroy().catch(() => undefined);
    }
  }
}

export function createCodingExecutorAdapter(params: {
  mode: CodingExecutorMode;
  runner: OpenCodeRunner;
  masterKey?: Buffer;
}): CodingExecutorAdapter {
  const openCodeAdapter = new OpenCodeExecutorAdapter(params.runner);
  if (params.mode === "mastra_coding_agent") {
    return new MastraWorkspaceExecutorAdapter({
      masterKey: params.masterKey,
      fallbackOpenCodeAdapter: openCodeAdapter,
    });
  }
  return openCodeAdapter;
}
