import { describe, expect, it, vi } from "vitest";

import type { RunningEntry } from "../../src/orchestrator/runtime-types.js";
import type { RunOutcome, ServiceConfig, TokenUsageSnapshot } from "../../src/core/types.js";
import type { OrchestratorDeps } from "../../src/orchestrator/runtime-types.js";
import {
  createRunLifecycleCoordinator,
  type OrchestratorState,
} from "../../src/orchestrator/run-lifecycle-coordinator.js";
import { createIssue, createWorkspace } from "./issue-test-factories.js";

function buildCtx(state: OrchestratorState, deps: OrchestratorDeps) {
  return createRunLifecycleCoordinator(state, deps).getContext();
}

function makeState(overrides: Partial<OrchestratorState> = {}): OrchestratorState {
  return {
    running: true,
    runningEntries: new Map(),
    retryEntries: new Map(),
    completedViews: new Map(),
    detailViews: new Map(),
    claimedIssueIds: new Set(),
    queuedViews: [],
    recentEvents: [],
    rateLimits: null,
    issueModelOverrides: new Map(),
    issueTemplateOverrides: new Map(),
    sessionUsageTotals: new Map(),
    codexTotals: { inputTokens: 0, outputTokens: 0, totalTokens: 0, secondsRunning: 0 },
    stallEvents: [],
    markDirty: () => {},
    ...overrides,
  };
}

function makeDeps(overrides: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
  return {
    attemptStore: {} as never,
    configStore: {
      getConfig: () =>
        ({
          tracker: { activeStates: ["In Progress"], terminalStates: ["Done"] },
          agent: { maxConcurrentAgents: 5, maxConcurrentAgentsByState: {} },
          codex: { model: "gpt-4o", reasoningEffort: "high" },
        }) as never,
      getWorkflow: () => ({ promptTemplate: "Work on it" }),
    } as never,
    tracker: {} as never,
    workspaceManager: {} as never,
    agentRunner: {} as never,
    issueConfigStore: {
      loadAll: vi.fn(() => []),
      upsertModel: vi.fn(),
      upsertTemplateId: vi.fn(),
      clearTemplateId: vi.fn(),
    } as never,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() } as never,
    resolveTemplate: vi.fn().mockResolvedValue("Work on {{ issue.identifier }}"),
    ...overrides,
  };
}

function makeLaunchConfig(): ServiceConfig {
  return {
    tracker: {
      activeStates: ["In Progress"],
      terminalStates: ["Done"],
    },
    agent: {
      maxConcurrentAgents: 5,
      maxConcurrentAgentsByState: {},
      maxTurns: 10,
      maxRetryBackoffMs: 300000,
      maxContinuationAttempts: 5,
      successState: null,
      stallTimeoutMs: 1200000,
      autoClaim: true,
    },
    codex: { model: "gpt-5.4", reasoningEffort: "high" },
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
  } as ServiceConfig;
}

describe("buildCtx — pushEvent", () => {
  it("appends events to recentEvents", () => {
    const state = makeState();
    const ctx = buildCtx(state, makeDeps());
    ctx.pushEvent({
      at: "2024-01-01T00:00:00Z",
      issueId: "i1",
      issueIdentifier: "MT-1",
      sessionId: null,
      event: "test",
      message: "hello",
    });
    expect(state.recentEvents.length).toBe(1);
    expect(state.recentEvents[0].event).toBe("test");
  });

  it("truncates recentEvents to 250 items", () => {
    const state = makeState({
      recentEvents: Array.from({ length: 250 }, (_, i) => ({
        at: `t${i}`,
        issueId: "i",
        issueIdentifier: "MT-1",
        sessionId: null,
        event: `ev-${i}`,
        message: `m-${i}`,
        content: null,
      })),
    });
    const ctx = buildCtx(state, makeDeps());
    ctx.pushEvent({
      at: "new",
      issueId: "i",
      issueIdentifier: "MT-1",
      sessionId: null,
      event: "new-event",
      message: "new msg",
    });
    expect(state.recentEvents.length).toBe(250);
    expect(state.recentEvents[249].event).toBe("new-event");
  });
});

describe("buildCtx — applyUsageEvent", () => {
  function makeEntry(sessionId: string | null = "sess-1"): RunningEntry {
    return {
      runId: "r1",
      sessionId,
      tokenUsage: null,
    } as unknown as RunningEntry;
  }

  it("accumulates delta usage correctly", () => {
    const state = makeState();
    const ctx = buildCtx(state, makeDeps());
    const entry = makeEntry();
    const usage: TokenUsageSnapshot = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
    ctx.applyUsageEvent(entry, usage, "delta");
    expect(state.codexTotals.inputTokens).toBe(10);
    expect(state.codexTotals.outputTokens).toBe(5);
    expect(entry.tokenUsage).toEqual(usage);

    // Second delta accumulates
    ctx.applyUsageEvent(entry, usage, "delta");
    expect(state.codexTotals.inputTokens).toBe(20);
    expect(entry.tokenUsage!.inputTokens).toBe(20);
  });

  it("computes delta from absolute_total mode using session tracking", () => {
    const state = makeState();
    const ctx = buildCtx(state, makeDeps());
    const entry = makeEntry("sess-A");

    const first: TokenUsageSnapshot = { inputTokens: 100, outputTokens: 50, totalTokens: 150 };
    ctx.applyUsageEvent(entry, first, "absolute_total");
    expect(state.codexTotals.inputTokens).toBe(100);
    expect(state.sessionUsageTotals.get("sess-A")).toEqual(first);

    // Second absolute — delta should be the difference
    const second: TokenUsageSnapshot = { inputTokens: 180, outputTokens: 90, totalTokens: 270 };
    ctx.applyUsageEvent(entry, second, "absolute_total");
    expect(state.codexTotals.inputTokens).toBe(180); // 100 + (180-100)
    expect(state.codexTotals.outputTokens).toBe(90);
  });

  it("handles absolute_total with null sessionId", () => {
    const state = makeState();
    const ctx = buildCtx(state, makeDeps());
    const entry = makeEntry(null);
    const usage: TokenUsageSnapshot = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
    ctx.applyUsageEvent(entry, usage, "absolute_total");
    // With no session, delta is computed from null previous → full usage
    expect(state.codexTotals.inputTokens).toBe(10);
  });
});

describe("buildCtx — notify", () => {
  it("does not throw when notificationManager is absent", () => {
    const state = makeState();
    const ctx = buildCtx(state, makeDeps({ notificationManager: undefined }));
    expect(() => ctx.notify({ type: "worker_launched" } as never)).not.toThrow();
  });

  it("delegates to notificationManager.notify when present", () => {
    const notifyFn = vi.fn().mockResolvedValue(undefined);
    const state = makeState();
    const ctx = buildCtx(
      state,
      makeDeps({
        notificationManager: { notify: notifyFn } as never,
      }),
    );
    ctx.notify({ type: "worker_launched" } as never);
    expect(notifyFn).toHaveBeenCalled();
  });
});

describe("buildCtx — setQueuedViews / getQueuedViews", () => {
  it("round-trips queued views through state", () => {
    const state = makeState();
    const ctx = buildCtx(state, makeDeps());
    const views = [{ issueId: "i1" }] as never;
    ctx.setQueuedViews(views);
    expect(state.queuedViews).toBe(views);
  });
});

describe("buildCtx — setRateLimits", () => {
  it("stores rate limits on state", () => {
    const state = makeState();
    const ctx = buildCtx(state, makeDeps());
    ctx.setRateLimits({ remaining: 100 });
    expect(state.rateLimits).toEqual({ remaining: 100 });
  });
});

describe("buildCtx — pushEvent → eventBus routing", () => {
  function makeEventBus() {
    return { emit: vi.fn() };
  }

  function pushLifecycleEvent(eventName: string, issueId = "i1", issueIdentifier = "MT-1") {
    const bus = makeEventBus();
    const ctx = buildCtx(makeState(), makeDeps({ eventBus: bus as never }));
    ctx.pushEvent({
      at: "2024-01-01T00:00:00Z",
      issueId,
      issueIdentifier,
      sessionId: null,
      event: eventName,
      message: `${eventName} message`,
    });
    return bus.emit.mock.calls;
  }

  it("routes agent_stalled to workflow_run.stalled SSE channel", () => {
    const calls = pushLifecycleEvent("agent_stalled", "workflow-run-1", "WR-1");
    const stalledCall = calls.find((c) => c[0] === "workflow_run.stalled");
    expect(stalledCall).toEqual(
      expect.arrayContaining([
        "workflow_run.stalled",
        {
          workflowRunId: "workflow-run-1",
          identifier: "WR-1",
          reason: "agent_stalled message",
        },
      ]),
    );
  });

  it("routes worker_failed to workflow_run.worker_failed SSE channel", () => {
    const calls = pushLifecycleEvent("worker_failed", "workflow-run-2", "WR-2");
    const failedCall = calls.find((c) => c[0] === "workflow_run.worker_failed");
    expect(failedCall).toEqual(
      expect.arrayContaining([
        "workflow_run.worker_failed",
        {
          workflowRunId: "workflow-run-2",
          identifier: "WR-2",
          error: "worker_failed message",
        },
      ]),
    );
  });

  it("routes issue_queued to workflow_run.queued SSE channel", () => {
    const bus = makeEventBus();
    const ctx = buildCtx(makeState(), makeDeps({ eventBus: bus as never }));
    ctx.pushEvent({
      at: "2024-01-01T00:00:00Z",
      issueId: "workflow-run-1",
      issueIdentifier: "WR-1",
      sessionId: null,
      event: "issue_queued",
      message: "Workflow Run queued for dispatch",
      metadata: {
        state: "Ready",
        priority: 2,
      },
    });

    expect(bus.emit).toHaveBeenCalledWith("workflow_run.queued", {
      workflowRunId: "workflow-run-1",
      identifier: "WR-1",
      state: "Ready",
      priority: 2,
    });
  });

  it("routes workspace_ready to workflow_run.workspace_event SSE channel", () => {
    const calls = pushLifecycleEvent("workspace_ready", "workflow-run-3", "WR-3");
    const workspaceCall = calls.find((c) => c[0] === "workflow_run.workspace_event");
    expect(workspaceCall).toEqual(
      expect.arrayContaining([
        "workflow_run.workspace_event",
        {
          workflowRunId: "workflow-run-3",
          identifier: "WR-3",
          status: "ready",
        },
      ]),
    );
  });

  it("also emits workflow_run.agent_event for generic worker stream events", () => {
    const calls = pushLifecycleEvent("some_other_event", "workflow-run-4", "WR-4");
    const agentCall = calls.find((c) => c[0] === "workflow_run.agent_event");
    expect(agentCall).toEqual(
      expect.arrayContaining([
        "workflow_run.agent_event",
        {
          workflowRunId: "workflow-run-4",
          identifier: "WR-4",
          type: "some_other_event",
          message: "some_other_event message",
          sessionId: null,
          timestamp: "2024-01-01T00:00:00Z",
          content: null,
        },
      ]),
    );
  });

  it("does not throw when eventBus is absent", () => {
    const ctx = buildCtx(makeState(), makeDeps({ eventBus: undefined }));
    expect(() =>
      ctx.pushEvent({
        at: "2024-01-01T00:00:00Z",
        issueId: "i1",
        issueIdentifier: "MT-1",
        sessionId: null,
        event: "worker_failed",
        message: "boom",
      }),
    ).not.toThrow();
  });
});

describe("buildCtx — launchWorker eventBus routing", () => {
  it("emits a typed Workflow Run started event when a worker launches", async () => {
    const bus = { emit: vi.fn() };
    const issue = createIssue({
      id: "workflow-run-1",
      identifier: "WR-1",
      title: "Workflow Run title",
      description: "Run this workflow",
      url: "https://linear.app/test/WR-1",
    });
    const workspace = createWorkspace({ path: "/tmp/risoluto/WR-1", workspaceKey: "WR-1" });
    const pendingOutcome = new Promise<RunOutcome>(() => {});
    const ctx = buildCtx(
      makeState(),
      makeDeps({
        eventBus: bus as never,
        configStore: {
          getConfig: () => makeLaunchConfig(),
          getWorkflow: () => ({ promptTemplate: "Run {{ workflowRun.identifier }}" }),
        } as never,
        workspaceManager: {
          withLock: async <T>(_workspaceKey: string, task: () => Promise<T>) => task(),
          ensureWorkspace: vi.fn().mockResolvedValue(workspace),
        } as never,
        agentRunner: { runAttempt: vi.fn().mockReturnValue(pendingOutcome) } as never,
        attemptStore: {
          createAttempt: vi.fn().mockResolvedValue(undefined),
          updateAttempt: vi.fn().mockResolvedValue(undefined),
          appendEvent: vi.fn().mockResolvedValue(undefined),
          appendCheckpoint: vi.fn().mockResolvedValue(undefined),
        } as never,
      }),
    );

    await ctx.launchWorker(issue, 1);

    expect(bus.emit).toHaveBeenCalledWith("workflow_run.started", {
      workflowRun: {
        id: "workflow-run-1",
        identifier: "WR-1",
        title: "Workflow Run title",
        description: "Run this workflow",
        url: "https://linear.app/test/WR-1",
      },
      attempt: 1,
    });
  });
});
