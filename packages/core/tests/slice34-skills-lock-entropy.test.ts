import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { z } from "zod";
import {
  computeSkillDirectorySha256,
  createZodArbitraryHelpers,
  generateSkillsLockManifest,
  readSkillsLockFile,
  runDeterministicPropertyCheck,
  runSchemaRoundTripProperty,
  runScopedMutationAndPbt,
  verifySkillsLockManifest,
  writeSkillsLockFile,
} from "../src/index.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeSkillFixture(
  skillsRoot: string,
  opts: {
    name: string;
    license?: string;
    version?: string;
    extraRef?: string;
  }
): string {
  const skillDir = path.join(skillsRoot, opts.name);
  fs.mkdirSync(path.join(skillDir, "references"), { recursive: true });
  const frontmatter = [
    "---",
    `name: ${opts.name}`,
    `description: Use quando validar skill ${opts.name} no catalogo.`,
    "applies_to_roles: [architect, builder]",
    "phase: build",
    "role_category: reference",
    `license: ${opts.license ?? "Apache-2.0"}`,
    `version: "${opts.version ?? "2.0.0"}"`,
    "---",
    "",
    "## Iron Law",
    "Nunca pular verificacao de lock.",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), frontmatter, "utf8");
  fs.writeFileSync(
    path.join(skillDir, "references", "checklist.md"),
    opts.extraRef ?? "# Checklist\n- Item 1\n",
    "utf8"
  );
  return skillDir;
}

describe("Slice 34 — Skills Lock (SHA-256) & Mutation/PBT Core", () => {
  afterAll(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
    }
  });

  describe("skills-lock.json: geração, persistência e verificação de adulteração", () => {
    test("gera manifesto SHA-256 determinístico para as 16 skills reais e valida integridade", () => {
      const manifest = generateSkillsLockManifest();
      expect(manifest.lockVersion).toBe(1);
      expect(manifest.skills).toHaveLength(16);
      expect(manifest.skills.every((s) => s.verified && s.enabled)).toBe(true);

      const check = verifySkillsLockManifest(manifest, {
        requireAllDiskSkillsLocked: true,
      });
      expect(check.valid).toBe(true);
      expect(check.checkedCount).toBe(16);
      expect(check.issues).toHaveLength(0);
    });

    test.each([
      {
        label: "adulteração de SKILL.md detectada via sha256_mismatch",
        mutateDisk: (skillsRoot: string) => {
          fs.appendFileSync(
            path.join(skillsRoot, "alpha-skill", "SKILL.md"),
            "\n<!-- payload adulterado -->\n",
            "utf8"
          );
        },
        mutateManifest: <T>(m: T) => m,
        expectedReason: "sha256_mismatch",
      },
      {
        label: "adulteração em references/ detectada via sha256_mismatch",
        mutateDisk: (skillsRoot: string) => {
          fs.writeFileSync(
            path.join(skillsRoot, "alpha-skill", "references", "checklist.md"),
            "# Modificado\n",
            "utf8"
          );
        },
        mutateManifest: <T>(m: T) => m,
        expectedReason: "sha256_mismatch",
      },
      {
        label: "licença proprietária não permitida detectada via disallowed_license",
        mutateDisk: () => undefined,
        mutateManifest: (m: ReturnType<typeof generateSkillsLockManifest>) => ({
          ...m,
          skills: m.skills.map((s) =>
            s.name === "alpha-skill" ? { ...s, license: "Proprietary-Custom" } : s
          ),
        }),
        expectedReason: "disallowed_license",
      },
      {
        label: "skill removida do disco detectada via missing_on_disk",
        mutateDisk: (skillsRoot: string) => {
          fs.rmSync(path.join(skillsRoot, "alpha-skill"), {
            recursive: true,
            force: true,
          });
        },
        mutateManifest: <T>(m: T) => m,
        expectedReason: "missing_on_disk",
      },
      {
        label: "skill nova não registrada no lock detectada via extra_unlocked_skill",
        mutateDisk: (skillsRoot: string) => {
          writeSkillFixture(skillsRoot, { name: "rogue-skill" });
        },
        mutateManifest: <T>(m: T) => m,
        expectedReason: "extra_unlocked_skill",
      },
    ])(
      "$label",
      ({ mutateDisk, mutateManifest, expectedReason }) => {
        const root = makeTempDir("uzina-s34-lock-");
        const skillsRoot = path.join(root, "skills");
        fs.mkdirSync(skillsRoot, { recursive: true });
        const skillDir = writeSkillFixture(skillsRoot, { name: "alpha-skill" });

        const shaBefore = computeSkillDirectorySha256(skillDir);
        expect(shaBefore).toMatch(/^[a-f0-9]{64}$/);

        const lockFile = path.join(root, ".uzina", "skills-lock.json");
        const baseManifest = generateSkillsLockManifest({
          skillsDir: skillsRoot,
        });
        writeSkillsLockFile(lockFile, baseManifest);
        const reloaded = readSkillsLockFile(lockFile);
        expect(reloaded).toEqual(baseManifest);

        mutateDisk(skillsRoot);
        const targetManifest = mutateManifest(baseManifest);

        const verifyRes = verifySkillsLockManifest(targetManifest, {
          skillsDir: skillsRoot,
          requireAllDiskSkillsLocked: true,
        });
        expect(verifyRes.valid).toBe(false);
        expect(verifyRes.issues.some((i) => i.reason === expectedReason)).toBe(
          true
        );
      }
    );
  });

  describe("Mutation Testing (Stryker) & Property-Based Testing determinístico", () => {
    test("PBT determinístico valida round-trip Zod e detecta contraexemplo reprodutível", () => {
      const ItemSchema = z
        .object({
          id: z.uuid(),
          score: z.number().int().min(0).max(100),
          createdAt: z.iso.datetime(),
        })
        .strict();

      const okPbt = runSchemaRoundTripProperty(
        ItemSchema,
        (rng) => {
          const arb = createZodArbitraryHelpers(rng);
          return {
            id: arb.uuid(),
            score: arb.int(0, 100),
            createdAt: arb.isoDatetime(),
          };
        },
        { runs: 40, seed: 42 }
      );
      expect(okPbt.passed).toBe(true);
      expect(okPbt.runsExecuted).toBe(40);
      expect(okPbt.failedIteration).toBeNull();

      const failingPbt = runDeterministicPropertyCheck({
        runs: 20,
        seed: 7,
        generator: (rng) => createZodArbitraryHelpers(rng).int(0, 10),
        predicate: (val) => val < 5,
      });
      expect(failingPbt.passed).toBe(false);
      expect(typeof failingPbt.failedIteration).toBe("number");
      expect(Number(failingPbt.counterexample)).toBeGreaterThanOrEqual(5);
    });

    test("runScopedMutationAndPbt degrada para skipped_missing_binary sem Stryker e parseia métricas quando executado", async () => {
      const ws = makeTempDir("uzina-s34-mut-");
      fs.mkdirSync(path.join(ws, "src"), { recursive: true });
      fs.writeFileSync(
        path.join(ws, "src", "domain.ts"),
        "export const add = (a: number, b: number) => a + b;\n",
        "utf8"
      );

      const skippedReport = await runScopedMutationAndPbt({
        workspaceRoot: ws,
        targetFiles: ["src/domain.ts"],
        strykerBinaryOverride: null,
        pbtCheck: () =>
          runDeterministicPropertyCheck({
            runs: 25,
            generator: (rng) => createZodArbitraryHelpers(rng).int(-50, 50),
            predicate: (n) => n + 0 === n,
          }),
      });
      expect(skippedReport.pbtExecuted).toBe(true);
      expect(skippedReport.pbtCasesRun).toBe(25);
      expect(skippedReport.pbtPassed).toBe(true);
      expect(skippedReport.mutationStatus).toBe("skipped_missing_binary");
      expect(skippedReport.mutationScorePercent).toBeNull();

      const executedReport = await runScopedMutationAndPbt({
        workspaceRoot: ws,
        targetFiles: ["src/domain.ts"],
        strykerBinaryOverride: "stryker",
        runSubprocess: async (_bin, args) => {
          expect(args).toContain("--mutate");
          expect(args).toContain("src/domain.ts");
          return {
            exitCode: 0,
            stdout: "Killed: 18\nSurvived: 2\nMutation score: 90.00%",
            stderr: "",
          };
        },
      });
      expect(executedReport.mutationStatus).toBe("executed");
      expect(executedReport.killedMutants).toBe(18);
      expect(executedReport.survivedMutants).toBe(2);
      expect(executedReport.mutationScorePercent).toBe(90);

      await expect(
        runScopedMutationAndPbt({
          workspaceRoot: ws,
          targetFiles: ["../escape.ts"],
        })
      ).rejects.toThrow();
    });
  });
});
