import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  assertPathInsideWorkspace,
  assertSafeGitRef,
  redactError,
  redactSecrets,
  redactSecretsInValue,
  sanitizeWorktreeSlug,
  WorkspaceBoundaryError,
} from "../src/index.js";

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  }
});

describe("path-guard — contenção de workspace", () => {
  test.each([
    {
      label: "aceita arquivo relativo interno",
      target: "src/index.ts",
      allowRoot: false,
      expectedOk: true,
    },
    {
      label: "aceita arquivo legítimo cujo nome inicia com dois pontos (..env-example)",
      target: "..env-example",
      allowRoot: false,
      expectedOk: true,
    },
    {
      label: "aceita caminho aninhado ainda não criado",
      target: "packages/new-pkg/src/file.ts",
      allowRoot: false,
      expectedOk: true,
    },
    {
      label: "rejeita raiz exata quando allowRoot é false",
      target: ".",
      allowRoot: false,
      expectedOk: false,
    },
    {
      label: "aceita raiz exata quando allowRoot é true",
      target: ".",
      allowRoot: true,
      expectedOk: true,
    },
    {
      label: "rejeita travessia ../ fora do workspace",
      target: "../outside.txt",
      allowRoot: false,
      expectedOk: false,
    },
    {
      label: "rejeita null byte no caminho",
      target: "src/file\0.ts",
      allowRoot: false,
      expectedOk: false,
    },
    {
      label: "rejeita caminho vazio",
      target: "   ",
      allowRoot: false,
      expectedOk: false,
    },
    {
      label: "rejeita nome reservado Windows NUL",
      target: "src/NUL",
      allowRoot: false,
      expectedOk: false,
    },
    {
      label: "rejeita nome reservado Windows COM1.txt",
      target: "COM1.txt",
      allowRoot: false,
      expectedOk: false,
    },
    {
      label: "rejeita nome reservado Windows com trailing space/dot (CON .txt / nul.)",
      target: "CON .txt",
      allowRoot: false,
      expectedOk: false,
    },
    {
      label: "rejeita NTFS Alternate Data Stream (file.txt:stream)",
      target: "src/file.txt:hidden",
      allowRoot: false,
      expectedOk: false,
    },
    {
      label: "rejeita caminho UNC padrão (\\\\server\\share)",
      target: "\\\\evil-server\\share\\secret.txt",
      allowRoot: false,
      expectedOk: false,
    },
    {
      label: "rejeita caminho UNC com barras mistas (\\/server\\share)",
      target: "\\/evil-server/share/secret.txt",
      allowRoot: false,
      expectedOk: false,
    },
    {
      label: "rejeita caminho drive-relative Windows (C:foo.ts)",
      target: "C:foo.ts",
      allowRoot: false,
      expectedOk: false,
    },
  ])("$label", ({ target, allowRoot, expectedOk }) => {
    const root = createTempDir("uzina-pg-");
    if (expectedOk) {
      const resolved = assertPathInsideWorkspace(root, target, { allowRoot });
      expect(resolved.toLowerCase()).toContain(
        fs.realpathSync.native(root).replace(/^\\\\\?\\/, "").toLowerCase()
      );
    } else {
      expect(() =>
        assertPathInsideWorkspace(root, target, { allowRoot })
      ).toThrowError(WorkspaceBoundaryError);
    }
  });

  test("rejeita workspaceRoot vazio e respeita followSymlinks: false", () => {
    const root = createTempDir("uzina-empty-root-");
    expect(() => assertPathInsideWorkspace("   ", "a.ts")).toThrowError(
      WorkspaceBoundaryError
    );
    const resolved = assertPathInsideWorkspace(root, "sub/a.ts", {
      followSymlinks: false,
    });
    expect(resolved).toBe(path.join(path.resolve(root), "sub", "a.ts"));
  });

  test("bloqueia prefix trap (ex.: /tmp/ws-evil fora de /tmp/ws)", () => {
    const parent = createTempDir("uzina-prefix-");
    const ws = path.join(parent, "ws");
    const evil = path.join(parent, "ws-evil", "secret.txt");
    fs.mkdirSync(ws, { recursive: true });
    fs.mkdirSync(path.dirname(evil), { recursive: true });

    expect(() => assertPathInsideWorkspace(ws, evil)).toThrowError(
      WorkspaceBoundaryError
    );
  });

  test("bloqueia escape via symlink / directory junction (existente e dangling apontando para destino inexistente fora do workspace)", () => {
    const parent = createTempDir("uzina-sym-");
    const ws = path.join(parent, "worktree");
    const outside = path.join(parent, "outside-secret");
    const outsideFutureDir = path.join(parent, "outside-nonexistent-yet");
    fs.mkdirSync(ws, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, "credentials.json"), "{}", "utf8");

    const linkExisting = path.join(ws, "escape-link");
    fs.symlinkSync(
      outside,
      linkExisting,
      process.platform === "win32" ? "junction" : "dir"
    );

    expect(() =>
      assertPathInsideWorkspace(ws, "escape-link/credentials.json")
    ).toThrowError(WorkspaceBoundaryError);
    expect(() =>
      assertPathInsideWorkspace(ws, "escape-link/new-uncreated.ts")
    ).toThrowError(WorkspaceBoundaryError);

    // Dangling link/junction apontando para caminho fora do workspace que ainda nao existe
    const danglingLink = path.join(ws, "dangling-escape");
    fs.symlinkSync(
      outsideFutureDir,
      danglingLink,
      process.platform === "win32" ? "junction" : "dir"
    );
    expect(() =>
      assertPathInsideWorkspace(ws, "dangling-escape/pwn.ts")
    ).toThrowError(WorkspaceBoundaryError);
  });

  test("trata drive-letter casing no Windows sem falsos negativos", () => {
    const root = createTempDir("uzina-case-");
    const normalizedRoot =
      process.platform === "win32"
        ? root.charAt(0).toLowerCase() + root.slice(1)
        : root;
    const targetUpperDrive =
      process.platform === "win32"
        ? path.join(root.charAt(0).toUpperCase() + root.slice(1), "src", "app.ts")
        : path.join(root, "src", "app.ts");

    const resolved = assertPathInsideWorkspace(normalizedRoot, targetUpperDrive);
    expect(resolved.endsWith(path.join("src", "app.ts"))).toBe(true);
  });
});

describe("assertSafeGitRef & sanitizeWorktreeSlug", () => {
  test.each([
    { ref: "main", valid: true },
    { ref: "feat/slice-02-opencode", valid: true },
    { ref: "uzina/entrega-01", valid: true },
    { ref: "--upload-pack=evil", valid: false },
    { ref: "-b", valid: false },
    { ref: "main..evil", valid: false },
    { ref: "refs/heads/main.lock", valid: false },
    { ref: "feat//double", valid: false },
    { ref: "feat with space", valid: false },
    { ref: "main@{0}", valid: false },
    { ref: "@", valid: false },
    { ref: "feat/.hidden", valid: false },
    { ref: "feat/trailing/", valid: false },
    { ref: "feat/trailing.", valid: false },
    { ref: "feat\x07bell", valid: false },
  ])("assertSafeGitRef($ref) -> $valid", ({ ref, valid }) => {
    if (valid) {
      expect(assertSafeGitRef(ref)).toBe(ref);
    } else {
      expect(() => assertSafeGitRef(ref)).toThrowError(WorkspaceBoundaryError);
    }
  });

  test("sanitizeWorktreeSlug gera slug determinístico, respeita limite de 48 chars e fallback", () => {
    const a = sanitizeWorktreeSlug("Implementar Login + OAuth!", "deliv-1");
    const b = sanitizeWorktreeSlug("Implementar Login + OAuth!", "deliv-2");
    expect(a).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    expect(a).not.toBe(b);

    const longSlug = sanitizeWorktreeSlug("a".repeat(80), "uniq-1");
    expect(longSlug.length).toBeLessThanOrEqual(48);
    expect(sanitizeWorktreeSlug("---!!!---")).toBe("task");
  });
});

describe("redactSecrets & redactError", () => {
  test("respeita fronteira MIN_SECRET_LENGTH=4, ordena segredos sobrepostos e redige cause/stack/propriedades extras", () => {
    const shortSecret = "abc";
    const boundarySecret = "abcd";
    const longSecret = "abcd-super-secret-token";

    expect(redactSecrets(`val=${shortSecret}`, [shortSecret])).toBe("val=abc");
    expect(redactSecrets(`val=${boundarySecret}`, [boundarySecret])).toBe(
      "val=[REDACTED]"
    );
    // Segredo mais longo deve ser redigido antes do prefixo mais curto
    expect(
      redactSecrets(`tok=${longSecret}`, [boundarySecret, longSecret])
    ).toBe("tok=[REDACTED]");

    const obj = {
      msg: `Falha ao chamar usando ${longSecret}`,
      nested: [{ header: `Bearer ${longSecret}` }],
    };
    const sanitized = redactSecretsInValue(obj, [longSecret, shortSecret, null]);
    expect(sanitized.msg).toBe("Falha ao chamar usando [REDACTED]");
    expect(sanitized.nested[0]?.header).toBe("Bearer [REDACTED]");

    class CustomBridgeError extends Error {
      override readonly name = "CustomBridgeError";
      readonly code = "BRIDGE_ERR";
      stderr = `stderr leak: ${longSecret}`;
    }
    const causeErr = new Error(`root cause ${longSecret}`);
    const err = new CustomBridgeError(`Erro HTTP com token ${longSecret}`, {
      cause: causeErr,
    });
    const safeErr = redactError(err, [longSecret]) as CustomBridgeError;

    expect(safeErr.code).toBe("BRIDGE_ERR");
    expect(safeErr.name).toBe("CustomBridgeError");
    expect(safeErr.message).toBe("Erro HTTP com token [REDACTED]");
    expect(safeErr.stack).not.toContain(longSecret);
    expect(safeErr.stderr).toBe("stderr leak: [REDACTED]");
    expect((safeErr.cause as Error).message).toBe("root cause [REDACTED]");

    const stringErr = redactError(`plain failure ${longSecret}`, [longSecret]);
    expect(stringErr.message).toBe("plain failure [REDACTED]");
  });
});
