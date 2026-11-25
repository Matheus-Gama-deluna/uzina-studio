import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  SkillsLockManifestSchema,
  type SkillsLockEntry,
  type SkillsLockManifest,
} from "@uzina/contracts";
import { assertPathInsideWorkspace } from "./path-guard.js";
import {
  loadNativeSkills,
  resolveDefaultSkillsDir,
} from "./skills-loader.js";

export const DEFAULT_ALLOWED_SKILL_LICENSES: readonly string[] = [
  "Apache-2.0",
  "MIT",
];

const SENSITIVE_LOCK_FILE_RE =
  /(?:^|[\\/])(?:\.env(?:\.[^\\/]*)?|\.master-key|\.git(?:[\\/]|$)|[^\\/]+\.(?:pem|key))$/i;

function isIgnoredSkillEntry(nameOrRel: string): boolean {
  const trimmed = nameOrRel.trim();
  if (!trimmed || trimmed.includes("\0")) return true;
  if (SENSITIVE_LOCK_FILE_RE.test(trimmed)) return true;
  const base = path.posix.basename(trimmed.replace(/\\/g, "/")).toLowerCase();
  return (
    base === ".git" ||
    base === ".env" ||
    base.startsWith(".env.") ||
    base === ".master-key" ||
    base.endsWith(".pem") ||
    base.endsWith(".key")
  );
}

function collectSkillFilesSorted(skillRootDir: string): string[] {
  const canonicalRoot = assertPathInsideWorkspace(skillRootDir, skillRootDir, {
    allowRoot: true,
  });
  const collected: string[] = [];

  const walk = (dirAbs: string, relPrefix: string) => {
    const entries = fs.readdirSync(/*turbopackIgnore: true*/ dirAbs, {
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (isIgnoredSkillEntry(entry.name)) {
        continue;
      }
      const nextRel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      const entryAbs = path.join(/*turbopackIgnore: true*/ dirAbs, entry.name);
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(/*turbopackIgnore: true*/ entryAbs);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        if (
          nextRel === "references" ||
          nextRel === "templates" ||
          nextRel === "scripts" ||
          nextRel.startsWith("references/") ||
          nextRel.startsWith("templates/") ||
          nextRel.startsWith("scripts/")
        ) {
          walk(entryAbs, nextRel);
        }
      } else if (entry.isFile()) {
        if (
          nextRel === "SKILL.md" ||
          nextRel.startsWith("references/") ||
          nextRel.startsWith("templates/") ||
          nextRel.startsWith("scripts/")
        ) {
          collected.push(nextRel);
        }
      }
    }
  };

  walk(canonicalRoot, "");
  return collected.sort((a, b) => a.localeCompare(b));
}

export function computeSkillDirectorySha256(skillRootDir: string): string {
  const canonicalRoot = assertPathInsideWorkspace(skillRootDir, skillRootDir, {
    allowRoot: true,
  });
  const relFiles = collectSkillFilesSorted(canonicalRoot);
  if (!relFiles.includes("SKILL.md")) {
    throw new Error(
      `Diretório de skill inválido (SKILL.md ausente): ${skillRootDir}`
    );
  }

  const hash = crypto.createHash("sha256");
  for (const rel of relFiles) {
    const abs = assertPathInsideWorkspace(canonicalRoot, rel, {
      followSymlinks: false,
    });
    const normalizedText = fs
      .readFileSync(/*turbopackIgnore: true*/ abs, "utf8")
      .replace(/\r\n/g, "\n");
    hash.update(rel, "utf8");
    hash.update("\0", "utf8");
    hash.update(normalizedText, "utf8");
    hash.update("\0", "utf8");
  }
  return hash.digest("hex");
}

export interface GenerateSkillsLockOptions {
  skillsDir?: string;
  sourcePrefix?: string;
  allowedLicenses?: readonly string[];
  disabledSkills?: readonly string[];
}

export function generateSkillsLockManifest(
  options: GenerateSkillsLockOptions = {}
): SkillsLockManifest {
  const skillsDir = options.skillsDir
    ? path.resolve(/*turbopackIgnore: true*/ options.skillsDir)
    : resolveDefaultSkillsDir();
  const sourcePrefix = (options.sourcePrefix ?? "packages/skills").replace(
    /\/+$/,
    ""
  );
  const allowedLicenses = new Set(
    options.allowedLicenses ?? DEFAULT_ALLOWED_SKILL_LICENSES
  );
  const disabledSet = new Set(options.disabledSkills ?? []);

  const loaded = loadNativeSkills({ skillsDir });
  const entries: SkillsLockEntry[] = loaded.map((skill) => {
    const skillRootDir = path.dirname(/*turbopackIgnore: true*/ skill.filePath);
    const sha256 = computeSkillDirectorySha256(skillRootDir);
    const license = skill.license?.trim() || "UNLICENSED";
    const verified = allowedLicenses.has(license);
    return {
      name: skill.name,
      source: `${sourcePrefix}/${skill.name}`,
      version: skill.version?.trim() || "1.0.0",
      license,
      sha256,
      verified,
      enabled: !disabledSet.has(skill.name),
    };
  });

  return SkillsLockManifestSchema.parse({
    lockVersion: 1,
    skills: entries,
  });
}

export interface SkillsLockIssue {
  skillName: string;
  reason:
    | "sha256_mismatch"
    | "missing_on_disk"
    | "disallowed_license"
    | "unverified_entry"
    | "extra_unlocked_skill";
  detail: string;
}

export interface VerifySkillsLockOptions {
  skillsDir?: string;
  allowedLicenses?: readonly string[];
  requireAllDiskSkillsLocked?: boolean;
}

export interface VerifySkillsLockResult {
  valid: boolean;
  checkedCount: number;
  issues: SkillsLockIssue[];
}

export function verifySkillsLockManifest(
  manifest: SkillsLockManifest,
  options: VerifySkillsLockOptions = {}
): VerifySkillsLockResult {
  const parsed = SkillsLockManifestSchema.parse(manifest);
  const skillsDir = options.skillsDir
    ? path.resolve(/*turbopackIgnore: true*/ options.skillsDir)
    : resolveDefaultSkillsDir();
  const allowedLicenses = new Set(
    options.allowedLicenses ?? DEFAULT_ALLOWED_SKILL_LICENSES
  );

  const diskSkills = loadNativeSkills({ skillsDir });
  const byName = new Map(diskSkills.map((s) => [s.name, s]));
  const lockedNames = new Set<string>();
  const issues: SkillsLockIssue[] = [];

  for (const entry of parsed.skills) {
    lockedNames.add(entry.name);
    const diskSkill = byName.get(entry.name);
    if (!diskSkill) {
      issues.push({
        skillName: entry.name,
        reason: "missing_on_disk",
        detail: `Skill '${entry.name}' listada no lockfile não existe em ${skillsDir}.`,
      });
      continue;
    }

    if (!allowedLicenses.has(entry.license)) {
      issues.push({
        skillName: entry.name,
        reason: "disallowed_license",
        detail: `Licença '${entry.license}' da skill '${entry.name}' não é permitida (esperado: ${Array.from(allowedLicenses).join(", ")}).`,
      });
    }

    if (!entry.verified) {
      issues.push({
        skillName: entry.name,
        reason: "unverified_entry",
        detail: `Skill '${entry.name}' está marcada com verified=false no lockfile.`,
      });
    }

    const actualSha = computeSkillDirectorySha256(
      path.dirname(/*turbopackIgnore: true*/ diskSkill.filePath)
    );
    if (actualSha !== entry.sha256) {
      issues.push({
        skillName: entry.name,
        reason: "sha256_mismatch",
        detail: `Adulteração detectada em '${entry.name}': SHA-256 esperado ${entry.sha256}, obtido ${actualSha}.`,
      });
    }
  }

  if (options.requireAllDiskSkillsLocked) {
    for (const diskSkill of diskSkills) {
      if (!lockedNames.has(diskSkill.name)) {
        issues.push({
          skillName: diskSkill.name,
          reason: "extra_unlocked_skill",
          detail: `Skill '${diskSkill.name}' presente em disco não consta no skills-lock.json.`,
        });
      }
    }
  }

  return {
    valid: issues.length === 0,
    checkedCount: parsed.skills.length,
    issues,
  };
}

export function readSkillsLockFile(
  lockFilePath: string
): SkillsLockManifest | null {
  if (!fs.existsSync(/*turbopackIgnore: true*/ lockFilePath)) {
    return null;
  }
  const raw = fs.readFileSync(/*turbopackIgnore: true*/ lockFilePath, "utf8");
  return SkillsLockManifestSchema.parse(JSON.parse(raw));
}

export function writeSkillsLockFile(
  lockFilePath: string,
  manifest: SkillsLockManifest
): void {
  const validated = SkillsLockManifestSchema.parse(manifest);
  fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(lockFilePath), {
    recursive: true,
  });
  fs.writeFileSync(
    /*turbopackIgnore: true*/ lockFilePath,
    `${JSON.stringify(validated, null, 2)}\n`,
    "utf8"
  );
}
