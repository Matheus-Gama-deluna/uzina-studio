import { spawnSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCodebaseDirectoryTree,
  buildCodebaseSkeleton,
  scanCodebaseWorkspace,
} from "@uzina/codebase-intel";
import {
  QmdSearchModeSchema,
  type QmdSearchMode,
} from "@uzina/contracts";
import {
  assertPathInsideWorkspace,
  chunkMarkdownByHeadings,
  computeBm25Scores,
  cosineSimilarity,
  createDeterministicEmbeddingProvider,
  formatQmdSnippet,
  reciprocalRankFusion,
  redactSensitiveText,
} from "@uzina/core";
import {
  migrateDatabaseData,
  redactDatabaseUrl,
  resolveDataDir,
  resolveDatabaseConfig,
  validatePostgresUrl,
  type MigrateDatabaseOptions,
  type MigrationReport,
} from "@uzina/db";
import {
  runSecurityCli,
  type SecurityCliDependencies,
} from "@uzina/security-engine";
import { z } from "zod";

export const UZINA_CLI_VERSION = "0.1.0";

const StartDevOptionsSchema = z
  .object({
    command: z.enum(["start", "dev"]),
    port: z.number().int().min(1).max(65535).default(3000),
    host: z.string().trim().min(1).default("127.0.0.1"),
    dataDir: z.string().trim().min(1).optional(),
    dryRun: z.boolean().default(false),
  })
  .strict();

const MigrateOptionsSchema = z
  .object({
    command: z.literal("db:migrate-to-postgres"),
    from: z.string().trim().min(1, "--from <dataDir> é obrigatório."),
    to: z.string().trim().min(1, "--to <DATABASE_URL> é obrigatório."),
    dryRun: z.boolean().default(false),
  })
  .strict();

const DoctorOptionsSchema = z
  .object({
    command: z.literal("doctor"),
    json: z.boolean().default(false),
    dataDir: z.string().trim().min(1).optional(),
  })
  .strict();

const MemorySearchOptionsSchema = z
  .object({
    command: z.literal("memory:search"),
    query: z.string().trim().min(2, "Consulta QMD exige ao menos 2 caracteres."),
    mode: QmdSearchModeSchema.default("hybrid"),
    limit: z.number().int().min(1).max(10).default(5),
    rootDir: z.string().trim().min(1).optional(),
  })
  .strict();

const CodeSkeletonOptionsSchema = z
  .object({
    command: z.literal("code:skeleton"),
    rootDir: z.string().trim().min(1).optional(),
    maxTokens: z.number().int().min(100).max(10000).optional(),
  })
  .strict();

const IndexCodeOptionsSchema = z
  .object({
    command: z.literal("index:code"),
    rootDir: z.string().trim().min(1).optional(),
    rebuild: z.boolean().default(false),
  })
  .strict();

export type ParsedCliCommand =
  | { command: "help" }
  | { command: "version" }
  | z.infer<typeof StartDevOptionsSchema>
  | { command: "sec"; args: string[] }
  | z.infer<typeof MigrateOptionsSchema>
  | z.infer<typeof DoctorOptionsSchema>
  | z.infer<typeof MemorySearchOptionsSchema>
  | z.infer<typeof CodeSkeletonOptionsSchema>
  | z.infer<typeof IndexCodeOptionsSchema>;

export interface SpawnServerPlan {
  mode: "start" | "dev";
  runtime: "standalone" | "next-cli";
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  port: number;
  host: string;
  dataDir: string;
  databaseMode: "pglite" | "postgres";
  singleProcess: true;
}

export interface UzinaCliDependencies {
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  env?: Record<string, string | undefined>;
  securityDeps?: SecurityCliDependencies;
  migrateImpl?: (options: MigrateDatabaseOptions) => Promise<MigrationReport>;
  checkGitAvailable?: () => { ok: boolean; version?: string };
  spawnServer?: (plan: SpawnServerPlan) => Promise<number>;
  cwd?: string;
}

function readNextFlagValue(
  args: string[],
  index: number,
  flagName: string
): string {
  const next = args[index + 1];
  if (!next || next.startsWith("--")) {
    throw new Error(`A flag ${flagName} exige um valor.`);
  }
  return next;
}

export function parseCliCommand(argv: string[]): ParsedCliCommand {
  const first = argv[0];
  if (!first || first === "help" || first === "--help" || first === "-h") {
    return { command: "help" };
  }
  if (first === "version" || first === "--version" || first === "-v") {
    return { command: "version" };
  }

  if (first === "sec") {
    return { command: "sec", args: argv.slice(1) };
  }

  if (first === "start" || first === "dev") {
    let port = 3000;
    let host = "127.0.0.1";
    let dataDir: string | undefined;
    let dryRun = false;

    for (let i = 1; i < argv.length; i += 1) {
      const arg = argv[i]!;
      if (arg === "--port" || arg === "-p") {
        const rawPort = readNextFlagValue(argv, i, arg);
        const parsedPort = Number(rawPort);
        if (!Number.isInteger(parsedPort)) {
          throw new Error(`Porta inválida em ${arg}: '${rawPort}'.`);
        }
        port = parsedPort;
        i += 1;
      } else if (arg === "--host" || arg === "-H") {
        host = readNextFlagValue(argv, i, arg);
        i += 1;
      } else if (arg === "--data-dir") {
        dataDir = readNextFlagValue(argv, i, arg);
        i += 1;
      } else if (arg === "--dry-run") {
        dryRun = true;
      } else {
        throw new Error(`Flag desconhecida para '${first}': ${arg}`);
      }
    }

    return StartDevOptionsSchema.parse({
      command: first,
      port,
      host,
      dataDir,
      dryRun,
    });
  }

  if (first === "db") {
    const subcommand = argv[1];
    if (subcommand !== "migrate-to-postgres") {
      throw new Error(
        `Subcomando 'db ${subcommand ?? ""}' não suportado. Use: uzina db migrate-to-postgres --from <dataDir> --to <DATABASE_URL>`
      );
    }

    let from = "";
    let to = "";
    let dryRun = false;

    for (let i = 2; i < argv.length; i += 1) {
      const arg = argv[i]!;
      if (arg === "--from") {
        from = readNextFlagValue(argv, i, arg);
        i += 1;
      } else if (arg === "--to") {
        to = readNextFlagValue(argv, i, arg);
        i += 1;
      } else if (arg === "--dry-run") {
        dryRun = true;
      } else {
        throw new Error(`Flag desconhecida para 'db migrate-to-postgres': ${arg}`);
      }
    }

    const parsed = MigrateOptionsSchema.parse({
      command: "db:migrate-to-postgres",
      from,
      to,
      dryRun,
    });
    validatePostgresUrl(parsed.to);
    return parsed;
  }

  if (first === "doctor") {
    let json = false;
    let dataDir: string | undefined;

    for (let i = 1; i < argv.length; i += 1) {
      const arg = argv[i]!;
      if (arg === "--json") {
        json = true;
      } else if (arg === "--data-dir") {
        dataDir = readNextFlagValue(argv, i, arg);
        i += 1;
      } else {
        throw new Error(`Flag desconhecida para 'doctor': ${arg}`);
      }
    }

    return DoctorOptionsSchema.parse({
      command: "doctor",
      json,
      dataDir,
    });
  }

  if (first === "memory") {
    const subcommand = argv[1];
    if (subcommand !== "search") {
      throw new Error(
        `Subcomando 'memory ${subcommand ?? ""}' não suportado. Use: uzina memory search "<consulta>" [--mode hybrid|lexical|vector] [--limit 5]`
      );
    }

    let mode: QmdSearchMode = "hybrid";
    let limit = 5;
    let rootDir: string | undefined;
    const queryParts: string[] = [];

    for (let i = 2; i < argv.length; i += 1) {
      const arg = argv[i]!;
      if (arg === "--mode") {
        mode = QmdSearchModeSchema.parse(readNextFlagValue(argv, i, arg));
        i += 1;
      } else if (arg === "--limit") {
        const rawLim = readNextFlagValue(argv, i, arg);
        const parsedLim = Number(rawLim);
        if (!Number.isInteger(parsedLim)) {
          throw new Error(`Limite inválido em --limit: '${rawLim}'.`);
        }
        limit = parsedLim;
        i += 1;
      } else if (arg === "--root") {
        rootDir = readNextFlagValue(argv, i, arg);
        i += 1;
      } else if (arg.startsWith("--")) {
        throw new Error(`Flag desconhecida para 'memory search': ${arg}`);
      } else {
        queryParts.push(arg);
      }
    }

    return MemorySearchOptionsSchema.parse({
      command: "memory:search",
      query: queryParts.join(" "),
      mode,
      limit,
      rootDir,
    });
  }

  if (first === "code") {
    const subcommand = argv[1];
    if (subcommand !== "skeleton") {
      throw new Error(
        `Subcomando 'code ${subcommand ?? ""}' não suportado. Use: uzina code skeleton [--root <dir>] [--max-tokens <n>]`
      );
    }
    let rootDir: string | undefined;
    let maxTokens: number | undefined;
    for (let i = 2; i < argv.length; i += 1) {
      const arg = argv[i]!;
      if (arg === "--root") {
        rootDir = readNextFlagValue(argv, i, arg);
        i += 1;
      } else if (arg === "--max-tokens") {
        maxTokens = Number(readNextFlagValue(argv, i, arg));
        i += 1;
      } else {
        throw new Error(`Flag desconhecida para 'code skeleton': ${arg}`);
      }
    }
    return CodeSkeletonOptionsSchema.parse({
      command: "code:skeleton",
      rootDir,
      maxTokens,
    });
  }

  if (first === "index") {
    const subcommand = argv[1];
    if (subcommand !== "code") {
      throw new Error(
        `Subcomando 'index ${subcommand ?? ""}' não suportado. Use: uzina index code [--rebuild] [--root <dir>]`
      );
    }
    let rootDir: string | undefined;
    let rebuild = false;
    for (let i = 2; i < argv.length; i += 1) {
      const arg = argv[i]!;
      if (arg === "--root") {
        rootDir = readNextFlagValue(argv, i, arg);
        i += 1;
      } else if (arg === "--rebuild") {
        rebuild = true;
      } else {
        throw new Error(`Flag desconhecida para 'index code': ${arg}`);
      }
    }
    return IndexCodeOptionsSchema.parse({
      command: "index:code",
      rootDir,
      rebuild,
    });
  }

  throw new Error(`Comando desconhecido: '${first}'. Execute 'uzina --help'.`);
}

function resolveWebAppRoot(cwd: string): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(cwd, "apps", "web"),
    cwd,
    path.resolve(currentDir, "..", "..", "web"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "package.json"))) {
      return candidate;
    }
  }
  return path.resolve(cwd, "apps", "web");
}

export function buildServerSpawnPlan(
  parsed: z.infer<typeof StartDevOptionsSchema>,
  env: Record<string, string | undefined>,
  cwd: string
): SpawnServerPlan {
  const effectiveEnv: Record<string, string | undefined> = {
    ...env,
    PORT: String(parsed.port),
    HOSTNAME: parsed.host,
    ...(parsed.dataDir ? { UZINA_DATA_DIR: parsed.dataDir } : {}),
  };

  const resolvedDataDir = resolveDataDir(effectiveEnv);
  const dbConfig = resolveDatabaseConfig(effectiveEnv, {
    dataDir: parsed.dataDir,
  });

  const webRoot = resolveWebAppRoot(cwd);
  const standaloneEntry = path.join(
    webRoot,
    ".next",
    "standalone",
    "apps",
    "web",
    "server.js"
  );

  if (parsed.command === "start" && fs.existsSync(standaloneEntry)) {
    return {
      mode: parsed.command,
      runtime: "standalone",
      command: process.execPath,
      args: [standaloneEntry],
      cwd: path.dirname(standaloneEntry),
      env: effectiveEnv,
      port: parsed.port,
      host: parsed.host,
      dataDir: resolvedDataDir,
      databaseMode: dbConfig.mode,
      singleProcess: true,
    };
  }

  const nextBin = path.join(webRoot, "node_modules", "next", "dist", "bin", "next");
  const args = fs.existsSync(nextBin)
    ? [nextBin, parsed.command, "-p", String(parsed.port), "-H", parsed.host]
    : ["pnpm", "--filter", "@uzina/web", parsed.command, "--", "-p", String(parsed.port), "-H", parsed.host];

  const command = fs.existsSync(nextBin) ? process.execPath : args[0]!;
  const finalArgs = fs.existsSync(nextBin) ? args : args.slice(1);

  return {
    mode: parsed.command,
    runtime: "next-cli",
    command,
    args: finalArgs,
    cwd: webRoot,
    env: effectiveEnv,
    port: parsed.port,
    host: parsed.host,
    dataDir: resolvedDataDir,
    databaseMode: dbConfig.mode,
    singleProcess: true,
  };
}

function defaultSpawnServer(plan: SpawnServerPlan): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(plan.command, plan.args, {
      cwd: plan.cwd,
      env: plan.env as NodeJS.ProcessEnv,
      stdio: "inherit",
      shell: false,
    });

    const forwardSignal = (signal: NodeJS.Signals) => {
      if (!child.killed) {
        child.kill(signal);
      }
    };

    process.once("SIGINT", () => forwardSignal("SIGINT"));
    process.once("SIGTERM", () => forwardSignal("SIGTERM"));

    child.on("error", reject);
    child.on("close", (code) => {
      resolve(code ?? 0);
    });
  });
}

function defaultCheckGit(): { ok: boolean; version?: string } {
  const result = spawnSync("git", ["--version"], {
    encoding: "utf8",
    shell: false,
  });
  if (result.status === 0) {
    return { ok: true, version: result.stdout.trim() };
  }
  return { ok: false };
}

function getHelpText(): string {
  return [
    `Uzina Studio CLI v${UZINA_CLI_VERSION}`,
    "",
    "Uso:",
    "  uzina start [--port 3000] [--host 127.0.0.1] [--data-dir ./data] [--dry-run]",
    "  uzina dev [--port 3000] [--host 127.0.0.1] [--data-dir ./data] [--dry-run]",
    "  uzina sec <scan [dir] | doctor | install-tools> [...]",
    "  uzina memory search <consulta> [--mode hybrid|lexical|vector] [--limit 5] [--root <dir>]",
    "  uzina db migrate-to-postgres --from <dataDir> --to <DATABASE_URL> [--dry-run]",
    "  uzina doctor [--json] [--data-dir ./data]",
    "  uzina --version | --help",
  ].join("\n");
}

export async function runCli(
  argv: string[],
  deps: UzinaCliDependencies = {}
): Promise<number> {
  const stdout = deps.stdout ?? ((line: string) => console.log(line));
  const stderr = deps.stderr ?? ((line: string) => console.error(line));
  const env = deps.env ?? process.env;
  const cwd = deps.cwd ?? process.cwd();

  let parsed: ParsedCliCommand;
  try {
    parsed = parseCliCommand(argv);
  } catch (error) {
    stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }

  if (parsed.command === "help") {
    stdout(getHelpText());
    return 0;
  }

  if (parsed.command === "version") {
    stdout(`uzina-studio v${UZINA_CLI_VERSION}`);
    return 0;
  }

  if (parsed.command === "sec") {
    // Regra de Processo Único PGlite: subcomando stateless via HTTP/CLI, sem abrir pgdata.
    return runSecurityCli(parsed.args, {
      stdout,
      stderr,
      ...deps.securityDeps,
    });
  }

  if (parsed.command === "start" || parsed.command === "dev") {
    const plan = buildServerSpawnPlan(parsed, env, cwd);
    if (plan.dataDir !== ":memory:") {
      fs.mkdirSync(plan.dataDir, { recursive: true });
    }
    if (parsed.dryRun) {
      stdout(
        JSON.stringify(
          {
            mode: plan.mode,
            runtime: plan.runtime,
            port: plan.port,
            host: plan.host,
            dataDir: plan.dataDir,
            databaseMode: plan.databaseMode,
            singleProcess: plan.singleProcess,
          },
          null,
          2
        )
      );
      return 0;
    }

    const spawner = deps.spawnServer ?? defaultSpawnServer;
    return spawner(plan);
  }

  if (parsed.command === "db:migrate-to-postgres") {
    const migrateFn = deps.migrateImpl ?? migrateDatabaseData;
    const targetRedacted = redactDatabaseUrl(parsed.to);
    try {
      const report = await migrateFn({
        sourceDataDir: parsed.from,
        targetDatabaseUrl: parsed.to,
        dryRun: parsed.dryRun,
      });

      stdout(
        JSON.stringify(
          {
            dryRun: report.dryRun,
            verified: report.verified,
            target: report.targetRedacted,
            mastraLibsqlDetected: report.mastraLibsqlDetected,
            totalSourceRows: report.totalSourceRows,
            totalTargetRows: report.totalTargetRows,
            tables: report.tables,
          },
          null,
          2
        )
      );
      return report.verified ? 0 : 1;
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      const safeMessage = rawMessage.split(parsed.to).join(targetRedacted);
      stderr(`Falha na migração para ${targetRedacted}: ${safeMessage}`);
      return 1;
    }
  }

  if (parsed.command === "doctor") {
    const nodeMajor = Number(process.versions.node.split(".")[0] ?? "0");
    const nodeOk = nodeMajor >= 22;
    const gitStatus = (deps.checkGitAvailable ?? defaultCheckGit)();
    const effectiveEnv: Record<string, string | undefined> = {
      ...env,
      ...(parsed.dataDir ? { UZINA_DATA_DIR: parsed.dataDir } : {}),
    };
    const dataDir = resolveDataDir(effectiveEnv);
    const dbConfig = resolveDatabaseConfig(effectiveEnv, {
      dataDir: parsed.dataDir,
    });

    const scannerLines: string[] = [];
    const secExit = await runSecurityCli(["doctor"], {
      stdout: (line) => scannerLines.push(line),
      stderr,
      ...deps.securityDeps,
    });

    const payload = {
      cliVersion: UZINA_CLI_VERSION,
      nodeVersion: process.versions.node,
      nodeOk,
      git: gitStatus,
      databaseMode: dbConfig.mode,
      dataDir,
      securityDoctorExit: secExit,
      scanners: scannerLines,
    };

    if (parsed.json) {
      stdout(JSON.stringify(payload, null, 2));
    } else {
      stdout(
        `[uzina doctor] Node ${payload.nodeVersion} (${nodeOk ? "OK" : "REQUER >= 22"}) | Git: ${gitStatus.ok ? gitStatus.version : "ausente"} | DB: ${dbConfig.mode} | DataDir: ${dataDir}`
      );
      for (const line of scannerLines) {
        stdout(line);
      }
    }

    return nodeOk ? 0 : 1;
  }

  if (parsed.command === "memory:search") {
    const resolvedRoot = path.resolve(parsed.rootDir ?? cwd);
    const mdFiles: Array<{ relPath: string; absPath: string }> = [];
    const walkDocs = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".env") || entry.name === ".master-key") continue;
        const abs = assertPathInsideWorkspace(resolvedRoot, path.join(dir, entry.name));
        if (entry.isDirectory()) {
          walkDocs(abs);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
          mdFiles.push({
            relPath: path.relative(resolvedRoot, abs).replace(/\\/g, "/"),
            absPath: abs,
          });
        }
      }
    };
    for (const sub of [".uzina", "docs"]) {
      const candidate = path.join(resolvedRoot, sub);
      if (fs.existsSync(candidate)) {
        walkDocs(assertPathInsideWorkspace(resolvedRoot, candidate));
      }
    }

    const docsChunks = mdFiles.flatMap((file) => {
      const content = redactSensitiveText(fs.readFileSync(file.absPath, "utf8"));
      return chunkMarkdownByHeadings(content, {
        defaultHeading: path.basename(file.relPath, ".md"),
      }).map((chunk, idx) => ({
        id: `${file.relPath}:${idx}`,
        sourcePath: file.relPath,
        headingPath: chunk.headingPath,
        lineStart: chunk.lineStart,
        lineEnd: chunk.lineEnd,
        content: chunk.content,
      }));
    });

    const provider = createDeterministicEmbeddingProvider();
    const bm25 = computeBm25Scores(
      parsed.query,
      docsChunks.map((c) => ({ id: c.id, text: `${c.headingPath} ${c.content}` }))
    );
    const queryVec = await provider.embedQuery(parsed.query);
    const docVecs = await provider.embedDocuments(docsChunks.map((c) => c.content));
    const vecScores = new Map<string, number>();
    docsChunks.forEach((c, idx) => {
      vecScores.set(c.id, Math.max(0, cosineSimilarity(queryVec, docVecs[idx]!)));
    });

    const ranked =
      parsed.mode === "lexical"
        ? reciprocalRankFusion([docsChunks.map((c) => ({ id: c.id, score: bm25.get(c.id) ?? 0 }))])
        : parsed.mode === "vector"
          ? reciprocalRankFusion([docsChunks.map((c) => ({ id: c.id, score: vecScores.get(c.id) ?? 0 }))])
          : reciprocalRankFusion([
              docsChunks.map((c) => ({ id: c.id, score: bm25.get(c.id) ?? 0 })),
              docsChunks.map((c) => ({ id: c.id, score: vecScores.get(c.id) ?? 0 })),
            ]);

    const byId = new Map(docsChunks.map((c) => [c.id, c]));
    const hits = ranked.slice(0, parsed.limit).map((r) => {
      const chunk = byId.get(r.id)!;
      return {
        sourcePath: chunk.sourcePath,
        headingPath: chunk.headingPath,
        lineStart: chunk.lineStart,
        lineEnd: chunk.lineEnd,
        snippet: formatQmdSnippet(chunk.content),
        rrf: r.rrf,
      };
    });

    stdout(
      JSON.stringify(
        {
          query: parsed.query,
          mode: parsed.mode,
          embeddingModel: provider.id,
          totalChunks: docsChunks.length,
          hits,
        },
        null,
        2
      )
    );
    return 0;
  }

  if (parsed.command === "code:skeleton" || parsed.command === "index:code") {
    const rootDir = path.resolve(parsed.rootDir ?? cwd);
    const scan = scanCodebaseWorkspace(rootDir);
    const symbols = scan.files.flatMap((file) =>
      file.symbols.map((s, idx) => ({
        id: `${file.path}:${s.name}:${idx}`,
        fileId: file.path,
        filePath: s.filePath,
        kind: s.kind,
        name: s.name,
        signature: s.signature,
        lineStart: s.lineStart,
        lineEnd: s.lineEnd,
        exported: s.exported,
        citation: s.citation,
      }))
    );
    const symIdByKey = new Map(
      symbols.map((s) => [`${s.filePath}:${s.name}`, s.id])
    );
    const edges = scan.edges
      .map((e, idx) => {
        const fromId = symIdByKey.get(`${e.fromFilePath}:${e.fromSymbolName}`);
        const toId = symIdByKey.get(`${e.toFilePath}:${e.toSymbolName}`);
        if (!fromId || !toId) return null;
        return {
          id: `edge:${idx}`,
          fromSymbolId: fromId,
          toSymbolId: toId,
          fromSymbolName: e.fromSymbolName,
          toSymbolName: e.toSymbolName,
          relation: e.relation,
        };
      })
      .filter((e): e is NonNullable<typeof e> => Boolean(e));

    const skeleton = buildCodebaseSkeleton({
      repositoryId: null,
      files: scan.files.map((f) => ({ path: f.path, size: f.size })),
      symbols,
      edges,
      maxTokens: parsed.command === "code:skeleton" ? parsed.maxTokens : undefined,
    });

    if (parsed.command === "code:skeleton") {
      stdout(
        JSON.stringify(
          {
            filesCount: scan.files.length,
            symbolsCount: symbols.length,
            edgesCount: edges.length,
            skeleton,
          },
          null,
          2
        )
      );
      return 0;
    }

    const directories = buildCodebaseDirectoryTree(
      scan.files.map((f) => f.path),
      symbols
    );
    stdout(
      JSON.stringify(
        {
          rebuild: parsed.rebuild,
          filesCount: scan.files.length,
          symbolsCount: symbols.length,
          edgesCount: edges.length,
          savingsPercent: skeleton.savingsPercent,
          directories,
        },
        null,
        2
      )
    );
    return 0;
  }

  return 1;
}
