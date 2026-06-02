import { describe, expect, it } from "vitest";

import { createLifecycleEvent } from "../../src/core/lifecycle-events.js";
import type { Issue } from "../../src/core/types.js";
import { workflowRunRef } from "../../src/orchestrator/worker-outcome/types.js";

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "lin_issue_7",
    identifier: "NIN-7",
    title: "Wire the engine",
    description: null,
    priority: null,
    state: "Todo",
    branchName: null,
    url: null,
    labels: [],
    blockedBy: [],
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

describe("workflow-run identity (CR-03)", () => {
  it("identifies the Workflow Run by its wr_UUID, not the tracker issue id, when known", () => {
    const ref = workflowRunRef(makeIssue({ workflowRunId: "wr_owned_123" }));

    expect(ref.id).toBe("wr_owned_123");
    expect(ref.id).not.toBe("lin_issue_7");
    expect(ref.identifier).toBe("NIN-7");
  });

  it("falls back to the tracker issue id for legacy issues without a wr_UUID", () => {
    expect(workflowRunRef(makeIssue()).id).toBe("lin_issue_7");
  });

  it("stamps the wr_UUID onto lifecycle events so workflow_run.* emissions can adopt it", () => {
    const event = createLifecycleEvent({
      issue: makeIssue({ workflowRunId: "wr_owned_123" }),
      event: "issue_queued",
      message: "queued",
    });

    expect(event.workflowRunId).toBe("wr_owned_123");
    expect(event.issueId).toBe("lin_issue_7");
  });
});
