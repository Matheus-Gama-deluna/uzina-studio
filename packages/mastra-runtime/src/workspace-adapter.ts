import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Agent, type ToolsInput } from "@mastra/core/agent";
import type { MastraModelConfig } from "@mastra/core/llm";
import { RequestContext } from "@mastra/core/request-context";
import { createTool } from "@mastra/core/tools";
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
  MigrationSafetyReportSchema,
  OpenCodeSessionResultSchema,
  ScopedCheckResultSchema,
  ToolCallTracePayloadSchema,
  type CodingExecutorMode,
  type MigrationSafetyReport,
  type OpenCodeRunSessionOptionsInput,
  type ScopedCheckDiagnostic,
  type ScopedCheckResult,
  type ToolPoliciesMap,
  type WorkspaceKind,
} from "@uzina/contracts";
import {
  assertPathInsideWorkspace,
  redactSensitiveText,
  validateMigrationSafety,
} from "@uzina/core";
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
    const trimmed = line.trim();
    const headerMatch = /^(?:---|\+\+\+)\s+(?:[ab]\/)?(.+)$/.exec(trimmed);
    if (headerMatch?.[1] && headerMatch[1] !== "/dev/null") {
      targets.push(headerMatch[1].trim());
      continue;
    }
    const codexMatch =
      /^\*\*\*\s+(?:Update File|Add File|Delete File|Move to):\s*(.+)$/.exec(
        trimmed
      );
    if (codexMatch?.[1]) {
      targets.push(codexMatch[1].trim());
    }
  }
  return targets;
}

function collectHookCandidatePaths(input: unknown): string[] {
  if (!input || typeof input !== "object") return [];
  const rec = input as Record<string, unknown>;
  const candidates: string[] = [];
  for (const key of [
    "path",
    "src",
    "dest",
    "filePath",
    "directory",
    "target",
    "file",
  ]) {
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

function buildLockedPathsMatcher(
  workspaceRoot: string,
  lockedReadOnlyPaths?: readonly string[]
): { isLocked: (candidate: string) => boolean; hasEntries: boolean } {
  const lockedFileKeys = new Set<string>();
  const lockedDirPrefixes: string[] = [];

  for (const rawEntry of lockedReadOnlyPaths ?? []) {
    const trimmed = rawEntry.trim();
    if (!trimmed) continue;
    const isDirEntry = trimmed.endsWith("/") || trimmed.endsWith("\\");
    const key = normalizeTrackerKey(trimmed, workspaceRoot);
    if (isDirEntry) {
      const normalizedPrefix = key.endsWith(path.sep) ? key : `${key}${path.sep}`;
      lockedDirPrefixes.push(normalizedPrefix);
    } else {
      lockedFileKeys.add(key);
    }
  }

  return {
    hasEntries: lockedFileKeys.size > 0 || lockedDirPrefixes.length > 0,
    isLocked(candidate: string): boolean {
      const key = normalizeTrackerKey(candidate, workspaceRoot);
      if (lockedFileKeys.has(key)) {
        return true;
      }
      return lockedDirPrefixes.some(
        (prefix) => key === prefix.slice(0, -1) || key.startsWith(prefix)
      );
    },
  };
}

const MAX_SCOPED_TIMEOUT_MS = 30_000;
const MAX_SCOPED_OUTPUT_CHARS = 16_384;
const ALLOWED_PACKAGE_RE =
  /^(?:@uzina\/[a-z0-9-]+|apps\/(?:web|cli)|packages\/[a-z0-9-]+|web|cli)$/;
const FORBIDDEN_ARG_CHARS_RE = /[;&|$`><(){}[\]\r\n\0]/;
const ALLOWED_UNIT_TEST_EXT_RE = /\.(?:test|spec)\.[cm]?[jt]sx?$/i;

export function assertAllowedTargetPackage(rawPackage: string): string {
  const trimmed = rawPackage.trim();
  if (
    !trimmed ||
    trimmed.startsWith("-") ||
    trimmed.includes("..") ||
    trimmed.includes("\\") ||
    FORBIDDEN_ARG_CHARS_RE.test(trimmed) ||
    !ALLOWED_PACKAGE_RE.test(trimmed)
  ) {
    throw new Error(
      `Pacote alvo fora da allowlist fechada de micro-loop: '${rawPackage}'.`
    );
  }
  return trimmed;
}

export function assertAllowedUnitTestPath(
  workspaceRoot: string,
  rawTestPath: string
): string {
  const trimmed = rawTestPath.trim();
  if (
    !trimmed ||
    trimmed.startsWith("-") ||
    FORBIDDEN_ARG_CHARS_RE.test(trimmed) ||
    trimmed.split(/[\\/]+/).includes("..")
  ) {
    throw new Error(
      `Caminho de teste unitário inválido ou com flag/traversal proibido: '${rawTestPath}'.`
    );
  }
  const safeAbs = resolveCandidateInsideRoot(workspaceRoot, trimmed, false);
  const rel = path.relative(workspaceRoot, safeAbs).replace(/\\/g, "/");
  if (!rel || rel.startsWith("..") || !ALLOWED_UNIT_TEST_EXT_RE.test(rel)) {
    throw new Error(
      `Arquivo fora do escopo de teste unitário permitido (*.test.* / *.spec.*): '${rawTestPath}'.`
    );
  }
  return rel;
}

function buildMinimalSubprocessEnv(): NodeJS.ProcessEnv {
  const allowKeys = [
    "PATH",
    "Path",
    "SystemRoot",
    "SYSTEMROOT",
    "PATHEXT",
    "COMSPEC",
    "ComSpec",
    "HOME",
    "USERPROFILE",
    "TMPDIR",
    "TEMP",
    "TMP",
    "LANG",
    "LC_ALL",
    "NODE_ENV",
    "npm_execpath",
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const key of allowKeys) {
    const val = process.env[key];
    if (typeof val === "string" && val.length > 0) {
      env[key] = val;
    }
  }
  return env;
}

function resolvePnpmSubprocessCommand(args: readonly string[]): {
  binary: string;
  args: string[];
} {
  const npmExecPath = process.env.npm_execpath?.trim();
  if (
    npmExecPath &&
    /\.(?:[cm]?js)$/i.test(npmExecPath) &&
    fs.existsSync(npmExecPath)
  ) {
    return {
      binary: process.execPath,
      args: [npmExecPath, ...args],
    };
  }
  return {
    binary: "pnpm",
    args: [...args],
  };
}

function parseTscDiagnostics(output: string): ScopedCheckDiagnostic[] {
  const diagnostics: ScopedCheckDiagnostic[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (diagnostics.length >= 200) break;
    const parenMatch =
      /^(.+?)\((\d+),\d+\):\s+(?:error|warning)\s+(TS\d+):\s+(.+)$/.exec(
        line.trim()
      );
    if (parenMatch?.[1] && parenMatch[2] && parenMatch[4]) {
      diagnostics.push({
        file: parenMatch[1].trim().slice(0, 500),
        line: Number.parseInt(parenMatch[2], 10),
        code: parenMatch[3],
        message: parenMatch[4].trim().slice(0, 1000),
      });
      continue;
    }
    const colonMatch =
      /^(.+?):(\d+):\d+\s+-\s+(?:error|warning)\s+(TS\d+):\s+(.+)$/.exec(
        line.trim()
      );
    if (colonMatch?.[1] && colonMatch[2] && colonMatch[4]) {
      diagnostics.push({
        file: colonMatch[1].trim().slice(0, 500),
        line: Number.parseInt(colonMatch[2], 10),
        code: colonMatch[3],
        message: colonMatch[4].trim().slice(0, 1000),
      });
    }
  }
  return diagnostics;
}

function parseVitestDiagnostics(
  output: string,
  defaultFile: string
): ScopedCheckDiagnostic[] {
  const diagnostics: ScopedCheckDiagnostic[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    if (diagnostics.length >= 200) break;
    const line = rawLine.trim();
    if (!line) continue;
    if (/^(?:FAIL|AssertionError|Error:)/i.test(line)) {
      diagnostics.push({
        file: defaultFile.slice(0, 500),
        line: null,
        message: line.slice(0, 1000),
      });
    }
  }
  return diagnostics;
}

export interface ScopedSubprocessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export type ScopedSubprocessRunner = (
  binary: string,
  args: readonly string[],
  options: {
    cwd: string;
    timeoutMs: number;
    env: NodeJS.ProcessEnv;
  }
) => Promise<ScopedSubprocessResult>;

function defaultScopedSubprocessRunner(
  binary: string,
  args: readonly string[],
  options: {
    cwd: string;
    timeoutMs: number;
    env: NodeJS.ProcessEnv;
  }
): Promise<ScopedSubprocessResult> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    execFile(
      binary,
      [...args],
      {
        cwd: options.cwd,
        env: options.env,
        timeout: Math.min(options.timeoutMs, MAX_SCOPED_TIMEOUT_MS),
        maxBuffer: 2 * 1024 * 1024,
        shell: false,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const errObj = error as (NodeJS.ErrnoException & { killed?: boolean }) | null;
        const timedOut = Boolean(errObj?.killed);
        const exitCode =
          typeof errObj?.code === "number" ? errObj.code : error ? 1 : 0;
        resolve({
          exitCode,
          stdout: typeof stdout === "string" ? stdout : "",
          stderr: typeof stderr === "string" ? stderr : "",
          durationMs: Date.now() - startedAt,
          timedOut,
        });
      }
    );
  });
}

export interface ScopedMicroLoopToolsDeps {
  workspaceRoot: string;
  toolPolicies?: ToolPoliciesMap;
  knownSecrets?: readonly string[];
  db?: UzinaDb;
  deliverableId?: string;
  stage?: string;
  actorRole?: string;
  timeoutMs?: number;
  runSubprocess?: ScopedSubprocessRunner;
}

export function createScopedMicroLoopTools(
  deps: ScopedMicroLoopToolsDeps
) {
  const workspaceRoot = path.resolve(deps.workspaceRoot);
  const boundedTimeoutMs = Math.min(
    Math.max(100, deps.timeoutMs ?? MAX_SCOPED_TIMEOUT_MS),
    MAX_SCOPED_TIMEOUT_MS
  );
  const secrets = [...(deps.knownSecrets ?? [])];
  const runSubprocess = deps.runSubprocess ?? defaultScopedSubprocessRunner;

  const recordToolEvent = async (params: {
    toolName: string;
    targetPath?: string;
    durationMs: number;
    status: "ok" | "error";
    summary?: string;
  }) => {
    if (!deps.db || !deps.deliverableId) return;
    try {
      const payload = ToolCallTracePayloadSchema.parse({
        phase: "result",
        toolName: params.toolName,
        ...(params.targetPath ? { targetPath: params.targetPath } : {}),
        durationMs: params.durationMs,
        status: params.status,
        ...(params.summary
          ? { summary: redactSensitiveText(params.summary, secrets).slice(0, 1000) }
          : {}),
      });
      await recordExecutionEvent(deps.db, {
        deliverableId: deps.deliverableId,
        stage: deps.stage ?? "stage_build",
        actorRole: deps.actorRole ?? "builder",
        eventType: "tool_call",
        payload,
      });
    } catch {
      // Telemetria best-effort não interrompe micro-loop
    }
  };

  const run_scoped_typecheck = createTool({
    id: "run_scoped_typecheck",
    description:
      "Executa typecheck allowlisted (tsc --noEmit) em um único pacote do monorepo via execFile (shell: false, timeout <= 30s).",
    inputSchema: z
      .object({
        targetPackage: z.string().trim().min(1).max(120),
      })
      .strict(),
    outputSchema: ScopedCheckResultSchema,
    execute: async (inputData): Promise<ScopedCheckResult> => {
      const targetPackage = assertAllowedTargetPackage(inputData.targetPackage);
      const commandLabel = `pnpm --filter ${targetPackage} typecheck`;
      const policyAction = deps.toolPolicies?.runTests ?? "allow";

      if (policyAction === "deny" || policyAction === "ask") {
        const msg = `Execução bloqueada pela política granular 'runTests=${policyAction}'.`;
        await recordToolEvent({
          toolName: "run_scoped_typecheck",
          targetPath: targetPackage,
          durationMs: 0,
          status: "error",
          summary: msg,
        });
        return ScopedCheckResultSchema.parse({
          passed: false,
          command: commandLabel,
          targetPackage,
          diagnostics: [
            {
              file: targetPackage,
              line: null,
              code: "TOOL_POLICY_BLOCKED",
              message: msg,
            },
          ],
          durationMs: 0,
          truncatedOutput: msg,
        });
      }

      const cmd = resolvePnpmSubprocessCommand([
        "--filter",
        targetPackage,
        "typecheck",
      ]);
      const res = await runSubprocess(cmd.binary, cmd.args, {
        cwd: workspaceRoot,
        timeoutMs: boundedTimeoutMs,
        env: buildMinimalSubprocessEnv(),
      });

      const combined = redactSensitiveText(
        [res.stdout, res.stderr].filter(Boolean).join("\n"),
        secrets
      );
      const diagnostics = parseTscDiagnostics(combined);
      const passed = res.exitCode === 0 && !res.timedOut;
      const truncatedOutput = combined.slice(0, MAX_SCOPED_OUTPUT_CHARS);

      await recordToolEvent({
        toolName: "run_scoped_typecheck",
        targetPath: targetPackage,
        durationMs: res.durationMs,
        status: passed ? "ok" : "error",
        summary: passed
          ? `typecheck aprovado em ${targetPackage}`
          : truncatedOutput || `typecheck falhou (exit=${res.exitCode})`,
      });

      return ScopedCheckResultSchema.parse({
        passed,
        command: commandLabel,
        targetPackage,
        diagnostics,
        durationMs: res.durationMs,
        truncatedOutput,
      });
    },
  });

  const run_scoped_unit_test = createTool({
    id: "run_scoped_unit_test",
    description:
      "Executa um único arquivo de teste unitário (*.test.* / *.spec.*) via execFile (shell: false, timeout <= 30s) respeitando toolPolicies.runTests.",
    inputSchema: z
      .object({
        targetPackage: z.string().trim().min(1).max(120),
        testFilePath: z.string().trim().min(1).max(300),
      })
      .strict(),
    outputSchema: ScopedCheckResultSchema,
    execute: async (inputData): Promise<ScopedCheckResult> => {
      const targetPackage = assertAllowedTargetPackage(inputData.targetPackage);
      const safeRelPath = assertAllowedUnitTestPath(
        workspaceRoot,
        inputData.testFilePath
      );
      const commandLabel = `pnpm --filter ${targetPackage} test -- ${safeRelPath}`;
      const policyAction = deps.toolPolicies?.runTests ?? "allow";

      if (policyAction === "deny" || policyAction === "ask") {
        const msg = `Execução bloqueada pela política granular 'runTests=${policyAction}'.`;
        await recordToolEvent({
          toolName: "run_scoped_unit_test",
          targetPath: safeRelPath,
          durationMs: 0,
          status: "error",
          summary: msg,
        });
        return ScopedCheckResultSchema.parse({
          passed: false,
          command: commandLabel,
          targetPackage,
          diagnostics: [
            {
              file: safeRelPath,
              line: null,
              code: "TOOL_POLICY_BLOCKED",
              message: msg,
            },
          ],
          durationMs: 0,
          truncatedOutput: msg,
        });
      }

      const cmd = resolvePnpmSubprocessCommand([
        "--filter",
        targetPackage,
        "test",
        "--",
        safeRelPath,
      ]);
      const res = await runSubprocess(cmd.binary, cmd.args, {
        cwd: workspaceRoot,
        timeoutMs: boundedTimeoutMs,
        env: buildMinimalSubprocessEnv(),
      });

      const combined = redactSensitiveText(
        [res.stdout, res.stderr].filter(Boolean).join("\n"),
        secrets
      );
      const diagnostics = parseVitestDiagnostics(combined, safeRelPath);
      const passed = res.exitCode === 0 && !res.timedOut;
      const truncatedOutput = combined.slice(0, MAX_SCOPED_OUTPUT_CHARS);

      await recordToolEvent({
        toolName: "run_scoped_unit_test",
        targetPath: safeRelPath,
        durationMs: res.durationMs,
        status: passed ? "ok" : "error",
        summary: passed
          ? `teste unitário aprovado (${safeRelPath})`
          : truncatedOutput || `teste falhou (exit=${res.exitCode})`,
      });

      return ScopedCheckResultSchema.parse({
        passed,
        command: commandLabel,
        targetPackage,
        diagnostics,
        durationMs: res.durationMs,
        truncatedOutput,
      });
    },
  });

  const validate_migration_safety = createTool({
    id: "validate_migration_safety",
    description:
      "Valida segurança DDL de migrações SQL/schema dentro do workspace, bloqueando DROP TABLE, DROP COLUMN, TRUNCATE, ADD COLUMN NOT NULL sem DEFAULT e ALTER COLUMN TYPE.",
    inputSchema: z
      .object({
        filePath: z.string().trim().min(1).max(500),
        content: z.string().max(512_000).optional(),
      })
      .strict(),
    outputSchema: MigrationSafetyReportSchema,
    execute: async (inputData): Promise<MigrationSafetyReport> => {
      const startedAt = Date.now();
      const safeAbs = resolveCandidateInsideRoot(
        workspaceRoot,
        inputData.filePath,
        false
      );
      const relPath = path.relative(workspaceRoot, safeAbs).replace(/\\/g, "/");
      const sqlContent =
        inputData.content !== undefined
          ? inputData.content
          : fs.readFileSync(safeAbs, "utf8");

      const report = validateMigrationSafety(sqlContent, relPath);
      await recordToolEvent({
        toolName: "validate_migration_safety",
        targetPath: relPath,
        durationMs: Date.now() - startedAt,
        status: report.passed ? "ok" : "error",
        summary: report.passed
          ? `Migração segura (${report.issues.length} avisos)`
          : `${report.issues.filter((i) => i.severity === "blocking").length} violações bloqueantes em ${relPath}`,
      });
      return report;
    },
  });

  return {
    run_scoped_typecheck,
    run_scoped_unit_test,
    validate_migration_safety,
  } satisfies ToolsInput;
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
  lockedReadOnlyPaths?: readonly string[];
  scopedMicroLoopTimeoutMs?: number;
  scopedSubprocessRunner?: ScopedSubprocessRunner;
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
    const lockedPathsMatcher = buildLockedPathsMatcher(
      workspaceRoot,
      options.lockedReadOnlyPaths
    );
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

      if (isWriteOp && lockedPathsMatcher.hasEntries) {
        for (const c of candidates) {
          if (lockedPathsMatcher.isLocked(c)) {
            const lockMsg = `Test Lock ativo: '${c}' está protegido somente-leitura (${ctx.workspaceToolName}). Corrija o código de produção em vez de alterar os testes de contrato (ou solicite revisão de contrato).`;
            if (options.db && options.deliverableId) {
              const targetPath = resolveTargetPathPreview(ctx.input);
              await emitToolTrace({
                phase: "result",
                toolName: ctx.workspaceToolName,
                ...(targetPath ? { targetPath } : {}),
                durationMs: 0,
                status: "error",
                summary: lockMsg,
              });
            }
            return {
              proceed: false as const,
              output: { error: lockMsg },
            };
          }
        }
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
        [WORKSPACE_TOOLS.FILESYSTEM.APPLY_PATCH]: {
          enabled: options.mode !== "plan",
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

      const microLoopTools =
        options.mode === "plan"
          ? undefined
          : createScopedMicroLoopTools({
              workspaceRoot,
              toolPolicies: options.toolPolicies,
              knownSecrets,
              db: options.db,
              deliverableId: options.deliverableId,
              stage: traceStage,
              actorRole: options.role,
              timeoutMs: options.scopedMicroLoopTimeoutMs,
              runSubprocess: options.scopedSubprocessRunner,
            });

      const agent = new Agent({
        id: `uzina_workspace_executor_${options.role}`,
        name: `Uzina Workspace ${options.role}`,
        instructions: systemInstructions,
        model: resolvedModel,
        workspace,
        ...(microLoopTools ? { tools: microLoopTools } : {}),
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
