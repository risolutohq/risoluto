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
 * NIN-270 reachability: when `tracker.statusMapping` is configured the completion writeback — a real
 * production entry point reached from the worker-outcome finalize path — drives the canonical Run
 * Status → board projection (`projectWorkflowRunStatus` via `mirrorWorkflowRunStatusToTracker`), rather
 * than the hardcoded `agent.successState`. An unmapped Run Status surfaces a clear projection error and
 * does NOT silently choose a state.
 */
function makeCtx(statusMapping: WorkflowRunStatusMapping, stateId: string | null): CompletionWritebackContext {
  const config = {
    tracker: {
      kind: "linear",
      apiKey: "key",
      endpoint: "https://api.linear.app/graphql",
      projectSlug: "MT",
      activeStates: ["In Progress"],
      terminalStates: ["Done", "Canceled"],
      statusMapping,
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
  } as unknown as CompletionWritebackContext;
}

function makeInput(overrides: Partial<CompletionWritebackInput> = {}): CompletionWritebackInput {
  return {
    issue: createIssue(),
    entry: createRunningEntry({ startedAtMs: Date.now() - 10_000, tokenUsage: null }),
    attempt: 1,
    stopSignal: "done",
    pullRequestUrl: null,
    turnCount: 1,
    ...overrides,
  };
}

describe("writeCompletionWriteback — status projection (NIN-270)", () => {
  it("projects the done Run Status through the configured mapping and mirrors it to the board", async () => {
    const ctx = makeCtx({ done: "Shipped", running: "In Progress" }, "state-shipped-id");
    const input = makeInput({ stopSignal: "done" });

    await writeCompletionWriteback(ctx, input);

    const resolveStateId = ctx.deps.tracker.resolveStateId as ReturnType<typeof vi.fn>;
    // The projected external status ("Shipped"), not the legacy successState, drives the transition.
    expect(resolveStateId).toHaveBeenCalledWith("Shipped");
    expect(resolveStateId).not.toHaveBeenCalledWith("LEGACY_SHOULD_NOT_BE_USED");
    expect(ctx.deps.tracker.updateIssueState).toHaveBeenCalledWith(input.issue.id, "state-shipped-id");
  });

  it("blocks the mirror with a clear error and chooses no state when the done status is unmapped", async () => {
    // statusMapping is configured but omits "done" — projection must not silently fall back to a state.
    const ctx = makeCtx({ running: "In Progress" }, "any-state-id");
    const input = makeInput({ stopSignal: "done" });

    await writeCompletionWriteback(ctx, input);

    expect(ctx.deps.tracker.updateIssueState).not.toHaveBeenCalled();
    expect(ctx.deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ run_status: "done" }),
      expect.stringContaining("unmapped"),
    );
  });

  it("projects the blocked Run Status to the board when configured", async () => {
    const ctx = makeCtx({ blocked: "Needs human" }, "state-needs-human");
    const input = makeInput({ stopSignal: "blocked" });

    await writeCompletionWriteback(ctx, input);

    expect(ctx.deps.tracker.resolveStateId).toHaveBeenCalledWith("Needs human");
    expect(ctx.deps.tracker.updateIssueState).toHaveBeenCalledWith(input.issue.id, "state-needs-human");
  });
});
