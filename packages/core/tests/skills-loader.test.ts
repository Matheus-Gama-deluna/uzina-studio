import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  formatSkillsForPrompt,
  loadNativeSkills,
  parseSkillMarkdown,
} from "../src/index.js";

const EXPECTED_SKILL_NAMES = [
  "architecture-blueprint",
  "brownfield-archaeology",
  "contract-first-msw",
  "discovery-interview",
  "safe-db-migrations",
  "secure-code-audit",
  "test-quality-engineering",
  "visual-design-md",
];

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  }
});

describe("skills-loader — 8 skills nativas SKILL.md", () => {
  test("carrega e valida todas as 8 skills reais de packages/skills/", () => {
    const skills = loadNativeSkills();
    expect(skills.map((s) => s.name)).toEqual(EXPECTED_SKILL_NAMES);
    for (const skill of skills) {
      expect(skill.description.length).toBeGreaterThan(10);
      expect(skill.appliesToRoles.length).toBeGreaterThanOrEqual(1);
      expect(skill.content).toContain("#");
    }
  });

  test("filtra por papel e faz interseção quando roles e names são fornecidos", () => {
    const builderSkills = loadNativeSkills({ roles: ["builder"] });
    expect(builderSkills.map((s) => s.name)).toEqual([
      "contract-first-msw",
      "safe-db-migrations",
      "test-quality-engineering",
    ]);

    const intersected = loadNativeSkills({
      roles: ["builder"],
      names: ["contract-first-msw", "discovery-interview"],
    });
    expect(intersected.map((s) => s.name)).toEqual(["contract-first-msw"]);
  });

  test("lança erro explícito quando um nome solicitado em names ou skillsDir não existe", () => {
    expect(() =>
      loadNativeSkills({ names: ["skill-que-nao-existe"] })
    ).toThrowError(/skill-que-nao-existe/i);

    expect(() =>
      loadNativeSkills({
        skillsDir: path.join(os.tmpdir(), `uzina-missing-${Date.now()}`),
      })
    ).toThrowError(/não encontrado/i);
  });

  test("respeita variável UZINA_SKILLS_DIR para localizar skills customizadas", () => {
    const customDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-env-skills-"));
    tempDirs.push(customDir);
    const skillSubdir = path.join(customDir, "custom-env");
    fs.mkdirSync(skillSubdir, { recursive: true });
    fs.writeFileSync(
      path.join(skillSubdir, "SKILL.md"),
      "---\nname: custom-env\ndescription: Custom skill\napplies_to_roles: [builder]\n---\n\n# Env Skill",
      "utf8"
    );

    const prevEnv = process.env.UZINA_SKILLS_DIR;
    process.env.UZINA_SKILLS_DIR = customDir;
    try {
      const loaded = loadNativeSkills();
      expect(loaded.map((s) => s.name)).toEqual(["custom-env"]);
    } finally {
      if (prevEnv === undefined) delete process.env.UZINA_SKILLS_DIR;
      else process.env.UZINA_SKILLS_DIR = prevEnv;
    }
  });

  test("parseSkillMarkdown suporta CRLF, lista inline e lista YAML multilinha com dois-pontos", () => {
    const inlineRaw = [
      "---",
      "name: inline-skill",
      "description: Skill com lista inline",
      "applies_to_roles: [builder, verifier]",
      "---",
      "",
      "# Inline",
    ].join("\n");
    const parsedInline = parseSkillMarkdown(inlineRaw, "/virtual/inline/SKILL.md");
    expect(parsedInline.appliesToRoles).toEqual(["builder", "verifier"]);

    const crlfRaw =
      "---\r\n" +
      'name: "custom-skill"\r\n' +
      "description: Regra: validar tokens e sessões\r\n" +
      "applies_to_roles:\r\n" +
      "  - builder\r\n" +
      "  - verifier\r\n" +
      "---\r\n" +
      "\r\n" +
      "# Corpo da Skill\r\nConteúdo válido.";

    const parsed = parseSkillMarkdown(crlfRaw, "/virtual/custom-skill/SKILL.md");
    expect(parsed.name).toBe("custom-skill");
    expect(parsed.description).toBe("Regra: validar tokens e sessões");
    expect(parsed.appliesToRoles).toEqual(["builder", "verifier"]);
    expect(parsed.content).toContain("# Corpo da Skill");
  });

  test("parseSkillMarkdown rejeita escalares dobrados YAML não suportados (>- / |)", () => {
    const badRaw = [
      "---",
      "name: bad-skill",
      "description: >-",
      "  multilinha nao suportada",
      "applies_to_roles: [builder]",
      "---",
      "# Body",
    ].join("\n");

    expect(() =>
      parseSkillMarkdown(badRaw, "/virtual/bad-skill/SKILL.md")
    ).toThrowError(/YAML/i);
  });

  test("formatSkillsForPrompt ordena internamente lista invertida e retorna vazio para []", () => {
    expect(formatSkillsForPrompt([])).toBe("");
    const zSkill = parseSkillMarkdown(
      "---\nname: z-skill\ndescription: Desc Z\napplies_to_roles: [builder]\n---\n\n# Z Body",
      "/virtual/z/SKILL.md"
    );
    const aSkill = parseSkillMarkdown(
      "---\nname: a-skill\ndescription: Desc A\napplies_to_roles: [builder]\n---\n\n# A Body",
      "/virtual/a/SKILL.md"
    );

    const formatted = formatSkillsForPrompt([zSkill, aSkill]);
    expect(formatted.indexOf("a-skill")).toBeLessThan(
      formatted.indexOf("z-skill")
    );
    expect(formatted).toContain("<native_skills>");
  });
});
