import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  ExecOptionsSchema,
  ExecResultSchema,
  WorktreeHandleSchema,
  WorktreePrepareInputSchema,
  type ExecOptions,
  type ExecResult,
  type SkillDefinition,
  type WorktreeHandle,
} from "@uzina/contracts";
import {
  assertPathInsideWorkspace,
  assertSafeGitRef,
  sanitizeWorktreeSlug,
} from "@uzina/core";
import { DangerousCommandError, WorktreeError } from "./errors.js";

const execFileAsync = promisify(execFile);

const repoExcludeLocks = new Map<string, Promise<void>>();

const ENV_INHERIT_ALLOWLIST = new Set([
  "PATH",
  "PATHEXT",
  "HOME",
  "USERPROFILE",
  "SYSTEMROOT",
  "COMSPEC",
  "TEMP",
  "TMP",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "NODE_ENV",
  "CI",
]);

const FORBIDDEN_EXTRA_ENV_KEYS = new Set([
  "MASTER_ENCRYPTION_KEY",
  "VAULT_MASTER_KEY",
  "BETTER_AUTH_SECRET",
  "DATABASE_URL",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_ASKPASS",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "GIT_PROXY_COMMAND",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_EXEC_PATH",
  "GIT_TEMPLATE_DIR",
  "SSH_ASKPASS",
  "SSH_AUTH_SOCK",
  "BASH_ENV",
  "NODE_OPTIONS",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "PYTHONPATH",
  "JAVA_TOOL_OPTIONS",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
]);

const FORBIDDEN_EXTRA_ENV_SUFFIX_RE = /(_KEY|_SECRET|_TOKEN|PASSWORD)$/i;

const BLOCKED_SHELL_EXECUTABLES = new Set([
  "sh",
  "bash",
  "zsh",
  "dash",
  "ksh",
  "csh",
  "tcsh",
  "fish",
  "ash",
  "busybox",
  "wsl",
  "cmd",
  "powershell",
  "pwsh",
  "cscript",
  "wscript",
  "mshta",
  "env",
]);

const BLOCKED_SYSTEM_EXECUTABLES = new Set([
  "format",
  "mkfs",
  "dd",
  "shutdown",
  "reboot",
  "diskpart",
  "fdisk",
]);

const GIT_GLOBAL_FLAGS_WITH_VALUE = new Set([
  "-c",
  "-C",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--super-prefix",
  "--exec-path",
  "--config-env",
  "--list-cmds",
]);

const GIT_BLOCKED_GLOBAL_FLAGS = new Set([
  "-c",
  "--exec-path",
  "--upload-pack",
  "--receive-pack",
]);

export interface ExecutionWorkspace {
  prepare(
    repoPath: string,
    baseBranch: string,
    deliverableId: string,
    options?: { worktreesRootDir?: string }
  ): Promise<WorktreeHandle>;
  exec(
    command: string,
    args?: string[],
    options?: ExecOptions & { signal?: AbortSignal }
  ): Promise<ExecResult>;
  getDiff(
    baseRef?: string,
    options?: { maxBytes?: number; includeUntracked?: boolean }
  ): Promise<string>;
  cleanup(options?: { deleteBranch?: boolean }): Promise<void>;
}

export function sanitizeChildEnv(
  baseEnv: Record<string, string | undefined> = process.env,
  extraEnv?: Record<string, string>
): Record<string, string> {
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(baseEnv)) {
    if (value !== undefined && ENV_INHERIT_ALLOWLIST.has(key.toUpperCase())) {
      sanitized[key] = value;
    }
  }

  if (extraEnv) {
    for (const [key, value] of Object.entries(extraEnv)) {
      const upper = key.toUpperCase();
      if (
        FORBIDDEN_EXTRA_ENV_KEYS.has(upper) ||
        FORBIDDEN_EXTRA_ENV_SUFFIX_RE.test(upper)
      ) {
        continue;
      }
      sanitized[key] = value;
    }
  }

  sanitized.GIT_TERMINAL_PROMPT = "0";
  return sanitized;
}

function normalizeExecutableName(command: string): string {
  const base = path.basename(command.trim()).toLowerCase();
  return base.replace(/\.(exe|cmd|bat|ps1)$/i, "");
}

function parseGitSubcommandAndValidateGlobals(args: readonly string[]): {
  subcommand: string | null;
  subArgs: string[];
} {
  let i = 0;
  while (i < args.length) {
    const arg = args[i]!;
    if (arg === "--") {
      i += 1;
      break;
    }
    if (/ext::/i.test(arg)) {
      throw new DangerousCommandError(
        "Protocolo git 'ext::' bloqueado em ExecutionWorkspace.exec."
      );
    }
    if (!arg.startsWith("-")) {
      return {
        subcommand: arg.toLowerCase(),
        subArgs: args.slice(i + 1),
      };
    }

    if (arg.startsWith("-c") && !arg.startsWith("--")) {
      throw new DangerousCommandError(
        `Flag global perigosa do git bloqueada: '${arg}'.`
      );
    }

    const eqIdx = arg.indexOf("=");
    const flagName = eqIdx !== -1 ? arg.slice(0, eqIdx) : arg;

    if (GIT_BLOCKED_GLOBAL_FLAGS.has(flagName)) {
      throw new DangerousCommandError(
        `Flag global perigosa do git bloqueada: '${flagName}'.`
      );
    }

    if (eqIdx === -1 && GIT_GLOBAL_FLAGS_WITH_VALUE.has(flagName)) {
      i += 2;
      continue;
    }
    i += 1;
  }

  const next = args[i];
  return {
    subcommand: next ? next.toLowerCase() : null,
    subArgs: args.slice(i + 1),
  };
}

function hasShortFlag(args: readonly string[], letter: string): boolean {
  return args.some(
    (a) => a.startsWith("-") && !a.startsWith("--") && a.includes(letter)
  );
}

export function assertSafeCommand(
  command: string,
  args: readonly string[] = []
): void {
  const trimmed = command.trim();
  if (!trimmed || trimmed.includes("\0")) {
    throw new DangerousCommandError("Comando vazio ou inválido.");
  }

  const exe = normalizeExecutableName(trimmed);
  if (BLOCKED_SHELL_EXECUTABLES.has(exe)) {
    throw new DangerousCommandError(
      `Interpretadores shell ('${exe}') não são permitidos em ExecutionWorkspace.exec.`
    );
  }
  if (BLOCKED_SYSTEM_EXECUTABLES.has(exe)) {
    throw new DangerousCommandError(
      `Executável de sistema destrutivo bloqueado: '${exe}'.`
    );
  }

  if (exe === "rm") {
    const hasRecursiveOrForce =
      args.some((a) => a === "--recursive" || a === "--force") ||
      hasShortFlag(args, "r") ||
      hasShortFlag(args, "f");

    const targetsDangerousPath = args.some((a) => {
      if (a.startsWith("-")) return false;
      const t = a.trim();
      const norm = path.posix.normalize(t.replace(/\\/g, "/"));
      return (
        t === "/" ||
        t === "\\" ||
        /^[a-zA-Z]:[\\/]?$/.test(t) ||
        path.isAbsolute(t) ||
        norm === "." ||
        norm === ".." ||
        norm.startsWith("../") ||
        norm.startsWith("/")
      );
    });
    if (hasRecursiveOrForce && targetsDangerousPath) {
      throw new DangerousCommandError(
        "Comando 'rm' recursivo/forçado fora do diretório relativo bloqueado."
      );
    }
  }

  if (exe === "git") {
    const { subcommand, subArgs } = parseGitSubcommandAndValidateGlobals(args);
    for (const a of subArgs) {
      if (/ext::/i.test(a)) {
        throw new DangerousCommandError("Protocolo git 'ext::' bloqueado.");
      }
      if (
        a === "--upload-pack" ||
        a.startsWith("--upload-pack=") ||
        a === "--receive-pack" ||
        a.startsWith("--receive-pack=")
      ) {
        throw new DangerousCommandError(`Flag perigosa '${a}' bloqueada.`);
      }
    }

    const hasForce =
      subArgs.some(
        (a) =>
          a === "--force" ||
          a.startsWith("--force=") ||
          a === "--force-with-lease"
      ) || hasShortFlag(subArgs, "f");

    if (subcommand === "push") {
      const hasPlusRefspec = subArgs.some((a) => {
        if (a.startsWith("-")) return false;
        return a.startsWith("+") || a.includes(":+");
      });
      if (hasForce || hasPlusRefspec) {
        throw new DangerousCommandError(
          "Comando 'git push --force' ou refspec '+' bloqueado."
        );
      }
    }

    if (
      subcommand === "reset" &&
      subArgs.some((a) => a === "--hard" || a === "--merge")
    ) {
      throw new DangerousCommandError(
        "Comando 'git reset --hard/--merge' bloqueado."
      );
    }

    if (subcommand === "clean" && hasForce) {
      throw new DangerousCommandError("Comando 'git clean -f' bloqueado.");
    }

    if (subcommand === "checkout" && hasForce) {
      throw new DangerousCommandError("Comando 'git checkout -f' bloqueado.");
    }
  }
}

async function killProcessTree(pid: number | undefined): Promise<void> {
  if (!pid || pid <= 0) {
    return;
  }
  if (process.platform === "win32") {
    await execFileAsync("taskkill", ["/pid", String(pid), "/T", "/F"], {
      windowsHide: true,
    }).catch(() => undefined);
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // processo ja encerrado
    }
  }
}

async function runGit(
  cwd: string,
  args: string[],
  envOverrides?: Record<string, string>
): Promise<{ stdout: string; stderr: string }> {
  const env = {
    ...sanitizeChildEnv(process.env),
    ...envOverrides,
    GIT_TERMINAL_PROMPT: "0",
  };
  const { stdout, stderr } = await execFileAsync("git", args, {
    cwd,
    env,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });
  return { stdout, stderr };
}

function normalizeGitPathForCompare(p: string): string {
  const resolved = fs.existsSync(p)
    ? fs.realpathSync.native(p).replace(/^\\\\\?\\/, "")
    : path.resolve(p);
  const unixified = resolved.replace(/\\/g, "/");
  return process.platform === "win32" ? unixified.toLowerCase() : unixified;
}

async function withRepoExcludeLock(
  repoKey: string,
  fn: () => Promise<void>
): Promise<void> {
  const prev = repoExcludeLocks.get(repoKey) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  repoExcludeLocks.set(repoKey, next);
  try {
    await next;
  } finally {
    if (repoExcludeLocks.get(repoKey) === next) {
      repoExcludeLocks.delete(repoKey);
    }
  }
}

export class LocalGitWorktreeWorkspace implements ExecutionWorkspace {
  private handle: WorktreeHandle | null = null;
  private isPrepared = false;

  getHandle(): WorktreeHandle | null {
    return this.handle;
  }

  async prepare(
    repoPath: string,
    baseBranch: string,
    deliverableId: string,
    options?: { worktreesRootDir?: string }
  ): Promise<WorktreeHandle> {
    if (this.isPrepared && this.handle) {
      throw new WorktreeError(
        "Workspace já preparado. Execute cleanup() antes de preparar novamente."
      );
    }

    const input = WorktreePrepareInputSchema.parse({
      repoPath,
      baseBranch,
      deliverableId,
      worktreesRootDir: options?.worktreesRootDir,
    });
    const absRepoPath = path.resolve(input.repoPath);
    if (!fs.existsSync(absRepoPath)) {
      throw new WorktreeError(`Repositório não encontrado: ${absRepoPath}`);
    }

    try {
      const check = await runGit(absRepoPath, [
        "rev-parse",
        "--is-inside-work-tree",
      ]);
      if (check.stdout.trim() !== "true") {
        throw new WorktreeError(
          `Diretório não é uma working tree Git válida: ${absRepoPath}`
        );
      }
    } catch (error) {
      if (error instanceof WorktreeError) {
        throw error;
      }
      throw new WorktreeError(
        `Diretório não é repositório Git válido: ${absRepoPath}`,
        error
      );
    }

    const safeBaseBranch = assertSafeGitRef(input.baseBranch, "baseBranch");
    const slug = sanitizeWorktreeSlug(
      input.deliverableId,
      `${input.deliverableId}:${Date.now()}:${Math.random()}`
    );
    const branchName = assertSafeGitRef(`uzina/${slug}`, "branchName");

    const worktreesRoot = input.worktreesRootDir
      ? path.resolve(input.worktreesRootDir)
      : path.join(absRepoPath, ".worktrees");
    fs.mkdirSync(worktreesRoot, { recursive: true });

    await this.ensureExcludeRuleIfInsideRepo(absRepoPath, worktreesRoot);

    const workspacePath = path.join(worktreesRoot, `task-${slug}`);
    let worktreeCreated = false;

    try {
      await runGit(absRepoPath, [
        "worktree",
        "add",
        "-b",
        branchName,
        workspacePath,
        safeBaseBranch,
      ]);
      worktreeCreated = true;

      const handle = WorktreeHandleSchema.parse({
        deliverableId: input.deliverableId,
        repoPath: absRepoPath,
        workspacePath: fs.realpathSync.native(workspacePath).replace(/^\\\\\?\\/, ""),
        branchName,
        baseBranch: safeBaseBranch,
      });

      this.handle = handle;
      this.isPrepared = true;
      return handle;
    } catch (error) {
      if (worktreeCreated) {
        await runGit(absRepoPath, [
          "worktree",
          "remove",
          "--force",
          workspacePath,
        ]).catch(() => undefined);
      }
      await runGit(absRepoPath, ["branch", "-D", "--", branchName]).catch(
        () => undefined
      );
      throw new WorktreeError(
        `Falha ao criar Git worktree isolado em ${workspacePath}`,
        error
      );
    }
  }

  private async ensureExcludeRuleIfInsideRepo(
    repoPath: string,
    worktreesRoot: string
  ): Promise<void> {
    const cmpRepo = normalizeGitPathForCompare(repoPath);
    const cmpRoot = normalizeGitPathForCompare(worktreesRoot);
    const rel = path.relative(cmpRepo, cmpRoot);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
      return;
    }

    await withRepoExcludeLock(cmpRepo, async () => {
      const { stdout } = await runGit(repoPath, [
        "rev-parse",
        "--git-common-dir",
      ]);
      const gitCommonDir = path.resolve(repoPath, stdout.trim());
      const infoDir = path.join(gitCommonDir, "info");
      const excludeFile = path.join(infoDir, "exclude");
      fs.mkdirSync(infoDir, { recursive: true });

      const topSegment = rel.split(/[\\/]/)[0] || ".worktrees";
      const rule = `/${topSegment}/`;
      const current = fs.existsSync(excludeFile)
        ? fs.readFileSync(excludeFile, "utf8")
        : "";

      if (!current.split(/\r?\n/).includes(rule)) {
        const prefix = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
        fs.appendFileSync(excludeFile, `${prefix}${rule}\n`, "utf8");
      }
    });
  }

  private requireHandle(): WorktreeHandle {
    if (!this.isPrepared || !this.handle) {
      throw new WorktreeError(
        "ExecutionWorkspace não preparado. Chame prepare() antes de operar."
      );
    }
    return this.handle;
  }

  async exec(
    command: string,
    args: string[] = [],
    options?: ExecOptions & { signal?: AbortSignal }
  ): Promise<ExecResult> {
    const handle = this.requireHandle();
    const { signal, ...rawExecOpts } = options ?? {};
    const parsedOpts = ExecOptionsSchema.parse(rawExecOpts);

    if (signal?.aborted) {
      return ExecResultSchema.parse({
        exitCode: null,
        stdout: "",
        stderr: "Execução abortada previamente por AbortSignal.",
        durationMs: 0,
        timedOut: false,
        aborted: true,
        truncated: false,
      });
    }

    assertSafeCommand(command, args);
    const resolvedCwd = parsedOpts.cwd
      ? assertPathInsideWorkspace(handle.workspacePath, parsedOpts.cwd, {
          allowRoot: true,
        })
      : handle.workspacePath;

    const childEnv = sanitizeChildEnv(process.env, parsedOpts.env);
    const startedAt = Date.now();

    return await new Promise<ExecResult>((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let totalBytes = 0;
      let truncated = false;
      let timedOut = false;
      let aborted = false;
      let settled = false;

      const child = spawn(command, args, {
        cwd: resolvedCwd,
        env: childEnv,
        shell: false,
        windowsHide: true,
        detached: process.platform !== "win32",
      });

      const appendChunk = (target: "stdout" | "stderr", chunk: Buffer) => {
        if (truncated) {
          return;
        }
        const remaining = parsedOpts.maxOutputBytes - totalBytes;
        if (remaining <= 0) {
          truncated = true;
          return;
        }
        const slice =
          chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
        totalBytes += slice.length;
        if (chunk.length > remaining) {
          truncated = true;
        }
        const text = slice.toString("utf8");
        if (target === "stdout") {
          stdout += text;
        } else {
          stderr += text;
        }
      };

      child.stdout?.on("data", (chunk: Buffer) => appendChunk("stdout", chunk));
      child.stderr?.on("data", (chunk: Buffer) => appendChunk("stderr", chunk));

      const cleanupTimersAndListeners = () => {
        clearTimeout(timeoutHandle);
        if (signal) {
          signal.removeEventListener("abort", onAbort);
        }
      };

      const onAbort = () => {
        if (settled) return;
        aborted = true;
        void killProcessTree(child.pid);
      };

      const timeoutHandle = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        void killProcessTree(child.pid);
      }, parsedOpts.timeoutMs);

      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }

      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        cleanupTimersAndListeners();
        reject(new WorktreeError(`Falha ao executar '${command}'`, err));
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        cleanupTimersAndListeners();
        resolve(
          ExecResultSchema.parse({
            exitCode: code,
            stdout,
            stderr,
            durationMs: Date.now() - startedAt,
            timedOut,
            aborted,
            truncated,
          })
        );
      });
    });
  }

  async getDiff(
    baseRef?: string,
    options?: { maxBytes?: number; includeUntracked?: boolean }
  ): Promise<string> {
    const handle = this.requireHandle();
    const targetRef = baseRef
      ? assertSafeGitRef(baseRef, "baseRef")
      : handle.baseBranch;
    const includeUntracked = options?.includeUntracked !== false;
    const maxBytes = options?.maxBytes ?? 2 * 1024 * 1024;

    let tempIndexDir: string | null = null;

    try {
      let gitEnvOverrides: Record<string, string> | undefined;

      if (includeUntracked) {
        const { stdout: gitDirOut } = await runGit(handle.workspacePath, [
          "rev-parse",
          "--git-dir",
        ]);
        const worktreeGitDir = path.resolve(
          handle.workspacePath,
          gitDirOut.trim()
        );
        const realIndexPath = path.join(worktreeGitDir, "index");
        tempIndexDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-diff-"));
        const tempIndexPath = path.join(tempIndexDir, "index");

        if (fs.existsSync(realIndexPath)) {
          fs.copyFileSync(realIndexPath, tempIndexPath);
        }

        gitEnvOverrides = { GIT_INDEX_FILE: tempIndexPath };
        await runGit(
          handle.workspacePath,
          ["add", "-N", "--", "."],
          gitEnvOverrides
        );
      }

      const { stdout } = await runGit(
        handle.workspacePath,
        ["diff", targetRef, "--"],
        gitEnvOverrides
      );

      if (Buffer.byteLength(stdout, "utf8") <= maxBytes) {
        return stdout;
      }
      const sliced = Buffer.from(stdout, "utf8")
        .subarray(0, maxBytes)
        .toString("utf8");
      return `${sliced}\n... [DIFF TRUNCATED AT ${maxBytes} BYTES]`;
    } catch (error) {
      if (error instanceof WorktreeError) {
        throw error;
      }
      throw new WorktreeError("Falha ao gerar git diff da worktree.", error);
    } finally {
      if (tempIndexDir && fs.existsSync(tempIndexDir)) {
        fs.rmSync(tempIndexDir, { recursive: true, force: true });
      }
    }
  }

  async cleanup(options?: { deleteBranch?: boolean }): Promise<void> {
    if (!this.isPrepared || !this.handle) {
      return;
    }

    const { repoPath, workspacePath, branchName } = this.handle;
    this.isPrepared = false;
    this.handle = null;

    if (fs.existsSync(repoPath)) {
      await runGit(repoPath, [
        "worktree",
        "remove",
        "--force",
        workspacePath,
      ]).catch(() => undefined);
      await runGit(repoPath, ["worktree", "prune"]).catch(() => undefined);
    }

    if (fs.existsSync(workspacePath)) {
      fs.rmSync(workspacePath, {
        recursive: true,
        force: true,
        maxRetries: 4,
        retryDelay: 120,
      });
    }

    if (
      options?.deleteBranch &&
      branchName.startsWith("uzina/") &&
      fs.existsSync(repoPath)
    ) {
      await runGit(repoPath, ["branch", "-D", "--", branchName]).catch(
        () => undefined
      );
    }
  }
}

export function syncSkillsToWorktree(
  workspacePath: string,
  skills: readonly SkillDefinition[]
): string[] {
  const writtenPaths: string[] = [];
  for (const skill of skills) {
    const relPath = path.join(".opencode", "skills", skill.name, "SKILL.md");
    const safeAbs = assertPathInsideWorkspace(workspacePath, relPath);
    fs.mkdirSync(path.dirname(safeAbs), { recursive: true });
    const raw =
      `---\n` +
      `name: ${JSON.stringify(skill.name)}\n` +
      `description: ${JSON.stringify(skill.description)}\n` +
      `applies_to_roles: [${skill.appliesToRoles.join(", ")}]\n` +
      `---\n\n${skill.content}\n`;
    fs.writeFileSync(safeAbs, raw, "utf8");
    writtenPaths.push(safeAbs);
  }
  return writtenPaths;
}
