import { describe, expect, test } from "vitest";
import { validateDockerHostEndpoint } from "../src/index.js";

describe("Slice 42 — Validação de Endpoint DOCKER_HOST (Proxy Sidecar)", () => {
  test.each([
    {
      label: "undefined usa socket padrão local",
      input: undefined,
      expectedOk: true,
      expectedMode: "local_default",
    },
    {
      label: "string vazia usa socket padrão local",
      input: "   ",
      expectedOk: true,
      expectedMode: "local_default",
    },
    {
      label: "unix socket válido",
      input: "unix:///var/run/docker.sock",
      expectedOk: true,
      expectedMode: "unix_socket",
    },
    {
      label: "npipe Windows válido",
      input: "npipe:////./pipe/docker_engine",
      expectedOk: true,
      expectedMode: "npipe",
    },
    {
      label: "tcp sidecar docker-proxy interno permitido",
      input: "tcp://docker-proxy:2375",
      expectedOk: true,
      expectedMode: "tcp_loopback_or_proxy",
    },
    {
      label: "tcp sidecar uzina-docker-proxy interno permitido",
      input: "tcp://uzina-docker-proxy:2375",
      expectedOk: true,
      expectedMode: "tcp_loopback_or_proxy",
    },
    {
      label: "tcp loopback 127.0.0.1 permitido",
      input: "tcp://127.0.0.1:2375",
      expectedOk: true,
      expectedMode: "tcp_loopback_or_proxy",
    },
    {
      label: "tcp bind 0.0.0.0 bloqueado",
      input: "tcp://0.0.0.0:2375",
      expectedOk: false,
      expectedMode: "invalid",
    },
    {
      label: "tcp IP externo bloqueado",
      input: "tcp://8.8.8.8:2375",
      expectedOk: false,
      expectedMode: "invalid",
    },
    {
      label: "protocolo http externo bloqueado",
      input: "http://evil.com:2375",
      expectedOk: false,
      expectedMode: "invalid",
    },
    {
      label: "tcp sem porta explícita bloqueado",
      input: "tcp://docker-proxy",
      expectedOk: false,
      expectedMode: "invalid",
    },
  ])(
    "validateDockerHostEndpoint ($label)",
    ({ input, expectedOk, expectedMode }) => {
      const result = validateDockerHostEndpoint(input);
      expect(result.ok).toBe(expectedOk);
      expect(result.mode).toBe(expectedMode);
      if (result.ok) {
        expect(result.normalizedHost).toBe(
          input?.trim() ? input.trim() : null
        );
      } else {
        expect(result.reason.length).toBeGreaterThan(5);
      }
    }
  );
});
