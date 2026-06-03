import { afterEach, describe, expect, it } from "vitest";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createServices } from "../../src/cli/services.js";
import { ConfigStore } from "../../src/config/store.js";
import type { ConfigOverlayPort } from "../../src/config/overlay.js";
import { DefaultWebhookHealthTracker } from "../../src/webhook/health-tracker.js";
import { WebhookRegistrar } from "../../src/webhook/registrar.js";
import { SqliteWebhookInbox } from "../../src/persistence/sqlite/webhook-inbox.js";
import { initPersistenceRuntime, type PersistenceRuntime } from "../../src/persistence/sqlite/runtime.js";
import type { ServiceConfig, WebhookConfig } from "../../src/core/types.js";
import { createMockLogger } from "../helpers.js";
import { createWorkflowRunArchive } from "../../src/workflow-run/archive.js";
import { acceptWorkflowRunIntake } from "../../src/workflow-run/intake-core.js";
import { DEFAULT_WORKFLOW_DEFINITION_ID, type WorkflowRunStartRecord } from "../../src/workflow-run/contracts.js";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "risoluto-services-int-"));
  tempDirs.push(dir);
  return dir;
}

function createServiceConfig(root: string, webhook?: WebhookConfig | null): ServiceConfig {
  return {
    tracker: {
      kind: "linear",
      apiKey: "linear-token",
      endpoint: "https://api.linear.app/graphql",
      projectSlug: "EXAMPLE",
      activeStates: ["In Progress"],
      terminalStates: ["Done", "Canceled"],
    },
    polling: { intervalMs: 30000 },
    workspace: {
      root: path.join(root, "workspaces"),
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
    agent: {
      maxConcurrentAgents: 1,
      maxConcurrentAgentsByState: {},
      maxTurns: 1,
      maxRetryBackoffMs: 300000,
      maxContinuationAttempts: 5,
      successState: null,
      stallTimeoutMs: 10000,
    },
    codex: {
      command: "codex app-server",
      model: "gpt-5.4",
      reasoningEffort: "high",
      approvalPolicy: "never",
      threadSandbox: "danger-full-access",
      personality: "friendly",
      turnSandboxPolicy: { type: "dangerFullAccess" },
      selfReview: false,
      readTimeoutMs: 1000,
      turnTimeoutMs: 10000,
      drainTimeoutMs: 0,
      startupTimeoutMs: 5000,
      stallTimeoutMs: 10000,
      structuredOutput: false,
      auth: {
        mode: "api_key",
        sourceHome: path.join(root, "codex-home"),
      },
      provider: null,
      sandbox: {
        image: "risoluto-codex:latest",
        network: "",
        security: { noNewPrivileges: true, dropCapabilities: true, gvisor: false, seccompProfile: "" },
        resources: { memory: "4g", memoryReservation: "1g", memorySwap: "4g", cpus: "2.0", tmpfsSize: "512m" },
        extraMounts: [],
        envPassthrough: [],
        logs: { driver: "json-file", maxSize: "50m", maxFile: 3 },
        egressAllowlist: [],
      },
    },
    server: { port: 4000 },
    webhook: webhook ?? null,
  };
}

function createConfigStore(config: ServiceConfig): ConfigStore {
  return {
    getConfig: () => config,
    getMergedConfigMap: () => ({ system: { selectedTemplateId: null } }),
    subscribe: () => () => undefined,
  } as unknown as ConfigStore;
}

function createOverlayStore(): ConfigOverlayPort {
  return {
    toMap: () => ({}),
    subscribe: () => () => undefined,
  };
}

function createSecretsStore(initial: Record<string, string> = {}) {
  const secrets = new Map(Object.entries(initial));
  return {
    get(key: string) {
      return secrets.get(key) ?? null;
    },
    async set(key: string, value: string) {
      secrets.set(key, value);
    },
    async delete(key: string) {
      secrets.delete(key);
    },
    subscribe() {
      return () => undefined;
    },
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function pollForStatusChange(
  archive: ReturnType<typeof createWorkflowRunArchive>,
  workflowRunId: string,
  fromStatus: string,
  timeoutMs: number,
): Promise<WorkflowRunStartRecord> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const run = await archive.loadWorkflowRun(workflowRunId);
    if (run.status !== fromStatus) {
      return run;
    }
    if (Date.now() > deadline) {
      throw new Error(`Workflow Run ${workflowRunId} still "${fromStatus}" after ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("createServices integration", () => {
  it("builds the real service graph with webhook mode disabled", async () => {
    const archiveDir = await createTempDir();
    const logger = createMockLogger();
    const result = await createServices(
      createConfigStore(createServiceConfig(archiveDir)),
      createOverlayStore(),
      createSecretsStore(),
      archiveDir,
      logger,
    );

    try {
      expect(result.persistence.db).not.toBeNull();
      expect(result.webhookHealthTracker).toBeUndefined();
      expect(result.webhookRegistrar).toBeUndefined();
      expect(result.webhookInbox).toBeUndefined();
    } finally {
      result.persistence.close();
    }
  });

  it("wires webhook inbox and registrar when webhook_url exists but the secret is missing", async () => {
    const archiveDir = await createTempDir();
    const logger = createMockLogger();
    const result = await createServices(
      createConfigStore(
        createServiceConfig(archiveDir, {
          webhookUrl: "https://example.com/webhooks/linear",
          webhookSecret: "",
          previousWebhookSecret: null,
          pollingStretchMs: 60000,
          pollingBaseMs: 15000,
          healthCheckIntervalMs: 30000,
        }),
      ),
      createOverlayStore(),
      createSecretsStore(),
      archiveDir,
      logger,
    );

    try {
      expect(result.webhookHealthTracker).toBeUndefined();
      expect(result.webhookInbox).toBeInstanceOf(SqliteWebhookInbox);
      expect(result.webhookRegistrar).toBeInstanceOf(WebhookRegistrar);
      expect(logger.warn).toHaveBeenCalledWith(
        { webhookUrl: "https://example.com/webhooks/linear" },
        "webhook_url is configured but webhook_secret is missing — set $LINEAR_WEBHOOK_SECRET or configure webhook_secret in Settings",
      );
    } finally {
      result.persistence.close();
    }
  });

  it("uses a supplied persistence runtime and enables full webhook infrastructure when url and secret are present", async () => {
    const archiveDir = await createTempDir();
    const logger = createMockLogger();
    const persistence = await initPersistenceRuntime({ dataDir: archiveDir, logger });

    const result = await createServices(
      createConfigStore(
        createServiceConfig(archiveDir, {
          webhookUrl: "https://example.com/webhooks/linear",
          webhookSecret: "manual-secret",
          previousWebhookSecret: "old-secret",
          pollingStretchMs: 60000,
          pollingBaseMs: 15000,
          healthCheckIntervalMs: 30000,
        }),
      ),
      createOverlayStore(),
      createSecretsStore(),
      archiveDir,
      logger,
      { persistence: persistence as PersistenceRuntime },
    );

    try {
      expect(result.persistence).toBe(persistence);
      expect(result.webhookInbox).toBeInstanceOf(SqliteWebhookInbox);
      expect(result.webhookRegistrar).toBeInstanceOf(WebhookRegistrar);
      expect(result.webhookHealthTracker).toBeInstanceOf(DefaultWebhookHealthTracker);
    } finally {
      result.persistence.close();
    }
  });

  // Proves the Phase 8 daemon subscriber (the keystone of review finding #1) is real production
  // wiring, not test-local theater: it emits workflow_run.accepted on the bus createServices returns
  // and asserts the accepted run is actually driven to a real blocked handoff through the same engine
  // `run start` uses. Deleting the subscriber inside createServices makes this test time out.
  it("daemon subscriber drives an accepted run to a real blocked handoff", async () => {
    // createServices derives workflowDir as dirname(archiveDir)/workflows (mirrors production, where
    // archiveDir is dataDir/archives). Seed the real default workflow there so the driver resolves it.
    const baseDir = await createTempDir();
    const archiveDir = path.join(baseDir, "archives");
    await mkdir(archiveDir, { recursive: true });
    const workflowDir = path.join(baseDir, "workflows");
    await mkdir(workflowDir, { recursive: true });
    await copyFile(
      path.resolve(".risoluto", "workflows", `${DEFAULT_WORKFLOW_DEFINITION_ID}.yaml`),
      path.join(workflowDir, `${DEFAULT_WORKFLOW_DEFINITION_ID}.yaml`),
    );
    const logger = createMockLogger();
    const result = await createServices(
      createConfigStore(createServiceConfig(archiveDir)),
      createOverlayStore(),
      createSecretsStore(),
      archiveDir,
      logger,
    );

    try {
      // Record a real accepted run, exactly as every intake surface does before it emits.
      const intake = await acceptWorkflowRunIntake({
        archiveDir,
        source: "api",
        mode: "start",
        title: "subscriber drive proof",
        body: "prove the production daemon subscriber drives an accepted run",
        externalObject: null,
        rules: [],
        workflowDefinitionId: DEFAULT_WORKFLOW_DEFINITION_ID,
        workspaceKey: "default",
      });
      const workflowRunId = intake.workflowRun.id;

      const archive = createWorkflowRunArchive({ archiveDir });
      expect((await archive.loadWorkflowRun(workflowRunId)).status).toBe("accepted");

      // Fire the SAME event the intake surfaces emit; it must reach the production subscriber.
      result.eventBus.emit("workflow_run.accepted", {
        workflowRunId,
        source: intake.workflowRun.source,
        title: intake.workflowRun.title,
        workflowDefinitionId: intake.workflowRun.workflowDefinitionId,
      });

      // The driver runs fire-and-forget through the real single-operator-afk-coder workflow; with the
      // honest-block default dispatch the planner role blocks, producing a real handoff.v1.
      const driven = await pollForStatusChange(archive, workflowRunId, "accepted", 15000);
      expect(driven.status).toBe("blocked");

      const handoff = await archive.readWorkflowRunArtifact({ workflowRunId, artifactId: "handoff" });
      expect(handoff.data).toMatchObject({ version: 1, outcome: "blocked" });
    } finally {
      result.persistence.close();
    }
  }, 30000);
});
