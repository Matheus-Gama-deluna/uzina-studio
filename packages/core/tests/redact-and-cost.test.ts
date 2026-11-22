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
  ])("$name", ({ input, expectedNotContain }) => {
    const out = redactSensitiveText(input);
    expect(out).not.toContain(expectedNotContain);
    expect(out).toContain("[REDACTED");
  });

  test("estimateTokenCostUsd calculates positive cost for known models and 0 fallback for unknown", () => {
    const known = estimateTokenCostUsd("claude-sonnet-4", {
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheReadTokens: 200_000,
    });
    expect(known).toBeGreaterThan(0);

    const unknown = estimateTokenCostUsd("custom-local-ollama", {
      inputTokens: 5000,
      outputTokens: 1200,
      cacheReadTokens: 0,
    });
    expect(unknown).toBe(0);
  });
});
