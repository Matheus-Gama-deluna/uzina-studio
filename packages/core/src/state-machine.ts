import type { DeliverableStatus } from "@uzina/contracts";

export interface TransitionContext {
  hasUi: boolean;
  pausedFromStatus?: DeliverableStatus | null;
  verifyAttempts?: number;
  maxVerifyAttempts?: number;
}

const PAUSABLE_STATUSES = new Set<DeliverableStatus>([
  "discovery",
  "spec_review",
  "visual_studio",
  "contract_tests",
  "building",
  "verifying",
  "decision_pending",
  "approved",
]);

export function getAllowedNextStatuses(
  from: DeliverableStatus,
  ctx: TransitionContext
): DeliverableStatus[] {
  const next: DeliverableStatus[] = [];

  switch (from) {
    case "discovery":
      next.push("spec_review", "failed");
      break;
    case "spec_review":
      next.push(ctx.hasUi ? "visual_studio" : "contract_tests", "failed");
      break;
    case "visual_studio":
      next.push("contract_tests", "failed");
      break;
    case "contract_tests":
      next.push("building", "failed");
      break;
    case "building":
      next.push("verifying", "failed");
      break;
    case "verifying": {
      next.push("decision_pending");
      const attempts = ctx.verifyAttempts ?? 0;
      const maxAttempts = ctx.maxVerifyAttempts ?? 3;
      if (attempts < maxAttempts) {
        next.push("building");
      }
      next.push("failed");
      break;
    }
    case "decision_pending":
      next.push("approved", "building", "failed");
      break;
    case "approved":
      next.push("merged", "failed");
      break;
    case "paused":
      if (ctx.pausedFromStatus && ctx.pausedFromStatus !== "paused") {
        next.push(ctx.pausedFromStatus);
      }
      next.push("failed");
      return next;
    case "merged":
    case "failed":
      return [];
  }

  if (PAUSABLE_STATUSES.has(from)) {
    next.push("paused");
  }

  return next;
}

export function canTransition(
  from: DeliverableStatus,
  to: DeliverableStatus,
  ctx: TransitionContext
): boolean {
  if (from === to) {
    return false;
  }
  return getAllowedNextStatuses(from, ctx).includes(to);
}

export function assertValidTransition(
  from: DeliverableStatus,
  to: DeliverableStatus,
  ctx: TransitionContext
): void {
  if (!canTransition(from, to, ctx)) {
    throw new Error(
      `Transição inválida de deliverable: '${from}' -> '${to}'`
    );
  }
}
