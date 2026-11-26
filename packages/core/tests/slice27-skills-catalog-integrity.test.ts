import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  AgentRole,
  SkillLifecyclePhase,
  SkillRoleCategory,
} from "@uzina/contracts";
import { afterEach, describe, expect, test } from "vitest";
import {
  SKILL_MAX_BODY_LINES,
  SKILL_MAX_DESCRIPTION_CHARS,
  SKILL_MAX_NAME_CHARS,
  loadNativeSkills,
  loadSkillResource,
  resolveDefaultSkillsDir,
  selectNonConflictingSkillsForStage,
} from "../src/index.js";

interface ExpectedSkillSpec {
  name: string;
  phase: SkillLifecyclePhase;
  roleCategory: SkillRoleCategory;
  expectedRoles: AgentRole[];
  resourceKind: "references" | "templates" | "scripts";
  resourcePath: string;
}

const CATALOG_SPEC: readonly ExpectedSkillSpec[] = [
  {
    name: "discovery-interview",
    phase: "discovery",
    roleCategory: "lead",
    expectedRoles: ["discovery", "copilot"],
    resourceKind: "templates",
    resourcePath: "templates/shape-spec-template.md",
  },
  {
    name: "brownfield-archaeology",
    phase: "discovery",
    roleCategory: "lead",
    expectedRoles: ["architect", "discovery"],
    resourceKind: "references",
    resourcePath: "references/maturity-scorecard-rubric.md",
  },
  {
    name: "architecture-blueprint",
    phase: "architecture",
    roleCategory: "lead",
    expectedRoles: ["architect"],
    resourceKind: "templates",
    resourcePath: "templates/adr-rfc-template.md",
  },
  {
    name: "visual-design-md",
    phase: "visual",
    roleCategory: "lead",
    expectedRoles: ["visual", "architect"],
    resourceKind: "references",
    resourcePath: "references/tokens-wcag-checklist.md",
  },
  {
    name: "contract-first-msw",
    phase: "build",
    roleCategory: "reference",
    expectedRoles: ["builder", "architect"],
    resourceKind: "templates",
    resourcePath: "templates/contract-drift-test.md",
  },
  {
    name: "test-quality-engineering",
    phase: "verify",
    roleCategory: "reference",
    expectedRoles: ["builder", "verifier"],
    resourceKind: "references",
    resourcePath: "references/bva-anti-patterns.md",
  },
  {
    name: "safe-db-migrations",
    phase: "build",
    roleCategory: "reference",
    expectedRoles: ["builder", "architect", "verifier"],
    resourceKind: "scripts",
    resourcePath: "scripts/check-migration-ddl.mjs",
  },
  {
    name: "secure-code-audit",
    phase: "verify",
    roleCategory: "critique",
    expectedRoles: ["security", "verifier"],
    resourceKind: "references",
    resourcePath: "references/sarif-triage-guide.md",
  },
  {
    name: "domain-event-storming-bdd",
    phase: "discovery",
    roleCategory: "reference",
    expectedRoles: ["discovery"],
    resourceKind: "templates",
    resourcePath: "templates/bdd-rbac-matrix.md",
  },
  {
    name: "openspec-brownfield-delta",
    phase: "architecture",
    roleCategory: "lead",
    expectedRoles: ["discovery", "architect", "copilot"],
    resourceKind: "templates",
    resourcePath: "templates/delta-spec-template.md",
  },
  {
    name: "threat-modeling-stride-fmea",
    phase: "architecture",
    roleCategory: "reference",
    expectedRoles: ["architect", "security"],
    resourceKind: "references",
    resourcePath: "references/stride-fmea-matrix.md",
  },
  {
    name: "ui-design-critique-a11y",
    phase: "visual",
    roleCategory: "critique",
    expectedRoles: ["visual", "verifier"],
    resourceKind: "references",
    resourcePath: "references/nielsen-wcag-5states.md",
  },
  {
    name: "systematic-debugging-3-strikes",
    phase: "build",
    roleCategory: "lead",
    expectedRoles: ["builder"],
    resourceKind: "references",
    resourcePath: "references/scientific-debug-protocol.md",
  },
  {
    name: "property-based-and-mutation-qa",
    phase: "verify",
    roleCategory: "reference",
    expectedRoles: ["builder", "verifier"],
    resourceKind: "templates",
    resourcePath: "templates/fast-check-zod.md",
  },
  {
    name: "differential-appsec-sharp-edges",
    phase: "verify",
    roleCategory: "critique",
    expectedRoles: ["security", "verifier"],
    resourceKind: "references",
    resourcePath: "references/sharp-edges-checklist.md",
  },
  {
    name: "release-briefing-and-retro",
    phase: "release",
    roleCategory: "lead",
    expectedRoles: ["verifier", "copilot"],
    resourceKind: "templates",
    resourcePath: "templates/pr-risk-briefing.md",
  },
];

const tempDirs: string[] = [];

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

describe("slice 27 — integridade do catálogo de 16 skills v2", () => {
  test("catálogo completo contém exatamente as 16 skills esperadas com strictBudgets=true", () => {
    const skills = loadNativeSkills({ strictBudgets: true });
    expect(skills).toHaveLength(16);
    const loadedNames = skills.map((s) => s.name);
    const expectedSorted = CATALOG_SPEC.map((s) => s.name).sort((a, b) =>
      a.localeCompare(b)
    );
    expect(loadedNames).toEqual(expectedSorted);
  });

  test.each(CATALOG_SPEC)(
    "valida metadados v2, orçamento, seções obrigatórias e recurso em disco de $name",
    (spec) => {
      const skillsDir = resolveDefaultSkillsDir();
      const loaded = loadNativeSkills({
        skillsDir,
        names: [spec.name],
        strictBudgets: true,
      });
      expect(loaded).toHaveLength(1);

      const skill = loaded[0]!;
      expect(skill.name).toBe(spec.name);
      expect(skill.license).toBe("Apache-2.0");
      expect(skill.version).toBe("2.0.0");
      expect(skill.phase).toBe(spec.phase);
      expect(skill.roleCategory).toBe(spec.roleCategory);
      expect(skill.appliesToRoles).toEqual(spec.expectedRoles);
      expect(skill.description.startsWith("Use quando")).toBe(true);
      expect(skill.ironLaw?.length ?? 0).toBeGreaterThan(15);

      expect(skill.budgets?.withinBudgets).toBe(true);
      expect(skill.budgets?.nameLength ?? 999).toBeLessThanOrEqual(
        SKILL_MAX_NAME_CHARS
      );
      expect(skill.budgets?.descriptionLength ?? 9999).toBeLessThanOrEqual(
        SKILL_MAX_DESCRIPTION_CHARS
      );
      expect(skill.budgets?.bodyLines ?? 999).toBeLessThan(SKILL_MAX_BODY_LINES);

      expect(skill.content).toContain("## Iron Law");
      expect(skill.content).toContain("## Entry Gate & Exit Artifact");
      expect(skill.content).toContain("## Protocolo");
      expect(skill.content).toContain("Step 0");
      expect(skill.content).toContain("## Red Flags (Anti-Racionalização)");
      expect(skill.content).toContain("## Ponteiros Progressivos");
      expect(skill.content).toContain(spec.resourcePath);

      const absResource = path.join(
        path.dirname(skill.filePath),
        spec.resourcePath
      );
      expect(fs.existsSync(absResource)).toBe(true);
      expect(skill[spec.resourceKind]).toContain(spec.resourcePath);

      const loadedResource = loadSkillResource({
        skillName: spec.name,
        resourcePath: spec.resourcePath,
        skillsDir,
      });
      expect(loadedResource.resourcePath).toBe(spec.resourcePath);
      expect(loadedResource.content.trim().length).toBeGreaterThan(40);
    }
  );

  test.each<{
    phase: SkillLifecyclePhase;
    preferredLeadName?: string;
    includeCritique: boolean;
    expectedLeadName: string | null;
    expectedCritiques: string[];
  }>([
    {
      phase: "discovery",
      preferredLeadName: "discovery-interview",
      includeCritique: false,
      expectedLeadName: "discovery-interview",
      expectedCritiques: [],
    },
    {
      phase: "discovery",
      preferredLeadName: "brownfield-archaeology",
      includeCritique: false,
      expectedLeadName: "brownfield-archaeology",
      expectedCritiques: [],
    },
    {
      phase: "architecture",
      preferredLeadName: "architecture-blueprint",
      includeCritique: false,
      expectedLeadName: "architecture-blueprint",
      expectedCritiques: [],
    },
    {
      phase: "architecture",
      preferredLeadName: "openspec-brownfield-delta",
      includeCritique: false,
      expectedLeadName: "openspec-brownfield-delta",
      expectedCritiques: [],
    },
    {
      phase: "visual",
      includeCritique: true,
      expectedLeadName: "visual-design-md",
      expectedCritiques: ["ui-design-critique-a11y"],
    },
    {
      phase: "build",
      includeCritique: false,
      expectedLeadName: "systematic-debugging-3-strikes",
      expectedCritiques: [],
    },
    {
      phase: "verify",
      includeCritique: true,
      expectedLeadName: null,
      expectedCritiques: [
        "differential-appsec-sharp-edges",
        "secure-code-audit",
      ],
    },
    {
      phase: "release",
      includeCritique: false,
      expectedLeadName: "release-briefing-and-retro",
      expectedCritiques: [],
    },
  ])(
    "selectNonConflictingSkillsForStage mantém no máximo 1 lead por fase ($phase / $preferredLeadName)",
    ({
      phase,
      preferredLeadName,
      includeCritique,
      expectedLeadName,
      expectedCritiques,
    }) => {
      const allSkills = loadNativeSkills({ strictBudgets: true });
      const stageSkills = allSkills.filter((s) => s.phase === phase);
      const selected = selectNonConflictingSkillsForStage(stageSkills, {
        preferredLeadName,
        includeCritique,
      });

      const selectedLeads = selected.filter((s) => s.roleCategory === "lead");
      expect(selectedLeads.length).toBeLessThanOrEqual(1);
      expect(selectedLeads[0]?.name ?? null).toBe(expectedLeadName);

      const selectedCritiques = selected
        .filter((s) => s.roleCategory === "critique")
        .map((s) => s.name);
      expect(selectedCritiques).toEqual(expectedCritiques);
    }
  );

  test.each([
    {
      label: "DDL seguro aditivo com CONCURRENTLY",
      sql: [
        "ALTER TABLE deliverables ADD COLUMN appetite TEXT DEFAULT 'small_1_slice';",
        "CREATE INDEX CONCURRENTLY idx_deliverables_org ON deliverables (organization_id);",
      ].join("\n"),
      expectedExitCode: 0,
      expectedOk: true,
      expectedRuleIds: [] as string[],
    },
    {
      label: "DDL destrutivo (DROP TABLE e NOT NULL sem DEFAULT)",
      sql: [
        "DROP TABLE legacy_logs;",
        "ALTER TABLE deliverables ADD COLUMN required_flag BOOLEAN NOT NULL;",
      ].join("\n"),
      expectedExitCode: 1,
      expectedOk: false,
      expectedRuleIds: ["destructive_drop_table", "not_null_without_default"],
    },
  ])(
    "script safe-db-migrations/scripts/check-migration-ddl.mjs valida SQL ($label)",
    ({ sql, expectedExitCode, expectedOk, expectedRuleIds }) => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-ddl-check-"));
      tempDirs.push(tmpDir);
      const sqlFile = path.join(tmpDir, "0001_test.sql");
      fs.writeFileSync(sqlFile, sql, "utf8");

      const scriptPath = path.join(
        resolveDefaultSkillsDir(),
        "safe-db-migrations",
        "scripts",
        "check-migration-ddl.mjs"
      );
      const proc = spawnSync(process.execPath, [scriptPath, sqlFile, "--json"], {
        encoding: "utf8",
      });

      expect(proc.status).toBe(expectedExitCode);
      const parsed = JSON.parse(proc.stdout) as {
        ok: boolean;
        issues: Array<{ ruleId: string; severity: string }>;
      };
      expect(parsed.ok).toBe(expectedOk);
      expect(parsed.issues.map((i) => i.ruleId)).toEqual(expectedRuleIds);
    }
  );
});
