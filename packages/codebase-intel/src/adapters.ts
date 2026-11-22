import { execFile } from "node:child_process";
import type {
  CodebaseAdapterId,
  CodebaseAdapterReport,
} from "@uzina/contracts";

export interface AdapterCommandResult {
  status: "ok" | "missing_binary" | "error";
  stdout: string;
  stderr: string;
}

export type AdapterCommandRunner = (
  binary: string,
  args: string[],
  cwd: string
) => Promise<AdapterCommandResult>;

const EXTERNAL_ADAPTERS: Array<{
  adapter: Exclude<CodebaseAdapterId, "qmd">;
  binary: string;
  args: string[];
}> = [
  { adapter: "repomix", binary: "repomix", args: ["--version"] },
  { adapter: "ast_grep", binary: "sg", args: ["--version"] },
  {
    adapter: "codebase_memory_mcp",
    binary: "codebase-memory-mcp",
    args: ["--version"],
  },
];

function sanitizeAdapterEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? process.env.USERPROFILE ?? "",
    SystemRoot: process.env.SystemRoot ?? "",
  };
}

export const defaultAdapterCommandRunner: AdapterCommandRunner = (
  binary,
  args,
  cwd
) =>
  new Promise((resolve) => {
    execFile(
      binary,
      args,
      {
        cwd,
        shell: false,
        timeout: 5000,
        maxBuffer: 256 * 1024,
        env: sanitizeAdapterEnv(),
      },
      (error, stdout, stderr) => {
        if (error) {
          const errCode = (error as NodeJS.ErrnoException).code;
          if (errCode === "ENOENT") {
            resolve({ status: "missing_binary", stdout: "", stderr: "ENOENT" });
            return;
          }
          resolve({
            status: "error",
            stdout: stdout ?? "",
            stderr: stderr || error.message,
          });
          return;
        }
        resolve({ status: "ok", stdout: stdout ?? "", stderr: stderr ?? "" });
      }
    );
  });

export async function probeCodebaseAdapters(
  rootDir: string,
  deps?: { commandRunner?: AdapterCommandRunner }
): Promise<CodebaseAdapterReport[]> {
  const runner = deps?.commandRunner ?? defaultAdapterCommandRunner;
  const reports: CodebaseAdapterReport[] = [
    {
      adapter: "qmd",
      status: "ok",
      version: "builtin-slice-7",
      detail: "Motor híbrido QMD nativo integrado (BM25 + vetor 384d + RRF).",
    },
  ];

  for (const spec of EXTERNAL_ADAPTERS) {
    const res = await runner(spec.binary, spec.args, rootDir);
    if (res.status === "missing_binary") {
      reports.push({
        adapter: spec.adapter,
        status: "skipped_missing_binary",
        version: null,
        detail: `Binário '${spec.binary}' ausente no PATH; fallback AST nativo ativo.`,
      });
    } else if (res.status === "ok") {
      const firstLine = res.stdout.trim().split(/\r?\n/)[0] ?? "ok";
      reports.push({
        adapter: spec.adapter,
        status: "ok",
        version: firstLine.slice(0, 80),
        detail: `Adaptador '${spec.binary}' operacional.`,
      });
    } else {
      reports.push({
        adapter: spec.adapter,
        status: "error",
        version: null,
        detail: res.stderr.slice(0, 200) || "Erro ao sondar adaptador.",
      });
    }
  }

  return reports;
}
