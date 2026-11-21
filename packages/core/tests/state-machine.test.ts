import { describe, expect, test } from "vitest";
import {
  assertValidTransition,
  canTransition,
  getAllowedNextStatuses,
  type TransitionContext,
} from "../src/index.js";

describe("@uzina/core — Deliverable State Machine", () => {
  const defaultCtx: TransitionContext = {
    hasUi: false,
    verifyAttempts: 0,
    maxVerifyAttempts: 3,
  };

  test.each([
    { from: "discovery", to: "spec_review", ctx: defaultCtx, ok: true },
    { from: "discovery", to: "failed", ctx: defaultCtx, ok: true },
    { from: "spec_review", to: "visual_studio", ctx: { ...defaultCtx, hasUi: true }, ok: true },
    { from: "spec_review", to: "contract_tests", ctx: { ...defaultCtx, hasUi: true }, ok: false },
    { from: "spec_review", to: "contract_tests", ctx: { ...defaultCtx, hasUi: false }, ok: true },
    { from: "spec_review", to: "visual_studio", ctx: { ...defaultCtx, hasUi: false }, ok: false },
    { from: "spec_review", to: "failed", ctx: { ...defaultCtx, hasUi: true }, ok: true },
    { from: "visual_studio", to: "contract_tests", ctx: { ...defaultCtx, hasUi: true }, ok: true },
    { from: "visual_studio", to: "failed", ctx: { ...defaultCtx, hasUi: true }, ok: true },
    { from: "contract_tests", to: "building", ctx: defaultCtx, ok: true },
    { from: "contract_tests", to: "failed", ctx: defaultCtx, ok: true },
    { from: "building", to: "verifying", ctx: defaultCtx, ok: true },
    { from: "building", to: "failed", ctx: defaultCtx, ok: true },
    { from: "verifying", to: "decision_pending", ctx: defaultCtx, ok: true },
    { from: "verifying", to: "building", ctx: { ...defaultCtx, verifyAttempts: 1, maxVerifyAttempts: 3 }, ok: true },
    { from: "verifying", to: "building", ctx: { ...defaultCtx, verifyAttempts: 3, maxVerifyAttempts: 3 }, ok: false },
    { from: "verifying", to: "failed", ctx: defaultCtx, ok: true },
    { from: "decision_pending", to: "approved", ctx: defaultCtx, ok: true },
    { from: "decision_pending", to: "building", ctx: defaultCtx, ok: true },
    { from: "decision_pending", to: "failed", ctx: defaultCtx, ok: true },
    { from: "approved", to: "merged", ctx: defaultCtx, ok: true },
    { from: "building", to: "paused", ctx: defaultCtx, ok: true },
    { from: "paused", to: "building", ctx: { ...defaultCtx, pausedFromStatus: "building" }, ok: true },
    { from: "paused", to: "contract_tests", ctx: { ...defaultCtx, pausedFromStatus: "building" }, ok: false },
    { from: "paused", to: "failed", ctx: { ...defaultCtx, pausedFromStatus: "building" }, ok: true },
    { from: "discovery", to: "merged", ctx: defaultCtx, ok: false },
    { from: "merged", to: "building", ctx: defaultCtx, ok: false },
  ] as const)(
    "transição $from -> $to (hasUi=$ctx.hasUi) esperada=$ok",
    ({ from, to, ctx, ok }) => {
      expect(canTransition(from, to, ctx)).toBe(ok);
      if (ok) {
        expect(() => assertValidTransition(from, to, ctx)).not.toThrow();
      } else {
        expect(() => assertValidTransition(from, to, ctx)).toThrow(
          /Transição inválida/
        );
      }
    }
  );

  test("getAllowedNextStatuses retorna lista coerente para spec_review e paused", () => {
    expect(getAllowedNextStatuses("spec_review", { hasUi: true })).toEqual([
      "visual_studio",
      "failed",
      "paused",
    ]);
    expect(
      getAllowedNextStatuses("paused", {
        hasUi: false,
        pausedFromStatus: "verifying",
      })
    ).toEqual(["verifying", "failed"]);
  });
});
