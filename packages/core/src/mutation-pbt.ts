import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  MutationPbtReportSchema,
  type MutationPbtReport,
  type ScannerExecutionStatus,
} from "@uzina/contracts";
import type { z } from "zod";
import { assertPathInsideWorkspace } from "./path-guard.js";

const DEFAULT_PBT_RUNS = 50;
const DEFAULT_PBT_SEED = 0x557a696e; // "Uzin"
const MAX_STRYKER_TIMEOUT_MS = 60_000;
const FORBIDDEN_TARGET_CHARS_RE = /[;&|$`><(){}[\]\r\n\0]/;

export function createSeededRng(seed = DEFAULT_PBT_SEED): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createZodArbitraryHelpers(rng: () => number) {
  const int = (min: number, max: number): number => {
    const lo = Math.ceil(min);
    const hi = Math.floor(max);
    return Math.floor(rng() * (hi - lo + 1)) + lo;
  };

  const float = (min: number, max: number): number => {
    return min + rng() * (max - min);
  };

  const bool = (): boolean => rng() >= 0.5;

  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) {
      throw new Error("createZodArbitraryHelpers.pick requer lista não vazia.");
    }
    return items[int(0, items.length - 1)]!;
  };

  const string = (opts?: {
    minLen?: number;
    maxLen?: number;
    charset?: string;
  }): string => {
    const charset =
      opts?.charset ??
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
    const len = int(opts?.minLen ?? 1, opts?.maxLen ?? 24);
    let out = "";
    for (let i = 0; i < len; i += 1) {
      out += charset[int(0, charset.length - 1)]!;
    }
    return out;
  };

  const uuid = (): string => {
    const hex = "0123456789abcdef";
    const seg = (n: number) => string({ minLen: n, maxLen: n, charset: hex });
    return `${seg(8)}-${seg(4)}-4${seg(3)}-a${seg(3)}-${seg(12)}`;
  };

  const isoDatetime = (): string => {
    const baseMs = Date.UTC(2026, 0, 1, 0, 0, 0);
    const offsetMs = int(0, 365 * 24 * 3600) * 1000;
    return new Date(baseMs + offsetMs).toISOString();
  };

  return { int, float, bool, pick, string, uuid, isoDatetime };
}

export interface PropertyCheckOptions<T> {
  runs?: number;
  seed?: number;
  generator: (rng: () => number, iteration: number) => T;
  predicate: (value: T, iteration: number) => boolean | void;
}

export interface PropertyCheckResult {
  passed: boolean;
  runsExecuted: number;
  seed: number;
  failedIteration: number | null;
  counterexample?: unknown;
  errorMessage?: string;
}

export function runDeterministicPropertyCheck<T>(
  options: PropertyCheckOptions<T>
): PropertyCheckResult {
  const runs = Math.max(1, Math.min(2000, options.runs ?? DEFAULT_PBT_RUNS));
  const seed = options.seed ?? DEFAULT_PBT_SEED;
  const rng = createSeededRng(seed);

  for (let i = 0; i < runs; i += 1) {
    const sample = options.generator(rng, i);
    try {
      const ok = options.predicate(sample, i);
      if (ok === false) {
        return {
          passed: false,
          runsExecuted: i + 1,
          seed,
          failedIteration: i,
          counterexample: sample,
          errorMessage: `Propriedade retornou false na iteração ${i}.`,
        };
      }
    } catch (err) {
      return {
        passed: false,
        runsExecuted: i + 1,
        seed,
        failedIteration: i,
        counterexample: sample,
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return {
    passed: true,
    runsExecuted: runs,
    seed,
    failedIteration: null,
  };
}

export function runSchemaRoundTripProperty<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  generator: (rng: () => number, iteration: number) => z.input<TSchema>,
  options?: { runs?: number; seed?: number }
): PropertyCheckResult {
  return runDeterministicPropertyCheck({
    runs: options?.runs ?? DEFAULT_PBT_RUNS,
    seed: options?.seed ?? DEFAULT_PBT_SEED,
    generator,
    predicate: (sample) => {
      const first = schema.safeParse(sample);
      if (!first.success) {
        throw new Error(
          `Falha no parse inicial do schema Zod: ${first.error.message}`
        );
      }
      const second = schema.safeParse(first.data);
      if (!second.success) {
        throw new Error(
          `Falha de idempotência ao revalidar saída do schema: ${second.error.message}`
        );
      }
      return true;
    },
  });
}

export interface StrykerSubprocessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  missingBinary?: boolean;
  timedOut?: boolean;
}

export type StrykerSubprocessRunner = (
  binary: string,
  args: readonly string[],
  options: {
    cwd: string;
    timeoutMs: number;
  }
) => Promise<StrykerSubprocessResult>;

function resolveStrykerCommand(workspaceRoot: string): {
  binary: string;
  prefixArgs: string[];
} | null {
  const jsEntry = path.join(
    workspaceRoot,
    "node_modules",
    "@stryker-mutator",
    "core",
    "bin",
    "stryker.js"
  );
  if (fs.existsSync(/*turbopackIgnore: true*/ jsEntry)) {
    return { binary: process.execPath, prefixArgs: [jsEntry] };
  }

  const binEntry = path.join(
    workspaceRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "stryker.cmd" : "stryker"
  );
  if (fs.existsSync(/*turbopackIgnore: true*/ binEntry)) {
    if (process.platform === "win32") {
      return null;
    }
    return { binary: binEntry, prefixArgs: [] };
  }
  return null;
}

function defaultStrykerRunner(
  binary: string,
  args: readonly string[],
  options: { cwd: string; timeoutMs: number }
): Promise<StrykerSubprocessResult> {
  return new Promise((resolve) => {
    execFile(
      binary,
      [...args],
      {
        cwd: options.cwd,
        timeout: Math.min(options.timeoutMs, MAX_STRYKER_TIMEOUT_MS),
        maxBuffer: 2 * 1024 * 1024,
        shell: false,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const errObj = error as
          | (NodeJS.ErrnoException & { killed?: boolean })
          | null;
        if (errObj?.code === "ENOENT") {
          resolve({
            exitCode: 127,
            stdout: "",
            stderr: errObj.message,
            missingBinary: true,
          });
          return;
        }
        resolve({
          exitCode:
            typeof errObj?.code === "number" ? errObj.code : error ? 1 : 0,
          stdout: typeof stdout === "string" ? stdout : "",
          stderr: typeof stderr === "string" ? stderr : "",
          timedOut: Boolean(errObj?.killed),
        });
      }
    );
  });
}

function validateMutationTargetFiles(
  workspaceRoot: string,
  targetFiles: readonly string[]
): string[] {
  const safeRelPaths: string[] = [];
  for (const raw of targetFiles) {
    const trimmed = raw.trim();
    if (
      !trimmed ||
      trimmed.startsWith("-") ||
      FORBIDDEN_TARGET_CHARS_RE.test(trimmed) ||
      trimmed.split(/[\\/]+/).includes("..")
    ) {
      throw new Error(`Caminho alvo inválido para mutation testing: '${raw}'.`);
    }
    const abs = assertPathInsideWorkspace(workspaceRoot, trimmed);
    const rel = path.relative(workspaceRoot, abs).replace(/\\/g, "/");
    if (!rel || rel.startsWith("..")) {
      throw new Error(`Caminho alvo escapou do workspace: '${raw}'.`);
    }
    safeRelPaths.push(rel);
  }
  return safeRelPaths;
}

function parseStrykerMetrics(stdout: string): {
  killedMutants: number;
  survivedMutants: number;
  mutationScorePercent: number | null;
} {
  const killedMatch = /Killed:\s*(\d+)/i.exec(stdout);
  const survivedMatch = /Survived:\s*(\d+)/i.exec(stdout);
  const scoreMatch = /Mutation score:\s*([0-9]+(?:\.[0-9]+)?)\s*%/i.exec(
    stdout
  );

  const killedMutants = killedMatch?.[1]
    ? Number.parseInt(killedMatch[1], 10)
    : 0;
  const survivedMutants = survivedMatch?.[1]
    ? Number.parseInt(survivedMatch[1], 10)
    : 0;

  let mutationScorePercent: number | null = scoreMatch?.[1]
    ? Number.parseFloat(scoreMatch[1])
    : null;

  if (
    mutationScorePercent === null &&
    killedMutants + survivedMutants > 0
  ) {
    mutationScorePercent = Number(
      ((killedMutants / (killedMutants + survivedMutants)) * 100).toFixed(2)
    );
  }

  return {
    killedMutants,
    survivedMutants,
    mutationScorePercent,
  };
}

export interface RunScopedMutationAndPbtInput {
  workspaceRoot: string;
  targetFiles: readonly string[];
  pbtCheck?: () => PropertyCheckResult;
  timeoutMs?: number;
  runSubprocess?: StrykerSubprocessRunner;
  strykerBinaryOverride?: string | null;
}

export async function runScopedMutationAndPbt(
  input: RunScopedMutationAndPbtInput
): Promise<MutationPbtReport> {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const safeTargetFiles = validateMutationTargetFiles(
    workspaceRoot,
    input.targetFiles
  );

  const pbtResult = input.pbtCheck ? input.pbtCheck() : null;
  const pbtExecuted = pbtResult !== null;
  const pbtCasesRun = pbtResult?.runsExecuted ?? 0;
  const pbtPassed = pbtResult?.passed ?? true;

  if (safeTargetFiles.length === 0) {
    return MutationPbtReportSchema.parse({
      pbtExecuted,
      pbtCasesRun,
      pbtPassed,
      mutationStatus: "skipped_missing_binary",
      mutationScorePercent: null,
      killedMutants: 0,
      survivedMutants: 0,
      targetFiles: [],
    });
  }

  const resolvedCmd =
    input.strykerBinaryOverride !== undefined
      ? input.strykerBinaryOverride
        ? { binary: input.strykerBinaryOverride, prefixArgs: [] as string[] }
        : null
      : resolveStrykerCommand(workspaceRoot);

  if (!resolvedCmd) {
    return MutationPbtReportSchema.parse({
      pbtExecuted,
      pbtCasesRun,
      pbtPassed,
      mutationStatus: "skipped_missing_binary",
      mutationScorePercent: null,
      killedMutants: 0,
      survivedMutants: 0,
      targetFiles: safeTargetFiles,
    });
  }

  const runner = input.runSubprocess ?? defaultStrykerRunner;
  const boundedTimeoutMs = Math.min(
    Math.max(100, input.timeoutMs ?? MAX_STRYKER_TIMEOUT_MS),
    MAX_STRYKER_TIMEOUT_MS
  );
  const args = [
    ...resolvedCmd.prefixArgs,
    "run",
    "--mutate",
    safeTargetFiles.join(","),
  ];

  const execRes = await runner(resolvedCmd.binary, args, {
    cwd: workspaceRoot,
    timeoutMs: boundedTimeoutMs,
  });

  if (execRes.missingBinary) {
    return MutationPbtReportSchema.parse({
      pbtExecuted,
      pbtCasesRun,
      pbtPassed,
      mutationStatus: "skipped_missing_binary",
      mutationScorePercent: null,
      killedMutants: 0,
      survivedMutants: 0,
      targetFiles: safeTargetFiles,
    });
  }

  const metrics = parseStrykerMetrics(`${execRes.stdout}\n${execRes.stderr}`);
  const mutationStatus: ScannerExecutionStatus =
    execRes.exitCode === 0 && !execRes.timedOut ? "executed" : "failed";

  return MutationPbtReportSchema.parse({
    pbtExecuted,
    pbtCasesRun,
    pbtPassed,
    mutationStatus,
    mutationScorePercent: metrics.mutationScorePercent,
    killedMutants: metrics.killedMutants,
    survivedMutants: metrics.survivedMutants,
    targetFiles: safeTargetFiles,
  });
}
