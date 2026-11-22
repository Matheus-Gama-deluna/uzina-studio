import { describe, expect, test } from "vitest";
import { auditTestSource } from "../src/test-auditor.js";

describe("@uzina/core/test-auditor — Static Test Anti-Pattern Auditor", () => {
  test.each([
    {
      name: "missing_assertion when test body has no expect/assert",
      code: `
        it("does work without asserting", () => {
          const sum = 2 + 2;
          console.log(sum);
        });
      `,
      expectedRule: "missing_assertion",
      shouldPass: false,
    },
    {
      name: "trivial_assertion_only when only toBeTruthy or toBeDefined exists",
      code: `
        test("only checks truthy", () => {
          const obj = { ok: true };
          expect(obj).toBeDefined();
          expect(obj.ok).toBeTruthy();
        });
      `,
      expectedRule: "trivial_assertion_only",
      shouldPass: false,
    },
    {
      name: "swallowed_exception with empty or logging catch block",
      code: `
        it("swallows failure silently", async () => {
          try {
            await Promise.reject(new Error("boom"));
          } catch (err) {
            console.warn(err);
          }
          expect(1 + 1).toBe(2);
        });
      `,
      expectedRule: "swallowed_exception",
      shouldPass: false,
    },
    {
      name: "arbitrary_sleep with setTimeout or sleep",
      code: `
        it("waits arbitrarily", async () => {
          await new Promise((resolve) => setTimeout(resolve, 250));
          expect(true).toBe(true);
        });
      `,
      expectedRule: "arbitrary_sleep",
      shouldPass: false,
    },
    {
      name: "duplicate_test_blocks with 3+ repeated bodies outside test.each",
      code: `
        test("case A", () => {
          const r = validate("a");
          expect(r.ok).toBe(true);
        });
        test("case B", () => {
          const r = validate("b");
          expect(r.ok).toBe(true);
        });
        test("case C", () => {
          const r = validate("c");
          expect(r.ok).toBe(true);
        });
      `,
      expectedRule: "duplicate_test_blocks",
      shouldPass: false,
    },
    {
      name: "passes legitimate test with strong assertions and test.each",
      code: `
        test.each([{ a: 1 }, { a: 2 }, { a: 3 }])("adds $a", ({ a }) => {
          expect(a + 1).toBeGreaterThan(1);
        });
      `,
      expectedRule: null,
      shouldPass: true,
    },
    {
      name: "passes try/catch that asserts inside catch",
      code: `
        it("verifies error code in catch", () => {
          try {
            runDangerous();
          } catch (err) {
            expect((err as Error).message).toContain("denied");
          }
        });
      `,
      expectedRule: null,
      shouldPass: true,
    },
    {
      name: "passes trivial assertion paired with meaningful assertion",
      code: `
        it("checks property defined and exact value", () => {
          const user = { role: "admin" };
          expect(user).toBeDefined();
          expect(user.role).toBe("admin");
        });
      `,
      expectedRule: null,
      shouldPass: true,
    },
    {
      name: "honors explicit suppression pragma with rationale",
      code: `
        it("requires timer check in clock helper", async () => {
          // @uzina-test-audit-ignore arbitrary_sleep: valida TTL real em micro-janela
          await new Promise((resolve) => setTimeout(resolve, 15));
          expect(1 + 1).toBe(2);
        });
      `,
      expectedRule: null,
      shouldPass: true,
    },
  ])("$name", ({ code, expectedRule, shouldPass }) => {
    const result = auditTestSource("sample.test.ts", code);
    expect(result.passed).toBe(shouldPass);
    if (expectedRule) {
      expect(result.violations.some((v) => v.rule === expectedRule)).toBe(true);
    } else {
      expect(result.violations).toHaveLength(0);
    }
  });
});
