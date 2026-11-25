import fs from "node:fs";
import path from "node:path";
import { scanCodebaseWorkspace } from "@uzina/codebase-intel";
import {
  EntropyAuditReportSchema,
  type EntropyAuditReport,
} from "@uzina/contracts";
import { assertPathInsideWorkspace } from "@uzina/core";
import {
  clients,
  deliverables,
  projectRepositories,
  projects,
  type UzinaDb,
} from "@uzina/db";
import { listProjectWorktrees } from "@uzina/opencode-bridge";
import { and, eq, inArray } from "drizzle-orm";

const ENTRYPOINT_FILE_RE =
  /(?:^|\/)(?:index|main|cli|server|page|layout|route|loading|error|middleware|globals|next\.config|vitest\.config|eslint\.config)\.[cm]?[jt]sx?$/i;
const TEST_FILE_RE = /(?:^|\/)(?:tests?|__tests__)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/i;
const ENTRYPOINT_SYMBOL_RE =
  /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|default|metadata|generateMetadata|viewport)$/i;
const SPEC_PATH_REF_RE =
  /`((?:packages|apps|scripts)\/[A-Za-z0-9_.\-\/]+\.(?:ts|tsx|js|mjs|cjs|json|md|sql))`/g;
const IMPORT_SPECIFIER_RE =
  /(?:import\s+[\s\S]*?from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;
const IGNORED_RUNTIME_DEPS = new Set([
  "next",
  "react",
  "react-dom",
  "tailwindcss",
  "drizzle-kit",
]);

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

function collectMarkdownFiles(dirAbs: string, rootAbs: string): string[] {
  if (!fs.existsSync(/*turbopackIgnore: true*/ dirAbs)) return [];
  const results: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(/*turbopackIgnore: true*/ current, {
      withFileTypes: true,
    })) {
      if (entry.name.startsWith(".env") || entry.name === ".master-key") continue;
      const full = path.join(/*turbopackIgnore: true*/ current, entry.name);
      try {
        if (fs.lstatSync(/*turbopackIgnore: true*/ full).isSymbolicLink()) continue;
      } catch {
        continue;
      }
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        walk(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        results.push(full);
      }
    }
  };
  try {
    const safeDir = assertPathInsideWorkspace(rootAbs, dirAbs, {
      allowRoot: true,
    });
    walk(safeDir);
  } catch {
    return [];
  }
  return results.sort((a, b) => a.localeCompare(b));
}

function scanDocSpecDrifts(
  workspaceRoot: string,
  specDirs: readonly string[]
): EntropyAuditReport["docSpecDrifts"] {
  const drifts: EntropyAuditReport["docSpecDrifts"] = [];
  const seen = new Set<string>();

  for (const relDir of specDirs) {
    const dirAbs = path.join(/*turbopackIgnore: true*/ workspaceRoot, relDir);
    for (const mdAbs of collectMarkdownFiles(dirAbs, workspaceRoot)) {
      const relSpec = normalizeSlashes(path.relative(workspaceRoot, mdAbs));
      const content = fs.readFileSync(/*turbopackIgnore: true*/ mdAbs, "utf8");
      let match: RegExpExecArray | null;
      SPEC_PATH_REF_RE.lastIndex = 0;
      while ((match = SPEC_PATH_REF_RE.exec(content)) !== null) {
        const target = match[1]?.trim();
        if (
          !target ||
          target.includes("*") ||
          target.includes("<") ||
          target.includes("0X") ||
          target.includes("XX")
        ) {
          continue;
        }
        const key = `${relSpec}::${target}`;
        if (seen.has(key)) continue;
        seen.add(key);

        try {
          const targetAbs = assertPathInsideWorkspace(workspaceRoot, target);
          if (!fs.existsSync(/*turbopackIgnore: true*/ targetAbs)) {
            drifts.push({
              specPath: relSpec.slice(0, 500),
              missingTarget: target.slice(0, 500),
              detail: `Referência '${target}' citada em ${relSpec} não existe mais no workspace.`,
            });
          }
        } catch {
          // Ignora caminhos inválidos fora do workspace
        }
        if (drifts.length >= 100) return drifts;
      }
    }
  }
  return drifts;
}

function scanDeadCodeCandidates(
  workspaceRoot: string
): EntropyAuditReport["deadCodeCandidates"] {
  if (!fs.existsSync(/*turbopackIgnore: true*/ workspaceRoot)) return [];
  const scan = scanCodebaseWorkspace(workspaceRoot);
  const incomingTargetKeys = new Set(
    scan.edges.map(
      (e) => `${normalizeSlashes(e.toFilePath)}::${e.toSymbolName}`
    )
  );
  const incomingTargetNames = new Set(scan.edges.map((e) => e.toSymbolName));
  const candidates: EntropyAuditReport["deadCodeCandidates"] = [];

  for (const file of scan.files) {
    for (const sym of file.symbols) {
      const normalizedPath = normalizeSlashes(sym.filePath);
      if (!sym.exported) continue;
      if (normalizedPath.startsWith("packages/contracts/")) continue;
      if (ENTRYPOINT_FILE_RE.test(normalizedPath)) continue;
      if (TEST_FILE_RE.test(normalizedPath)) continue;
      if (ENTRYPOINT_SYMBOL_RE.test(sym.name)) continue;

      const symKey = `${normalizedPath}::${sym.name}`;
      if (
        !incomingTargetKeys.has(symKey) &&
        !incomingTargetNames.has(sym.name)
      ) {
        candidates.push({
          symbol: sym.name.slice(0, 200),
          filePath: normalizedPath.slice(0, 500),
          line: Math.max(1, sym.lineStart),
        });
      }
      if (candidates.length >= 100) return candidates;
    }
  }

  return candidates;
}

function collectImportsInDir(srcDir: string): Set<string> {
  const importedPackages = new Set<string>();
  if (!fs.existsSync(/*turbopackIgnore: true*/ srcDir)) return importedPackages;

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(/*turbopackIgnore: true*/ dir, {
      withFileTypes: true,
    })) {
      const full = path.join(/*turbopackIgnore: true*/ dir, entry.name);
      try {
        if (fs.lstatSync(/*turbopackIgnore: true*/ full).isSymbolicLink()) continue;
      } catch {
        continue;
      }
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        walk(full);
      } else if (
        entry.isFile() &&
        /\.(?:ts|tsx|js|mjs|cjs)$/i.test(entry.name)
      ) {
        const text = fs.readFileSync(/*turbopackIgnore: true*/ full, "utf8");
        IMPORT_SPECIFIER_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = IMPORT_SPECIFIER_RE.exec(text)) !== null) {
          const spec = m[1];
          if (!spec || spec.startsWith(".") || spec.startsWith("node:")) continue;
          const parts = spec.split("/");
          const pkg = spec.startsWith("@")
            ? parts.slice(0, 2).join("/")
            : parts[0]!;
          importedPackages.add(pkg);
        }
      }
    }
  };
  walk(srcDir);
  return importedPackages;
}

function scanUnusedDependencies(
  workspaceRoot: string
): EntropyAuditReport["unusedDependencies"] {
  const unused: EntropyAuditReport["unusedDependencies"] = [];
  const packageDirs: string[] = [];

  for (const parent of ["packages", "apps"]) {
    const parentAbs = path.join(/*turbopackIgnore: true*/ workspaceRoot, parent);
    if (!fs.existsSync(/*turbopackIgnore: true*/ parentAbs)) continue;
    for (const entry of fs.readdirSync(/*turbopackIgnore: true*/ parentAbs, {
      withFileTypes: true,
    })) {
      if (entry.isDirectory()) {
        packageDirs.push(path.join(/*turbopackIgnore: true*/ parentAbs, entry.name));
      }
    }
  }

  for (const pkgDir of packageDirs) {
    const pkgJsonPath = path.join(/*turbopackIgnore: true*/ pkgDir, "package.json");
    const srcDir = path.join(/*turbopackIgnore: true*/ pkgDir, "src");
    if (
      !fs.existsSync(/*turbopackIgnore: true*/ pkgJsonPath) ||
      !fs.existsSync(/*turbopackIgnore: true*/ srcDir)
    ) {
      continue;
    }
    try {
      const pkgJson = JSON.parse(
        fs.readFileSync(/*turbopackIgnore: true*/ pkgJsonPath, "utf8")
      ) as { name?: string; dependencies?: Record<string, string> };
      const packageName =
        pkgJson.name?.trim() ||
        normalizeSlashes(path.relative(workspaceRoot, pkgDir));
      const deps = Object.keys(pkgJson.dependencies ?? {});
      if (deps.length === 0) continue;

      const imported = collectImportsInDir(srcDir);
      for (const dep of deps) {
        if (dep.startsWith("@types/") || IGNORED_RUNTIME_DEPS.has(dep)) {
          continue;
        }
        if (!imported.has(dep)) {
          unused.push({
            packageName: packageName.slice(0, 160),
            dependencyName: dep.slice(0, 160),
          });
        }
      }
    } catch {
      continue;
    }
  }

  return unused.slice(0, 100);
}

async function detectOrphanWorktrees(input: {
  db?: UzinaDb;
  organizationId?: string;
  projectId?: string;
  workspaceRoot: string;
  worktreesRootDir?: string;
}): Promise<EntropyAuditReport["orphanWorktrees"]> {
  const orphans: EntropyAuditReport["orphanWorktrees"] = [];
  const seenPaths = new Set<string>();

  const activeWorktreePaths = new Set<string>();
  const deliverableIdByBranch = new Map<string, string>();

  if (input.db) {
    const repoFilters = input.projectId
      ? [eq(deliverables.projectId, input.projectId)]
      : [];

    if (input.organizationId && !input.projectId) {
      const orgProjects = await input.db
        .select({ id: projects.id })
        .from(projects)
        .innerJoin(clients, eq(projects.clientId, clients.id))
        .where(eq(clients.organizationId, input.organizationId));
      const ids = orgProjects.map((p) => p.id);
      if (ids.length > 0) {
        repoFilters.push(inArray(deliverables.projectId, ids));
      }
    }

    const rows =
      repoFilters.length > 0
        ? await input.db
            .select({
              id: deliverables.id,
              status: deliverables.status,
              worktreePath: deliverables.worktreePath,
              branchName: deliverables.branchName,
            })
            .from(deliverables)
            .where(and(...repoFilters))
        : await input.db
            .select({
              id: deliverables.id,
              status: deliverables.status,
              worktreePath: deliverables.worktreePath,
              branchName: deliverables.branchName,
            })
            .from(deliverables);

    for (const row of rows) {
      if (row.branchName) {
        deliverableIdByBranch.set(row.branchName, row.id);
      }
      if (row.status !== "merged" && row.status !== "failed") {
        if (row.worktreePath) {
          activeWorktreePaths.add(
            normalizeSlashes(path.resolve(row.worktreePath)).toLowerCase()
          );
        }
      }
    }
  }

  const repoRoots = new Set<string>([path.resolve(input.workspaceRoot)]);
  if (input.db && input.projectId) {
    const repos = await input.db
      .select({ localPath: projectRepositories.localPath })
      .from(projectRepositories)
      .where(eq(projectRepositories.projectId, input.projectId));
    for (const r of repos) {
      if (r.localPath) repoRoots.add(path.resolve(r.localPath));
    }
  }

  for (const repoRoot of repoRoots) {
    const gitEntries = await listProjectWorktrees(repoRoot).catch(() => []);
    for (const entry of gitEntries) {
      if (entry.isMain) continue;
      const normPath = normalizeSlashes(
        path.resolve(entry.worktreePath)
      ).toLowerCase();
      if (seenPaths.has(normPath)) continue;

      const missingOnDisk = !fs.existsSync(/*turbopackIgnore: true*/ entry.worktreePath);
      const isAttachedToActive = activeWorktreePaths.has(normPath);
      const matchedDelivId = entry.branchName
        ? deliverableIdByBranch.get(entry.branchName) ?? null
        : null;

      if (missingOnDisk || (input.db && !isAttachedToActive)) {
        seenPaths.add(normPath);
        orphans.push({
          workspacePath: normalizeSlashes(entry.worktreePath).slice(0, 500),
          branchName: (entry.branchName ?? "detached").slice(0, 200),
          deliverableId: matchedDelivId,
        });
      }
    }
  }

  const wtDirs = [
    path.join(/*turbopackIgnore: true*/ input.workspaceRoot, ".worktrees"),
    ...(input.worktreesRootDir ? [path.resolve(input.worktreesRootDir)] : []),
  ];
  for (const wtDir of wtDirs) {
    if (!fs.existsSync(/*turbopackIgnore: true*/ wtDir)) continue;
    for (const entry of fs.readdirSync(/*turbopackIgnore: true*/ wtDir, {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(/*turbopackIgnore: true*/ wtDir, entry.name);
      const normPath = normalizeSlashes(path.resolve(fullPath)).toLowerCase();
      if (seenPaths.has(normPath)) continue;
      if (input.db && !activeWorktreePaths.has(normPath)) {
        seenPaths.add(normPath);
        orphans.push({
          workspacePath: normalizeSlashes(fullPath).slice(0, 500),
          branchName: entry.name.slice(0, 200),
          deliverableId: null,
        });
      }
    }
  }

  return orphans.slice(0, 100);
}

export interface RunEntropyAuditInput {
  workspaceRoot: string;
  db?: UzinaDb;
  organizationId?: string;
  projectId?: string;
  worktreesRootDir?: string;
  specDirs?: readonly string[];
  scanCodebase?: boolean;
}

export async function runEntropyAudit(
  input: RunEntropyAuditInput
): Promise<EntropyAuditReport> {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const specDirs = input.specDirs ?? ["docs/slices", ".uzina"];

  const [orphanWorktrees, docSpecDrifts, deadCodeCandidates, unusedDependencies] =
    await Promise.all([
      detectOrphanWorktrees({
        db: input.db,
        organizationId: input.organizationId,
        projectId: input.projectId,
        workspaceRoot,
        worktreesRootDir: input.worktreesRootDir,
      }),
      Promise.resolve(scanDocSpecDrifts(workspaceRoot, specDirs)),
      Promise.resolve(
        input.scanCodebase === false ? [] : scanDeadCodeCandidates(workspaceRoot)
      ),
      Promise.resolve(
        input.scanCodebase === false ? [] : scanUnusedDependencies(workspaceRoot)
      ),
    ]);

  return EntropyAuditReportSchema.parse({
    deadCodeCandidates,
    docSpecDrifts,
    orphanWorktrees,
    unusedDependencies,
  });
}
