import { describe, expect, it, vi } from "vitest";

import {
  canDispatchIssue,
  hasAvailableStateSlot,
  launchWorker,
  launchAvailableWorkers,
} from "../../src/orchestrator/worker-launcher.js";
import type { Issue, RunOutcome, ServiceConfig } from "../../src/core/types.js";
import type { RunningEntry } from "../../src/orchestrator/runtime-types.js";
import { createIssue, createModelSelection, createRunningEntry, createWorkspace } from "./issue-test-factories.js";

function makeConfig(overrides: Partial<ServiceConfig["agent"]> = {}): ServiceConfig {
  return {
    tracker: {
      kind: "linear",
      apiKey: "key",
      endpoint: "https://api.linear.app/graphql",
      projectSlug: "MT",
      activeStates: ["In Progress", "Todo"],
      terminalStates: ["Done", "Canceled"],
    },
    agent: {
      maxConcurrentAgents: 3,
      maxConcurrentAgentsByState: {},
      maxTurns: 10,
      maxRetryBackoffMs: 300000,
      maxContinuationAttempts: 5,
      successState: null,
      stallTimeoutMs: 1200000,
      autoClaim: true,
      ...overrides,
    },
    workspace: {
      root: "/tmp/risoluto",
      strategy: "directory",
      branchPrefix: "risoluto/",
      hooks: {
        afterCreate: null,
        beforeRun: null,
        afterRun: null,
        beforeRemove: null,
        timeoutMs: 1000,
      },
    },
  } as unknown as ServiceConfig;
}

function makeLaunchWorkerHarness() {
  const issue = createIssue({
    id: "workflow-run-1",
    identifier: "WR-1",
    title: "Workflow Run title",
    description: "Run this workflow",
    url: "https://linear.app/test/WR-1",
  });
  const workspace = createWorkspace({ path: "/tmp/risoluto/WR-1", workspaceKey: "WR-1" });
  const modelSelection = createModelSelection();
  const outcome: RunOutcome = {
    status: "completed",
    summary: "done",
    tokenUsage: null,
    turnCount: 1,
    codexErrorInfo: null,
  };
  const runAttempt = vi.fn().mockResolvedValue(outcome);
  const notify = vi.fn();

  const ctx = {
    deps: {
      agentRunner: { runAttempt },
      attemptStore: {
        createAttempt: vi.fn().mockResolvedValue(undefined),
        updateAttempt: vi.fn().mockResolvedValue(undefined),
        appendEvent: vi.fn().mockResolvedValue(undefined),
        appendCheckpoint: vi.fn().mockResolvedValue(undefined),
      },
      configStore: { getConfig: () => makeConfig() },
      workspaceManager: {
        withLock: async <T>(_workspaceKey: string, task: () => Promise<T>) => task(),
        ensureWorkspace: vi.fn().mockResolvedValue(workspace),
      },
      logger: {
        warn: vi.fn(),
        error: vi.fn(),
      },
      resolveTemplate: vi.fn().mockResolvedValue("Run {{ workflowRun.identifier }}"),
    },
    isRunning: vi.fn(() => true),
    runningEntries: new Map<string, RunningEntry>(),
    completedViews: new Map(),
    detailViews: new Map(),
    getQueuedViews: vi.fn(() => [{ issueId: issue.id }]),
    setQueuedViews: vi.fn(),
    claimIssue: vi.fn(),
    releaseIssueClaim: vi.fn(),
    markDirty: vi.fn(),
    resolveModelSelection: vi.fn(() => modelSelection),
    notify,
    pushEvent: vi.fn(),
    applyUsageEvent: vi.fn(),
    setRateLimits: vi.fn(),
    handleWorkerPromise: vi.fn(async (promise: Promise<RunOutcome>) => {
      await promise;
    }),
  };

  return { ctx, issue, notify, runAttempt };
}

// ---------------------------------------------------------------------------
// canDispatchIssue
// ---------------------------------------------------------------------------

describe("canDispatchIssue", () => {
  it("returns true for an active-state issue that is not claimed or blocked", () => {
    const config = makeConfig();
    const issue = createIssue({ state: "In Progress" });
    expect(canDispatchIssue(issue, config, new Set())).toBe(true);
  });

  it("returns false when the issue state is not active", () => {
    const config = makeConfig();
    const issue = createIssue({ state: "Backlog" });
    expect(canDispatchIssue(issue, config, new Set())).toBe(false);
  });

  it("returns false when the issue is already claimed", () => {
    const config = makeConfig();
    const issue = createIssue({ state: "In Progress" });
    expect(canDispatchIssue(issue, config, new Set(["issue-1"]))).toBe(false);
  });

  it("returns false for a todo-state issue blocked by a non-terminal issue", () => {
    const config = makeConfig();
    const issue = createIssue({
      state: "Todo",
      blockedBy: [{ id: "blk", identifier: "MT-0", state: "In Progress" }],
    });
    expect(canDispatchIssue(issue, config, new Set())).toBe(false);
  });

  it("returns true for a todo-state issue when all blockers are terminal", () => {
    const config = makeConfig();
    const issue = createIssue({
      state: "Todo",
      blockedBy: [{ id: "blk", identifier: "MT-0", state: "Done" }],
    });
    expect(canDispatchIssue(issue, config, new Set())).toBe(true);
  });

  it("returns true for an active non-todo issue even with non-terminal blockers", () => {
    const config = makeConfig();
    const issue = createIssue({
      state: "In Progress",
      blockedBy: [{ id: "blk", identifier: "MT-0", state: "In Progress" }],
    });
    // blocker check only applies to todo-state issues
    expect(canDispatchIssue(issue, config, new Set())).toBe(true);
  });

  it("skips todo-state issues when autoClaim is disabled", () => {
    const config = makeConfig({ autoClaim: false });
    const issue = createIssue({ state: "Todo" });
    expect(canDispatchIssue(issue, config, new Set())).toBe(false);
  });

  it("still dispatches non-todo active issues when autoClaim is disabled", () => {
    const config = makeConfig({ autoClaim: false });
    const issue = createIssue({ state: "In Progress" });
    expect(canDispatchIssue(issue, config, new Set())).toBe(true);
  });
});

describe("launchWorker", () => {
  it("passes a Workflow Run reference to the run-attempt dispatcher", async () => {
    const { ctx, issue, runAttempt } = makeLaunchWorkerHarness();

    await launchWorker(ctx, issue, 1);

    expect(runAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        issue,
        workflowRun: {
          id: "workflow-run-1",
          identifier: "WR-1",
          title: "Workflow Run title",
          description: "Run this workflow",
          url: "https://linear.app/test/WR-1",
        },
      }),
    );
  });

  it("emits Workflow Run identity in launch notifications", async () => {
    const { ctx, issue, notify } = makeLaunchWorkerHarness();
    const workflowRun = {
      id: "workflow-run-1",
      identifier: "WR-1",
      title: "Workflow Run title",
      description: "Run this workflow",
      url: "https://linear.app/test/WR-1",
    };

    await launchWorker(ctx, issue, 1);

    expect(notify).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: "workflow_run_claimed",
        message: "Workflow Run claimed for execution",
        metadata: expect.objectContaining({
          workspace: "/tmp/risoluto/WR-1",
          workflowRun,
        }),
      }),
    );
    expect(notify).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: "workflow_run_worker_launched",
        message: "Workflow Run worker launched",
        metadata: expect.objectContaining({
          model: "gpt-5.4",
          reasoningEffort: "high",
          workflowRun,
        }),
      }),
    );
  });

  // orphan-worker re-check (NIN-239): a launch racing Orchestrator.stop() must
  // not register a running entry and must not dispatch runAttempt.
  describe("orphan-worker re-check (NIN-239)", () => {
    it("does not register an entry or dispatch when the orchestrator is already stopping", async () => {
      const { ctx, issue, runAttempt } = makeLaunchWorkerHarness();
      ctx.isRunning = vi.fn(() => false);

      await expect(launchWorker(ctx, issue, 1)).resolves.toBeUndefined();

      expect(ctx.runningEntries.has("workflow-run-1")).toBe(false);
      expect(runAttempt).not.toHaveBeenCalled();
      expect(ctx.releaseIssueClaim).toHaveBeenCalledWith("workflow-run-1");
    });

    it("aborts before dispatch when stop() begins after the entry is registered", async () => {
      const { ctx, issue, runAttempt } = makeLaunchWorkerHarness();
      ctx.isRunning = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);

      await expect(launchWorker(ctx, issue, 1)).resolves.toBeUndefined();

      expect(runAttempt).not.toHaveBeenCalled();
      expect(ctx.runningEntries.has("workflow-run-1")).toBe(false);
      expect(ctx.releaseIssueClaim).toHaveBeenCalledWith("workflow-run-1");
    });
  });

  // settlement robustness (NIN-240): a rejecting worker-promise settlement must
  // never leave an unhandled rejection and must always resolve the entry lifecycle.
  describe("settlement robustness (NIN-240)", () => {
    it("resolves the entry lifecycle and logs when settlement rejects", async () => {
      const { ctx, issue } = makeLaunchWorkerHarness();
      ctx.handleWorkerPromise = vi.fn(() => Promise.reject(new Error("settlement boom")));

      await expect(launchWorker(ctx, issue, 1)).resolves.toBeUndefined();

      const entry = ctx.runningEntries.get("workflow-run-1");
      expect(entry).toBeDefined();
      await expect(entry!.promise).resolves.toBeUndefined();
      expect(ctx.deps.logger.error).toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// hasAvailableStateSlot
// ---------------------------------------------------------------------------

describe("hasAvailableStateSlot", () => {
  it("returns true when no per-state limit is configured", () => {
    const config = makeConfig({ maxConcurrentAgentsByState: {} });
    const issue = createIssue({ state: "In Progress" });
    expect(hasAvailableStateSlot(issue, config, new Map())).toBe(true);
  });

  it("returns true when running count is below the configured limit", () => {
    const config = makeConfig({ maxConcurrentAgentsByState: { "in progress": 2 } });
    const issue = createIssue({ state: "In Progress" });

    const runningEntries = new Map<string, RunningEntry>();
    runningEntries.set("other-1", createRunningEntry({ issue: createIssue({ id: "other-1", state: "In Progress" }) }));

    expect(hasAvailableStateSlot(issue, config, runningEntries)).toBe(true);
  });

  it("returns false when running count reaches the configured limit", () => {
    const config = makeConfig({ maxConcurrentAgentsByState: { "in progress": 1 } });
    const issue = createIssue({ state: "In Progress" });

    const runningEntries = new Map<string, RunningEntry>();
    runningEntries.set("other-1", createRunningEntry({ issue: createIssue({ id: "other-1", state: "In Progress" }) }));

    expect(hasAvailableStateSlot(issue, config, runningEntries)).toBe(false);
  });

  it("accounts for pending state counts on top of running entries", () => {
    const config = makeConfig({ maxConcurrentAgentsByState: { "in progress": 2 } });
    const issue = createIssue({ state: "In Progress" });

    const runningEntries = new Map<string, RunningEntry>();
    runningEntries.set("other-1", createRunningEntry({ issue: createIssue({ id: "other-1", state: "In Progress" }) }));

    const pendingStateCounts = new Map([["in progress", 1]]);
    // 1 running + 1 pending = 2 >= limit of 2
    expect(hasAvailableStateSlot(issue, config, runningEntries, pendingStateCounts)).toBe(false);
  });

  it("allows dispatch when pending counts are absent", () => {
    const config = makeConfig({ maxConcurrentAgentsByState: { "in progress": 2 } });
    const issue = createIssue({ state: "In Progress" });

    const runningEntries = new Map<string, RunningEntry>();
    runningEntries.set("other-1", createRunningEntry({ issue: createIssue({ id: "other-1", state: "In Progress" }) }));

    // pendingStateCounts undefined, only 1 running < 2 limit
    expect(hasAvailableStateSlot(issue, config, runningEntries, undefined)).toBe(true);
  });

  it("normalizes state key for case-insensitive comparison", () => {
    const config = makeConfig({ maxConcurrentAgentsByState: { "in progress": 1 } });
    const issue = createIssue({ state: "IN PROGRESS" });

    const runningEntries = new Map<string, RunningEntry>();
    runningEntries.set("other-1", createRunningEntry({ issue: createIssue({ id: "other-1", state: "in progress" }) }));

    expect(hasAvailableStateSlot(issue, config, runningEntries)).toBe(false);
  });

  it("does not count entries in different states toward the limit", () => {
    const config = makeConfig({ maxConcurrentAgentsByState: { "in progress": 1 } });
    const issue = createIssue({ state: "In Progress" });

    const runningEntries = new Map<string, RunningEntry>();
    runningEntries.set("other-1", createRunningEntry({ issue: createIssue({ id: "other-1", state: "Todo" }) }));

    expect(hasAvailableStateSlot(issue, config, runningEntries)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// launchAvailableWorkers
// ---------------------------------------------------------------------------

describe("launchAvailableWorkers", () => {
  function makeLaunchCtx(
    overrides: {
      issues?: Issue[];
      maxConcurrentAgents?: number;
      runningCount?: number;
      canDispatch?: (issue: Issue) => boolean;
      hasSlot?: (issue: Issue) => boolean;
    } = {},
  ) {
    const {
      issues = [createIssue()],
      maxConcurrentAgents = 3,
      runningCount = 0,
      canDispatch = () => true,
      hasSlot = () => true,
    } = overrides;

    const runningEntries = new Map<string, RunningEntry>();
    for (let idx = 0; idx < runningCount; idx++) {
      const entry = createRunningEntry({ issue: createIssue({ id: `running-${idx}` }) });
      runningEntries.set(`running-${idx}`, entry);
    }

    const claimIssue = vi.fn();
    const launchWorker = vi.fn().mockResolvedValue(undefined);
    const fetchCandidateIssues = vi.fn().mockResolvedValue(issues);

    const ctx = {
      deps: { tracker: { fetchCandidateIssues } },
      getConfig: () => makeConfig({ maxConcurrentAgents }),
      runningEntries,
      claimIssue,
      canDispatchIssue: canDispatch,
      hasAvailableStateSlot: hasSlot,
      launchWorker,
    };

    return { ctx, claimIssue, launchWorker, fetchCandidateIssues };
  }

  it("dispatches issues up to the available concurrency slots", async () => {
    const issues = [
      createIssue({ id: "a", identifier: "MT-A", priority: 1 }),
      createIssue({ id: "b", identifier: "MT-B", priority: 2 }),
      createIssue({ id: "c", identifier: "MT-C", priority: 3 }),
    ];
    const { ctx, launchWorker, claimIssue } = makeLaunchCtx({
      issues,
      maxConcurrentAgents: 2,
      runningCount: 0,
    });

    await launchAvailableWorkers(ctx);

    expect(launchWorker).toHaveBeenCalledTimes(2);
    expect(claimIssue).toHaveBeenCalledTimes(2);
  });

  it("does not dispatch when already at concurrency limit", async () => {
    const { ctx, launchWorker } = makeLaunchCtx({
      maxConcurrentAgents: 2,
      runningCount: 2,
    });

    await launchAvailableWorkers(ctx);

    expect(launchWorker).not.toHaveBeenCalled();
  });

  it("skips issues that fail canDispatchIssue", async () => {
    const issues = [createIssue({ id: "skip", identifier: "MT-SKIP" }), createIssue({ id: "ok", identifier: "MT-OK" })];
    const { ctx, launchWorker } = makeLaunchCtx({
      issues,
      canDispatch: (issue: Issue) => issue.id !== "skip",
    });

    await launchAvailableWorkers(ctx);

    expect(launchWorker).toHaveBeenCalledTimes(1);
    expect(launchWorker).toHaveBeenCalledWith(expect.objectContaining({ id: "ok" }), 1, { claimHeld: true });
  });

  it("skips issues that fail hasAvailableStateSlot", async () => {
    const issues = [
      createIssue({ id: "a", identifier: "MT-A", state: "In Progress" }),
      createIssue({ id: "b", identifier: "MT-B", state: "In Progress" }),
    ];

    let callCount = 0;
    const { ctx, launchWorker } = makeLaunchCtx({
      issues,
      hasSlot: () => {
        callCount++;
        // Only the first issue gets a slot
        return callCount === 1;
      },
    });

    await launchAvailableWorkers(ctx);

    expect(launchWorker).toHaveBeenCalledTimes(1);
  });

  it("launches nothing when the candidate list is empty", async () => {
    const { ctx, launchWorker } = makeLaunchCtx({ issues: [] });

    await launchAvailableWorkers(ctx);

    expect(launchWorker).not.toHaveBeenCalled();
  });

  it("passes claimHeld: true to each launched worker", async () => {
    const issues = [createIssue({ id: "a", identifier: "MT-A" })];
    const { ctx, launchWorker } = makeLaunchCtx({ issues });

    await launchAvailableWorkers(ctx);

    expect(launchWorker).toHaveBeenCalledWith(expect.any(Object), 1, { claimHeld: true });
  });

  it("claims each issue before launching it", async () => {
    const issues = [createIssue({ id: "a", identifier: "MT-A" })];
    const { ctx, claimIssue, launchWorker } = makeLaunchCtx({ issues });

    const callOrder: string[] = [];
    claimIssue.mockImplementation(() => callOrder.push("claim"));
    launchWorker.mockImplementation(async () => callOrder.push("launch"));

    await launchAvailableWorkers(ctx);

    expect(callOrder).toEqual(["claim", "launch"]);
  });
});
