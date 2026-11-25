import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SkillDefinitionSchema,
  type AgentRole,
  type SkillDefinition,
} from "@uzina/contracts";
import { assertPathInsideWorkspace } from "./path-guard.js";
import { redactSensitiveText } from "./redact.js";

export const SKILL_MAX_NAME_CHARS = 64;
export const SKILL_MAX_DESCRIPTION_CHARS = 1024;
export const SKILL_MAX_BODY_LINES = 500;
export const DEFAULT_SKILL_RESOURCE_MAX_BYTES = 16_384;

const ALLOWED_RESOURCE_DIRS = ["references", "templates", "scripts"] as const;
type SkillResourceDir = (typeof ALLOWED_RESOURCE_DIRS)[number];

const SENSITIVE_RESOURCE_RE =
  /(?:^|[\\/])(?:\.env(?:\.[^\\/]*)?|\.master-key|\.git(?:[\\/]|$)|[^\\/]+\.(?:pem|key))$/i;

function isSensitiveSkillFile(filePathOrName: string): boolean {
  const trimmed = filePathOrName.trim();
  if (!trimmed || trimmed.includes("\0")) return true;
  const normalizedSlashes = trimmed.replace(/\\/g, "/");
  const segments = normalizedSlashes
    .split("/")
    .map((s) => s.replace(/[. ]+$/, "").toLowerCase())
    .filter(Boolean);
  if (
    segments.some(
      (seg) =>
        seg === ".git" ||
        seg === ".env" ||
        seg.startsWith(".env.") ||
        seg === ".master-key"
    )
  ) {
    return true;
  }
  if (SENSITIVE_RESOURCE_RE.test(trimmed)) return true;
  const base = segments[segments.length - 1] ?? "";
  return (
    base === ".env" ||
    base.startsWith(".env.") ||
    base === ".master-key" ||
    base.endsWith(".pem") ||
    base.endsWith(".key")
  );
}

function unquoteYamlScalar(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseYamlListInline(raw: string): string[] {
  const inner = raw.trim().slice(1, -1).trim();
  if (!inner) {
    return [];
  }
  return inner
    .split(",")
    .map((item) => unquoteYamlScalar(item))
    .filter(Boolean);
}

function listSkillSubdirFiles(
  skillRootDir: string,
  subdir: SkillResourceDir
): string[] {
  const subPath = path.join(/*turbopackIgnore: true*/ skillRootDir, subdir);
  if (!fs.existsSync(/*turbopackIgnore: true*/ subPath)) {
    return [];
  }
  let rootStat: fs.Stats;
  try {
    rootStat = fs.lstatSync(/*turbopackIgnore: true*/ subPath);
  } catch {
    return [];
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    return [];
  }

  const collected: string[] = [];
  const walk = (currentAbs: string, relPrefix: string) => {
    const entries = fs.readdirSync(/*turbopackIgnore: true*/ currentAbs, {
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (isSensitiveSkillFile(entry.name)) {
        continue;
      }
      const entryAbs = path.join(/*turbopackIgnore: true*/ currentAbs, entry.name);
      try {
        const st = fs.lstatSync(/*turbopackIgnore: true*/ entryAbs);
        if (st.isSymbolicLink()) continue;
      } catch {
        continue;
      }
      const nextRel = `${relPrefix}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(entryAbs, nextRel);
      } else if (entry.isFile()) {
        collected.push(nextRel);
      }
    }
  };

  walk(subPath, subdir);
  return collected.sort((a, b) => a.localeCompare(b));
}

export interface ParseSkillMarkdownOptions {
  strictBudgets?: boolean;
  skillRootDir?: string;
}

export function parseSkillMarkdown(
  rawMarkdown: string,
  filePath: string,
  options: ParseSkillMarkdownOptions = {}
): SkillDefinition {
  const normalized = rawMarkdown.replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(normalized);
  if (!match) {
    throw new Error(
      `SKILL.md inválido em ${filePath}: frontmatter YAML ausente ou malformado.`
    );
  }

  const frontmatterRaw = match[1] ?? "";
  const content = (match[2] ?? "").trim();

  const scalars: Record<string, string> = {};
  const lists: Record<string, string[]> = {};
  let activeListKey: string | null = null;

  for (const rawLine of frontmatterRaw.split("\n")) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    if (trimmed.startsWith("- ") && activeListKey) {
      const value = unquoteYamlScalar(trimmed.slice(2));
      if (value) {
        lists[activeListKey]?.push(value);
      }
      continue;
    }

    activeListKey = null;
    const colonIdx = rawLine.indexOf(":");
    if (colonIdx === -1) {
      throw new Error(
        `Sintaxe YAML inválida em ${filePath}: linha sem chave '${rawLine}'.`
      );
    }

    const key = rawLine.slice(0, colonIdx).trim();
    const rawValue = rawLine.slice(colonIdx + 1).trim();

    if (
      rawValue === ">-" ||
      rawValue === ">" ||
      rawValue === "|-" ||
      rawValue === "|"
    ) {
      throw new Error(
        `Sintaxe YAML multilinha '${rawValue}' não suportada no frontmatter de ${filePath}.`
      );
    }

    if (rawValue === "") {
      lists[key] = [];
      activeListKey = key;
      continue;
    }

    if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
      lists[key] = parseYamlListInline(rawValue);
      continue;
    }

    scalars[key] = unquoteYamlScalar(rawValue);
  }

  const nameStr = scalars.name ?? "";
  const descriptionStr = scalars.description ?? "";
  const bodyLines = content ? content.split("\n").length : 0;
  const withinBudgets =
    nameStr.length <= SKILL_MAX_NAME_CHARS &&
    descriptionStr.length <= SKILL_MAX_DESCRIPTION_CHARS &&
    bodyLines < SKILL_MAX_BODY_LINES;

  if (options.strictBudgets && !withinBudgets) {
    if (nameStr.length > SKILL_MAX_NAME_CHARS) {
      throw new Error(
        `Skill '${nameStr}' excede orçamento de name (${nameStr.length} > ${SKILL_MAX_NAME_CHARS} chars).`
      );
    }
    if (descriptionStr.length > SKILL_MAX_DESCRIPTION_CHARS) {
      throw new Error(
        `Skill '${nameStr}' excede orçamento de description (${descriptionStr.length} > ${SKILL_MAX_DESCRIPTION_CHARS} chars).`
      );
    }
    throw new Error(
      `Skill '${nameStr}' excede orçamento de linhas no corpo (${bodyLines} >= ${SKILL_MAX_BODY_LINES} linhas).`
    );
  }

  const resolvedRoot =
    options.skillRootDir ??
    (filePath && !filePath.startsWith("/virtual/")
      ? path.dirname(/*turbopackIgnore: true*/ filePath)
      : undefined);

  const hasDiskRoot =
    typeof resolvedRoot === "string" &&
    fs.existsSync(/*turbopackIgnore: true*/ resolvedRoot);

  const references = hasDiskRoot
    ? listSkillSubdirFiles(resolvedRoot, "references")
    : [];
  const templates = hasDiskRoot
    ? listSkillSubdirFiles(resolvedRoot, "templates")
    : [];
  const scripts = hasDiskRoot
    ? listSkillSubdirFiles(resolvedRoot, "scripts")
    : [];

  return SkillDefinitionSchema.parse({
    name: scalars.name,
    description: scalars.description,
    appliesToRoles: lists.applies_to_roles ?? [],
    content,
    filePath,
    ...(scalars.version ? { version: scalars.version } : {}),
    ...(scalars.license ? { license: scalars.license } : {}),
    ...(scalars.phase ? { phase: scalars.phase } : {}),
    ...(scalars.role_category ? { roleCategory: scalars.role_category } : {}),
    ...(scalars.iron_law ? { ironLaw: scalars.iron_law } : {}),
    references,
    templates,
    scripts,
    budgets: {
      nameLength: nameStr.length,
      descriptionLength: descriptionStr.length,
      bodyLines,
      withinBudgets,
    },
  });
}

function findSkillsDirUpwards(startDir: string): string | null {
  let cursor = path.resolve(/*turbopackIgnore: true*/ startDir);
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(cursor, "packages", "skills");
    if (
      fs.existsSync(/*turbopackIgnore: true*/ candidate) &&
      fs.statSync(/*turbopackIgnore: true*/ candidate).isDirectory()
    ) {
      return candidate;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }
  return null;
}

export function resolveDefaultSkillsDir(): string {
  const envDir = process.env.UZINA_SKILLS_DIR?.trim();
  if (envDir && fs.existsSync(/*turbopackIgnore: true*/ envDir)) {
    return path.resolve(/*turbopackIgnore: true*/ envDir);
  }

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const fromModule = findSkillsDirUpwards(moduleDir);
  if (fromModule) {
    return fromModule;
  }

  const fromCwd = findSkillsDirUpwards(process.cwd());
  if (fromCwd) {
    return fromCwd;
  }

  throw new Error(
    "Diretório packages/skills não localizado a partir do módulo nem do cwd."
  );
}

export interface LoadNativeSkillsOptions {
  skillsDir?: string;
  roles?: AgentRole[];
  names?: string[];
  strictBudgets?: boolean;
}

export function loadNativeSkills(
  options: LoadNativeSkillsOptions = {}
): SkillDefinition[] {
  const skillsDir = options.skillsDir
    ? path.resolve(/*turbopackIgnore: true*/ options.skillsDir)
    : resolveDefaultSkillsDir();

  if (!fs.existsSync(/*turbopackIgnore: true*/ skillsDir)) {
    throw new Error(`Diretório de skills não encontrado: ${skillsDir}`);
  }

  const entries = fs.readdirSync(/*turbopackIgnore: true*/ skillsDir, {
    withFileTypes: true,
  });
  const loaded: SkillDefinition[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const skillRootDir = path.join(
      /*turbopackIgnore: true*/ skillsDir,
      entry.name
    );
    try {
      if (fs.lstatSync(/*turbopackIgnore: true*/ skillRootDir).isSymbolicLink()) {
        continue;
      }
    } catch {
      continue;
    }
    const skillPath = path.join(
      /*turbopackIgnore: true*/ skillRootDir,
      "SKILL.md"
    );
    if (!fs.existsSync(/*turbopackIgnore: true*/ skillPath)) {
      continue;
    }
    try {
      const skillStat = fs.lstatSync(/*turbopackIgnore: true*/ skillPath);
      if (skillStat.isSymbolicLink() || !skillStat.isFile()) {
        continue;
      }
    } catch {
      continue;
    }
    const raw = fs.readFileSync(/*turbopackIgnore: true*/ skillPath, "utf8");
    loaded.push(
      parseSkillMarkdown(raw, skillPath, {
        strictBudgets: options.strictBudgets,
        skillRootDir,
      })
    );
  }

  loaded.sort((a, b) => a.name.localeCompare(b.name));

  let result = loaded;

  if (options.names !== undefined) {
    const byName = new Map(loaded.map((skill) => [skill.name, skill]));
    for (const requestedName of options.names) {
      if (!byName.has(requestedName)) {
        throw new Error(
          `Skill nativa solicitada não encontrada: '${requestedName}'.`
        );
      }
    }
    const allowedNames = new Set(options.names);
    result = result.filter((skill) => allowedNames.has(skill.name));
  }

  if (options.roles !== undefined && options.roles.length > 0) {
    const wantedRoles = new Set(options.roles);
    result = result.filter((skill) =>
      skill.appliesToRoles.some((role) => wantedRoles.has(role))
    );
  }

  return result;
}

export interface LoadSkillResourceParams {
  skillName: string;
  resourcePath: string;
  skillsDir?: string;
  maxBytes?: number;
  knownSecrets?: readonly string[];
}

export interface LoadedSkillResource {
  skillName: string;
  resourcePath: string;
  content: string;
  truncated: boolean;
}

export function loadSkillResource(
  params: LoadSkillResourceParams
): LoadedSkillResource {
  const normalizedRel = params.resourcePath
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");

  if (
    !normalizedRel ||
    normalizedRel.includes("\0") ||
    path.isAbsolute(params.resourcePath) ||
    /^[a-zA-Z]:/.test(normalizedRel) ||
    normalizedRel.includes("..")
  ) {
    throw new Error(
      `Caminho de recurso inválido para skill '${params.skillName}'.`
    );
  }

  const allowedPrefix = ALLOWED_RESOURCE_DIRS.some((dir) =>
    normalizedRel.startsWith(`${dir}/`)
  );
  if (!allowedPrefix || isSensitiveSkillFile(normalizedRel)) {
    throw new Error(
      `Recurso '${normalizedRel}' fora de references/, templates/ ou scripts/, ou marcado como sensível.`
    );
  }

  const skills = loadNativeSkills({
    skillsDir: params.skillsDir,
    names: [params.skillName],
  });
  const targetSkill = skills[0];
  if (!targetSkill) {
    throw new Error(`Skill '${params.skillName}' não encontrada.`);
  }

  const skillRootDir = path.dirname(/*turbopackIgnore: true*/ targetSkill.filePath);
  const absTarget = assertPathInsideWorkspace(skillRootDir, normalizedRel, {
    followSymlinks: true,
  });

  if (!fs.existsSync(/*turbopackIgnore: true*/ absTarget)) {
    throw new Error(
      `Recurso '${normalizedRel}' não encontrado na skill '${params.skillName}'.`
    );
  }
  const st = fs.lstatSync(/*turbopackIgnore: true*/ absTarget);
  if (st.isSymbolicLink() || !st.isFile()) {
    throw new Error(
      `Recurso '${normalizedRel}' inválido (symlink ou não é arquivo regular).`
    );
  }

  const raw = fs.readFileSync(/*turbopackIgnore: true*/ absTarget, "utf8");
  const redacted = redactSensitiveText(raw, params.knownSecrets);
  const maxBytes = Math.max(256, params.maxBytes ?? DEFAULT_SKILL_RESOURCE_MAX_BYTES);
  const buf = Buffer.from(redacted, "utf8");
  if (buf.byteLength > maxBytes) {
    return {
      skillName: params.skillName,
      resourcePath: normalizedRel,
      content: `${buf.subarray(0, maxBytes).toString("utf8")}\n// ... [recurso truncado por maxBytes]`,
      truncated: true,
    };
  }

  return {
    skillName: params.skillName,
    resourcePath: normalizedRel,
    content: redacted,
    truncated: false,
  };
}

export function selectNonConflictingSkillsForStage(
  skills: readonly SkillDefinition[],
  options: {
    preferredLeadName?: string;
    includeCritique?: boolean;
  } = {}
): SkillDefinition[] {
  const ordered = [...skills].sort((a, b) => a.name.localeCompare(b.name));
  const leads = ordered.filter((s) => s.roleCategory === "lead");
  const references = ordered.filter((s) => s.roleCategory === "reference");
  const critiques = options.includeCritique
    ? ordered.filter((s) => s.roleCategory === "critique")
    : [];

  let chosenLead: SkillDefinition | undefined;
  if (leads.length > 0) {
    chosenLead = options.preferredLeadName
      ? (leads.find((s) => s.name === options.preferredLeadName) ?? leads[0])
      : leads[0];
  }

  return [
    ...(chosenLead ? [chosenLead] : []),
    ...references,
    ...critiques,
  ].sort((a, b) => a.name.localeCompare(b.name));
}

export function formatSkillsForPrompt(
  skills: readonly SkillDefinition[]
): string {
  if (skills.length === 0) {
    return "";
  }
  const ordered = [...skills].sort((a, b) => a.name.localeCompare(b.name));
  const blocks = ordered.map(
    (skill) =>
      `<skill name="${skill.name}" roles="${skill.appliesToRoles.join(",")}">\n${skill.content}\n</skill>`
  );
  return `<native_skills>\n${blocks.join("\n\n")}\n</native_skills>`;
}
