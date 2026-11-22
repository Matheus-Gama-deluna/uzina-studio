import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import {
  DangerousCommandError,
  DockerExecutionWorkspace,
  assertSafeDockerOptions,
  buildDockerRunArgs,
} from "../src/index.js";

function initTempGitRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-s10-docker-repo-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "ci@uzina.local"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Uzina CI"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "index.ts"), "export const v = 1;\n", "utf8");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-m", "chore: init"], { cwd: dir });
  return dir;
}

describe("@uzina/opencode-bridge — Slice 10 DockerExecutionWorkspace (Hardening & Contrato)", () => {
  const tempDirs: string[] = [];

  afterAll(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("buildDockerRunArgs injeta todas as flags obrigatórias de hardening", () => {
    const args = buildDockerRunArgs({
      containerName: "uzina-test-01",
      workspacePath: "/tmp/worktree-1",
      command: "node",
      args: ["--version"],
    });

    expect(args).toContain("--cap-drop");
    expect(args).toContain("ALL");
    expect(args).toContain("--security-opt");
    expect(args).toContain("no-new-privileges");
    expect(args).toContain("--read-only");
    expect(args).toContain("--network");
    expect(args).toContain("none");
    expect(args).toContain("--user");
    expect(args).toContain("1001:1001");
    expect(args).toContain("--pids-limit");
    expect(args).toContain("--rm");
  });

  test.each([
    {
      name: "proíbe user root",
      input: { workspacePath: "/tmp/ws", user: "root", network: "none" },
    },
    {
      name: "proíbe uid 0",
      input: { workspacePath: "/tmp/ws", user: "0:0", network: "none" },
    },
    {
      name: "proíbe rede bridge aberta",
      input: { workspacePath: "/tmp/ws", user: "1001:1001", network: "host" },
    },
    {
      name: "proíbe montagem de docker.sock",
      input: {
        workspacePath: "/var/run/docker.sock",
        user: "1001:1001",
        network: "none",
      },
    },
  ])("assertSafeDockerOptions: $name", ({ input }) => {
    expect(() => assertSafeDockerOptions(input)).toThrow(DangerousCommandError);
  });

  test("cumpre contrato ExecutionWorkspace (prepare -> exec -> getDiff -> cleanup) e limpa container em timeout", async () => {
    const repoDir = initTempGitRepo();
    tempDirs.push(repoDir);

    const capturedArgs: string[][] = [];
    const cleanedContainers: string[] = [];

    const ws = new DockerExecutionWorkspace({
      dockerRunner: async ({ args }) => {
        capturedArgs.push(args);
        return {
          exitCode: 124,
          stdout: "",
          stderr: "timeout",
          timedOut: true,
        };
      },
      dockerCleanupRunner: async (name) => {
        cleanedContainers.push(name);
      },
    });

    const handle = await ws.prepare(repoDir, "main", "deliv-s10-test");
    expect(handle.branchName).toContain("deliv-s10-test");

    fs.writeFileSync(
      path.join(handle.workspacePath, "feature.ts"),
      "export const feature = true;\n",
      "utf8"
    );

    const execRes = await ws.exec("node", ["--version"], { timeoutMs: 1000 });
    expect(execRes.timedOut).toBe(true);
    expect(capturedArgs[0]).toContain("--cap-drop");
    expect(cleanedContainers).toHaveLength(1);

    const diff = await ws.getDiff("main", { includeUntracked: true });
    expect(diff).toContain("feature.ts");

    await ws.cleanup({ deleteBranch: true });
    expect(fs.existsSync(handle.workspacePath)).toBe(false);
  });
});
