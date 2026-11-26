import fs from "node:fs";
import path from "node:path";
import {
  ScaReachabilityAnnotationSchema,
  type ScaReachabilityAnnotation,
  type ScaReachabilityStatus,
} from "@uzina/contracts";
import { assertPathInsideWorkspace } from "@uzina/core";

export interface ScaAdvisoryMetadata {
  epssScore?: number | null;
  inCisaKev?: boolean;
}

export interface ScaReachabilityFindingInput {
  fingerprint: string;
  ruleId: string;
  scanner: string;
  title?: string;
  description?: string;
  filePath?: string | null;
  packageName?: string;
}

export type ImportedPackagesInput =
  | ReadonlyMap<string, readonly string[]>
  | Record<string, readonly string[]>;

export interface WorkspaceImportInventory {
  importedByPackage: Map<string, string[]>;
  dependencies: Set<string>;
  devDependencies: Set<string>;
  scannedSourceFiles: number;
  hasPackageManifest: boolean;
}

export interface AnnotateScaReachabilityOptions {
  targetPath?: string;
  findings: readonly ScaReachabilityFindingInput[];
  importedPackagesMap?: ImportedPackagesInput;
  advisoryMetadata?: Readonly<Record<string, ScaAdvisoryMetadata>>;
}

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".next",
  ".turbo",
  ".worktrees",
  "coverage",
  "tests",
  "test",
  "__tests__",
  "fixtures",
]);

const SOURCE_FILE_EXT_RE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|py|go)$/i;
const TEST_FILE_RE = /\.(?:test|spec)\.[cm]?[jt]sx?$/i;
const MAX_SOURCE_FILES = 1500;
const MAX_SOURCE_BYTES = 256 * 1024;

export function normalizeExternalPackageName(specifier: string): string | null {
  const trimmed = specifier.trim();
  if (
    !trimmed ||
    trimmed.startsWith(".") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("node:")
  ) {
    return null;
  }

  if (trimmed.startsWith("@")) {
    const parts = trimmed.split("/");
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return `${parts[0]}/${parts[1]}`;
    }
    return trimmed;
  }

  const slashIdx = trimmed.indexOf("/");
  return slashIdx === -1 ? trimmed : trimmed.slice(0, slashIdx);
}

export function extractImportsFromSource(
  filePath: string,
  content: string
): string[] {
  const ext = path.posix.extname(filePath).toLowerCase();
  const packages = new Set<string>();

  if (ext === ".py") {
    const pyImportRe = /^[ \t]*import[ \t]+([A-Za-z0-9_., \t]+?)(?:[ \t]*(?:#.*)?)?$/gm;
    const pyFromRe = /^[ \t]*from[ \t]+([A-Za-z0-9_.]+)[ \t]+import\b/gm;

    for (const match of content.matchAll(pyImportRe)) {
      const clause = match[1] ?? "";
      for (const item of clause.split(",")) {
        const mod = item.trim().split(/\s+as\s+/i)[0]?.split(".")[0]?.trim();
        if (mod) {
          packages.add(mod);
        }
      }
    }
    for (const match of content.matchAll(pyFromRe)) {
      const raw = match[1]?.trim() ?? "";
      if (!raw || raw.startsWith(".")) continue;
      const rootMod = raw.split(".")[0]?.trim();
      if (rootMod) {
        packages.add(rootMod);
      }
    }
    return Array.from(packages);
  }

  if (ext === ".go") {
    const singleImportRe = /^[ \t]*import[ \t]+(?:[A-Za-z0-9_.]+[ \t]+)?"([^"\r\n]+)"/gm;
    const blockImportRe = /import\s*\(([\s\S]*?)\)/gm;
    const quotedInBlockRe = /(?:[A-Za-z0-9_.]+\s+)?"([^"]+)"/g;

    for (const match of content.matchAll(singleImportRe)) {
      const pkg = match[1]?.trim();
      if (pkg && pkg.includes(".")) {
        packages.add(pkg);
      }
    }
    for (const block of content.matchAll(blockImportRe)) {
      const body = block[1] ?? "";
      for (const entry of body.matchAll(quotedInBlockRe)) {
        const pkg = entry[1]?.trim();
        if (pkg && pkg.includes(".")) {
          packages.add(pkg);
        }
      }
    }
    return Array.from(packages);
  }

  // TS / JS imports & requires
  const esmStaticRe =
    /(?:^|[\s;])(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/gm;
  const dynamicOrRequireRe =
    /\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g;

  for (const match of content.matchAll(esmStaticRe)) {
    const normalized = normalizeExternalPackageName(match[1] ?? "");
    if (normalized) {
      packages.add(normalized);
    }
  }

  for (const match of content.matchAll(dynamicOrRequireRe)) {
    const normalized = normalizeExternalPackageName(match[1] ?? "");
    if (normalized) {
      packages.add(normalized);
    }
  }

  return Array.from(packages);
}

export function collectWorkspaceImports(
  targetPath: string
): WorkspaceImportInventory {
  const importedByPackage = new Map<string, string[]>();
  const dependencies = new Set<string>();
  const devDependencies = new Set<string>();
  let scannedSourceFiles = 0;
  let hasPackageManifest = false;

  if (!fs.existsSync(/*turbopackIgnore: true*/ targetPath)) {
    return {
      importedByPackage,
      dependencies,
      devDependencies,
      scannedSourceFiles,
      hasPackageManifest,
    };
  }

  const rootAbs = assertPathInsideWorkspace(targetPath, ".", {
    allowRoot: true,
  });

  // Lê package.json na raiz para distinguir dependencies vs devDependencies
  try {
    const pkgPath = assertPathInsideWorkspace(rootAbs, "package.json");
    if (fs.existsSync(/*turbopackIgnore: true*/ pkgPath)) {
      const stat = fs.lstatSync(/*turbopackIgnore: true*/ pkgPath);
      if (stat.isFile() && !stat.isSymbolicLink()) {
        const rawPkg = fs.readFileSync(/*turbopackIgnore: true*/ pkgPath, "utf8");
        const parsed = JSON.parse(rawPkg) as {
          dependencies?: Record<string, unknown>;
          devDependencies?: Record<string, unknown>;
          optionalDependencies?: Record<string, unknown>;
        };
        hasPackageManifest = true;
        for (const dep of Object.keys(parsed.dependencies ?? {})) {
          dependencies.add(dep);
        }
        for (const dep of Object.keys(parsed.optionalDependencies ?? {})) {
          dependencies.add(dep);
        }
        for (const dep of Object.keys(parsed.devDependencies ?? {})) {
          devDependencies.add(dep);
        }
      }
    }
  } catch {
    // package.json ausente ou inválido não impede inspeção de src/
  }

  // Prefere src/ se existir, caso contrário inspeciona diretórios de produção da raiz
  const srcCandidate = path.join(rootAbs, "src");
  const walkRoots: string[] =
    fs.existsSync(/*turbopackIgnore: true*/ srcCandidate) &&
    !fs.lstatSync(/*turbopackIgnore: true*/ srcCandidate).isSymbolicLink() &&
    fs.lstatSync(/*turbopackIgnore: true*/ srcCandidate).isDirectory()
      ? [srcCandidate]
      : [rootAbs];

  const walk = (dir: string) => {
    if (scannedSourceFiles >= MAX_SOURCE_FILES) {
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
      if (scannedSourceFiles >= MAX_SOURCE_FILES) {
        break;
      }
      if (IGNORED_DIRS.has(entry.name) || entry.isSymbolicLink()) {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (!SOURCE_FILE_EXT_RE.test(entry.name) || TEST_FILE_RE.test(entry.name)) {
        continue;
      }

      try {
        const safeFile = assertPathInsideWorkspace(rootAbs, fullPath);
        const stat = fs.lstatSync(/*turbopackIgnore: true*/ safeFile);
        if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_SOURCE_BYTES) {
          continue;
        }
        const buf = fs.readFileSync(/*turbopackIgnore: true*/ safeFile);
        if (buf.includes(0)) {
          continue;
        }
        const relPath = path.relative(rootAbs, safeFile).replace(/\\/g, "/");
        scannedSourceFiles += 1;
        const imported = extractImportsFromSource(relPath, buf.toString("utf8"));
        for (const pkg of imported) {
          const list = importedByPackage.get(pkg) ?? [];
          if (!list.includes(relPath)) {
            list.push(relPath);
          }
          importedByPackage.set(pkg, list);
        }
      } catch {
        // Ignora arquivos fora da fronteira ou ilegíveis
      }
    }
  };

  for (const walkRoot of walkRoots) {
    walk(walkRoot);
  }

  return {
    importedByPackage,
    dependencies,
    devDependencies,
    scannedSourceFiles,
    hasPackageManifest,
  };
}

function mergeImportedPackagesMap(
  base: Map<string, string[]>,
  extra?: ImportedPackagesInput
): Map<string, string[]> {
  const merged = new Map<string, string[]>();
  for (const [pkg, files] of base.entries()) {
    merged.set(pkg, [...files]);
  }
  if (!extra) {
    return merged;
  }

  const entries: Array<[string, readonly string[]]> =
    extra instanceof Map ? Array.from(extra.entries()) : Object.entries(extra);

  for (const [pkg, files] of entries) {
    const existing = new Set(merged.get(pkg) ?? []);
    for (const file of files) {
      const normalized = file.replace(/\\/g, "/").trim();
      if (normalized) {
        existing.add(normalized);
      }
    }
    merged.set(pkg, Array.from(existing).sort());
  }
  return merged;
}

export function resolvePackageNameFromFinding(
  finding: ScaReachabilityFindingInput
): string | null {
  if (finding.packageName && finding.packageName.trim()) {
    return finding.packageName.trim();
  }
  const isScaScanner =
    finding.scanner === "trivy" ||
    finding.scanner === "osv_scanner" ||
    finding.scanner.toLowerCase().includes("sca");
  if (!isScaScanner) {
    return null;
  }
  const title = finding.title ?? "";
  // Padrão Trivy: "<CVE> em <pkg>"
  const emMatch = title.match(/\bem\s+([@A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?)\s*$/);
  if (emMatch?.[1]) {
    return emMatch[1];
  }
  // Padrão OSV: "<GHSA> (<pkg>)"
  const parenMatch = title.match(/\(([@A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?)\)\s*$/);
  if (parenMatch?.[1]) {
    return parenMatch[1];
  }
  return null;
}

export function annotateScaReachability(
  options: AnnotateScaReachabilityOptions
): ScaReachabilityAnnotation[] {
  const inventory = options.targetPath
    ? collectWorkspaceImports(options.targetPath)
    : {
        importedByPackage: new Map<string, string[]>(),
        dependencies: new Set<string>(),
        devDependencies: new Set<string>(),
        scannedSourceFiles: 0,
        hasPackageManifest: false,
      };

  const importedMap = mergeImportedPackagesMap(
    inventory.importedByPackage,
    options.importedPackagesMap
  );
  const hasAnalysisContext =
    inventory.scannedSourceFiles > 0 ||
    inventory.hasPackageManifest ||
    Boolean(options.importedPackagesMap);

  const annotations: ScaReachabilityAnnotation[] = [];

  for (const finding of options.findings) {
    const packageName = resolvePackageNameFromFinding(finding);
    if (!packageName) {
      continue;
    }

    const importedInFiles = importedMap.get(packageName) ?? [];
    const isDevOnly =
      inventory.devDependencies.has(packageName) &&
      !inventory.dependencies.has(packageName);

    let reachability: ScaReachabilityStatus;
    let rationale: string;

    if (importedInFiles.length > 0) {
      reachability = "reachable";
      rationale = `Pacote '${packageName}' importado em código de produção (${importedInFiles.slice(0, 5).join(", ")}).`;
    } else if (isDevOnly) {
      reachability = "unreachable";
      rationale = `Pacote '${packageName}' declarado apenas em devDependencies e não importado em produção (src/).`;
    } else if (hasAnalysisContext) {
      reachability = "unreachable";
      rationale = `Pacote '${packageName}' não possui imports detectados nos arquivos de produção analisados.`;
    } else {
      reachability = "unknown";
      rationale = `Contexto de código-fonte/manifesto insuficiente para comprovar alcançabilidade de '${packageName}'.`;
    }

    const meta =
      options.advisoryMetadata?.[finding.ruleId] ??
      options.advisoryMetadata?.[packageName];

    annotations.push(
      ScaReachabilityAnnotationSchema.parse({
        findingFingerprint: finding.fingerprint,
        packageName: packageName.slice(0, 200),
        reachability,
        importedInFiles: importedInFiles.slice(0, 100),
        epssScore:
          typeof meta?.epssScore === "number" ? meta.epssScore : null,
        inCisaKev: Boolean(meta?.inCisaKev),
        rationale: rationale.slice(0, 500),
      })
    );
  }

  return annotations;
}
