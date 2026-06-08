import type { WorkflowRunStatus } from "./contracts.js";

export type RunStatusTransitionEvent =
  | "queue"
  | "start"
  /**
   * Transitions running → waiting_for_operator.
   * The executor handles the wait-for-operator case entirely in-process without
   * persisting this transition, so 'waiting_for_operator' is never a persisted
   * run status and no resume event exists in this machine.
   */
  | "operator_input_required"
  | "prerequisite_failed"
  | "complete"
  | "cancel";

export interface WorkflowRunStatusTransitionInput {
  readonly from: WorkflowRunStatus;
  readonly event: RunStatusTransitionEvent;
}

export interface WorkflowRunStatusTransition {
  readonly from: WorkflowRunStatus;
  readonly to: WorkflowRunStatus;
  readonly event: RunStatusTransitionEvent;
}

export interface WorkflowRunAttemptIdentity {
  readonly id: string;
  readonly workflowRunId: string;
  readonly attemptNumber: number;
  readonly reason: "initial" | "retry" | "resume";
}

export interface CreateRetryRunAttemptInput {
  readonly workflowRunId: string;
  readonly previousAttempts: readonly WorkflowRunAttemptIdentity[];
  readonly attemptId: string;
}

export const RUN_STATUS_VALUES = [
  "accepted",
  "queued",
  "running",
  "waiting_for_operator",
  "blocked",
  "done",
  "cancelled",
] as const satisfies readonly WorkflowRunStatus[];

export class WorkflowRunStatusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowRunStatusError";
  }
}

export function parseWorkflowRunStatus(value: string): WorkflowRunStatus {
  for (const status of RUN_STATUS_VALUES) {
    if (value === status) {
      return status;
    }
  }
  throw new WorkflowRunStatusError(`invalid Workflow Run status: ${value}`);
}

export function transitionWorkflowRunStatus(input: WorkflowRunStatusTransitionInput): WorkflowRunStatusTransition {
  const to = nextWorkflowRunStatus(input.from, input.event);
  return { ...input, to };
}

export function createRetryRunAttempt(input: CreateRetryRunAttemptInput): WorkflowRunAttemptIdentity {
  assertAttemptsBelongToRun(input.workflowRunId, input.previousAttempts);
  return {
    id: input.attemptId,
    workflowRunId: input.workflowRunId,
    attemptNumber: nextAttemptNumber(input.previousAttempts),
    reason: "retry",
  };
}

function nextWorkflowRunStatus(from: WorkflowRunStatus, event: RunStatusTransitionEvent): WorkflowRunStatus {
  switch (event) {
    case "queue":
      return requireTransition(from, "accepted", "queued", event);
    case "start":
      return requireTransition(from, "queued", "running", event);
    case "operator_input_required":
      return requireTransition(from, "running", "waiting_for_operator", event);
    case "prerequisite_failed":
      return requireActiveTransition(from, "blocked", event);
    case "complete":
      return requireTransition(from, "running", "done", event);
    case "cancel":
      return requireNonTerminalTransition(from, "cancelled", event);
    default:
      return assertNever(event);
  }
}

function requireTransition(
  from: WorkflowRunStatus,
  expected: WorkflowRunStatus,
  to: WorkflowRunStatus,
  event: RunStatusTransitionEvent,
): WorkflowRunStatus {
  if (from !== expected) {
    throw invalidTransition(from, event);
  }
  return to;
}

function requireActiveTransition(
  from: WorkflowRunStatus,
  to: WorkflowRunStatus,
  event: RunStatusTransitionEvent,
): WorkflowRunStatus {
  if (from === "accepted" || from === "queued" || from === "running" || from === "waiting_for_operator") {
    return to;
  }
  throw invalidTransition(from, event);
}

function requireNonTerminalTransition(
  from: WorkflowRunStatus,
  to: WorkflowRunStatus,
  event: RunStatusTransitionEvent,
): WorkflowRunStatus {
  if (from === "blocked" || from === "done" || from === "cancelled") {
    throw invalidTransition(from, event);
  }
  return to;
}

function invalidTransition(from: WorkflowRunStatus, event: RunStatusTransitionEvent): WorkflowRunStatusError {
  return new WorkflowRunStatusError(`cannot apply ${event} while Workflow Run status is ${from}`);
}

function assertAttemptsBelongToRun(
  workflowRunId: string,
  previousAttempts: readonly WorkflowRunAttemptIdentity[],
): void {
  const mismatch = previousAttempts.find((attempt) => attempt.workflowRunId !== workflowRunId);
  if (mismatch) {
    throw new WorkflowRunStatusError(
      `attempt ${mismatch.id} belongs to ${mismatch.workflowRunId}, not ${workflowRunId}`,
    );
  }
}

function nextAttemptNumber(previousAttempts: readonly WorkflowRunAttemptIdentity[]): number {
  return Math.max(0, ...previousAttempts.map((attempt) => attempt.attemptNumber)) + 1;
}

function assertNever(value: never): never {
  throw new WorkflowRunStatusError(`unhandled Run Status transition event: ${value}`);
}
