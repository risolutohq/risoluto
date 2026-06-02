import { describe, expect, it } from "vitest";

import {
  observeExternalStatusChange,
  projectWorkflowRunStatus,
  WorkflowRunStatusProjectionError,
} from "../../src/workflow-run/status-projection.js";

describe("workflow-run status projection mappings", () => {
  it("blocks projection when the Run Status has no adapter mapping", () => {
    expect(() =>
      projectWorkflowRunStatus({
        workflowRunId: "wr_unmapped",
        workflowDefinitionId: "single-operator-afk-coder",
        provider: "linear",
        runStatus: "waiting_for_operator",
        workspaceMapping: {
          accepted: "Triage",
          queued: "Todo",
          running: "In Progress",
          blocked: "Blocked",
          done: "Done",
          cancelled: "Canceled",
        },
      }),
    ).toThrow(new WorkflowRunStatusProjectionError("no linear status mapping for waiting_for_operator on wr_unmapped"));
  });

  it("uses workflow-level mapping before workspace-level mapping", () => {
    const projection = projectWorkflowRunStatus({
      workflowRunId: "wr_override",
      workflowDefinitionId: "single-operator-afk-coder",
      provider: "github",
      runStatus: "blocked",
      workspaceMapping: {
        accepted: "backlog",
        queued: "todo",
        running: "in-progress",
        waiting_for_operator: "waiting",
        blocked: "blocked",
        done: "done",
        cancelled: "closed",
      },
      workflowMapping: {
        blocked: "needs-human",
      },
    });

    expect(projection).toEqual({
      workflowRunId: "wr_override",
      workflowDefinitionId: "single-operator-afk-coder",
      provider: "github",
      runStatus: "blocked",
      externalStatus: "needs-human",
      mappingScope: "workflow",
    });
  });

  it("records external status changes without changing canonical Run Status", () => {
    const observation = observeExternalStatusChange({
      workflowRunId: "wr_truth",
      workflowDefinitionId: "single-operator-afk-coder",
      provider: "linear",
      canonicalRunStatus: "running",
      externalStatus: "Done",
      observedAt: "2026-05-31T20:45:00.000Z",
    });

    expect(observation).toEqual({
      workflowRunId: "wr_truth",
      workflowDefinitionId: "single-operator-afk-coder",
      provider: "linear",
      canonicalRunStatus: "running",
      externalStatus: "Done",
      observedAt: "2026-05-31T20:45:00.000Z",
    });
  });
});
