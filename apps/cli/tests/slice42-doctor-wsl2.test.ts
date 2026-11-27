import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { runCli } from "../src/index.js";

describe("@uzina/cli — Slice 42 Detecção WSL2 Docker no uzina doctor", () => {
  const tempDirs: string[] = [];

  afterAll(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reporta wslAvailable=true, wslVersion e hint em JSON quando Windows não tem Docker nativo mas tem WSL2", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-cli-s42-"));
    tempDirs.push(tempDir);

    const out: string[] = [];
    const exitCode = await runCli(["doctor", "--json", "--data-dir", tempDir], {
      env: {},
      stdout: (line) => out.push(line),
      checkGitAvailable: () => ({ ok: true, version: "git version 2.51.0" }),
      platform: "win32",
      checkDockerAvailable: () => ({ available: false, version: null }),
      probeWslDocker: () => ({
        available: true,
        version: "Docker version 29.1.5, build 0e6fee6",
      }),
      securityDeps: {
        commandRunner: async () => ({
          exitCode: 127,
          stdout: "",
          stderr: "ENOENT",
          missingBinary: true,
        }),
      },
    });

    expect(exitCode).toBe(0);
    const payload = JSON.parse(out[0]!) as {
      docker: {
        available: boolean;
        version: string | null;
        wslAvailable: boolean;
        wslVersion: string | null;
        hint: string | null;
      };
    };

    expect(payload.docker.available).toBe(false);
    expect(payload.docker.version).toBeNull();
    expect(payload.docker.wslAvailable).toBe(true);
    expect(payload.docker.wslVersion).toBe("Docker version 29.1.5, build 0e6fee6");
    expect(payload.docker.hint).toContain("WSL2");
  });

  test("exibe resumo Docker WSL2 e dica na saída textual de uzina doctor", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-cli-s42-txt-"));
    tempDirs.push(tempDir);

    const out: string[] = [];
    const exitCode = await runCli(["doctor", "--data-dir", tempDir], {
      env: {},
      stdout: (line) => out.push(line),
      checkGitAvailable: () => ({ ok: true, version: "git version 2.51.0" }),
      platform: "win32",
      checkDockerAvailable: () => ({ available: false, version: null }),
      probeWslDocker: () => ({
        available: true,
        version: "Docker version 29.1.5",
      }),
      securityDeps: {
        commandRunner: async () => ({
          exitCode: 127,
          stdout: "",
          stderr: "ENOENT",
          missingBinary: true,
        }),
      },
    });

    expect(exitCode).toBe(0);
    const joined = out.join("\n");
    expect(joined).toContain("WSL2: Docker version 29.1.5");
    expect(joined).toContain("Dica Docker:");
  });

  test("não reporta WSL2 em Windows quando ausente nem sonda WSL2 em Linux", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-cli-s42-neg-"));
    tempDirs.push(tempDir);

    const winOut: string[] = [];
    const winCode = await runCli(["doctor", "--json", "--data-dir", tempDir], {
      env: {},
      stdout: (line) => winOut.push(line),
      checkGitAvailable: () => ({ ok: true, version: "git version 2.51.0" }),
      platform: "win32",
      checkDockerAvailable: () => ({ available: false, version: null }),
      probeWslDocker: () => ({ available: false, version: null }),
      securityDeps: {
        commandRunner: async () => ({
          exitCode: 127,
          stdout: "",
          stderr: "ENOENT",
          missingBinary: true,
        }),
      },
    });
    expect(winCode).toBe(0);
    const winPayload = JSON.parse(winOut[0]!) as {
      docker: { wslAvailable: boolean; hint: string | null };
    };
    expect(winPayload.docker.wslAvailable).toBe(false);
    expect(winPayload.docker.hint).toBeNull();

    let wslProbeCalledOnLinux = false;
    const linuxOut: string[] = [];
    const linuxCode = await runCli(
      ["doctor", "--json", "--data-dir", tempDir],
      {
        env: {},
        stdout: (line) => linuxOut.push(line),
        checkGitAvailable: () => ({ ok: true, version: "git version 2.51.0" }),
        platform: "linux",
        checkDockerAvailable: () => ({ available: false, version: null }),
        probeWslDocker: () => {
          wslProbeCalledOnLinux = true;
          return { available: true, version: "should-not-run" };
        },
        securityDeps: {
          commandRunner: async () => ({
            exitCode: 127,
            stdout: "",
            stderr: "ENOENT",
            missingBinary: true,
          }),
        },
      }
    );
    expect(linuxCode).toBe(0);
    expect(wslProbeCalledOnLinux).toBe(false);
  });
});
