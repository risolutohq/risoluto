import { describe, expect, it, vi } from "vitest";

import { TypedEventBus } from "../../src/core/event-bus.js";
import type { RisolutoEventMap } from "../../src/core/risoluto-events.js";
import type { RisolutoLogger, WebhookConfig } from "../../src/core/types.js";
import type { PersistenceRuntime } from "../../src/persistence/sqlite/runtime.js";
import type { WebhookDeliveryRecord, WebhookInboxStats } from "../../src/persistence/sqlite/webhook-inbox.js";
import { createWebhookRuntime } from "../../src/webhook/runtime.js";

function makeLogger(): RisolutoLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as RisolutoLogger;
}

function makeWebhookConfig(overrides: Partial<WebhookConfig> = {}): WebhookConfig {
  return {
    webhookUrl: "https://risoluto.example.com/webhooks/linear",
    webhookSecret: "manual-secret",
    previousWebhookSecret: "previous-secret",
    pollingStretchMs: 120_000,
    pollingBaseMs: 15_000,
    healthCheckIntervalMs: 300_000,
    ...overrides,
  };
}

function makeStats(overrides: Partial<WebhookInboxStats> = {}): WebhookInboxStats {
  return {
    backlogCount: 1,
    oldestBacklogAgeSeconds: 10,
    dlqCount: 0,
    duplicateCount: 0,
    lastDeliveryAgeSeconds: 5,
    ...overrides,
  };
}

function makeDelivery(overrides: Partial<WebhookDeliveryRecord> = {}): WebhookDeliveryRecord {
  return {
    deliveryId: "delivery-1",
    receivedAt: "2026-04-15T02:00:00.000Z",
    type: "Issue",
    action: "update",
    entityId: "entity-1",
    issueId: "issue-1",
    issueIdentifier: "RIS-1",
    webhookTimestamp: 1_777_777_777,
    payloadJson: '{"ok":true}',
    status: "received",
    attemptCount: 0,
    nextAttemptAt: null,
    lastError: null,
    appliedAt: null,
    ...overrides,
  };
}

function makePersistence(
  options: {
    stats?: WebhookInboxStats;
    recent?: WebhookDeliveryRecord[];
  } = {},
): PersistenceRuntime {
  const stats = options.stats ?? makeStats();
  const recent = options.recent ?? [makeDelivery()];
  const inbox = {
    insertVerified: vi.fn().mockResolvedValue({ isNew: true }),
  };

  return {
    db: {} as PersistenceRuntime["db"],
    attemptStore: {} as PersistenceRuntime["attemptStore"],
    operator: {} as PersistenceRuntime["operator"],
    webhook: {
      inbox: inbox as PersistenceRuntime["webhook"]["inbox"],
      getSnapshot: vi.fn().mockResolvedValue({ stats, recent }),
      getRecentDeliveries: vi.fn().mockResolvedValue(recent),
      getStats: vi.fn().mockResolvedValue(stats),
      getRetryDeliveries: vi.fn().mockResolvedValue([]),
    },
    close: vi.fn(),
  };
}

function makeSecretsStore(stored: Record<string, string> = {}) {
  return {
    get: vi.fn((key: string) => stored[key] ?? null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(true),
  };
}

function makeLinearClient() {
  return {
    listWebhooks: vi.fn().mockResolvedValue([]),
    createWebhook: vi.fn().mockResolvedValue({ id: "wh-1", secret: "auto-secret" }),
    updateWebhook: vi.fn().mockResolvedValue(undefined),
    deleteWebhook: vi.fn().mockResolvedValue(undefined),
    runGraphQL: vi.fn().mockResolvedValue({ webhooks: { nodes: [] } }),
  };
}

function makeOrchestrator() {
  return {
    requestRefresh: vi.fn().mockReturnValue({
      queued: true,
      coalesced: false,
      requestedAt: "2026-04-15T02:05:00.000Z",
    }),
    requestTargetedRefresh: vi.fn(),
    stopWorkerForIssue: vi.fn(),
    getIssueDetail: vi.fn().mockReturnValue(null),
  };
}

describe("createWebhookRuntime", () => {
  it("returns an empty snapshot and no handler deps when webhook_url is absent", async () => {
    const runtime = createWebhookRuntime({
      persistence: makePersistence(),
      webhookConfig: null,
      linearClient: null,
      eventBus: new TypedEventBus<RisolutoEventMap>(),
      secretsStore: makeSecretsStore(),
      logger: makeLogger(),
    });

    expect(runtime.webhookUrlSet).toBe(false);
    expect(runtime.buildHandlerDeps({ orchestrator: makeOrchestrator(), logger: makeLogger() })).toBeUndefined();
    await expect(runtime.getSnapshot()).resolves.toEqual({
      health: null,
      inboxStats: null,
      recentDeliveries: [],
    });
  });

  it("keeps the resolved secret and handler deps in sync with registrar updates", async () => {
    const logger = makeLogger();
    const secretsStore = makeSecretsStore();
    const linearClient = makeLinearClient();
    const runtime = createWebhookRuntime({
      persistence: makePersistence(),
      webhookConfig: makeWebhookConfig({ webhookSecret: "" }),
      linearClient,
      eventBus: new TypedEventBus<RisolutoEventMap>(),
      secretsStore,
      logger,
    });

    await runtime.webhookRegistrar?.register();

    const handlerDeps = runtime.buildHandlerDeps({ orchestrator: makeOrchestrator(), logger });
    expect(runtime.resolvedWebhookSecret.current).toBe("auto-secret");
    expect(handlerDeps?.getWebhookSecret()).toBe("auto-secret");
    expect(secretsStore.set).toHaveBeenCalledWith("LINEAR_WEBHOOK_SECRET", "auto-secret");
    expect(logger.warn).toHaveBeenCalledWith(
      { webhookUrl: "https://risoluto.example.com/webhooks/linear" },
      "webhook_url is configured but webhook_secret is missing — set $LINEAR_WEBHOOK_SECRET or configure webhook_secret in Settings",
    );
  });

  it("forwards both the GitHub and Linear workflow-run intake adapters into the handler deps", () => {
    const acceptGitHubTriggeredWorkflowRun = vi.fn();
    const acceptLinearTriggeredWorkflowRun = vi.fn();
    const runtime = createWebhookRuntime({
      persistence: makePersistence(),
      webhookConfig: makeWebhookConfig(),
      linearClient: null,
      eventBus: new TypedEventBus<RisolutoEventMap>(),
      secretsStore: makeSecretsStore(),
      acceptLinearTriggeredWorkflowRun,
      acceptGitHubTriggeredWorkflowRun,
      logger: makeLogger(),
    });

    const handlerDeps = runtime.buildHandlerDeps({ orchestrator: makeOrchestrator(), logger: makeLogger() });

    expect(handlerDeps?.acceptGitHubTriggeredWorkflowRun).toBe(acceptGitHubTriggeredWorkflowRun);
    expect(handlerDeps?.acceptLinearTriggeredWorkflowRun).toBe(acceptLinearTriggeredWorkflowRun);
  });

  it("records an inbound external status change as a read-only observation (NIN-270 AC3)", () => {
    const logger = makeLogger();
    const orchestrator = makeOrchestrator();
    // The orchestrator's current view of the run reports canonical status "running".
    orchestrator.getIssueDetail.mockReturnValue({ issueId: "issue-1", identifier: "NIN-1", status: "running", workflowRunId: null });
    const runtime = createWebhookRuntime({
      persistence: makePersistence(),
      webhookConfig: makeWebhookConfig(),
      linearClient: null,
      eventBus: new TypedEventBus<RisolutoEventMap>(),
      secretsStore: makeSecretsStore(),
      logger: makeLogger(),
    });

    const handlerDeps = runtime.buildHandlerDeps({ orchestrator, logger });
    handlerDeps?.observeExternalStatusChange?.({
      issueId: "issue-1",
      issueIdentifier: "NIN-1",
      externalStatus: "In Review",
    });

    // The observation reaches observeExternalStatusChange and is recorded against the canonical status…
    expect(orchestrator.getIssueDetail).toHaveBeenCalledWith("NIN-1");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow_run_id: "NIN-1",
        canonical_run_status: "running",
        external_status: "In Review",
      }),
      expect.stringContaining("canonical Workflow Run truth unchanged"),
    );
    // …without mutating canonical truth (no run-state transition triggered).
    expect(orchestrator.stopWorkerForIssue).not.toHaveBeenCalled();
  });

  it("skips the observation when the runtime status is not a canonical Workflow Run status (NIN-270 AC3)", () => {
    const logger = makeLogger();
    const orchestrator = makeOrchestrator();
    // "retrying" is an orchestrator runtime status, not a canonical Workflow Run status — no truth to
    // compare against, so the observation must be skipped rather than recorded against a fabricated status.
    orchestrator.getIssueDetail.mockReturnValue({ issueId: "issue-1", identifier: "NIN-1", status: "retrying" });
    const runtime = createWebhookRuntime({
      persistence: makePersistence(),
      webhookConfig: makeWebhookConfig(),
      linearClient: null,
      eventBus: new TypedEventBus<RisolutoEventMap>(),
      secretsStore: makeSecretsStore(),
      logger: makeLogger(),
    });

    const handlerDeps = runtime.buildHandlerDeps({ orchestrator, logger });
    handlerDeps?.observeExternalStatusChange?.({
      issueId: "issue-1",
      issueIdentifier: "NIN-1",
      externalStatus: "In Review",
    });

    expect(logger.info).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("canonical Workflow Run truth unchanged"),
    );
  });

  it("merges persistence and health state behind one runtime snapshot", async () => {
    const runtime = createWebhookRuntime({
      persistence: makePersistence({
        stats: makeStats({ backlogCount: 3 }),
        recent: [makeDelivery({ deliveryId: "delivery-snapshot" })],
      }),
      webhookConfig: makeWebhookConfig(),
      linearClient: null,
      eventBus: new TypedEventBus<RisolutoEventMap>(),
      secretsStore: makeSecretsStore(),
      logger: makeLogger(),
    });

    const handlerDeps = runtime.buildHandlerDeps({ orchestrator: makeOrchestrator(), logger: makeLogger() });
    handlerDeps?.recordVerifiedDelivery("Issue:create");

    await expect(runtime.getSnapshot()).resolves.toMatchObject({
      inboxStats: makeStats({ backlogCount: 3 }),
      recentDeliveries: [expect.objectContaining({ deliveryId: "delivery-snapshot" })],
      health: expect.objectContaining({
        status: "connected",
        lastEventType: "Issue:create",
      }),
    });
  });
});
