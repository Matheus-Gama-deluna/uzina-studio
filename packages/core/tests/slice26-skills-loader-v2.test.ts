import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SkillDefinition } from "@uzina/contracts";
import { afterEach, describe, expect, test } from "vitest";
import {
  SKILL_MAX_BODY_LINES,
  SKILL_MAX_DESCRIPTION_CHARS,
  SKILL_MAX_NAME_CHARS,
  loadNativeSkills,
  loadSkillResource,
  parseSkillMarkdown,
  selectNonConflictingSkillsForStage,
} from "../src/index.js";

const tempDirs: string[] = [];

function createTempSkillsRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-s26-skills-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
    }
  }
});

describe("slice 26 — skills-loader v2 (agentskills.io Progressive Disclosure)", () => {
  test("descobre metadados v2, subpastas references/templates/scripts e calcula budgets", () => {
    const root = createTempSkillsRoot();
    const skillDir = path.join(root, "secure-audit-v2");
    fs.mkdirSync(path.join(skillDir, "references", ".git"), { recursive: true });
    fs.mkdirSync(path.join(skillDir, "templates"), { recursive: true });
    fs.mkdirSync(path.join(skillDir, "scripts"), { recursive: true });

    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: secure-audit-v2",
        "description: Use quando precisar auditar achados SARIF com triagem contextual.",
        "applies_to_roles: [security, verifier]",
        "version: 2.0.0",
        "license: Apache-2.0",
        "phase: verify",
        "role_category: critique",
        "iron_law: Nunca classifique sem ler source e sink.",
        "---",
        "",
        "# Secure Audit v2",
        "Instruções principais.",
        "Fim do bloco.",
      ].join("\n"),
      "utf8"
    );
    fs.writeFileSync(
      path.join(skillDir, "references", "sarif-guide.md"),
      "# SARIF Guide\nDetalhe técnico.\n",
      "utf8"
    );
    fs.writeFileSync(
      path.join(skillDir, "references", ".env"),
      "SECRET=should_be_ignored\n",
      "utf8"
    );
    fs.writeFileSync(
      path.join(skillDir, "references", ".git", "config"),
      "[core]\nrepositoryformatversion = 0\n",
      "utf8"
    );
    fs.writeFileSync(
      path.join(skillDir, "templates", "report.md"),
      "## Veredito\n",
      "utf8"
    );
    fs.writeFileSync(
      path.join(skillDir, "scripts", "check.mjs"),
      "console.log('ok');\n",
      "utf8"
    );

    const loaded = loadNativeSkills({ skillsDir: root });
    expect(loaded).toHaveLength(1);
    const skill = loaded[0]!;
    expect(skill.version).toBe("2.0.0");
    expect(skill.license).toBe("Apache-2.0");
    expect(skill.phase).toBe("verify");
    expect(skill.roleCategory).toBe("critique");
    expect(skill.ironLaw).toBe("Nunca classifique sem ler source e sink.");
    expect(skill.references).toEqual(["references/sarif-guide.md"]);
    expect(skill.templates).toEqual(["templates/report.md"]);
    expect(skill.scripts).toEqual(["scripts/check.mjs"]);
    expect(skill.budgets).toEqual({
      nameLength: "secure-audit-v2".length,
      descriptionLength:
        "Use quando precisar auditar achados SARIF com triagem contextual."
          .length,
      bodyLines: 3,
      withinBudgets: true,
    });
  });

  test.each([
    {
      label: "nome acima de 64 chars",
      name: "a".repeat(SKILL_MAX_NAME_CHARS + 1),
      description: "Descrição válida.",
      lines: 3,
      errorRegex: /name|64/i,
    },
    {
      label: "descrição acima de 1024 chars",
      name: "valid-skill-name",
      description: "d".repeat(SKILL_MAX_DESCRIPTION_CHARS + 1),
      lines: 3,
      errorRegex: /description|1024/i,
    },
    {
      label: "corpo com 500 ou mais linhas",
      name: "valid-skill-name",
      description: "Descrição válida.",
      lines: SKILL_MAX_BODY_LINES,
      errorRegex: /500|linhas/i,
    },
  ])(
    "rejeita skill fora do orçamento quando strictBudgets=true ($label)",
    ({ name, description, lines, errorRegex }) => {
      const body = Array.from({ length: lines }, (_, i) => `Linha ${i + 1}`).join(
        "\n"
      );
      const raw = [
        "---",
        `name: ${name}`,
        `description: ${description}`,
        "applies_to_roles: [builder]",
        "---",
        "",
        body,
      ].join("\n");

      const parsedNonStrict = parseSkillMarkdown(raw, "/virtual/SKILL.md");
      expect(parsedNonStrict.budgets?.withinBudgets).toBe(false);

      expect(() =>
        parseSkillMarkdown(raw, "/virtual/SKILL.md", { strictBudgets: true })
      ).toThrowError(errorRegex);
    }
  );

  test("loadSkillResource carrega recurso válido (POSIX e Windows), redige knownSecrets e trunca em maxBytes", () => {
    const root = createTempSkillsRoot();
    const skillDir = path.join(root, "design-contract");
    fs.mkdirSync(path.join(skillDir, "references"), { recursive: true });

    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: design-contract\ndescription: Design tokens\napplies_to_roles: [visual]\n---\n\n# Design",
      "utf8"
    );
    fs.writeFileSync(
      path.join(skillDir, "references", "checklist.md"),
      `Contraste 4.5:1\nToken vazado: sk-secret-1234567890abcdef123456\nCustom: custom-secret-token-xyz\n${"x".repeat(400)}`,
      "utf8"
    );

    const resPosix = loadSkillResource({
      skillName: "design-contract",
      resourcePath: "references/checklist.md",
      skillsDir: root,
      knownSecrets: ["custom-secret-token-xyz"],
    });
    expect(resPosix.skillName).toBe("design-contract");
    expect(resPosix.resourcePath).toBe("references/checklist.md");
    expect(resPosix.content).toContain("Contraste 4.5:1");
    expect(resPosix.content).not.toContain("sk-secret-1234567890abcdef123456");
    expect(resPosix.content).not.toContain("custom-secret-token-xyz");
    expect(resPosix.truncated).toBe(false);

    const resWindows = loadSkillResource({
      skillName: "design-contract",
      resourcePath: "references\\checklist.md",
      skillsDir: root,
      maxBytes: 256,
    });
    expect(resWindows.resourcePath).toBe("references/checklist.md");
    expect(resWindows.truncated).toBe(true);
    expect(resWindows.content).toContain("[recurso truncado por maxBytes]");
  });

  test.each([
    {
      label: "path traversal POSIX",
      badPath: "../design-contract/SKILL.md",
      errorRegex: /inválido|fora/i,
    },
    {
      label: "path traversal interno",
      badPath: "references/../../secret.txt",
      errorRegex: /inválido/i,
    },
    {
      label: "path traversal Windows",
      badPath: "references\\..\\secret.txt",
      errorRegex: /inválido/i,
    },
    {
      label: "drive Windows absoluto",
      badPath: "C:\\secret.txt",
      errorRegex: /inválido/i,
    },
    {
      label: "pasta não permitida",
      badPath: "other/forbidden.txt",
      errorRegex: /fora de references/i,
    },
    {
      label: "arquivo .env.local",
      badPath: "references/.env.local",
      errorRegex: /sensível/i,
    },
    {
      label: "arquivo .git/config",
      badPath: "references/.git/config",
      errorRegex: /sensível/i,
    },
    {
      label: "arquivo .master-key com trailing dot NTFS",
      badPath: "references/.master-key.",
      errorRegex: /sensível/i,
    },
    {
      label: "null-byte",
      badPath: "references/file\0.md",
      errorRegex: /inválido/i,
    },
  ])(
    "loadSkillResource bloqueia entrada insegura ($label)",
    ({ badPath, errorRegex }) => {
      const root = createTempSkillsRoot();
      const skillDir = path.join(root, "design-contract");
      fs.mkdirSync(path.join(skillDir, "references"), { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, "SKILL.md"),
        "---\nname: design-contract\ndescription: Design tokens\napplies_to_roles: [visual]\n---\n\n# Design",
        "utf8"
      );

      expect(() =>
        loadSkillResource({
          skillName: "design-contract",
          resourcePath: badPath,
          skillsDir: root,
        })
      ).toThrowError(errorRegex);
    }
  );

  test("bloqueia directory junction / symlink escapando de skillRootDir em loadSkillResource e listSkillSubdirFiles", () => {
    const root = createTempSkillsRoot();
    const outsideDir = createTempSkillsRoot();
    fs.writeFileSync(
      path.join(outsideDir, "outside-secret.md"),
      "Segredo externo",
      "utf8"
    );

    const skillDir = path.join(root, "sym-skill");
    fs.mkdirSync(path.join(skillDir, "references"), { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: sym-skill\ndescription: Skill symlink test\napplies_to_roles: [builder]\n---\n\n# Sym",
      "utf8"
    );

    const junctionPath = path.join(skillDir, "references", "linked-out");
    fs.symlinkSync(outsideDir, junctionPath, "junction");

    const loaded = loadNativeSkills({ skillsDir: root });
    expect(loaded[0]!.references).toEqual([]);

    expect(() =>
      loadSkillResource({
        skillName: "sym-skill",
        resourcePath: "references/linked-out/outside-secret.md",
        skillsDir: root,
      })
    ).toThrowError(/escapa dos limites do workspace|fora do workspace/i);
  });

  test.each([
    {
      label: "mantém apenas 1 lead (o primeiro alfabético) e omite critique por padrão",
      preferredLeadName: undefined,
      includeCritique: false,
      expectedNames: ["lead-alpha", "ref-one"],
    },
    {
      label: "prioriza preferredLeadName quando informado",
      preferredLeadName: "lead-beta",
      includeCritique: false,
      expectedNames: ["lead-beta", "ref-one"],
    },
    {
      label: "inclui critique apenas quando includeCritique=true",
      preferredLeadName: "lead-alpha",
      includeCritique: true,
      expectedNames: ["critique-a11y", "lead-alpha", "ref-one"],
    },
  ])(
    "selectNonConflictingSkillsForStage evita conflito de múltiplas skills Lead ($label)",
    ({ preferredLeadName, includeCritique, expectedNames }) => {
      const mk = (
        name: string,
        roleCategory: "lead" | "reference" | "critique"
      ): SkillDefinition => ({
        name,
        description: `Desc ${name}`,
        appliesToRoles: ["architect"],
        content: `# ${name}`,
        filePath: `/skills/${name}/SKILL.md`,
        roleCategory,
        references: [],
        templates: [],
        scripts: [],
      });

      const input = [
        mk("lead-beta", "lead"),
        mk("lead-alpha", "lead"),
        mk("ref-one", "reference"),
        mk("critique-a11y", "critique"),
      ];

      const selected = selectNonConflictingSkillsForStage(input, {
        preferredLeadName,
        includeCritique,
      });
      expect(selected.map((s) => s.name)).toEqual(expectedNames);
    }
  );
});
