import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SkillDefinitionSchema,
  type AgentRole,
  type SkillDefinition,
} from "@uzina/contracts";

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

export function parseSkillMarkdown(
  rawMarkdown: string,
  filePath: string
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

  return SkillDefinitionSchema.parse({
    name: scalars.name,
    description: scalars.description,
    appliesToRoles: lists.applies_to_roles ?? [],
    content,
    filePath,
  });
}

function findSkillsDirUpwards(startDir: string): string | null {
  let cursor = path.resolve(/*turbopackIgnore: true*/ startDir);
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(cursor, "packages", "skills");
    if (fs.existsSync(/*turbopackIgnore: true*/ candidate) && fs.statSync(/*turbopackIgnore: true*/ candidate).isDirectory()) {
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

  const entries = fs.readdirSync(/*turbopackIgnore: true*/ skillsDir, { withFileTypes: true });
  const loaded: SkillDefinition[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const skillPath = path.join(/*turbopackIgnore: true*/ skillsDir, entry.name, "SKILL.md");
    if (!fs.existsSync(/*turbopackIgnore: true*/ skillPath)) {
      continue;
    }
    const raw = fs.readFileSync(/*turbopackIgnore: true*/ skillPath, "utf8");
    loaded.push(parseSkillMarkdown(raw, skillPath));
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
