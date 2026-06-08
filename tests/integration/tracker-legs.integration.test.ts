/**
 * Reachability integration tests for NIN-106 tracker-leg wiring.
 *
 * AC1 — polling dedup:
 *   Webhook delivery + orchestrator-tick polling reconciliation for the SAME external issue
 *   collapse to exactly ONE Workflow Run, with the polling leg driven by the real orchestrator
 *   tick (not a test fabrication).
 *
 * AC2 — retry signal:
 *   A retry label on a Linear "update" webhook, a retry comment on a Linear "Comment" webhook,
 *   and a retry label on a GitHub "labeled" webhook each create a NEW ATTEMPT on the existing
 *   Workflow Run — via the real webhook handler → intake path.
 */

import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { acceptTrackerIssueWorkflowRun } from "../../src/workflow-run/tracker-intake.js";
import type { WorkflowRunIntakeOutput } from "../../src/workflow-run/intake-core.js";
import { createWorkflowRunArchive } from "../../src/workflow-run/archive.js";
import { Orchestrator } from "../../src/orchestrator/orchestrator.js";
import { handleWebhookLinear, type WebhookHandlerDeps } from "../../src/webhook/linear-handler.js";
import { handleWebhookGitHub, type GitHubWebhookHandlerDeps } from "../../src/webhook/github-handler.js";
import type { WebhookRequest } from "../../src/http/webhook-types.js";
import type { Response } from "express";
import {
  createAttemptStore,
  createConfig,
  createConfigStore,
  createCostSampleStore,
  createIssueConfigStore,
  createLogger,
  createResolveTemplate,
  passThroughWithLock,
} from "../orchestrator/orchestrator-fixtures.js";
import type { AgentRunner, TrackerPort, WorkspaceManager } from "../orchestrator/orchestrator-fixtures.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "risoluto-tracker-legs-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function makeResponse(): Response & { _status: number } {
  const res = {
    _status: 200,
    status(code: number) {
      res._status = code;
      return res;
    },
    json() {
      return res;
    },
    setHeader() {
      return res;
    },
  };
  return res as unknown as Response & { _status: number };
}

function signLinear(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function signGitHub(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function linearIssue() {
  return {
    id: "lin_issue_106",
    identifier: "RIS-106",
    title: "Tracker intake wiring",
    url: "https://linear.app/test/issue/RIS-106",
    description: "Wire polling and retry legs.",
    labels: ["risoluto"],
    state: "In Progress",
  };
}

/**
 * Build a real Linear webhook request with a valid HMAC signature for the handler's
 * signature check path.
 */
function makeLinearRequest(
  payload: Record<string, unknown>,
  secret: string,
  deliveryId = "linear-delivery-1",
): WebhookRequest {
  const bodyStr = JSON.stringify(payload);
  const rawBody = Buffer.from(bodyStr);
  return {
    body: payload,
    rawBody,
    path: "/webhooks/linear",
    get: (name: string) => {
      const headers: Record<string, string> = {
        "linear-signature": signLinear(bodyStr, secret),
        "linear-delivery": deliveryId,
      };
      return headers[name.toLowerCase()];
    },
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as WebhookRequest;
}

/**
 * Build a real GitHub webhook request with a valid HMAC signature.
 */
function makeGitHubRequest(
  payload: Record<string, unknown>,
  secret: string,
  event = "issues",
  deliveryId = "github-delivery-1",
): WebhookRequest {
  const bodyStr = JSON.stringify(payload);
  const rawBody = Buffer.from(bodyStr);
  return {
    body: payload,
    rawBody,
    path: "/webhooks/github",
    get: (name: string) => {
      const headers: Record<string, string> = {
        "x-hub-signature-256": `sha256=${signGitHub(bodyStr, secret)}`,
        "x-github-event": event,
        "x-github-delivery": deliveryId,
      };
      return headers[name.toLowerCase()];
    },
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as WebhookRequest;
}

// ---------------------------------------------------------------------------
// AC1 — polling dedup via the orchestrator tick
// ---------------------------------------------------------------------------

describe("tracker-legs AC1: orchestrator tick deduplicates polling against prior webhook delivery", () => {
  it("webhook delivery + polling tick for the same Linear issue produce exactly one Workflow Run", async () => {
    vi.useFakeTimers();
    const dataDir = await createTempDir();

    // Step 1: simulate a prior webhook delivery creating the run directly
    const webhookResult = await acceptTrackerIssueWorkflowRun({
      dataDir,
      provider: "linear",
      deliveryKind: "webhook",
      deliveryId: "linear-delivery-1",
      action: "create",
      issue: linearIssue(),
      id: () => "wr_ac1_dedup",
    });
    expect(webhookResult.action).toBe("created");

    // Step 2: run the orchestrator tick with pollTrackerIssue wired to real intake
    const pollOutputs: WorkflowRunIntakeOutput[] = [];
    let resolvePoll!: () => void;
    const pollDone = new Promise<void>((resolve) => {
      resolvePoll = resolve;
    });

    const tracker = {
      fetchCandidateIssues: vi.fn().mockResolvedValue([
        {
          id: "lin_issue_106",
          identifier: "RIS-106",
          title: "Tracker intake wiring",
          description: "Wire polling and retry legs.",
          priority: 1,
          state: "In Progress",
          branchName: null,
          url: "https://linear.app/test/issue/RIS-106",
          labels: ["risoluto"],
          blockedBy: [],
          createdAt: null,
          updatedAt: null,
        },
      ]),
      fetchIssueStatesByIds: vi.fn().mockResolvedValue([]),
    } as unknown as TrackerPort;

    const workspaceManager = {
      ensureWorkspace: vi.fn(),
      removeWorkspace: vi.fn().mockResolvedValue(undefined),
      withLock: passThroughWithLock,
    } as unknown as WorkspaceManager;

    const orchestrator = new Orchestrator({
      attemptStore: createAttemptStore(),
      costSampleStore: createCostSampleStore(),
      configStore: createConfigStore(createConfig()),
      tracker,
      workspaceManager,
      agentRunner: { runAttempt: vi.fn() } as unknown as AgentRunner,
      issueConfigStore: createIssueConfigStore(),
      logger: createLogger(),
      resolveTemplate: createResolveTemplate(),
      pollTrackerIssue: async (issue) => {
        const output = await acceptTrackerIssueWorkflowRun({
          dataDir,
          provider: "linear",
          deliveryKind: "polling",
          action: "reconcile",
          issue,
        });
        pollOutputs.push(output);
        resolvePoll();
      },
    });

    await orchestrator.start();
    vi.advanceTimersByTime(0); // fire the first tick timer synchronously
    vi.useRealTimers(); // allow real async operations (file I/O) to complete
    await pollDone; // wait for the polling intake to complete
    await orchestrator.stop();

    // Polling intake must have deduplicated — same run, not a second one
    expect(pollOutputs).toHaveLength(1);
    expect(pollOutputs[0].action).toBe("deduplicated");
    expect(pollOutputs[0].workflowRun.id).toBe("wr_ac1_dedup");

    // Exactly ONE run in the archive
    const archive = createWorkflowRunArchive({ dataDir });
    await expect(archive.listWorkflowRuns()).resolves.toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// AC2 — retry signal via the Linear webhook handler
// ---------------------------------------------------------------------------

describe("tracker-legs AC2: Linear webhook handler forwards labels and comments for retry", () => {
  const LINEAR_SECRET = "linear-test-secret";

  /**
   * Build a minimal Linear webhook dep whose intake function is the REAL
   * `acceptTrackerIssueWorkflowRun` bound to a temp archive.  Captures each
   * `WorkflowRunIntakeOutput` for assertion.
   */
  function buildLinearDeps(
    dataDir: string,
    intakeOutputs: WorkflowRunIntakeOutput[],
    deliverySeen = new Set<string>(),
  ): WebhookHandlerDeps {
    return {
      getWebhookSecret: () => LINEAR_SECRET,
      requestRefresh: vi.fn(),
      requestTargetedRefresh: vi.fn(),
      stopWorkerForIssue: vi.fn(),
      recordVerifiedDelivery: vi.fn(),
      webhookInbox: {
        insertVerified: async (d) => {
          const key = d.bodyDigest ?? d.deliveryId;
          if (deliverySeen.has(key)) return { isNew: false };
          deliverySeen.add(key);
          return { isNew: true };
        },
      },
      acceptLinearTriggeredWorkflowRun: async (input) => {
        // Call the real intake directly so we can capture the full output
        const output = await acceptTrackerIssueWorkflowRun({
          dataDir,
          provider: "linear",
          deliveryKind: "webhook",
          action: input.action,
          deliveryId: input.deliveryId ?? null,
          issue: input.issue,
        });
        intakeOutputs.push(output);
        return { type: "workflow_run.started", workflowRun: output.workflowRun };
      },
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn().mockReturnThis(),
      },
    };
  }

  it("retry label on Issue update creates a new attempt on the existing Workflow Run", async () => {
    const dataDir = await createTempDir();
    const intakeOutputs: WorkflowRunIntakeOutput[] = [];
    const deps = buildLinearDeps(dataDir, intakeOutputs);

    // First: create the run via Issue "create" (no retry label)
    const createPayload = {
      action: "create",
      type: "Issue",
      data: {
        id: "lin_issue_106",
        identifier: "RIS-106",
        title: "Tracker intake wiring",
        url: "https://linear.app/test/issue/RIS-106",
        description: "Wire polling and retry legs.",
        labels: [{ id: "lbl-risoluto", name: "risoluto" }],
      },
      webhookTimestamp: Date.now(),
    };
    handleWebhookLinear(deps, makeLinearRequest(createPayload, LINEAR_SECRET, "delivery-create"), makeResponse());
    await flushMicrotasks();

    // Second: retry via "update" event carrying the retry label
    const retryPayload = {
      action: "update",
      type: "Issue",
      data: {
        id: "lin_issue_106",
        identifier: "RIS-106",
        title: "Tracker intake wiring",
        url: "https://linear.app/test/issue/RIS-106",
        labels: [
          { id: "lbl-risoluto", name: "risoluto" },
          { id: "lbl-retry", name: "risoluto:retry" },
        ],
      },
      webhookTimestamp: Date.now(),
    };
    handleWebhookLinear(deps, makeLinearRequest(retryPayload, LINEAR_SECRET, "delivery-retry-label"), makeResponse());
    await flushMicrotasks();

    // Allow real async I/O to settle (delivery-workflow runs process() asynchronously)
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(intakeOutputs).toHaveLength(2);
    expect(intakeOutputs[0].action).toBe("created");
    expect(intakeOutputs[1].action).toBe("retried");
    expect(intakeOutputs[1].runAttempt).toMatchObject({
      workflowRunId: intakeOutputs[0].workflowRun.id,
      attemptNumber: 1,
      reason: "retry",
    });

    const archive = createWorkflowRunArchive({ dataDir });
    await expect(archive.listWorkflowRuns()).resolves.toHaveLength(1);
  });

  it("retry comment on Comment create creates a new attempt on the existing Workflow Run", async () => {
    const dataDir = await createTempDir();
    const intakeOutputs: WorkflowRunIntakeOutput[] = [];
    const deps = buildLinearDeps(dataDir, intakeOutputs);

    // First: create the run via Issue "create"
    const createPayload = {
      action: "create",
      type: "Issue",
      data: {
        id: "lin_issue_106",
        identifier: "RIS-106",
        title: "Tracker intake wiring",
        url: "https://linear.app/test/issue/RIS-106",
        labels: [{ id: "lbl-risoluto", name: "risoluto" }],
      },
      webhookTimestamp: Date.now(),
    };
    handleWebhookLinear(deps, makeLinearRequest(createPayload, LINEAR_SECRET, "delivery-create-c"), makeResponse());
    await flushMicrotasks();
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Second: retry via Comment "create" with the retry command
    const commentPayload = {
      action: "create",
      type: "Comment",
      data: {
        id: "comment-uuid-1",
        body: "/risoluto retry",
        issue: {
          id: "lin_issue_106",
          identifier: "RIS-106",
          title: "Tracker intake wiring",
          url: "https://linear.app/test/issue/RIS-106",
        },
      },
      webhookTimestamp: Date.now(),
    };
    handleWebhookLinear(
      deps,
      makeLinearRequest(commentPayload, LINEAR_SECRET, "delivery-retry-comment"),
      makeResponse(),
    );
    await flushMicrotasks();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(intakeOutputs).toHaveLength(2);
    expect(intakeOutputs[0].action).toBe("created");
    expect(intakeOutputs[1].action).toBe("retried");
    expect(intakeOutputs[1].runAttempt).toMatchObject({
      workflowRunId: intakeOutputs[0].workflowRun.id,
      attemptNumber: 1,
      reason: "retry",
    });

    const archive = createWorkflowRunArchive({ dataDir });
    await expect(archive.listWorkflowRuns()).resolves.toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// AC2 — retry signal via the GitHub webhook handler
// ---------------------------------------------------------------------------

describe("tracker-legs AC2: GitHub webhook handler retry label creates a new attempt", () => {
  const GITHUB_SECRET = "github-test-secret";
  const REPO_OWNER = "acme";
  const REPO_NAME = "awesome";

  function buildGitHubDeps(
    dataDir: string,
    intakeOutputs: WorkflowRunIntakeOutput[],
    deliverySeen = new Set<string>(),
  ): GitHubWebhookHandlerDeps {
    return {
      configStore: {
        getConfig: () =>
          ({
            triggers: { githubSecret: GITHUB_SECRET },
            tracker: { kind: "github", owner: REPO_OWNER, repo: REPO_NAME },
          }) as ReturnType<NonNullable<GitHubWebhookHandlerDeps["configStore"]>["getConfig"]>,
      },
      requestTargetedRefresh: vi.fn(),
      stopWorkerForIssue: vi.fn(),
      webhookInbox: {
        insertVerified: async (d) => {
          const key = d.bodyDigest ?? d.deliveryId;
          if (deliverySeen.has(key)) return { isNew: false };
          deliverySeen.add(key);
          return { isNew: true };
        },
      },
      acceptGitHubTriggeredWorkflowRun: async (input) => {
        const output = await acceptTrackerIssueWorkflowRun({
          dataDir,
          provider: "github",
          deliveryKind: "webhook",
          action: input.action,
          deliveryId: input.deliveryId ?? null,
          issue: input.issue,
        });
        intakeOutputs.push(output);
        return { type: "workflow_run.started", workflowRun: output.workflowRun };
      },
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn().mockReturnThis(),
      },
    };
  }

  it("retry label on labeled event creates a new attempt on the existing Workflow Run", async () => {
    const dataDir = await createTempDir();
    const intakeOutputs: WorkflowRunIntakeOutput[] = [];
    const deps = buildGitHubDeps(dataDir, intakeOutputs);

    // First: "opened" event — creates the run
    const openedPayload = {
      action: "opened",
      issue: {
        number: 7,
        title: "Fix the tracker wiring",
        body: "Wire the tracker polling and retry legs.",
        html_url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/issues/7`,
        state: "open",
        labels: [{ name: "risoluto" }],
      },
      repository: { full_name: `${REPO_OWNER}/${REPO_NAME}` },
    };
    handleWebhookGitHub(
      deps,
      makeGitHubRequest(openedPayload, GITHUB_SECRET, "issues", "gh-delivery-1"),
      makeResponse(),
    );
    await flushMicrotasks();
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Second: "labeled" event carrying the retry label
    const labeledPayload = {
      action: "labeled",
      issue: {
        number: 7,
        title: "Fix the tracker wiring",
        body: "Wire the tracker polling and retry legs.",
        html_url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/issues/7`,
        state: "open",
        labels: [{ name: "risoluto" }, { name: "risoluto:retry" }],
      },
      repository: { full_name: `${REPO_OWNER}/${REPO_NAME}` },
    };
    handleWebhookGitHub(
      deps,
      makeGitHubRequest(labeledPayload, GITHUB_SECRET, "issues", "gh-delivery-2"),
      makeResponse(),
    );
    await flushMicrotasks();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(intakeOutputs).toHaveLength(2);
    expect(intakeOutputs[0].action).toBe("created");
    expect(intakeOutputs[1].action).toBe("retried");
    expect(intakeOutputs[1].runAttempt).toMatchObject({
      workflowRunId: intakeOutputs[0].workflowRun.id,
      attemptNumber: 1,
      reason: "retry",
    });

    const archive = createWorkflowRunArchive({ dataDir });
    await expect(archive.listWorkflowRuns()).resolves.toHaveLength(1);
  });
});
