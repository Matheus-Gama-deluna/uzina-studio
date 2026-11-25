import { describe, expect, test } from "vitest";
import { probeDockerDaemon } from "../src/index.js";

describe("Slice 25 — probeDockerDaemon (@uzina/opencode-bridge)", () => {
  test.each([
    {
      label: "daemon ativo retorna ready=true e versão limpa",
      mockResult: {
        exitCode: 0,
        stdout: "29.10.0\n",
        stderr: "",
        timedOut: false,
      },
      expected: { ready: true, version: "29.10.0" },
    },
    {
      label: "daemon indisponível retorna ready=false e DOCKER_UNAVAILABLE",
      mockResult: {
        exitCode: 1,
        stdout: "",
        stderr: "Cannot connect to the Docker daemon",
        timedOut: false,
      },
      expected: {
        ready: false,
        version: null,
        errorCode: "DOCKER_UNAVAILABLE",
      },
    },
    {
      label: "timeout no comando retorna ready=false e DOCKER_TIMEOUT",
      mockResult: {
        exitCode: 1,
        stdout: "",
        stderr: "",
        timedOut: true,
      },
      expected: {
        ready: false,
        version: null,
        errorCode: "DOCKER_TIMEOUT",
      },
    },
    {
      label: "exitCode 0 com stdout vazio retorna DOCKER_UNAVAILABLE",
      mockResult: {
        exitCode: 0,
        stdout: "   \n",
        stderr: "",
        timedOut: false,
      },
      expected: {
        ready: false,
        version: null,
        errorCode: "DOCKER_UNAVAILABLE",
      },
    },
    {
      label: "exceção lançada pelo runner retorna DOCKER_UNAVAILABLE",
      runnerError: new Error("ENOENT docker"),
      expected: {
        ready: false,
        version: null,
        errorCode: "DOCKER_UNAVAILABLE",
      },
    },
  ])("$label", async ({ mockResult, runnerError, expected }) => {
    const res = await probeDockerDaemon({
      timeoutMs: 1500,
      runner: async () => {
        if (runnerError) throw runnerError;
        return mockResult!;
      },
    });
    expect(res).toEqual(expected);
  });
});
