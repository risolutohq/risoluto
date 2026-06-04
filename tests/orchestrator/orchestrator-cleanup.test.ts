import { afterEach, describe, expect, it, vi } from "vitest";

import { Orchestrator } from "../../src/orchestrator/orchestrator.js";
import { TypedEventBus } from "../../src/core/event-bus.js";
import type { RisolutoEventMap } from "../../src/core/risoluto-events.js";
import type { ConfigStore } from "../../src/config/store.js";
import type { AgentRunner, TrackerPort, WorkspaceManager } from "./orchestrator-fixtures.js";
import {
  createAttemptStore,
  createConfig,
  createConfigStore,
  createCostSampleStore,
  createIssueConfigStore,
  createLogger,
  createResolveTemplate,
  passThroughWithLock,
} from "./orchestrator-fixtures.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function healthListenerCount(eventBus: TypedEventBus<RisolutoEventMap>): number {
  const listeners = (eventBus as unknown as { listeners: Map<string, Set<unknown>> }).listeners;
  return listeners.get("health.transition")?.size ?? 0;
}

describe("Orchestrator lifecycle cleanup (NIN-266)", () => {
  it("releases listeners and clears unbounded maps across repeated start/stop", async () => {
    vi.useFakeTimers();
    const eventBus = new TypedEventBus<RisolutoEventMap>();
    let activeConfigSubs = 0;
    const baseStore = createConfigStore(createConfig());
    const configStore: ConfigStore = {
      ...baseStore,
      subscribe: (listener: () => void) => {
        activeConfigSubs += 1;
        const unsubscribe = baseStore.subscribe(listener);
        return () => {
          activeConfigSubs -= 1;
          unsubscribe();
        };
      },
    };

    const tracker = {
      fetchCandidateIssues: vi.fn(async () => []),
      fetchIssueStatesByIds: vi.fn(async () => []),
      fetchIssuesByStates: vi.fn(async () => []),
    } as unknown as TrackerPort;
    const workspaceManager = {
      ensureWorkspace: vi.fn(async () => ({ path: "/tmp/x", workspaceKey: "x", createdNow: true })),
      removeWorkspace: vi.fn(async () => undefined),
      withLock: passThroughWithLock,
    } as unknown as WorkspaceManager;

    const orchestrator = new Orchestrator({
      attemptStore: createAttemptStore(),
      costSampleStore: createCostSampleStore(),
      configStore,
      tracker,
      workspaceManager,
      agentRunner: { runAttempt: vi.fn() } as unknown as AgentRunner,
      issueConfigStore: createIssueConfigStore(),
      logger: createLogger(),
      resolveTemplate: createResolveTemplate(),
      eventBus,
    });

    const state = (
      orchestrator as unknown as {
        _state: { sessionUsageTotals: Map<string, unknown>; detailViews: Map<string, unknown> };
      }
    )._state;

    for (let cycle = 0; cycle < 3; cycle++) {
      await orchestrator.start();
      await vi.advanceTimersByTimeAsync(0);
      // Simulate runtime accumulation in the in-memory projection caches.
      state.sessionUsageTotals.set(`session-${cycle}`, {});
      state.detailViews.set(`detail-${cycle}`, {});
      await orchestrator.stop();

      // No listener or map survives a stop, so nothing accumulates across cycles.
      expect(healthListenerCount(eventBus)).toBe(0);
      expect(activeConfigSubs).toBe(0);
      expect(state.sessionUsageTotals.size).toBe(0);
      expect(state.detailViews.size).toBe(0);
    }
  });
});
