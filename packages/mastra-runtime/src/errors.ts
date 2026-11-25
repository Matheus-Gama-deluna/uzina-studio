export type WorkflowRuntimeErrorCode =
  | "DELIVERABLE_NOT_FOUND"
  | "DELIVERABLE_LOCKED"
  | "DECISION_NOT_FOUND"
  | "DECISION_ALREADY_RESOLVED"
  | "WORKFLOW_ALREADY_RUNNING"
  | "WORKFLOW_NOT_SUSPENDED"
  | "WORKFLOW_RUN_NOT_FOUND"
  | "INVALID_WORKFLOW_INPUT"
  | "MISSING_PRECONDITION"
  | "EXECUTION_FAILED"
  | "FORBIDDEN_PROJECT_SCOPE"
  | "FORBIDDEN_THREAD_ACCESS"
  | "FORBIDDEN_SESSION_ACCESS"
  | "SESSION_NOT_ACTIVE"
  | "SESSION_NOT_FOUND"
  | "BUDGET_CAP_EXCEEDED"
  | "TOOL_POLICY_DENIED"
  | "INVALID_MODE_TRANSITION"
  | "AGENCY_NO_RESPONSE";

export class WorkflowRuntimeError extends Error {
  readonly statusCode: number;
  readonly code: WorkflowRuntimeErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(params: {
    message: string;
    statusCode: number;
    code: WorkflowRuntimeErrorCode;
    details?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(params.message, params.cause ? { cause: params.cause } : undefined);
    this.name = "WorkflowRuntimeError";
    this.statusCode = params.statusCode;
    this.code = params.code;
    this.details = params.details;
  }
}
