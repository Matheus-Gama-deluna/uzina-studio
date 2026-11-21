import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadNativeSkills, WorkspaceBoundaryError } from "@uzina/core";
import { afterEach, describe, expect, test } from "vitest";
import {
  assertSafeCommand,
  DangerousCommandError,
  LocalGitWorktreeWorkspace,
  syncSkillsToWorktree,
  WorktreeError,
} from "../src/index.js";

const tempDirs: string[] = [];

function createTempGitRepo(): string {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-git-repo-"));
  tempDirs.push(repoDir);

  execFileSync("git", ["init", "-b", "main"], { cwd: repoDir, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "Uzina Test"], {
    cwd: repoDir,
    stdio: "pipe",
  });
  execFileSync("git", ["config", "user.email", "test@uzina.local"], {
    cwd: repoDir,
    stdio: "pipe",
  });
  fs.writeFileSync(path.join(repoDir, "README.md"), "# Projeto Teste\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: repoDir, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "chore: initial commit"], {
    cwd: repoDir,
    stdio: "pipe",
  });
  return repoDir;
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

describe("LocalGitWorktreeWorkspace — integração real com Git", () => {
  test("prepara worktree isolada, preserva working tree principal, captura diff (rastreado + untracked) e limpa de forma idempotente", async () => {
    const repoDir = createTempGitRepo();
    const workspace = new LocalGitWorktreeWorkspace();

    const handle = await workspace.prepare(repoDir, "main", "deliv-101");
    expect(handle.branchName).toMatch(/^uzina\/deliv-101-[a-f0-9]{8}$/);
    expect(fs.existsSync(handle.workspacePath)).toBe(true);
    expect(fs.existsSync(path.join(handle.workspacePath, "README.md"))).toBe(
      true
    );

    const mainStatusBefore = execFileSync("git", ["status", "--porcelain"], {
      cwd: repoDir,
      encoding: "utf8",
    });
    expect(mainStatusBefore.trim()).toBe("");

    fs.writeFileSync(
      path.join(handle.workspacePath, "README.md"),
      "# Projeto Teste\nAlterado na worktree\n",
      "utf8"
    );
    fs.writeFileSync(
      path.join(handle.workspacePath, "src-novo.ts"),
      "export const createdInWorktree = true;\n",
      "utf8"
    );

    const mainReadme = fs.readFileSync(path.join(repoDir, "README.md"), "utf8");
    expect(mainReadme).toBe("# Projeto Teste\n");
    expect(fs.existsSync(path.join(repoDir, "src-novo.ts"))).toBe(false);

    // includeUntracked: false ignora arquivo novo untracked
    const diffTrackedOnly = await workspace.getDiff("main", {
      includeUntracked: false,
    });
    expect(diffTrackedOnly).toContain("Alterado na worktree");
    expect(diffTrackedOnly).not.toContain("src-novo.ts");

    // Padrao inclui untracked e respeita truncamento por maxBytes
    const fullDiff = await workspace.getDiff("main");
    expect(fullDiff).toContain("Alterado na worktree");
    expect(fullDiff).toContain("src-novo.ts");

    const truncatedDiff = await workspace.getDiff("main", { maxBytes: 80 });
    expect(truncatedDiff).toContain("[DIFF TRUNCATED AT 80 BYTES]");

    await workspace.cleanup({ deleteBranch: true });
    await workspace.cleanup({ deleteBranch: true });

    expect(fs.existsSync(handle.workspacePath)).toBe(false);
    const branches = execFileSync("git", ["branch", "--list", handle.branchName], {
      cwd: repoDir,
      encoding: "utf8",
    });
    expect(branches.trim()).toBe("");
  });

  test("suporta preparo concorrente (Promise.all) no mesmo repositório sem corrida em .git/info/exclude", async () => {
    const repoDir = createTempGitRepo();
    const ws1 = new LocalGitWorktreeWorkspace();
    const ws2 = new LocalGitWorktreeWorkspace();

    try {
      const [h1, h2] = await Promise.all([
        ws1.prepare(repoDir, "main", "concurrent-1"),
        ws2.prepare(repoDir, "main", "concurrent-2"),
      ]);
      expect(h1.workspacePath).not.toBe(h2.workspacePath);
      expect(h1.branchName).not.toBe(h2.branchName);

      const status = execFileSync("git", ["status", "--porcelain"], {
        cwd: repoDir,
        encoding: "utf8",
      });
      expect(status.trim()).toBe("");
    } finally {
      await Promise.all([
        ws1.cleanup({ deleteBranch: true }),
        ws2.cleanup({ deleteBranch: true }),
      ]);
    }
  });

  test("syncSkillsToWorktree grava skills nativas com YAML seguro dentro de .opencode/skills", async () => {
    const repoDir = createTempGitRepo();
    const workspace = new LocalGitWorktreeWorkspace();
    const handle = await workspace.prepare(repoDir, "main", "skills-sync");

    try {
      const skills = loadNativeSkills({
        names: ["contract-first-msw", "test-quality-engineering"],
      });
      const written = syncSkillsToWorktree(handle.workspacePath, [
        {
          ...skills[0]!,
          description: "Regra: evitar\nquebra yaml",
        },
        skills[1]!,
      ]);

      expect(written).toHaveLength(2);
      const firstContent = fs.readFileSync(written[0]!, "utf8");
      expect(firstContent).toContain('"Regra: evitar\\nquebra yaml"');
    } finally {
      await workspace.cleanup({ deleteBranch: true });
    }
  });

  test("impõe ciclo de vida (sem prepare, prepare duplicado, pós-cleanup) e trunca saída via maxOutputBytes", async () => {
    const repoDir = createTempGitRepo();
    const workspace = new LocalGitWorktreeWorkspace();

    await expect(workspace.exec(process.execPath, ["-v"])).rejects.toThrowError(
      WorktreeError
    );
    await expect(workspace.getDiff()).rejects.toThrowError(WorktreeError);

    await workspace.prepare(repoDir, "main", "lifecycle");
    try {
      await expect(
        workspace.prepare(repoDir, "main", "dup")
      ).rejects.toThrowError(WorktreeError);

      const bigOut = await workspace.exec(
        process.execPath,
        ["-e", "process.stdout.write('A'.repeat(3000))"],
        { maxOutputBytes: 1024 }
      );
      expect(bigOut.exitCode).toBe(0);
      expect(bigOut.truncated).toBe(true);
      expect(Buffer.byteLength(bigOut.stdout, "utf8")).toBeLessThanOrEqual(1024);

      await expect(
        workspace.exec("comando-inexistente-uzina-xyz", [])
      ).rejects.toThrowError(WorktreeError);
    } finally {
      await workspace.cleanup({ deleteBranch: true });
    }

    await expect(workspace.exec(process.execPath, ["-v"])).rejects.toThrowError(
      WorktreeError
    );
  });

  test.each([
    { label: "shell sh", cmd: "sh", args: ["-c", "echo evil"] },
    { label: "shell bash", cmd: "bash", args: ["-c", "id"] },
    { label: "shell cmd.exe", cmd: "cmd.exe", args: ["/c", "dir"] },
    { label: "git push --force", cmd: "git", args: ["push", "--force", "origin", "main"] },
    { label: "git -C . push --force (global flag)", cmd: "git", args: ["-C", ".", "push", "--force"] },
    { label: "git -c core.sshCommand (option injection)", cmd: "git", args: ["-c", "core.sshCommand=evil", "status"] },
    { label: "git -ccore.sshCommand colado (option injection)", cmd: "git", args: ["-ccore.sshCommand=evil", "status"] },
    { label: "git push --receive-pack", cmd: "git", args: ["push", "--receive-pack=evil", "origin", "main"] },
    { label: "git push refspec +main", cmd: "git", args: ["push", "origin", "+main"] },
    { label: "git reset --hard", cmd: "git", args: ["reset", "--hard", "HEAD~1"] },
    { label: "git clean -fdx", cmd: "git", args: ["clean", "-fdx"] },
    { label: "rm -rf ../outside", cmd: "rm", args: ["-rf", "../outside"] },
    { label: "rm -rf ./../../etc", cmd: "rm", args: ["-rf", "./../../etc"] },
    { label: "rm -rf /", cmd: "rm", args: ["-rf", "/"] },
  ])("assertSafeCommand bloqueia $label", ({ cmd, args }) => {
    expect(() => assertSafeCommand(cmd, args)).toThrowError(
      DangerousCommandError
    );
  });

  test("remove variáveis sensíveis em sanitizeChildEnv e bloqueia cwd/ref inválidos", async () => {
    const repoDir = createTempGitRepo();
    const workspace = new LocalGitWorktreeWorkspace();
    await workspace.prepare(repoDir, "main", "deliv-sec");

    const prevMaster = process.env.MASTER_ENCRYPTION_KEY;
    process.env.MASTER_ENCRYPTION_KEY = "0".repeat(64);

    try {
      await expect(
        workspace.exec(process.execPath, ["-e", "console.log(1)"], {
          cwd: "..",
        })
      ).rejects.toThrowError(WorkspaceBoundaryError);

      await expect(workspace.getDiff("--upload-pack=evil")).rejects.toThrowError(
        WorkspaceBoundaryError
      );

      const res = await workspace.exec(
        process.execPath,
        [
          "-e",
          "console.log(JSON.stringify({ m: process.env.MASTER_ENCRYPTION_KEY || null, g: process.env.GIT_DIR || null, ssh: process.env.GIT_SSH_COMMAND || null, pk: process.env.PRIVATE_KEY || null, no: process.env.NODE_OPTIONS || null, ok: process.env.SAFE_VAR || null }))",
        ],
        {
          env: {
            MASTER_ENCRYPTION_KEY: "should-be-stripped",
            GIT_DIR: "/evil/.git",
            GIT_SSH_COMMAND: "evil",
            PRIVATE_KEY: "secret",
            NODE_OPTIONS: "--require=evil",
            SAFE_VAR: "allowed-value",
          },
        }
      );
      expect(res.exitCode).toBe(0);
      expect(JSON.parse(res.stdout.trim())).toEqual({
        m: null,
        g: null,
        ssh: null,
        pk: null,
        no: null,
        ok: "allowed-value",
      });
    } finally {
      if (prevMaster === undefined) {
        delete process.env.MASTER_ENCRYPTION_KEY;
      } else {
        process.env.MASTER_ENCRYPTION_KEY = prevMaster;
      }
      await workspace.cleanup({ deleteBranch: true });
    }
  });

  test("aplica AbortSignal (pré-abortado e mid-run) e timeoutMs encerrando processo filho", async () => {
    const repoDir = createTempGitRepo();
    const workspace = new LocalGitWorktreeWorkspace();
    await workspace.prepare(repoDir, "main", "deliv-abort");

    try {
      const preController = new AbortController();
      preController.abort();
      const preAborted = await workspace.exec(process.execPath, ["-v"], {
        signal: preController.signal,
      });
      expect(preAborted.aborted).toBe(true);
      expect(preAborted.exitCode).toBeNull();

      const timedOut = await workspace.exec(
        process.execPath,
        ["-e", "setInterval(() => {}, 1000)"],
        { timeoutMs: 200 }
      );
      expect(timedOut.timedOut).toBe(true);
      expect(timedOut.aborted).toBe(false);

      const midController = new AbortController();
      setTimeout(() => midController.abort(), 120);
      const midAborted = await workspace.exec(
        process.execPath,
        ["-e", "setInterval(() => {}, 1000)"],
        { timeoutMs: 10_000, signal: midController.signal }
      );
      expect(midAborted.aborted).toBe(true);
    } finally {
      await workspace.cleanup({ deleteBranch: true });
    }
  });

  test("rejeita repoPath que não é repositório Git válido", async () => {
    const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-nogit-"));
    tempDirs.push(plainDir);
    const workspace = new LocalGitWorktreeWorkspace();

    await expect(
      workspace.prepare(plainDir, "main", "deliv-nogit")
    ).rejects.toThrowError(WorktreeError);
  });

  test("attach() reanexa uma nova instância à mesma worktree preservando arquivos e permitindo getDiff()", async () => {
    const repoDir = createTempGitRepo();
    const wsStage1 = new LocalGitWorktreeWorkspace();
    const handle = await wsStage1.prepare(repoDir, "main", "reattach-1");

    const wsStage2 = new LocalGitWorktreeWorkspace();
    try {
      fs.writeFileSync(
        path.join(handle.workspacePath, "contract.ts"),
        "export const step1 = true;\n",
        "utf8"
      );

      const attached = await wsStage2.attach(handle);
      expect(attached.workspacePath).toBe(handle.workspacePath);
      expect(attached.branchName).toBe(handle.branchName);

      const diff = await wsStage2.getDiff("main");
      expect(diff).toContain("contract.ts");
      expect(diff).toContain("step1");

      await expect(
        wsStage2.attach({ ...handle, branchName: "main" })
      ).rejects.toThrowError(WorktreeError);
    } finally {
      await wsStage2.cleanup({ deleteBranch: true });
    }
  });
});
