import { describe, expect, test } from "vitest";
import { estimateTokenCostUsd, redactSensitiveText } from "../src/index.js";

describe("@uzina/core — redactSensitiveText & estimateTokenCostUsd", () => {
  test.each([
    {
      name: "redacts AWS access key",
      input: "aws_access_key_id=AKIAIOSFODNN7EXAMPLE123",
      expectedNotContain: "AKIAIOSFODNN7EXAMPLE123",
    },
    {
      name: "redacts GitHub PAT",
      input: "token=ghp_1234567890abcdefghijklmnopqrstuvwxyz1234",
      expectedNotContain: "ghp_1234567890abcdefghijklmnopqrstuvwxyz1234",
    },
    {
      name: "redacts OpenAI/Anthropic sk- key",
      input: "OPENAI_API_KEY=sk-proj-abc123def456ghi789jkl012mno345",
      expectedNotContain: "sk-proj-abc123def456ghi789jkl012mno345",
    },
    {
      name: "redacts Postgres URI password",
      input: "postgres://uzina_user:supersecretpass99@db.internal:5432/uzina",
      expectedNotContain: "supersecretpass99",
    },
    {
      name: "redacts PEM private key block",
      input:
        "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcw\n-----END PRIVATE KEY-----",
      expectedNotContain: "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcw",
    },
    {
      name: "redacts Bearer token without colon or equals",
      input: "Authorization header sent: Bearer opaque_secret_token_987654321",
      expectedNotContain: "opaque_secret_token_987654321",
      knownSecrets: undefined,
    },
    {
      name: "redacts Google AIza key",
      input: "GEMINI_KEY=AIzaSyDummyGoogleApiKey1234567890abcdef",
      expectedNotContain: "AIzaSyDummyGoogleApiKey1234567890abcdef",
      knownSecrets: undefined,
    },
    {
      name: "redacts JWT eyJ token",
      input: "jwt=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
      expectedNotContain: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
      knownSecrets: undefined,
    },
    {
      name: "redacts explicit knownSecrets without prefix pattern",
      input: "Custom secret leaked: custom-tenant-secret-xyz999888",
      expectedNotContain: "custom-tenant-secret-xyz999888",
      knownSecrets: ["custom-tenant-secret-xyz999888"],
    },
  ])("$name", ({ input, expectedNotContain, knownSecrets }) => {
    const out = redactSensitiveText(input, knownSecrets);
    expect(out).not.toContain(expectedNotContain);
    expect(out).toContain("[REDACTED");
  });

  test.each([
    {
      label: "claude-sonnet-4 exact cost with cache",
      modelId: "claude-sonnet-4",
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 100_000,
        cacheReadTokens: 200_000,
      },
      expected: 4.56,
    },
    {
      label: "gpt-4o-mini exact cost",
      modelId: "gpt-4o-mini",
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 500_000,
        cacheReadTokens: 0,
      },
      expected: 0.45,
    },
    {
      label: "unknown local model falls back to 0",
      modelId: "custom-local-ollama",
      usage: {
        inputTokens: 5000,
        outputTokens: 1200,
        cacheReadTokens: 0,
      },
      expected: 0,
    },
    {
      label: "null/undefined model and negative inputs clamp safely to 0",
      modelId: null,
      usage: {
        inputTokens: -100,
        outputTokens: 500,
        cacheReadTokens: 0,
      },
      customPricing: undefined,
      expected: 0,
    },
    {
      label: "customPricing aplica tarifa exata para omni-fast",
      modelId: "omni-fast",
      usage: {
        inputTokens: 500_000,
        outputTokens: 100_000,
        cacheReadTokens: 200_000,
      },
      customPricing: {
        "omni-fast": {
          inputPer1MUsd: 0.4,
          outputPer1MUsd: 1.2,
          cacheReadPer1MUsd: 0.05,
        },
      },
      expected: 0.33,
    },
    {
      label: "customPricing com wildcard '*' aplica tarifa padrao para modelo prefixado",
      modelId: "openai/omni-custom",
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 250_000,
        cacheReadTokens: 0,
      },
      customPricing: {
        "*": {
          inputPer1MUsd: 0.5,
          outputPer1MUsd: 2.0,
        },
      },
      expected: 1.0,
    },
    {
      label: "customPricing sem cacheReadPer1MUsd usa fallback de 10% do inputPer1MUsd",
      modelId: "omni-fast",
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 500_000,
      },
      customPricing: {
        "omni-fast": {
          inputPer1MUsd: 2.0,
          outputPer1MUsd: 4.0,
        },
      },
      expected: 2.1,
    },
    {
      label: "customPricing casa modelo prefixado openai/omni-fast na chave sem prefixo",
      modelId: "openai/omni-fast",
      usage: {
        inputTokens: 500_000,
        outputTokens: 500_000,
        cacheReadTokens: 0,
      },
      customPricing: {
        "omni-fast": {
          inputPer1MUsd: 1.0,
          outputPer1MUsd: 3.0,
        },
      },
      expected: 2.0,
    },
  ])("estimateTokenCostUsd: $label", ({ modelId, usage, customPricing, expected }) => {
    expect(estimateTokenCostUsd(modelId, usage, customPricing)).toBe(expected);
  });
});
