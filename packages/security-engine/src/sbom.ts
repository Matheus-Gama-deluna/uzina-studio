import crypto from "node:crypto";
import fs from "node:fs";
import {
  SbomComponentSchema,
  SbomDocumentSummarySchema,
  type SbomComponent,
  type SbomDocumentSummary,
  type ScannerExecutionStatus,
} from "@uzina/contracts";
import { assertPathInsideWorkspace } from "@uzina/core";
import {
  assertSafeScanArg,
  defaultCommandRunner,
  type ExternalCommandRunner,
} from "./adapters.js";

export interface CycloneDx15Component {
  type: "library";
  name: string;
  version: string;
  purl: string;
  scope: "required" | "optional" | "dev";
  licenses?: Array<{ license: { id?: string; name?: string } }>;
}

export interface CycloneDx15Document {
  bomFormat: "CycloneDX";
  specVersion: "1.5";
  serialNumber: string;
  version: 1;
  metadata: {
    timestamp: string;
    tools: Array<{ vendor: string; name: string; version: string }>;
    component?: {
      type: "application";
      name: string;
      version: string;
    };
  };
  components: CycloneDx15Component[];
}

export interface GenerateSbomOptions {
  targetPath: string;
  useSyft?: boolean;
  commandRunner?: ExternalCommandRunner;
  timeoutMs?: number;
  signal?: AbortSignal;
  now?: () => Date;
}

export interface GeneratedSbomResult {
  document: CycloneDx15Document;
  summary: SbomDocumentSummary;
  syftStatus: ScannerExecutionStatus | "not_requested";
}

function buildNpmPurl(name: string, version: string): string {
  const encodedName = name.startsWith("@")
    ? `%40${name.slice(1)}`
    : name;
  return `pkg:npm/${encodedName}@${version}`.slice(0, 300);
}

function formatDeterministicSerialNumber(componentsHash: string): string {
  return `urn:uuid:${componentsHash.slice(0, 8)}-${componentsHash.slice(8, 12)}-4${componentsHash.slice(13, 16)}-8${componentsHash.slice(17, 20)}-${componentsHash.slice(20, 32)}`;
}

function cleanDeclaredVersion(raw: string): string {
  return raw
    .trim()
    .replace(/^[\^~>=<=\s]+/, "")
    .split(/\s+/)[0] || raw.trim();
}

function readSafeTextFile(
  rootAbs: string,
  relPath: string
): string | null {
  try {
    const candidate = assertPathInsideWorkspace(rootAbs, relPath);
    if (!fs.existsSync(/*turbopackIgnore: true*/ candidate)) {
      return null;
    }
    const stat = fs.lstatSync(/*turbopackIgnore: true*/ candidate);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 8 * 1024 * 1024) {
      return null;
    }
    return fs.readFileSync(/*turbopackIgnore: true*/ candidate, "utf8");
  } catch {
    return null;
  }
}

function parsePnpmPackageKey(
  rawKey: string
): { name: string; version: string } | null {
  const cleaned = rawKey.trim().replace(/^['"]|['"]$/g, "");
  if (!cleaned) return null;
  const withoutLeadingSlash = cleaned.startsWith("/") ? cleaned.slice(1) : cleaned;
  // Remove sufixos de peer dependencies: pkg@1.2.3(peer@4.5.6) ou pkg@1.2.3_peer@4.5.6
  const baseKey = withoutLeadingSlash.split("(")[0]?.split("_")[0] ?? "";
  if (!baseKey) return null;

  // Formato v6/v9: @scope/name@1.2.3 ou name@1.2.3
  const lastAt = baseKey.lastIndexOf("@");
  if (lastAt > 0) {
    const name = baseKey.slice(0, lastAt).trim();
    const version = baseKey.slice(lastAt + 1).trim();
    if (name && version) {
      return { name, version };
    }
  }

  // Formato v5: @scope/name/1.2.3 ou name/1.2.3
  const segments = baseKey.split("/").filter(Boolean);
  if (segments.length >= 2) {
    const version = segments[segments.length - 1]!;
    const name = segments.slice(0, -1).join("/");
    if (name && version) {
      return { name, version };
    }
  }

  return null;
}

function parsePnpmLockYaml(content: string): SbomComponent[] {
  const components = new Map<string, SbomComponent>();
  const lines = content.split(/\r?\n/);

  let section: "none" | "importers" | "packages" | "snapshots" = "none";
  let importerDepScope: "required" | "dev" | "optional" | null = null;
  let currentImporterPkg: string | null = null;
  let currentPkgKey: { name: string; version: string } | null = null;
  let currentPkgScope: "required" | "dev" | "optional" = "required";

  const flushPackageBlock = () => {
    if (!currentPkgKey) return;
    const id = `${currentPkgKey.name}@${currentPkgKey.version}`;
    if (!components.has(id)) {
      components.set(
        id,
        SbomComponentSchema.parse({
          name: currentPkgKey.name,
          version: currentPkgKey.version,
          purl: buildNpmPurl(currentPkgKey.name, currentPkgKey.version),
          license: null,
          scope: currentPkgScope,
        })
      );
    }
    currentPkgKey = null;
    currentPkgScope = "required";
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const indent = rawLine.length - rawLine.trimStart().length;
    if (indent === 0) {
      flushPackageBlock();
      importerDepScope = null;
      currentImporterPkg = null;

      if (trimmed.startsWith("importers:")) {
        section = "importers";
      } else if (trimmed.startsWith("packages:")) {
        section = "packages";
      } else if (trimmed.startsWith("snapshots:")) {
        section = "snapshots";
      } else {
        section = "none";
      }
      continue;
    }

    if (section === "packages" || section === "snapshots") {
      if (indent === 2 && trimmed.endsWith(":")) {
        flushPackageBlock();
        const keyRaw = trimmed.slice(0, -1);
        currentPkgKey = parsePnpmPackageKey(keyRaw);
        currentPkgScope = "required";
        continue;
      }
      if (currentPkgKey && indent >= 4) {
        if (/^dev:\s*true\b/i.test(trimmed)) {
          currentPkgScope = "dev";
        } else if (/^optional:\s*true\b/i.test(trimmed)) {
          currentPkgScope = "optional";
        }
      }
      continue;
    }

    if (section === "importers") {
      if (indent === 4) {
        currentImporterPkg = null;
        if (trimmed === "dependencies:") {
          importerDepScope = "required";
        } else if (trimmed === "devDependencies:") {
          importerDepScope = "dev";
        } else if (trimmed === "optionalDependencies:") {
          importerDepScope = "optional";
        } else {
          importerDepScope = null;
        }
        continue;
      }

      if (importerDepScope && indent === 6 && trimmed.endsWith(":")) {
        currentImporterPkg = trimmed.slice(0, -1).replace(/^['"]|['"]$/g, "");
        continue;
      }

      if (importerDepScope && currentImporterPkg && indent === 8) {
        const verMatch = trimmed.match(/^version:\s*['"]?([^'"\s(]+)['"]?/);
        if (verMatch?.[1]) {
          const cleanVer = cleanDeclaredVersion(verMatch[1]);
          if (cleanVer && !cleanVer.startsWith("link:") && !cleanVer.startsWith("workspace:")) {
            const id = `${currentImporterPkg}@${cleanVer}`;
            const existing = components.get(id);
            if (!existing || existing.scope === "dev") {
              components.set(
                id,
                SbomComponentSchema.parse({
                  name: currentImporterPkg,
                  version: cleanVer,
                  purl: buildNpmPurl(currentImporterPkg, cleanVer),
                  license: existing?.license ?? null,
                  scope: importerDepScope,
                })
              );
            }
          }
        }
      }
    }
  }

  flushPackageBlock();
  return Array.from(components.values());
}

function parsePackageLockJson(content: string): SbomComponent[] {
  let parsed: {
    packages?: Record<
      string,
      {
        version?: string;
        license?: string;
        dev?: boolean;
        optional?: boolean;
      }
    >;
    dependencies?: Record<
      string,
      {
        version?: string;
        dev?: boolean;
        optional?: boolean;
      }
    >;
  };
  try {
    parsed = JSON.parse(content) as typeof parsed;
  } catch {
    return [];
  }

  const components = new Map<string, SbomComponent>();

  if (parsed.packages && typeof parsed.packages === "object") {
    for (const [pkgPath, meta] of Object.entries(parsed.packages)) {
      if (!pkgPath || !meta || typeof meta.version !== "string") continue;
      const lastNmIdx = pkgPath.lastIndexOf("node_modules/");
      if (lastNmIdx === -1) continue;
      const name = pkgPath.slice(lastNmIdx + "node_modules/".length).trim();
      const version = meta.version.trim();
      if (!name || !version) continue;

      const scope: "required" | "optional" | "dev" = meta.dev
        ? "dev"
        : meta.optional
          ? "optional"
          : "required";
      const id = `${name}@${version}`;
      components.set(
        id,
        SbomComponentSchema.parse({
          name,
          version,
          purl: buildNpmPurl(name, version),
          license: typeof meta.license === "string" ? meta.license.slice(0, 120) : null,
          scope,
        })
      );
    }
  } else if (parsed.dependencies && typeof parsed.dependencies === "object") {
    for (const [name, meta] of Object.entries(parsed.dependencies)) {
      if (!name || !meta || typeof meta.version !== "string") continue;
      const version = meta.version.trim();
      const scope: "required" | "optional" | "dev" = meta.dev
        ? "dev"
        : meta.optional
          ? "optional"
          : "required";
      const id = `${name}@${version}`;
      components.set(
        id,
        SbomComponentSchema.parse({
          name,
          version,
          purl: buildNpmPurl(name, version),
          license: null,
          scope,
        })
      );
    }
  }

  return Array.from(components.values());
}

function parsePackageJsonManifest(content: string): {
  appName?: string;
  appVersion?: string;
  components: SbomComponent[];
} {
  let parsed: {
    name?: string;
    version?: string;
    dependencies?: Record<string, unknown>;
    devDependencies?: Record<string, unknown>;
    optionalDependencies?: Record<string, unknown>;
  };
  try {
    parsed = JSON.parse(content) as typeof parsed;
  } catch {
    return { components: [] };
  }

  const components: SbomComponent[] = [];
  const groups: Array<{
    entries: Record<string, unknown> | undefined;
    scope: "required" | "optional" | "dev";
  }> = [
    { entries: parsed.dependencies, scope: "required" },
    { entries: parsed.optionalDependencies, scope: "optional" },
    { entries: parsed.devDependencies, scope: "dev" },
  ];

  for (const group of groups) {
    for (const [name, rawVer] of Object.entries(group.entries ?? {})) {
      if (typeof rawVer !== "string") continue;
      const trimmed = rawVer.trim();
      if (!trimmed || trimmed.startsWith("workspace:")) continue;
      const version = cleanDeclaredVersion(trimmed);
      components.push(
        SbomComponentSchema.parse({
          name,
          version,
          purl: buildNpmPurl(name, version),
          license: null,
          scope: group.scope,
        })
      );
    }
  }

  return {
    appName: typeof parsed.name === "string" ? parsed.name : undefined,
    appVersion: typeof parsed.version === "string" ? parsed.version : undefined,
    components,
  };
}

function mergeAndSortComponents(
  lockComponents: readonly SbomComponent[],
  manifestComponents: readonly SbomComponent[]
): SbomComponent[] {
  const byNameAndVersion = new Map<string, SbomComponent>();
  const lockNames = new Set(lockComponents.map((c) => c.name));

  for (const comp of lockComponents) {
    byNameAndVersion.set(`${comp.name}@${comp.version}`, comp);
  }

  for (const comp of manifestComponents) {
    // Se já temos versão exata resolvida pelo lockfile, não duplica com versão declarada do package.json
    if (lockNames.has(comp.name)) {
      continue;
    }
    const key = `${comp.name}@${comp.version}`;
    if (!byNameAndVersion.has(key)) {
      byNameAndVersion.set(key, comp);
    }
  }

  return Array.from(byNameAndVersion.values()).sort((a, b) => {
    const nameCmp = a.name.localeCompare(b.name);
    return nameCmp !== 0 ? nameCmp : a.version.localeCompare(b.version);
  });
}

function buildCycloneDxFromComponents(params: {
  components: readonly SbomComponent[];
  generator: string;
  generatedAt: string;
  appName?: string;
  appVersion?: string;
  syftStatus: ScannerExecutionStatus | "not_requested";
}): GeneratedSbomResult {
  const sorted = [...params.components].sort((a, b) => {
    const nameCmp = a.name.localeCompare(b.name);
    return nameCmp !== 0 ? nameCmp : a.version.localeCompare(b.version);
  });

  const canonicalPayload = JSON.stringify({
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    generator: params.generator,
    appName: params.appName ?? null,
    appVersion: params.appVersion ?? null,
    components: sorted,
  });

  const sha256 = crypto
    .createHash("sha256")
    .update(canonicalPayload, "utf8")
    .digest("hex");

  const serialNumber = formatDeterministicSerialNumber(sha256);

  const document: CycloneDx15Document = {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber,
    version: 1,
    metadata: {
      timestamp: params.generatedAt,
      tools: [
        {
          vendor: "Uzina Studio",
          name: params.generator,
          version: "0.1.0",
        },
      ],
      ...(params.appName
        ? {
            component: {
              type: "application",
              name: params.appName,
              version: params.appVersion ?? "0.0.0",
            },
          }
        : {}),
    },
    components: sorted.map((c) => ({
      type: "library",
      name: c.name,
      version: c.version,
      purl: c.purl,
      scope: c.scope,
      ...(c.license
        ? { licenses: [{ license: { id: c.license } }] }
        : {}),
    })),
  };

  const summary = SbomDocumentSummarySchema.parse({
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber,
    generatedAt: params.generatedAt,
    generator: params.generator,
    totalComponents: sorted.length,
    componentsSample: sorted.slice(0, 500),
    sha256,
  });

  return {
    document,
    summary,
    syftStatus: params.syftStatus,
  };
}

function parseSyftCycloneDxStdout(stdout: string): {
  components: SbomComponent[];
  appName?: string;
  appVersion?: string;
} | null {
  if (!stdout.trim()) return null;
  let parsed: {
    bomFormat?: string;
    metadata?: { component?: { name?: string; version?: string } };
    components?: Array<{
      name?: string;
      version?: string;
      purl?: string;
      scope?: string;
      licenses?: Array<{ license?: { id?: string; name?: string } }>;
    }>;
  };
  try {
    parsed = JSON.parse(stdout) as typeof parsed;
  } catch {
    return null;
  }
  if (parsed.bomFormat !== "CycloneDX" || !Array.isArray(parsed.components)) {
    return null;
  }

  const components: SbomComponent[] = [];
  for (const item of parsed.components) {
    if (!item.name || !item.version) continue;
    const scope =
      item.scope === "dev" || item.scope === "optional"
        ? item.scope
        : "required";
    const license =
      item.licenses?.[0]?.license?.id ??
      item.licenses?.[0]?.license?.name ??
      null;
    components.push(
      SbomComponentSchema.parse({
        name: item.name.slice(0, 200),
        version: item.version.slice(0, 100),
        purl: (item.purl || buildNpmPurl(item.name, item.version)).slice(0, 300),
        license: license ? license.slice(0, 120) : null,
        scope,
      })
    );
  }

  return {
    components,
    appName: parsed.metadata?.component?.name,
    appVersion: parsed.metadata?.component?.version,
  };
}

export async function generateCycloneDxSbom(
  options: GenerateSbomOptions
): Promise<GeneratedSbomResult> {
  const safePath = assertSafeScanArg("targetPath", options.targetPath);
  const rootAbs = assertPathInsideWorkspace(safePath, ".", {
    allowRoot: true,
  });
  const generatedAt = (options.now?.() ?? new Date()).toISOString();

  let syftStatus: ScannerExecutionStatus | "not_requested" = "not_requested";
  if (options.useSyft) {
    const runner = options.commandRunner ?? defaultCommandRunner;
    const syftRes = await runner(
      "syft",
      ["scan", "-o", "cyclonedx-json", "-q", "--", rootAbs],
      {
        cwd: rootAbs,
        timeoutMs: options.timeoutMs ?? 60_000,
        signal: options.signal,
      }
    );

    if (syftRes.status === "missing_binary") {
      syftStatus = "skipped_missing_binary";
    } else if (syftRes.status === "failed" || syftRes.exitCode !== 0) {
      syftStatus = "failed";
    } else {
      const parsedSyft = parseSyftCycloneDxStdout(syftRes.stdout);
      if (parsedSyft) {
        return buildCycloneDxFromComponents({
          components: parsedSyft.components,
          generator: "syft-cyclonedx",
          generatedAt,
          appName: parsedSyft.appName,
          appVersion: parsedSyft.appVersion,
          syftStatus: "executed",
        });
      }
      syftStatus = "failed";
    }
  }

  const pkgRaw = readSafeTextFile(rootAbs, "package.json");
  const pkgParsed = pkgRaw
    ? parsePackageJsonManifest(pkgRaw)
    : { components: [] };

  const pnpmLockRaw = readSafeTextFile(rootAbs, "pnpm-lock.yaml");
  const pkgLockRaw = readSafeTextFile(rootAbs, "package-lock.json");

  const lockComponents = pnpmLockRaw
    ? parsePnpmLockYaml(pnpmLockRaw)
    : pkgLockRaw
      ? parsePackageLockJson(pkgLockRaw)
      : [];

  const merged = mergeAndSortComponents(lockComponents, pkgParsed.components);

  return buildCycloneDxFromComponents({
    components: merged,
    generator: "uzina-sbom-native",
    generatedAt,
    appName: pkgParsed.appName,
    appVersion: pkgParsed.appVersion,
    syftStatus,
  });
}
