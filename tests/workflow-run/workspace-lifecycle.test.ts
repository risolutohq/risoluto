import { describe, expect, it, vi } from "vitest";

import {
  classifyWorkflowRunWorktreeRetention,
  prepareWorkflowRunWorktree,
  renderWorkflowRunBranchName,
  WorkflowRunBranchTemplateError,
  WorkflowRunAutoStashNotImplementedError,
  WorkflowRunDirtyWorkspaceError,
} from "../../src/workflow-run/workspace-lifecycle.js";

describe("workflow-run workspace lifecycle", () => {
  it("renders a sanitized bounded branch from allowed workflow-run tokens and adds a collision suffix", () => {
    const branchName = renderWorkflowRunBranchName({
      template: "afk/{workflow}/{date}-{short-intent}-{run-id}",
      workflowDefinitionId: "single-operator-afk-coder",
      workflowRunId: "wr_1234567890abcdef",
      createdAt: "2026-05-31T16:00:00.000Z",
      intent: "Fix flaky CI: retain PR worktree!",
      existingBranches: ["afk/single-operator-afk-coder/20260531-fix-flaky-ci-retain-pr-worktree-wr-123456"],
      maxLength: 80,
    });

    expect(branchName).toBe("afk/single-operator-afk-coder/20260531-fix-flaky-ci-retain-pr-worktree-wr-1234-2");
    expect(branchName.length).toBeLessThanOrEqual(80);
  });

  it("rejects branch templates with tokens outside the allowed set", () => {
    expect(() =>
      renderWorkflowRunBranchName({
        template: "afk/{tracker-id}/{run-id}",
        workflowDefinitionId: "single-operator-afk-coder",
        workflowRunId: "wr_123",
        createdAt: "2026-05-31T16:00:00.000Z",
        intent: "Fix bug",
        existingBranches: [],
        maxLength: 96,
      }),
    ).toThrow(WorkflowRunBranchTemplateError);
  });

  it("rejects a dirty checkout before creating a worktree when dirty policy is reject", async () => {
    const createWorktree = vi.fn(async () => undefined);

    await expect(
      prepareWorkflowRunWorktree({
        dirtyPolicy: "reject",
        existingCheckoutPath: "/repo/app",
        hasUncommittedChanges: async () => true,
        createWorktree,
      }),
    ).rejects.toThrow(WorkflowRunDirtyWorkspaceError);

    expect(createWorktree).not.toHaveBeenCalled();
  });

  it("rejects a dirty checkout before creating a worktree when auto_stash is not implemented", async () => {
    const createWorktree = vi.fn(async () => undefined);

    await expect(
      prepareWorkflowRunWorktree({
        dirtyPolicy: "auto_stash",
        existingCheckoutPath: "/repo/app",
        hasUncommittedChanges: async () => true,
        createWorktree,
      }),
    ).rejects.toThrow(WorkflowRunAutoStashNotImplementedError);

    expect(createWorktree).not.toHaveBeenCalled();
  });

  it("retains open-PR worktrees even after the default retention window expires", () => {
    const retention = classifyWorkflowRunWorktreeRetention({
      finishedAt: "2026-05-20T00:00:00.000Z",
      now: "2026-05-31T00:00:00.000Z",
      retentionDays: 7,
      pullRequestState: "open",
      runStatus: "done",
    });

    expect(retention).toEqual({
      action: "keep",
      reason: "pull_request_open",
    });
  });
});
