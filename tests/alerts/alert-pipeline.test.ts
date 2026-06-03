import { describe, expect, it, vi } from "vitest";

import { AlertPipeline } from "../../src/alerts/alert-pipeline.js";
import { AlertHistoryStore } from "../../src/persistence/sqlite/alert-history-store.js";
import { openDatabase } from "../../src/persistence/sqlite/database.js";
import { createMockLogger } from "../helpers.js";

function createConfigStore() {
  return {
    getConfig: () =>
      ({
        alerts: {
          rules: [
            {
              name: "worker-failures",
              type: "worker_failed",
              severity: "critical",
              channels: ["ops-webhook"],
              cooldownMs: 300_000,
              enabled: true,
            },
          ],
        },
      }) as never,
  };
}

function makeHistoryStore() {
  return AlertHistoryStore.create(openDatabase(":memory:"));
}

describe("AlertPipeline", () => {
  it("delivers matching events and records alert history", async () => {
    const notificationManager = {
      notify: vi.fn().mockResolvedValue({
        deliveredChannels: ["ops-webhook"],
        failedChannels: [],
        skippedDuplicate: false,
      }),
    };
    const historyStore = makeHistoryStore();
    const pipeline = new AlertPipeline({
      configStore: createConfigStore() as never,
      notificationManager: notificationManager as never,
      historyStore,
      logger: createMockLogger(),
    });

    await pipeline.processEvent("worker.failed", {
      issueId: "issue-1",
      identifier: "ENG-1",
      error: "worker crashed",
    });

    expect(notificationManager.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "alert_fired",
        severity: "critical",
        issue: expect.objectContaining({ identifier: "ENG-1" }),
      }),
      { channelNames: ["ops-webhook"] },
    );
    await expect(historyStore.list()).resolves.toEqual([
      expect.objectContaining({
        ruleName: "worker-failures",
        status: "delivered",
      }),
    ]);
  });

  it("emits a redacted allowlisted summary instead of the raw event payload (NIN-247)", async () => {
    const notificationManager = {
      notify: vi.fn().mockResolvedValue({
        deliveredChannels: ["ops-webhook"],
        failedChannels: [],
        skippedDuplicate: false,
      }),
    };
    const pipeline = new AlertPipeline({
      configStore: createConfigStore() as never,
      notificationManager: notificationManager as never,
      historyStore: makeHistoryStore(),
      logger: createMockLogger(),
    });

    await pipeline.processEvent("worker.failed", {
      issueId: "issue-1",
      identifier: "ENG-1",
      error: "crashed with token=sk-alertsecret123",
      apiKey: "sk-extrasecret",
    });

    const notification = notificationManager.notify.mock.calls[0][0];
    expect(notification.metadata).not.toHaveProperty("payload");
    expect(notification.metadata.summary).toBeDefined();
    const serialized = JSON.stringify(notification.metadata);
    expect(serialized).not.toContain("sk-alertsecret123");
    expect(serialized).not.toContain("sk-extrasecret");
  });

  it("suppresses repeated alerts inside the cooldown window", async () => {
    const notificationManager = {
      notify: vi.fn().mockResolvedValue({
        deliveredChannels: ["ops-webhook"],
        failedChannels: [],
        skippedDuplicate: false,
      }),
    };
    const historyStore = makeHistoryStore();
    const pipeline = new AlertPipeline({
      configStore: createConfigStore() as never,
      notificationManager: notificationManager as never,
      historyStore,
      logger: createMockLogger(),
    });

    await pipeline.processEvent("worker.failed", {
      issueId: "issue-1",
      identifier: "ENG-1",
      error: "worker crashed",
    });
    await pipeline.processEvent("worker.failed", {
      issueId: "issue-1",
      identifier: "ENG-1",
      error: "worker crashed again",
    });

    expect(notificationManager.notify).toHaveBeenCalledTimes(1);
    const statuses = (await historyStore.list()).map((record) => record.status).sort();
    expect(statuses).toEqual(["delivered", "suppressed"]);
  });

  it("does not stamp the cooldown when the notify fully fails so the retry is not suppressed (NIN-264)", async () => {
    const notify = vi
      .fn()
      .mockResolvedValueOnce({
        deliveredChannels: [],
        failedChannels: [{ channel: "ops-webhook", error: "down" }],
        skippedDuplicate: false,
      })
      .mockResolvedValueOnce({
        deliveredChannels: ["ops-webhook"],
        failedChannels: [],
        skippedDuplicate: false,
      });
    const historyStore = makeHistoryStore();
    const pipeline = new AlertPipeline({
      configStore: createConfigStore() as never,
      notificationManager: { notify } as never,
      historyStore,
      logger: createMockLogger(),
    });

    await pipeline.processEvent("worker.failed", { issueId: "issue-1", identifier: "ENG-1", error: "worker crashed" });
    await pipeline.processEvent("worker.failed", {
      issueId: "issue-1",
      identifier: "ENG-1",
      error: "worker crashed again",
    });

    // The first (failed) delivery did not stamp the cooldown, so the second event is retried.
    expect(notify).toHaveBeenCalledTimes(2);
    const statuses = (await historyStore.list()).map((record) => record.status).sort();
    expect(statuses).toEqual(["delivered", "failed"]);
  });

  it("records partial_failure when some channels fail", async () => {
    const notificationManager = {
      notify: vi.fn().mockResolvedValue({
        deliveredChannels: ["ops-webhook"],
        failedChannels: [{ channel: "desktop", error: "permission denied" }],
        skippedDuplicate: false,
      }),
    };
    const historyStore = makeHistoryStore();
    const pipeline = new AlertPipeline({
      configStore: createConfigStore() as never,
      notificationManager: notificationManager as never,
      historyStore,
      logger: createMockLogger(),
    });

    await pipeline.processEvent("worker.failed", {
      issueId: "issue-2",
      identifier: "ENG-2",
      error: "worker crashed",
    });

    await expect(historyStore.list()).resolves.toEqual([
      expect.objectContaining({
        ruleName: "worker-failures",
        status: "partial_failure",
        failedChannels: [{ channel: "desktop", error: "permission denied" }],
      }),
    ]);
  });
});
