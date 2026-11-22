import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { scanRepositoryBrownfield } from "../src/brownfield.js";

const tempDirs: string[] = [];

function makeTempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-brownfield-"));
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

describe("scanRepositoryBrownfield — arqueologia somente leitura + Scorecard 0-100", () => {
  test("detecta stack TS/Next, testes, CI, steering/security e calcula maturityScore alto", () => {
    const repo = makeTempRepo();
    fs.writeFileSync(
      path.join(repo, "package.json"),
      JSON.stringify({
        name: "app-moderno",
        scripts: { test: "vitest run", lint: "eslint ." },
        dependencies: { next: "16.4.6", react: "19.3.1", zod: "4.6.7" },
        devDependencies: { typescript: "5.9.3", vitest: "5.1.1" },
      }),
      "utf8"
    );
    fs.writeFileSync(path.join(repo, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    fs.writeFileSync(path.join(repo, ".gitignore"), "node_modules\n.env\n");
    fs.writeFileSync(path.join(repo, "README.md"), "# App\n");
    fs.mkdirSync(path.join(repo, ".github", "workflows"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".github", "workflows", "ci.yml"), "name: CI\n");
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "index.ts"), "export const a = 1;\n");
    fs.mkdirSync(path.join(repo, "tests"), { recursive: true });
    fs.writeFileSync(path.join(repo, "tests", "app.test.ts"), "test('ok', () => {})\n");
    fs.mkdirSync(path.join(repo, "node_modules", "ignored-pkg"), { recursive: true });
    fs.writeFileSync(path.join(repo, "node_modules", "ignored-pkg", "index.js"), "x");

    const map = scanRepositoryBrownfield(repo);
    expect(map.detectedStack).toEqual(
      expect.arrayContaining(["typescript", "nextjs", "react", "zod"])
    );
    expect(map.hasTests).toBe(true);
    expect(map.hasCi).toBe(true);
    expect(map.maturityScore).toBeGreaterThanOrEqual(75);
    expect(map.maturityScore).toBeLessThanOrEqual(100);
    expect(map.recommendedStrategy).toBe("frontend_first_msw");
    // node_modules nao deve inflar contagem
    expect(map.totalFilesScanned).toBeLessThan(15);
  });

  test("calcula maturityScore < 40 para repo legado sem testes/CI e recomenda characterization_strangler", () => {
    const repo = makeTempRepo();
    fs.writeFileSync(path.join(repo, "index.js"), "console.log('legacy');\n");
    fs.writeFileSync(path.join(repo, ".env"), "SECRET=oops\n");

    const map = scanRepositoryBrownfield(repo);
    expect(map.hasTests).toBe(false);
    expect(map.hasCi).toBe(false);
    expect(map.maturityScore).toBeLessThan(40);
    expect(map.recommendedStrategy).toBe("characterization_strangler");
    expect(map.riskNotes.length).toBeGreaterThanOrEqual(1);
  });

  test("ignora symlinks/junctions externos e respeita maxFiles sem loop infinito", () => {
    const repo = makeTempRepo();
    const outside = makeTempRepo();
    fs.writeFileSync(path.join(outside, "secret.txt"), "top-secret");
    fs.symlinkSync(
      outside,
      path.join(repo, "ext-link"),
      process.platform === "win32" ? "junction" : "dir"
    );

    for (let i = 0; i < 10; i++) {
      fs.writeFileSync(path.join(repo, `file-${i}.ts`), `export const f${i} = ${i};`);
    }

    const map = scanRepositoryBrownfield(repo, { maxFiles: 5 });
    expect(map.truncated).toBe(true);
    expect(map.totalFilesScanned).toBeLessThanOrEqual(5);
    expect(map.topLevelEntries).not.toContain("secret.txt");
  });

  test("falha explicitamente para diretório inexistente e respeita maxDepth + symlink circular", () => {
    const nonexistent = path.join(os.tmpdir(), `uzina-missing-${Date.now()}`);
    expect(() => scanRepositoryBrownfield(nonexistent)).toThrow();

    const repo = makeTempRepo();
    fs.mkdirSync(path.join(repo, "a", "b", "c"), { recursive: true });
    fs.writeFileSync(path.join(repo, "a", "b", "c", "deep.ts"), "export {};");
    // Symlink circular interno apontando para a raiz
    fs.symlinkSync(
      repo,
      path.join(repo, "a", "loop-root"),
      process.platform === "win32" ? "junction" : "dir"
    );

    const mapDepth1 = scanRepositoryBrownfield(repo, { maxDepth: 1 });
    expect(mapDepth1.totalFilesScanned).toBe(0);
    expect(mapDepth1.topLevelEntries).toContain("a");
  });

  test("ignora symlink de arquivo sem vazar conteúdo e recomenda data_schema_first / api_contract_first", () => {
    const schemaRepo = makeTempRepo();
    fs.writeFileSync(
      path.join(schemaRepo, "package.json"),
      JSON.stringify({
        name: "db-service",
        scripts: { test: "vitest", lint: "eslint ." },
        dependencies: { "drizzle-orm": "0.45.4", zod: "4.6.7" },
      }),
      "utf8"
    );
    fs.writeFileSync(path.join(schemaRepo, ".gitignore"), "node_modules\n");
    fs.writeFileSync(path.join(schemaRepo, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    fs.writeFileSync(path.join(schemaRepo, "README.md"), "# DB\n");
    fs.mkdirSync(path.join(schemaRepo, ".github", "workflows"), { recursive: true });
    fs.writeFileSync(path.join(schemaRepo, ".github", "workflows", "ci.yml"), "on: push\n");
    fs.mkdirSync(path.join(schemaRepo, "tests"), { recursive: true });
    fs.writeFileSync(path.join(schemaRepo, "tests", "db.test.ts"), "export {};");

    const outsideSecret = makeTempRepo();
    const secretTarget = path.join(outsideSecret, "secret-env.txt");
    fs.writeFileSync(secretTarget, "TOKEN=1234", "utf8");
    try {
      fs.symlinkSync(secretTarget, path.join(schemaRepo, ".env"), "file");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EACCES") {
        throw error;
      }
    }

    const schemaMap = scanRepositoryBrownfield(schemaRepo);
    expect(schemaMap.maturityScore).toBeGreaterThanOrEqual(40);
    expect(schemaMap.recommendedStrategy).toBe("data_schema_first");
    expect(schemaMap.dimensions.securityPosture).toBe(20);

    const apiRepo = makeTempRepo();
    fs.writeFileSync(
      path.join(apiRepo, "package.json"),
      JSON.stringify({
        name: "api-service",
        scripts: { test: "vitest", lint: "eslint ." },
        dependencies: { zod: "4.6.7" },
      }),
      "utf8"
    );
    fs.writeFileSync(path.join(apiRepo, ".gitignore"), "node_modules\n");
    fs.writeFileSync(path.join(apiRepo, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    fs.writeFileSync(path.join(apiRepo, "README.md"), "# API\n");
    fs.mkdirSync(path.join(apiRepo, ".github", "workflows"), { recursive: true });
    fs.writeFileSync(path.join(apiRepo, ".github", "workflows", "ci.yml"), "on: push\n");
    fs.mkdirSync(path.join(apiRepo, "tests"), { recursive: true });
    fs.writeFileSync(path.join(apiRepo, "tests", "api.test.ts"), "export {};");

    const apiMap = scanRepositoryBrownfield(apiRepo);
    expect(apiMap.maturityScore).toBeGreaterThanOrEqual(40);
    expect(apiMap.recommendedStrategy).toBe("api_contract_first");
  });
});
