import { execFile } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import {
  ExecOptionsSchema,
  ExecResultSchema,
  type ExecOptions,
  type ExecResult,
  type WorktreeHandle,
} from "@uzina/contracts";
import { DangerousCommandError, WorktreeError } from "./errors.js";
import {
  LocalGitWorktreeWorkspace,
  assertSafeCommand,
  sanitizeChildEnv,
  type ExecutionWorkspace,
} from "./workspace.js";

export const DEFAULT_DOCKER_WORKSPACE_IMAGE =
  "node:22-slim@sha256:9f241c1b86d255e7f4a4f38d58732a4752e9c40d23c1a2e2f6a203e7b1c5d6e8";

export interface DockerRunArgsInput {
  containerName: string;
  workspacePath: string;
  image?: string;
  user?: string;
  network?: string;
  cpus?: string;
  memory?: string;
  pidsLimit?: number;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export type DockerCommandRunner = (params: {
  args: string[];
  timeoutMs: number;
  signal?: AbortSignal;
}) => Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }>;

export interface DockerExecutionWorkspaceOptions {
  image?: string;
  user?: string;
  network?: string;
  cpus?: string;
  memory?: string;
  pidsLimit?: number;
  dockerRunner?: DockerCommandRunner;
  dockerCleanupRunner?: (containerName: string) => Promise<void>;
}

const ALLOWED_NETWORKS = new Set(["none", "uzina-isolated"]);

export function assertSafeDockerOptions(input: {
  workspacePath: string;
  user: string;
  network: string;
  extraMounts?: string[];
}): void {
  const trimmedUser = input.user.trim().toLowerCase();
  if (
    !trimmedUser ||
    trimmedUser === "0" ||
    trimmedUser === "root" ||
    trimmedUser.startsWith("0:") ||
    trimmedUser.startsWith("root:")
  ) {
    throw new DangerousCommandError(
      "DockerExecutionWorkspace proíbe execução como root (uid 0)."
    );
  }

  if (!ALLOWED_NETWORKS.has(input.network)) {
    throw new DangerousCommandError(
      `Rede Docker não permitida: '${input.network}'. Use 'none' ou allowlist explícita.`
    );
  }

  const normalizedWs = input.workspacePath.toLowerCase();
  if (
    normalizedWs.includes("docker.sock") ||
    (input.extraMounts ?? []).some((m) =>
      m.toLowerCase().includes("docker.sock")
    )
  ) {
    throw new DangerousCommandError(
      "Montagem de docker.sock é estritamente proibida."
    );
  }
}

export function buildDockerRunArgs(input: DockerRunArgsInput): string[] {
  assertSafeCommand(input.command, input.args);
  const user = input.user ?? "1001:1001";
  const network = input.network ?? "none";
  const resolvedWorkspace = path.resolve(input.workspacePath);

  assertSafeDockerOptions({
    workspacePath: resolvedWorkspace,
    user,
    network,
  });

  const safeEnv = sanitizeChildEnv({}, input.env);
  const envFlags: string[] = [];
  for (const [k, v] of Object.entries(safeEnv)) {
    envFlags.push("-e", `${k}=${v}`);
  }

  const image =
    input.image ??
    process.env.UZINA_DOCKER_IMAGE ??
    DEFAULT_DOCKER_WORKSPACE_IMAGE;

  return [
    "run",
    "--rm",
    "--name",
    input.containerName,
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=64m",
    "--user",
    user,
    "--network",
    network,
    "--cpus",
    input.cpus ?? "1.0",
    "--memory",
    input.memory ?? "512m",
    "--pids-limit",
    String(input.pidsLimit ?? 128),
    "--workdir",
    "/workspace",
    "--volume",
    `${resolvedWorkspace}:/workspace:rw`,
    ...envFlags,
    image,
    input.command,
    ...input.args,
  ];
}

const defaultDockerRunner: DockerCommandRunner = ({
  args,
  timeoutMs,
  signal,
}) =>
  new Promise((resolve) => {
    const controller = new AbortController();
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    const onExternalAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) {
        controller.abort();
      } else {
        signal.addEventListener("abort", onExternalAbort, { once: true });
      }
    }

    execFile(
      "docker",
      args,
      {
        shell: false,
        signal: controller.signal,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        clearTimeout(timer);
        if (signal) {
          signal.removeEventListener("abort", onExternalAbort);
        }
        if (error) {
          const exitCode =
            typeof (error as { code?: unknown }).code === "number"
              ? ((error as { code: number }).code ?? 1)
              : 1;
          resolve({
            exitCode,
            stdout: stdout ?? "",
            stderr: stderr || error.message,
            timedOut,
          });
          return;
        }
        resolve({
          exitCode: 0,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          timedOut: false,
        });
      }
    );
  });

const defaultDockerCleanupRunner = (containerName: string): Promise<void> =>
  new Promise((resolve) => {
    execFile(
      "docker",
      ["rm", "-f", containerName],
      { shell: false, timeout: 5000, windowsHide: true },
      () => resolve()
    );
  });

export class DockerExecutionWorkspace implements ExecutionWorkspace {
  private readonly inner = new LocalGitWorktreeWorkspace();
  private readonly opts: DockerExecutionWorkspaceOptions;
  private readonly activeContainers = new Set<string>();

  constructor(options: DockerExecutionWorkspaceOptions = {}) {
    this.opts = options;
  }

  getHandle(): WorktreeHandle | null {
    return this.inner.getHandle();
  }

  async prepare(
    repoPath: string,
    baseBranch: string,
    deliverableId: string,
    options?: { worktreesRootDir?: string }
  ): Promise<WorktreeHandle> {
    return this.inner.prepare(repoPath, baseBranch, deliverableId, options);
  }

  async attach(existingHandle: WorktreeHandle): Promise<WorktreeHandle> {
    return this.inner.attach(existingHandle);
  }

  async exec(
    command: string,
    args: string[] = [],
    options?: ExecOptions & { signal?: AbortSignal }
  ): Promise<ExecResult> {
    const handle = this.inner.getHandle();
    if (!handle) {
      throw new WorktreeError(
        "Workspace não preparado. Execute prepare() ou attach() antes de exec()."
      );
    }

    const parsedOpts = ExecOptionsSchema.parse({
      timeoutMs: options?.timeoutMs,
      maxOutputBytes: options?.maxOutputBytes,
      env: options?.env,
    });

    const containerName = `uzina-ws-${crypto.randomUUID().slice(0, 12)}`;
    const dockerArgs = buildDockerRunArgs({
      containerName,
      workspacePath: handle.workspacePath,
      image: this.opts.image,
      user: this.opts.user,
      network: this.opts.network,
      cpus: this.opts.cpus,
      memory: this.opts.memory,
      pidsLimit: this.opts.pidsLimit,
      command,
      args,
      env: parsedOpts.env,
    });

    const runner = this.opts.dockerRunner ?? defaultDockerRunner;
    const cleaner = this.opts.dockerCleanupRunner ?? defaultDockerCleanupRunner;

    this.activeContainers.add(containerName);
    const startMs = Date.now();
    try {
      const res = await runner({
        args: dockerArgs,
        timeoutMs: parsedOpts.timeoutMs,
        signal: options?.signal,
      });

      if (res.timedOut || options?.signal?.aborted) {
        await cleaner(containerName).catch(() => undefined);
      }

      const maxBytes = parsedOpts.maxOutputBytes;
      const truncated =
        Buffer.byteLength(res.stdout, "utf8") > maxBytes ||
        Buffer.byteLength(res.stderr, "utf8") > maxBytes;
      return ExecResultSchema.parse({
        exitCode: res.exitCode,
        stdout: res.stdout.slice(0, maxBytes),
        stderr: res.stderr.slice(0, maxBytes),
        timedOut: res.timedOut,
        aborted: Boolean(options?.signal?.aborted),
        truncated,
        durationMs: Math.max(0, Date.now() - startMs),
      });
    } finally {
      this.activeContainers.delete(containerName);
    }
  }

  async getDiff(
    baseRef?: string,
    options?: { maxBytes?: number; includeUntracked?: boolean }
  ): Promise<string> {
    return this.inner.getDiff(baseRef, options);
  }

  async cleanup(options?: { deleteBranch?: boolean }): Promise<void> {
    const cleaner = this.opts.dockerCleanupRunner ?? defaultDockerCleanupRunner;
    for (const name of Array.from(this.activeContainers)) {
      await cleaner(name).catch(() => undefined);
      this.activeContainers.delete(name);
    }
    await this.inner.cleanup(options);
  }
}
