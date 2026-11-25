import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { WorktreeError } from "../src/errors.js";
import {
  LocalGitWorktreeWorkspace,
  listProjectWorktrees,
  removeWorktreeByPathSafe,
} from "../src/index.js";

function normalizeForCompare(p: string): string {
  const resolved = fs.existsSync(p) ? fs.realpathSync(p) : path.resolve(p);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

describe("Slice 24 — Governança Git Worktrees (listProjectWorktrees & removeWorktreeByPathSafe)", () => {
  const tempDirs: string[] = [];

  afterAll(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function initGitRepo(): string {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-s24-wt-"));
    tempDirs.push(repoDir);
    execFileSync("git", ["init", "-b", "main"], { cwd: repoDir, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "Uzina S24"], {
      cwd: repoDir,
      stdio: "ignore",
    });
    execFileSync("git", ["config", "user.email", "s24@uzina.studio"], {
      cwd: repoDir,
      stdio: "ignore",
    });
    fs.writeFileSync(path.join(repoDir, "README.md"), "# S24 Repo\n", "utf8");
    execFileSync("git", ["add", "."], { cwd: repoDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "chore: initial"], {
      cwd: repoDir,
      stdio: "ignore",
    });
    return repoDir;
  }

  test("retorna [] para caminho inexistente ou não-git", async () => {
    const nonExistent = path.join(os.tmpdir(), `uzina-missing-${Date.now()}`);
    expect(await listProjectWorktrees(nonExistent)).toEqual([]);

    const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-plain-"));
    tempDirs.push(plainDir);
    expect(await listProjectWorktrees(plainDir)).toEqual([]);
  });

  test("lista worktree principal e worktree isolado, bloqueia remoção do principal e traversal, e remove órfão com deleteBranch", async () => {
    const repoDir = initGitRepo();
    const ws = new LocalGitWorktreeWorkspace();
    const handle = await ws.prepare(
      repoDir,
      "main",
      "11111111-1111-4111-8111-111111111111"
    );

    const entriesBefore = await listProjectWorktrees(repoDir);
    expect(entriesBefore.length).toBeGreaterThanOrEqual(2);

    const mainEntry = entriesBefore.find((e) => e.isMain);
    const isolatedEntry = entriesBefore.find(
      (e) =>
        !e.isMain &&
        normalizeForCompare(e.worktreePath) ===
          normalizeForCompare(handle.workspacePath)
    );

    expect(mainEntry).toMatchObject({
      isMain: true,
      branchName: "main",
    });
    expect(isolatedEntry).toMatchObject({
      isMain: false,
      branchName: handle.branchName,
    });
    expect(isolatedEntry?.headSha).toMatch(/^[a-f0-9]{7,40}$/i);

    // Bloqueia tentativa de remover worktree principal
    await expect(
      removeWorktreeByPathSafe({
        repoPath: repoDir,
        worktreePath: repoDir,
      })
    ).rejects.toThrow(WorktreeError);

    // Bloqueia tentativa de path traversal fora do repositório, traversal interno e caminho vazio
    await expect(
      removeWorktreeByPathSafe({
        repoPath: repoDir,
        worktreePath: path.resolve(repoDir, ".."),
      })
    ).rejects.toThrow(WorktreeError);

    await expect(
      removeWorktreeByPathSafe({
        repoPath: repoDir,
        worktreePath: path.join(repoDir, ".worktrees", "..", "README.md"),
      })
    ).rejects.toThrow(WorktreeError);

    await expect(
      removeWorktreeByPathSafe({
        repoPath: repoDir,
        worktreePath: "   ",
      })
    ).rejects.toThrow(WorktreeError);

    // Remove o worktree isolado com deleteBranch
    await removeWorktreeByPathSafe({
      repoPath: repoDir,
      worktreePath: handle.workspacePath,
      deleteBranch: true,
      branchName: handle.branchName,
    });

    const entriesAfter = await listProjectWorktrees(repoDir);
    expect(
      entriesAfter.some(
        (e) =>
          normalizeForCompare(e.worktreePath) ===
          normalizeForCompare(handle.workspacePath)
      )
    ).toBe(false);
    expect(fs.existsSync(handle.workspacePath)).toBe(false);
    const branchList = execFileSync(
      "git",
      ["branch", "--list", handle.branchName],
      { cwd: repoDir, encoding: "utf8" }
    ).trim();
    expect(branchList).toBe("");
  });
});
