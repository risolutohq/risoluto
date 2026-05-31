import { describe, expect, it } from "vitest";

import {
  createRetryRunAttempt,
  parseWorkflowRunStatus,
  transitionWorkflowRunStatus,
  WorkflowRunStatusError,
} from "../../src/workflow-run/run-status.js";

describe("workflow-run Run Status lifecycle", () => {
  it("progresses accepted to queued to running and blocks failed prerequisites", () => {
    const queued = transitionWorkflowRunStatus({ from: "accepted", event: "queue" });
    const running = transitionWorkflowRunStatus({ from: queued.to, event: "start" });
    const blocked = transitionWorkflowRunStatus({ from: running.to, event: "prerequisite_failed" });

    expect([queued.to, running.to, blocked.to]).toEqual(["queued", "running", "blocked"]);
  });

  it("creates retry attempts under the same Workflow Run id", () => {
    const retry = createRetryRunAttempt({
      workflowRunId: "wr_123",
      previousAttempts: [
        { id: "attempt-1", workflowRunId: "wr_123", attemptNumber: 1, reason: "initial" },
        { id: "attempt-2", workflowRunId: "wr_123", attemptNumber: 2, reason: "retry" },
      ],
      attemptId: "attempt-3",
    });

    expect(retry).toEqual({
      id: "attempt-3",
      workflowRunId: "wr_123",
      attemptNumber: 3,
      reason: "retry",
    });
  });

  it("rejects Workflow State values as Run Status values", () => {
    expect(() => parseWorkflowRunStatus("validate")).toThrow(WorkflowRunStatusError);
  });
});
