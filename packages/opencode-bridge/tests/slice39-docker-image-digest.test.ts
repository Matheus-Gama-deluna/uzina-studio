import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  DEFAULT_DOCKER_WORKSPACE_IMAGE,
  buildDockerRunArgs,
} from "../src/docker-workspace.js";

describe("Slice 39 P1 #3 — Digest Verificado de DockerExecutionWorkspace", () => {
  test("buildDockerRunArgs usa DEFAULT_DOCKER_WORKSPACE_IMAGE pinado por digest e impõe isolamento padrão", () => {
    expect(DEFAULT_DOCKER_WORKSPACE_IMAGE).toMatch(
      /^node:22-slim@sha256:[0-9a-f]{64}$/
    );
    expect(DEFAULT_DOCKER_WORKSPACE_IMAGE).toBe(
      "node:22-slim@sha256:be979e5523c76fa4d5ca4ebd3099078f220aa47ec39c48ad5b5df9314debd6eb"
    );

    const prevImage = process.env.UZINA_DOCKER_IMAGE;
    delete process.env.UZINA_DOCKER_IMAGE;
    try {
      const args = buildDockerRunArgs({
        containerName: "uzina-ws-digest-check",
        workspacePath: path.resolve("."),
        command: "node",
        args: ["--version"],
      });

      expect(args).toContain(DEFAULT_DOCKER_WORKSPACE_IMAGE);
      expect(args).toContain("--read-only");
      expect(args.slice(-2)).toEqual(["node", "--version"]);
    } finally {
      if (prevImage !== undefined) {
        process.env.UZINA_DOCKER_IMAGE = prevImage;
      }
    }

    expect(() =>
      buildDockerRunArgs({
        containerName: "uzina-ws-unsafe-net",
        workspacePath: path.resolve("."),
        network: "host",
        command: "node",
        args: ["--version"],
      })
    ).toThrow(/Rede Docker não permitida/);
  });
});
