import fs from "node:fs";
import path from "node:path";
import {
  BrownfieldMapSchema,
  type BrownfieldMap,
  type DevelopmentStrategy,
} from "@uzina/contracts";
import { assertPathInsideWorkspace } from "./path-guard.js";

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".worktrees",
  ".venv",
  "venv",
  "target",
  "data",
]);

const MAX_MANIFEST_READ_BYTES = 256 * 1024;

export interface BrownfieldScanOptions {
  maxDepth?: number;
  maxFiles?: number;
}

function readSmallTextFileSafe(repoRoot: string, relOrAbsPath: string): string | null {
  try {
    const safePath = assertPathInsideWorkspace(repoRoot, relOrAbsPath);
    const stat = fs.lstatSync(/*turbopackIgnore: true*/ safePath);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_MANIFEST_READ_BYTES) {
      return null;
    }
    return fs.readFileSync(/*turbopackIgnore: true*/ safePath, "utf8");
  } catch {
    return null;
  }
}

export function scanRepositoryBrownfield(
  repoPath: string,
  options: BrownfieldScanOptions = {}
): BrownfieldMap {
  const absRoot = path.resolve(/*turbopackIgnore: true*/ repoPath);
  if (
    !fs.existsSync(/*turbopackIgnore: true*/ absRoot) ||
    !fs.lstatSync(/*turbopackIgnore: true*/ absRoot).isDirectory()
  ) {
    throw new Error(`Diretório de repositório inválido ou inacessível: ${repoPath}`);
  }

  const maxDepth = options.maxDepth ?? 4;
  const maxFiles = options.maxFiles ?? 400;

  let totalFilesScanned = 0;
  let truncated = false;
  const topLevelEntries: string[] = [];
  const manifestsFound = new Set<string>();
  const stackSet = new Set<string>();
  let hasTests = false;
  let hasCi = false;
  let hasSteering = false;
  let hasGitignore = false;
  let hasLockfile = false;
  let hasExposedDotEnv = false;
  let hasPackageTests = false;
  let hasSecurityOrLintScript = false;

  const manifestNames = new Set([
    "package.json",
    "pnpm-workspace.yaml",
    "tsconfig.json",
    "pyproject.toml",
    "requirements.txt",
    "cargo.toml",
    "go.mod",
    "dockerfile",
  ]);

  const lockfileNames = new Set([
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
    "poetry.lock",
    "cargo.lock",
    "go.sum",
  ]);

  function walk(dir: string, depth: number): void {
    if (truncated || depth > maxDepth) {
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(/*turbopackIgnore: true*/ dir, {
        withFileTypes: true,
      });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (truncated) break;
      // Nao segue symlinks/junctions para impedir loop ou fuga do repo
      if (entry.isSymbolicLink()) {
        continue;
      }

      const name = entry.name;
      const lower = name.toLowerCase();
      const fullPath = path.join(/*turbopackIgnore: true*/ dir, name);
      const rel = path.relative(absRoot, fullPath).replace(/\\/g, "/");

      if (depth === 0) {
        topLevelEntries.push(name);
      }

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(name)) {
          continue;
        }
        if (lower === "tests" || lower === "__tests__" || lower === "test") {
          hasTests = true;
        }
        if (rel === ".github/workflows" || lower === ".circleci") {
          hasCi = true;
        }
        if (rel === ".uzina" || rel === ".factory") {
          hasSteering = true;
        }
        walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        if (totalFilesScanned >= maxFiles) {
          truncated = true;
          break;
        }
        totalFilesScanned += 1;

        if (lower === ".gitignore") hasGitignore = true;
        if (lower === ".env") hasExposedDotEnv = true;
        if (lockfileNames.has(lower)) hasLockfile = true;
        if (lower === "readme.md" || lower === "agents.md" || lower === "steering.md") {
          hasSteering = true;
        }
        if (
          /\.(test|spec)\.(ts|tsx|js|jsx|mjs|py)$/.test(lower) ||
          lower.startsWith("test_")
        ) {
          hasTests = true;
        }
        if (rel.startsWith(".github/workflows/") && /\.ya?ml$/.test(lower)) {
          hasCi = true;
        }
        if (manifestNames.has(lower)) {
          manifestsFound.add(rel);
        }

        if (lower === "tsconfig.json" || lower.endsWith(".ts") || lower.endsWith(".tsx")) {
          stackSet.add("typescript");
        }
        if (lower === "pyproject.toml" || lower.endsWith(".py")) {
          stackSet.add("python");
        }
        if (lower === "go.mod") {
          stackSet.add("go");
        }
        if (lower === "cargo.toml") {
          stackSet.add("rust");
        }
        if (lower === "dockerfile") {
          stackSet.add("docker");
        }

        if (lower === "package.json" && depth <= 2) {
          const pkgRaw = readSmallTextFileSafe(absRoot, rel);
          if (pkgRaw) {
            try {
              const pkg = JSON.parse(pkgRaw) as {
                scripts?: Record<string, string>;
                dependencies?: Record<string, string>;
                devDependencies?: Record<string, string>;
              };
              const deps = { ...pkg.dependencies, ...pkg.devDependencies };
              if (deps.next) stackSet.add("nextjs");
              if (deps.react) stackSet.add("react");
              if (deps.zod) stackSet.add("zod");
              if (deps["drizzle-orm"]) stackSet.add("drizzle");
              if (deps.vitest || deps.jest || deps["@playwright/test"]) {
                hasPackageTests = true;
              }
              if (pkg.scripts?.test) hasPackageTests = true;
              if (
                pkg.scripts?.lint ||
                pkg.scripts?.verify ||
                pkg.scripts?.audit ||
                pkg.scripts?.typecheck
              ) {
                hasSecurityOrLintScript = true;
              }
            } catch {
              // ignora package.json invalido em fixture de teste
            }
          }
        }
      }
    }
  }

  walk(absRoot, 0);

  const effectiveTests = hasTests || hasPackageTests;
  const ciAndVerify = (hasCi ? 12 : 0) + (hasSecurityOrLintScript ? 8 : 0);
  const testQuality = (effectiveTests ? 14 : 0) + (hasPackageTests && hasTests ? 6 : 0);
  const documentationAndSteering =
    (hasSteering ? 12 : 0) + (manifestsFound.size > 0 ? 8 : 0);
  const securityPosture =
    (hasGitignore ? 4 : 0) +
    (hasLockfile ? 4 : 0) +
    (!hasExposedDotEnv ? 4 : 0) +
    (hasSecurityOrLintScript ? 4 : 0) +
    (effectiveTests ? 4 : 0);
  const architectureModularity =
    (manifestsFound.size > 0 ? 8 : 0) +
    (stackSet.has("typescript") || stackSet.has("zod") ? 8 : 4) +
    (topLevelEntries.includes("src") || topLevelEntries.includes("packages") ? 4 : 0);

  const maturityScore =
    ciAndVerify +
    testQuality +
    documentationAndSteering +
    securityPosture +
    architectureModularity;

  const riskNotes: string[] = [];
  if (!effectiveTests) {
    riskNotes.push("Nenhuma suíte de testes automatizados detectada no repositório.");
  }
  if (!hasCi) {
    riskNotes.push("Nenhum workflow de CI (.github/workflows) detectado.");
  }
  if (hasExposedDotEnv) {
    riskNotes.push("Arquivo .env detectado na raiz — verificar se está no .gitignore.");
  }
  if (!hasSteering) {
    riskNotes.push("Documentação de arquitetura / steering (AGENTS.md / README) ausente.");
  }

  let recommendedStrategy: DevelopmentStrategy = "api_contract_first";
  if (maturityScore < 40) {
    recommendedStrategy = "characterization_strangler";
  } else if (stackSet.has("nextjs") || stackSet.has("react")) {
    recommendedStrategy = "frontend_first_msw";
  } else if (stackSet.has("drizzle")) {
    recommendedStrategy = "data_schema_first";
  }

  return BrownfieldMapSchema.parse({
    repoPath: absRoot,
    scannedAt: new Date().toISOString(),
    totalFilesScanned,
    truncated,
    topLevelEntries: topLevelEntries.slice(0, 50),
    manifestsFound: Array.from(manifestsFound),
    detectedStack: Array.from(stackSet),
    hasTests: effectiveTests,
    hasCi,
    hasSteering,
    dimensions: {
      ciAndVerify,
      testQuality,
      documentationAndSteering,
      securityPosture,
      architectureModularity,
    },
    maturityScore,
    recommendedStrategy,
    riskNotes,
  });
}
