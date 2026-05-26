import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { registerWorkflowRunRoutes } from "../../src/http/routes/workflow-runs.js";
import {
  appendWorkflowRunEvent,
  createWorkflowRunRecord,
  writeWorkflowRunRecord,
} from "../../src/workflow-run/artifacts.js";
import {
  completeWorkflowRunAttempt,
  failWorkflowRunAttempt,
  startWorkflowRunAttempt,
} from "../../src/workflow-run/run-attempts.js";
import { createMockLogger } from "../helpers.js";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "risoluto-http-workflow-run-"));
  tempDirs.push(dir);
  return dir;
}

async function startApp(app: express.Express): Promise<{ server: http.Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const address = server.address() as { port: number };
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

async function stopServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Workflow Run HTTP routes", () => {
  it("lists Workflow Runs through an internal support endpoint without issue vocabulary", async () => {
    const archiveDir = await createTempDir();
    const firstRun = createWorkflowRunRecord({
      archiveDir,
      title: "Prepare support list projection",
      intent: "Expose Workflow Run summaries through the internal HTTP support surface.",
      source: "cli",
      id: () => "wr_http_list_first",
      now: () => "2026-05-25T12:00:00.000Z",
    });
    const secondRun = createWorkflowRunRecord({
      archiveDir,
      title: "Verify support list projection",
      intent: "Confirm HTTP remains a projection over Workflow Run artifacts.",
      source: "linear",
      id: () => "wr_http_list_second",
      now: () => "2026-05-25T12:01:00.000Z",
    });
    await writeWorkflowRunRecord(firstRun);
    await writeWorkflowRunRecord(secondRun);

    const app = express();
    registerWorkflowRunRoutes(app, {
      archiveDir,
      logger: createMockLogger(),
    } as never);
    const { server, baseUrl } = await startApp(app);
    try {
      const response = await fetch(`${baseUrl}/api/v1/workflow-runs`);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({
        type: "workflow_runs.listed",
        workflowRuns: [
          expect.objectContaining({
            id: secondRun.id,
            source: "linear",
            title: "Verify support list projection",
          }),
          expect.objectContaining({
            id: firstRun.id,
            source: "cli",
            title: "Prepare support list projection",
          }),
        ],
      });
      expect(JSON.stringify(body)).not.toMatch(/\bissue\b/i);
    } finally {
      await stopServer(server);
    }
  });

  it("exposes Workflow Run events through an internal support endpoint", async () => {
    const archiveDir = await createTempDir();
    const workflowRun = createWorkflowRunRecord({
      archiveDir,
      title: "Inspect internal event projection",
      intent: "Expose Workflow Run events without making HTTP the primary surface.",
      source: "cli",
      id: () => "wr_http_contract",
      now: () => "2026-05-25T11:55:00.000Z",
    });
    await writeWorkflowRunRecord(workflowRun);
    await appendWorkflowRunEvent({
      archiveDir,
      workflowRunId: workflowRun.id,
      eventType: "operator.note",
      source: "cli",
      message: "HTTP should be support/internal only.",
      now: () => "2026-05-25T11:56:00.000Z",
    });

    const app = express();
    registerWorkflowRunRoutes(app, {
      archiveDir,
      logger: createMockLogger(),
    } as never);
    const { server, baseUrl } = await startApp(app);
    try {
      const response = await fetch(`${baseUrl}/api/v1/workflow-runs/${workflowRun.id}/events`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        type: "workflow_run.events_listed",
        workflowRun: {
          id: workflowRun.id,
          source: "cli",
          title: "Inspect internal event projection",
        },
        events: [
          { eventType: "workflow_run.accepted", workflowRunId: workflowRun.id },
          {
            eventType: "operator.note",
            workflowRunId: workflowRun.id,
            message: "HTTP should be support/internal only.",
          },
        ],
      });
    } finally {
      await stopServer(server);
    }
  });

  it("exposes Workflow Run metadata through an internal support endpoint without issue vocabulary", async () => {
    const archiveDir = await createTempDir();
    const workflowRun = createWorkflowRunRecord({
      archiveDir,
      title: "Inspect internal run projection",
      intent: "Expose a single Workflow Run without making HTTP primary.",
      source: "cli",
      id: () => "wr_http_detail",
      now: () => "2026-05-25T12:15:00.000Z",
    });
    await writeWorkflowRunRecord(workflowRun);

    const app = express();
    registerWorkflowRunRoutes(app, {
      archiveDir,
      logger: createMockLogger(),
    } as never);
    const { server, baseUrl } = await startApp(app);
    try {
      const response = await fetch(`${baseUrl}/api/v1/workflow-runs/${workflowRun.id}`);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({
        type: "workflow_run.loaded",
        workflowRun: {
          id: workflowRun.id,
          source: "cli",
          status: "accepted",
          title: "Inspect internal run projection",
        },
      });
      expect(JSON.stringify(body)).not.toMatch(/\bissue\b/i);
    } finally {
      await stopServer(server);
    }
  });

  it("exposes Run Attempt history through an internal support endpoint without issue vocabulary", async () => {
    const archiveDir = await createTempDir();
    const workflowRun = createWorkflowRunRecord({
      archiveDir,
      title: "Inspect attempt support projection",
      intent: "Expose Run Attempt history without making HTTP primary.",
      source: "cli",
      id: () => "wr_http_run_attempts",
      now: () => "2026-05-25T12:30:00.000Z",
    });
    await writeWorkflowRunRecord(workflowRun);
    await startWorkflowRunAttempt({
      archiveDir,
      workflowRunId: workflowRun.id,
      source: "cli",
      attemptId: "attempt-1",
      attemptNumber: 1,
      reason: "initial",
      now: () => "2026-05-25T12:31:00.000Z",
    });
    await failWorkflowRunAttempt({
      archiveDir,
      workflowRunId: workflowRun.id,
      source: "cli",
      attemptId: "attempt-1",
      message: "First attempt failed validation.",
      now: () => "2026-05-25T12:32:00.000Z",
    });
    await startWorkflowRunAttempt({
      archiveDir,
      workflowRunId: workflowRun.id,
      source: "cli",
      attemptId: "attempt-2",
      attemptNumber: 2,
      reason: "retry",
      now: () => "2026-05-25T12:33:00.000Z",
    });
    await completeWorkflowRunAttempt({
      archiveDir,
      workflowRunId: workflowRun.id,
      source: "cli",
      attemptId: "attempt-2",
      message: "Retry passed validation.",
      now: () => "2026-05-25T12:34:00.000Z",
    });

    const app = express();
    registerWorkflowRunRoutes(app, {
      archiveDir,
      logger: createMockLogger(),
    } as never);
    const { server, baseUrl } = await startApp(app);
    try {
      const response = await fetch(`${baseUrl}/api/v1/workflow-runs/${workflowRun.id}/run-attempts`);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({
        type: "workflow_run.run_attempts_listed",
        workflowRun: {
          id: workflowRun.id,
          source: "cli",
          title: "Inspect attempt support projection",
        },
        runAttempts: [
          {
            id: "attempt-1",
            workflowRunId: workflowRun.id,
            attemptNumber: 1,
            reason: "initial",
            status: "failed",
            message: "First attempt failed validation.",
          },
          {
            id: "attempt-2",
            workflowRunId: workflowRun.id,
            attemptNumber: 2,
            reason: "retry",
            status: "completed",
            message: "Retry passed validation.",
          },
        ],
      });
      expect(JSON.stringify(body)).not.toMatch(/\bissue\b/i);
    } finally {
      await stopServer(server);
    }
  });

  it("returns JSON not_found when the Workflow Run archive is missing", async () => {
    const archiveDir = await createTempDir();
    const app = express();
    registerWorkflowRunRoutes(app, {
      archiveDir,
      logger: createMockLogger(),
    } as never);
    const { server, baseUrl } = await startApp(app);
    try {
      const response = await fetch(`${baseUrl}/api/v1/workflow-runs/wr_missing/events`);

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "not_found",
          message: "Workflow Run not found",
        },
      });
    } finally {
      await stopServer(server);
    }
  });
});
