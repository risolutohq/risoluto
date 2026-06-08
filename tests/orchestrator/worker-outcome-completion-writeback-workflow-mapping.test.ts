import { describe, expect, it, vi } from "vitest";

import { writeCompletionWriteback } from "../../src/orchestrator/worker-outcome/completion-writeback.js";
import type {
  CompletionWritebackContext,
  CompletionWritebackInput,
} from "../../src/orchestrator/worker-outcome/completion-writeback.js";
import type { ServiceConfig } from "../../src/core/types.js";
import type { WorkflowRunStatusMapping } from "../../src/workflow-run/status-projection.js";
import { createIssue, createRunningEntry } from "./issue-test-factories.js";

/**
 * NIN-77 reachability: when a run's resolved workflow definition carries a statusMapping override, the
 * completion-writeback path (the orchestrator's production entry point on worker outcome) drives the
 * tracker board through the WORKFLOW-level mapping, not the workspace-level one.
 *
 * The resolver is threaded via `CompletionWritebackContext.resolveWorkflowStatusMapping`, which is wired
 * from the archive in production via OrchestratorDeps.
 */

function makeCtx(
  workspaceMapping: WorkflowRunStatusMapping,
  workflowMapping: WorkflowRunStatusMapping | undefined,
  stateId: string | null,
): CompletionWritebackContext {
  const config = {
    tracker: {
      kind: "linear",
      apiKey: "key",
      endpoint: "https://api.linear.app/graphql",
      projectSlug: "MT",
      activeStates: ["In Progress"],
      terminalStates: ["Done", "Canceled"],
      statusMapping: workspaceMapping,
    },
    agent: { successState: "LEGACY_SHOULD_NOT_BE_USED" },
  } as unknown as ServiceConfig;
  return {
    getConfig: () => config,
    deps: {
      tracker: {
        resolveStateId: vi.fn().mockResolvedValue(stateId),
        updateIssueState: vi.fn().mockResolvedValue(undefined),
        createComment: vi.fn().mockResolvedValue(undefined),
      },
      logger: { info: vi.fn(), warn: vi.fn() },
    },
    resolveWorkflowStatusMapping:
      workflowMapping !== undefined ? vi.fn().mockResolvedValue(workflowMapping) : undefined,
  } as unknown as CompletionWritebackContext;
}

function makeInput(workflowRunId: string, overrides: Partial<CompletionWritebackInput> = {}): CompletionWritebackInput {
  return {
    issue: createIssue({ workflowRunId }),
    entry: createRunningEntry({ startedAtMs: Date.now() - 10_000, tokenUsage: null }),
    attempt: 1,
    stopSignal: "done",
    pullRequestUrl: null,
    turnCount: 1,
    ...overrides,
  };
}

describe("writeCompletionWriteback — workflow-level status mapping (NIN-77)", () => {
  it("drives the board through the workflow mapping, not the workspace mapping, when the run carries a definition override", async () => {
    const ctx = makeCtx(
      { done: "Workspace Done", blocked: "Workspace Blocked" },
      { done: "Workflow Done" },
      "state-workflow-done",
    );
    const input = makeInput("wr_test_override");

    await writeCompletionWriteback(ctx, input);

    const resolveStateId = ctx.deps.tracker.resolveStateId as ReturnType<typeof vi.fn>;
    // Workflow-level mapping must win: tracker receives "Workflow Done", not "Workspace Done"
    expect(resolveStateId).toHaveBeenCalledWith("Workflow Done");
    expect(resolveStateId).not.toHaveBeenCalledWith("Workspace Done");
    expect(ctx.deps.tracker.updateIssueState).toHaveBeenCalledWith(input.issue.id, "state-workflow-done");
  });

  it("falls back to the workspace mapping when the run has no workflow-level override", async () => {
    const ctx = makeCtx({ done: "Workspace Done" }, undefined, "state-workspace-done");
    const input = makeInput("wr_test_workspace_only");

    await writeCompletionWriteback(ctx, input);

    const resolveStateId = ctx.deps.tracker.resolveStateId as ReturnType<typeof vi.fn>;
    expect(resolveStateId).toHaveBeenCalledWith("Workspace Done");
    expect(ctx.deps.tracker.updateIssueState).toHaveBeenCalledWith(input.issue.id, "state-workspace-done");
  });

  it("passes the workflowRunId to the resolver so it loads the correct run definition", async () => {
    const ctx = makeCtx({ done: "Board Done" }, { done: "Run Done" }, "state-run-done");
    const input = makeInput("wr_specific_id");

    await writeCompletionWriteback(ctx, input);

    const resolveWorkflowStatusMapping = ctx.resolveWorkflowStatusMapping as ReturnType<typeof vi.fn>;
    expect(resolveWorkflowStatusMapping).toHaveBeenCalledWith("wr_specific_id");
  });

  it("also drives the blocked status through the workflow mapping when configured", async () => {
    const ctx = makeCtx({ blocked: "Workspace Blocked" }, { blocked: "Workflow Blocked" }, "state-workflow-blocked");
    const input = makeInput("wr_blocked", { stopSignal: "blocked" });

    await writeCompletionWriteback(ctx, input);

    const resolveStateId = ctx.deps.tracker.resolveStateId as ReturnType<typeof vi.fn>;
    expect(resolveStateId).toHaveBeenCalledWith("Workflow Blocked");
    expect(resolveStateId).not.toHaveBeenCalledWith("Workspace Blocked");
  });

  it("skips the resolver when the issue has no workflowRunId (legacy issue-keyed run)", async () => {
    const ctx = makeCtx({ done: "Done" }, { done: "Workflow Done" }, "state-done");
    // No workflowRunId on the issue — legacy path
    const input: CompletionWritebackInput = {
      issue: createIssue(),
      entry: createRunningEntry({ startedAtMs: Date.now() - 5_000, tokenUsage: null }),
      attempt: 1,
      stopSignal: "done",
      pullRequestUrl: null,
      turnCount: 1,
    };

    await writeCompletionWriteback(ctx, input);

    const resolveWorkflowStatusMapping = ctx.resolveWorkflowStatusMapping as ReturnType<typeof vi.fn>;
    // Resolver must not be called for legacy runs without a workflowRunId
    expect(resolveWorkflowStatusMapping).not.toHaveBeenCalled();
  });
});
