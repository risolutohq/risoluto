/**
 * Reachability integration tests for the accepted-run driver wiring (Phase 1 — Foundation).
 *
 * Each test drives a POST through the REAL handler/route with a valid provider signature or write token,
 * wires a REAL TypedEventBus + createAcceptedRunDriver pointing at a temp archiveDir, and asserts:
 *   - the event-bus subscriber fires (onSettled hook resolves)
 *   - the run status progresses past accepted (to blocked, since dispatchRole throws)
 *   - a real handoff.v1 is written on disk
 *
 * This proves the wiring is not reachability theater — the code path from HTTP/webhook entry point
 * through event-bus to driver to driveAcceptedWorkflowRun is exercised end-to-end.
 */

import { createHmac } from "node:crypto";
import http from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import express from "express";
import { afterEach, describe, expect, it } from "vitest";

import { TypedEventBus } from "../../src/core/event-bus.js";
import type { RisolutoEventMap } from "../../src/core/risoluto-events.js";
import { createAcceptedRunDriver } from "../../src/cli/accepted-run-driver.js";
import type { WorkflowRunRoleDispatch } from "../../src/workflow-run/run-role-runner.js";
import { WorkflowRunRoleDispatchError } from "../../src/workflow-run/run-role-runner.js";
import type { DriveAcceptedWorkflowRunResult } from "../../src/workflow-run/drive-accepted-run.js";
import { createWorkflowRunArchive } from "../../src/workflow-run/archive.js";
import { createReadGuard } from "../../src/http/read-guard.js";
import { createWriteGuard } from "../../src/http/write-guard.js";
import { registerWorkflowRunRoutes } from "../../src/http/routes/workflow-runs.js";
import { handleWebhookLinear, type WebhookHandlerDeps } from "../../src/webhook/linear-handler.js";
import { handleWebhookGitHub, type GitHubWebhookHandlerDeps } from "../../src/webhook/github-handler.js";
import { handleWebhookSlack, type SlackWebhookHandlerDeps } from "../../src/webhook/slack-handler.js";
import type { WebhookRequest } from "../../src/http/webhook-types.js";
import { createMockLogger } from "../helpers.js";

// ---------------------------------------------------------------------------
// Minimal workflow fixture (plan-only, artifacts-valid gate only, no actions)
// ---------------------------------------------------------------------------

const FIXTURE_WORKFLOW_ID = "reachability-fixture";
const FIXTURE_WORKFLOW_YAML = `\
version: 1
id: ${FIXTURE_WORKFLOW_ID}
defaults: {}
states:
  - id: plan
    roles:
      - id: planner
        consumes: [intent.v1]
        produces: [plan.v1]
        dependsOn: []
    gates: []
    hooks: []
actions: []
`;

// ---------------------------------------------------------------------------
// Fake dispatchRole: throws so the run reaches blocked with a real handoff.v1
// ---------------------------------------------------------------------------

const throwingDispatch: WorkflowRunRoleDispatch = async (input) => {
  throw new WorkflowRunRoleDispatchError(`reachability-test fake dispatch threw for role ${input.role.id}`);
};

// ---------------------------------------------------------------------------
// Test infra helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeWorkflowFixture(workflowDir: string): Promise<void> {
  await mkdir(workflowDir, { recursive: true });
  await writeFile(path.join(workflowDir, `${FIXTURE_WORKFLOW_ID}.yaml`), FIXTURE_WORKFLOW_YAML, "utf8");
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * Create a real eventBus + acceptedRunDriver pointed at the temp archive.
 * Returns a helper that registers the subscriber and exposes a settled-promise factory.
 */
function buildDriverWiring(archiveDir: string, workflowDir: string) {
  const eventBus = new TypedEventBus<RisolutoEventMap>();
  const driver = createAcceptedRunDriver({
    archiveDir,
    workflowDir,
    dispatchRole: throwingDispatch,
    logger: createMockLogger(),
  });

  function waitForSettled(): Promise<DriveAcceptedWorkflowRunResult> {
    return new Promise((resolve) => {
      eventBus.on("workflow_run.accepted", (e) => {
        void driver
          .drive(e.workflowRunId)
          .then(resolve)
          .catch(() => resolve({ outcome: "blocked", workflowRunId: e.workflowRunId, roleExecutions: [] }));
      });
    });
  }

  return { eventBus, driver, waitForSettled };
}

async function startHttpServer(app: express.Express): Promise<{ server: http.Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const address = server.address() as { port: number };
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

async function stopServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

// ---------------------------------------------------------------------------
// Signing helpers (copy from existing test harness patterns)
// ---------------------------------------------------------------------------

function signLinear(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function signGitHub(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function signSlack(body: string, timestamp: number, secret: string): string {
  const base = `v0:${timestamp}:${body}`;
  return `v0=${createHmac("sha256", secret).update(base).digest("hex")}`;
}

// ---------------------------------------------------------------------------
// Test: Linear surface
// ---------------------------------------------------------------------------

describe("Linear webhook → accepted-run driver reachability", () => {
  it("emits workflow_run.accepted and drives run to blocked with a real handoff.v1", async () => {
    const baseDir = await createTempDir("reach-linear-");
    const archiveDir = path.join(baseDir, "archive");
    const workflowDir = path.join(baseDir, "workflows");
    await mkdir(archiveDir, { recursive: true });
    await writeWorkflowFixture(workflowDir);

    const { eventBus, waitForSettled } = buildDriverWiring(archiveDir, workflowDir);
    const settledPromise = waitForSettled();

    const LINEAR_SECRET = "linear-test-secret";
    const timestamp = Date.now();
    const deliveryId = "linear-reach-delivery-1";

    const bodyObj = {
      action: "create",
      type: "Issue",
      data: {
        id: "lin_reach_1",
        identifier: "NIN-REACH-1",
        title: "Reachability test from Linear",
        url: "https://linear.app/test/NIN-REACH-1",
        description: "Integration reachability test.",
      },
      webhookTimestamp: timestamp,
      url: "https://linear.app/test/NIN-REACH-1",
    };
    const rawBody = Buffer.from(JSON.stringify(bodyObj));
    const signature = signLinear(rawBody.toString(), LINEAR_SECRET);

    const mockLogger = createMockLogger();
    const deps: WebhookHandlerDeps = {
      getWebhookSecret: () => LINEAR_SECRET,
      requestRefresh: () => undefined,
      requestTargetedRefresh: () => undefined,
      recordVerifiedDelivery: () => undefined,
      webhookInbox: { insertVerified: async () => ({ isNew: true }) },
      acceptLinearTriggeredWorkflowRun: async (input) => {
        const { acceptLinearTriggeredWorkflowRun } = await import("../../src/workflow-run/linear-intake.js");
        return acceptLinearTriggeredWorkflowRun({
          ...input,
          archiveDir,
          workflowDefinitionId: FIXTURE_WORKFLOW_ID,
          rules: [
            {
              id: "r1",
              provider: "linear",
              requiredLabels: [],
              states: [],
              workflowDefinitionId: FIXTURE_WORKFLOW_ID,
              workspaceKey: "default",
            },
          ],
          now: () => new Date().toISOString(),
          id: () => "wr_reach_linear",
        });
      },
      eventBus,
      logger: mockLogger,
    };

    const req = {
      body: bodyObj,
      rawBody,
      path: "/webhooks/linear",
      get: (name: string) => {
        const headers: Record<string, string> = {
          "linear-signature": signature,
          "linear-delivery": deliveryId,
        };
        return headers[name.toLowerCase()];
      },
      socket: { remoteAddress: "127.0.0.1" },
    } as unknown as WebhookRequest;

    const res = {
      _status: 200,
      _body: null as unknown,
      status(code: number) {
        this._status = code;
        return this;
      },
      json(data: unknown) {
        this._body = data;
        return this;
      },
    } as unknown as import("express").Response & { _status: number; _body: unknown };

    handleWebhookLinear(deps, req, res);

    const result = await settledPromise;

    expect(result.outcome).toBe("blocked");
    expect(result.workflowRunId).toBeTruthy();

    const archive = createWorkflowRunArchive({ archiveDir });
    const runs = await archive.listWorkflowRuns();
    expect(runs.length).toBeGreaterThanOrEqual(1);

    const run = runs.find((r) => r.id === result.workflowRunId);
    expect(run).toBeDefined();
    expect(run?.status).toBe("blocked");

    const handoffPayload = await archive.readWorkflowRunArtifact({
      workflowRunId: result.workflowRunId,
      artifactId: "handoff",
    });
    expect(handoffPayload.data).toMatchObject({ version: 1, outcome: "blocked" });
  });
});

// ---------------------------------------------------------------------------
// Test: GitHub surface
// ---------------------------------------------------------------------------

describe("GitHub webhook → accepted-run driver reachability", () => {
  it("emits workflow_run.accepted and drives run to blocked with a real handoff.v1", async () => {
    const baseDir = await createTempDir("reach-github-");
    const archiveDir = path.join(baseDir, "archive");
    const workflowDir = path.join(baseDir, "workflows");
    await mkdir(archiveDir, { recursive: true });
    await writeWorkflowFixture(workflowDir);

    const { eventBus, waitForSettled } = buildDriverWiring(archiveDir, workflowDir);
    const settledPromise = waitForSettled();

    const GITHUB_SECRET = "github-test-secret";
    const deliveryId = "github-reach-delivery-1";

    const bodyObj = {
      action: "opened",
      issue: {
        number: 99,
        title: "Reachability test from GitHub",
        body: "GitHub reachability integration test.",
        html_url: "https://github.com/acme/repo/issues/99",
        state: "open",
        labels: [],
      },
      repository: {
        full_name: "acme/repo",
      },
    };
    const rawBody = Buffer.from(JSON.stringify(bodyObj));
    const signature = `sha256=${signGitHub(rawBody.toString(), GITHUB_SECRET)}`;

    const mockLogger = createMockLogger();
    const deps: GitHubWebhookHandlerDeps = {
      configStore: {
        getConfig: () =>
          ({
            triggers: { githubSecret: GITHUB_SECRET },
            tracker: { kind: "github", owner: "acme", repo: "repo" },
          }) as ReturnType<NonNullable<GitHubWebhookHandlerDeps["configStore"]>["getConfig"]>,
      },
      webhookInbox: { insertVerified: async () => ({ isNew: true }) },
      acceptGitHubTriggeredWorkflowRun: async (input) => {
        const { acceptGitHubTriggeredWorkflowRun } = await import("../../src/workflow-run/tracker-intake.js");
        return acceptGitHubTriggeredWorkflowRun({
          ...input,
          archiveDir,
          workflowDefinitionId: FIXTURE_WORKFLOW_ID,
          rules: [
            {
              id: "r1",
              provider: "github",
              requiredLabels: [],
              states: [],
              workflowDefinitionId: FIXTURE_WORKFLOW_ID,
              workspaceKey: "default",
            },
          ],
          now: () => new Date().toISOString(),
          id: () => "wr_reach_github",
        });
      },
      eventBus,
      logger: mockLogger,
    };

    const req = {
      body: bodyObj,
      rawBody,
      path: "/webhooks/github",
      get: (name: string) => {
        const headers: Record<string, string> = {
          "x-hub-signature-256": signature,
          "x-github-event": "issues",
          "x-github-delivery": deliveryId,
        };
        return headers[name.toLowerCase()];
      },
      socket: { remoteAddress: "127.0.0.1" },
    } as unknown as WebhookRequest;

    const res = {
      _status: 200,
      _body: null as unknown,
      status(code: number) {
        this._status = code;
        return this;
      },
      json(data: unknown) {
        this._body = data;
        return this;
      },
    } as unknown as import("express").Response & { _status: number; _body: unknown };

    handleWebhookGitHub(deps, req, res);

    const result = await settledPromise;

    expect(result.outcome).toBe("blocked");
    expect(result.workflowRunId).toBeTruthy();

    const archive = createWorkflowRunArchive({ archiveDir });
    const run = await archive.loadWorkflowRun(result.workflowRunId);
    expect(run.status).toBe("blocked");

    const handoffPayload = await archive.readWorkflowRunArtifact({
      workflowRunId: result.workflowRunId,
      artifactId: "handoff",
    });
    expect(handoffPayload.data).toMatchObject({ version: 1, outcome: "blocked" });
  });
});

// ---------------------------------------------------------------------------
// Test: Slack surface
// ---------------------------------------------------------------------------

describe("Slack modal webhook → accepted-run driver reachability", () => {
  it("emits workflow_run.accepted and drives run to blocked with a real handoff.v1", async () => {
    const baseDir = await createTempDir("reach-slack-");
    const archiveDir = path.join(baseDir, "archive");
    const workflowDir = path.join(baseDir, "workflows");
    await mkdir(archiveDir, { recursive: true });
    await writeWorkflowFixture(workflowDir);

    const { eventBus, waitForSettled } = buildDriverWiring(archiveDir, workflowDir);
    const settledPromise = waitForSettled();

    const SLACK_SECRET = "slack-test-secret";
    const EPOCH = Math.floor(Date.now() / 1000);

    const modalPayload = {
      type: "view_submission",
      team: { id: "T_TEST" },
      user: { id: "U_TEST" },
      view: {
        id: "V_REACH_1",
        private_metadata: JSON.stringify({
          title: "Reachability test from Slack",
          body: "Slack modal reachability integration test.",
          workflowDefinitionId: FIXTURE_WORKFLOW_ID,
          workspaceKey: "default",
        }),
      },
    };
    const bodyStr = `payload=${encodeURIComponent(JSON.stringify(modalPayload))}`;
    const signature = signSlack(bodyStr, EPOCH, SLACK_SECRET);
    const rawBody = Buffer.from(bodyStr);

    const mockLogger = createMockLogger();
    const deps: SlackWebhookHandlerDeps = {
      signingSecret: SLACK_SECRET,
      operators: [],
      allowedSlackTeamIds: ["T_TEST"],
      rules: [],
      archiveDir,
      now: () => new Date().toISOString(),
      id: () => "wr_reach_slack",
      nowEpochSeconds: () => EPOCH,
      eventBus,
      logger: mockLogger,
    };

    const req = {
      rawBody,
      body: Object.fromEntries(new URLSearchParams(bodyStr)),
      path: "/webhooks/slack",
      get: (name: string) => {
        const headers: Record<string, string> = {
          "x-slack-signature": signature,
          "x-slack-request-timestamp": String(EPOCH),
        };
        return headers[name.toLowerCase()];
      },
      socket: { remoteAddress: "127.0.0.1" },
    } as unknown as WebhookRequest;

    const res = {
      _status: 200,
      _body: null as unknown,
      status(code: number) {
        this._status = code;
        return this;
      },
      json(data: unknown) {
        this._body = data;
        return this;
      },
    } as unknown as import("express").Response & { _status: number; _body: unknown };

    await handleWebhookSlack(deps, req, res);

    expect(res._status).toBe(200);

    const result = await settledPromise;

    expect(result.outcome).toBe("blocked");
    expect(result.workflowRunId).toBeTruthy();

    const archive = createWorkflowRunArchive({ archiveDir });
    const run = await archive.loadWorkflowRun(result.workflowRunId);
    expect(run.status).toBe("blocked");
    expect(run.source).toBe("slack");

    const handoffPayload = await archive.readWorkflowRunArtifact({
      workflowRunId: result.workflowRunId,
      artifactId: "handoff",
    });
    expect(handoffPayload.data).toMatchObject({ version: 1, outcome: "blocked" });
  });
});

// ---------------------------------------------------------------------------
// Test: HTTP API surface
// ---------------------------------------------------------------------------

describe("HTTP API POST /api/v1/workflow-runs → accepted-run driver reachability", () => {
  it("emits workflow_run.accepted and drives run to blocked with a real handoff.v1", async () => {
    process.env.RISOLUTO_WRITE_TOKEN = "write-reach-secret";
    const baseDir = await createTempDir("reach-http-");
    const archiveDir = path.join(baseDir, "archive");
    const workflowDir = path.join(baseDir, "workflows");
    await mkdir(archiveDir, { recursive: true });
    await writeWorkflowFixture(workflowDir);

    const { eventBus, waitForSettled } = buildDriverWiring(archiveDir, workflowDir);

    let settledResult: DriveAcceptedWorkflowRunResult | undefined;
    const settledPromise = waitForSettled().then((r) => {
      settledResult = r;
      return r;
    });

    const app = express();
    app.use(express.json());
    app.use(createReadGuard());
    app.use(createWriteGuard());
    registerWorkflowRunRoutes(app, {
      archiveDir,
      eventBus,
      logger: createMockLogger(),
    } as never);

    const { server, baseUrl } = await startHttpServer(app);
    try {
      const response = await fetch(`${baseUrl}/api/v1/workflow-runs`, {
        method: "POST",
        headers: {
          authorization: "Bearer write-reach-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title: "Reachability test from HTTP",
          intent: "HTTP API reachability integration test.",
          workflowDefinitionId: FIXTURE_WORKFLOW_ID,
        }),
      });

      expect(response.status).toBe(201);
      const body = (await response.json()) as { workflowRun: { id: string; source: string } };
      expect(body.workflowRun.source).toBe("api");

      const result = await settledPromise;
      expect(result.outcome).toBe("blocked");
      expect(settledResult?.workflowRunId).toBe(body.workflowRun.id);

      const archive = createWorkflowRunArchive({ archiveDir });
      const run = await archive.loadWorkflowRun(body.workflowRun.id);
      expect(run.status).toBe("blocked");

      const handoffPayload = await archive.readWorkflowRunArtifact({
        workflowRunId: body.workflowRun.id,
        artifactId: "handoff",
      });
      expect(handoffPayload.data).toMatchObject({ version: 1, outcome: "blocked" });
    } finally {
      await stopServer(server);
      delete process.env.RISOLUTO_WRITE_TOKEN;
    }
  });
});
