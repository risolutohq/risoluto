import { describe, expect, it, vi } from "vitest";

import { WorkflowRunStatusProjectionError } from "../../src/workflow-run/status-projection.js";
import { mirrorWorkflowRunStatusToTracker } from "../../src/workflow-run/status-mirror.js";

function createTracker(stateId: string | null) {
  return {
    resolveStateId: vi.fn(async () => stateId),
    updateIssueState: vi.fn(async () => {}),
  };
}

describe("mirrorWorkflowRunStatusToTracker", () => {
  it("blocks the mirror with a clear error when the Run Status is unmapped", async () => {
    const tracker = createTracker("state_id");
    await expect(
      mirrorWorkflowRunStatusToTracker({
        tracker,
        workflowRunId: "wr_unmapped",
        workflowDefinitionId: "single-operator-afk-coder",
        provider: "linear",
        issueId: "issue_1",
        runStatus: "waiting_for_operator",
        workspaceMapping: { running: "In Progress", done: "Done" },
      }),
    ).rejects.toThrow(
      new WorkflowRunStatusProjectionError("no linear status mapping for waiting_for_operator on wr_unmapped"),
    );
    // It must not silently pick a state and push it to the board.
    expect(tracker.updateIssueState).not.toHaveBeenCalled();
  });

  it("lets a workflow-level mapping override the workspace-level mapping", async () => {
    const tracker = createTracker("state_needs_human");
    const result = await mirrorWorkflowRunStatusToTracker({
      tracker,
      workflowRunId: "wr_override",
      workflowDefinitionId: "single-operator-afk-coder",
      provider: "github",
      issueId: "issue_2",
      runStatus: "blocked",
      workspaceMapping: { blocked: "blocked" },
      workflowMapping: { blocked: "needs-human" },
    });

    expect(result.externalStatus).toBe("needs-human");
    expect(result.mappingScope).toBe("workflow");
    expect(tracker.resolveStateId).toHaveBeenCalledWith("needs-human");
    expect(tracker.updateIssueState).toHaveBeenCalledWith("issue_2", "state_needs_human");
  });

  it("skips the board write (without error) when the projected state is unknown to the tracker", async () => {
    const tracker = createTracker(null);
    const result = await mirrorWorkflowRunStatusToTracker({
      tracker,
      workflowRunId: "wr_skip",
      workflowDefinitionId: "single-operator-afk-coder",
      provider: "linear",
      issueId: "issue_3",
      runStatus: "done",
      workspaceMapping: { done: "Done" },
    });

    expect(result.applied).toBe(false);
    expect(result.externalStatus).toBe("Done");
    expect(tracker.updateIssueState).not.toHaveBeenCalled();
  });
});
