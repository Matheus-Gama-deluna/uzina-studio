import { describe, expect, test } from "vitest";
import {
  classifyDiffFileCategory,
  parseUnifiedDiffSemantic,
} from "../src/index.js";

describe("parseUnifiedDiffSemantic & classifyDiffFileCategory", () => {
  test.each([
    { filePath: "src/app.ts", expected: "code" },
    { filePath: "apps/web/src/components/panel.tsx", expected: "code" },
    { filePath: "tests/foo.spec.ts", expected: "test" },
    { filePath: "src/bar.test.tsx", expected: "test" },
    { filePath: "e2e/smoke.spec.ts", expected: "test" },
    { filePath: "package.json", expected: "config" },
    { filePath: "drizzle.config.ts", expected: "config" },
    { filePath: "docker-compose.yml", expected: "config" },
    { filePath: "tsconfig.base.json", expected: "config" },
    { filePath: "README.md", expected: "docs" },
    { filePath: "docs/spec.md", expected: "docs" },
  ] as const)(
    "classifica '$filePath' como categoria '$expected'",
    ({ filePath, expected }) => {
      expect(classifyDiffFileCategory(filePath)).toBe(expected);
    }
  );

  test("retorna array vazio para diff vazio ou somente espaços", () => {
    expect(parseUnifiedDiffSemantic("")).toEqual([]);
    expect(parseUnifiedDiffSemantic("   \n\t  ")).toEqual([]);
  });

  test("divide diff multi-arquivo em chunks semânticos com contagens e redação de segredos", () => {
    const sampleDiff = [
      "diff --git a/src/service.ts b/src/service.ts",
      "index 1111111..2222222 100644",
      "--- a/src/service.ts",
      "+++ b/src/service.ts",
      "@@ -1,4 +1,5 @@",
      " export function greet() {",
      "-  return 'old';",
      "+  const apiKey = 'sk-live-secret1234567890';",
      "+  return apiKey;",
      " }",
      "diff --git a/tests/service.test.ts b/tests/service.test.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/tests/service.test.ts",
      "@@ -0,0 +1,3 @@",
      "+test('greet', () => {",
      "+  expect(1).toBe(1);",
      "+});",
      "diff --git a/package.json b/package.json",
      "index 3333333..4444444 100644",
      "--- a/package.json",
      "+++ b/package.json",
      "@@ -2,2 +2,2 @@",
      '-  "version": "0.1.0"',
      '+  "version": "0.2.0"',
      "diff --git a/docs/guide.md b/docs/guide.md",
      "deleted file mode 100644",
      "--- a/docs/guide.md",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-# Guia antigo",
      "-Removido",
    ].join("\n");

    const parsed = parseUnifiedDiffSemantic(sampleDiff);

    expect(parsed).toHaveLength(4);
    expect(parsed[0]).toMatchObject({
      filePath: "src/service.ts",
      category: "code",
      additions: 2,
      deletions: 1,
    });
    expect(parsed[0]?.hunkPreview).not.toContain("sk-live-secret1234567890");
    expect(parsed[0]?.hunkPreview).toContain("[REDACTED_API_KEY]");

    expect(parsed[1]).toMatchObject({
      filePath: "tests/service.test.ts",
      category: "test",
      additions: 3,
      deletions: 0,
    });

    expect(parsed[2]).toMatchObject({
      filePath: "package.json",
      category: "config",
      additions: 1,
      deletions: 1,
    });

    expect(parsed[3]).toMatchObject({
      filePath: "docs/guide.md",
      category: "docs",
      additions: 0,
      deletions: 2,
    });
  });

  test("respeita maxFiles, maxHunkChars e clamping mínimo (1 arquivo, 32 chars) e suporta CRLF / diff sem diff --git", () => {
    const chunk = (idx: number) =>
      [
        `diff --git a/src/file${idx}.ts b/src/file${idx}.ts`,
        `--- a/src/file${idx}.ts`,
        `+++ b/src/file${idx}.ts`,
        "@@ -1 +1 @@",
        `-const a = ${idx};`,
        `+const b = "${"x".repeat(200)}";`,
      ].join("\r\n");

    const bigDiff = [chunk(1), chunk(2), chunk(3)].join("\r\n");
    const parsed = parseUnifiedDiffSemantic(bigDiff, {
      maxFiles: 2,
      maxHunkChars: 80,
    });

    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.hunkPreview.length).toBe(80);
    expect(parsed[1]?.filePath).toBe("src/file2.ts");

    const clamped = parseUnifiedDiffSemantic(bigDiff, {
      maxFiles: 0,
      maxHunkChars: 10,
    });
    expect(clamped).toHaveLength(1);
    expect(clamped[0]?.hunkPreview.length).toBe(32);

    const noGitHeaderDiff = [
      "--- a/README.md",
      "+++ b/README.md",
      "@@ -1 +1,2 @@",
      " # Doc",
      "+Linha nova",
    ].join("\r\n");
    const parsedNoHeader = parseUnifiedDiffSemantic(noGitHeaderDiff);
    expect(parsedNoHeader).toHaveLength(1);
    expect(parsedNoHeader[0]).toMatchObject({
      filePath: "README.md",
      category: "docs",
      additions: 1,
      deletions: 0,
    });
  });
});
