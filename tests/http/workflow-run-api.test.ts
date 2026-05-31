import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createReadGuard } from "../../src/http/read-guard.js";
import { registerWorkflowRunRoutes } from "../../src/http/routes/workflow-runs.js";
import { createWriteGuard } from "../../src/http/write-guard.js";
import { createWorkflowRunArchive } from "../../src/workflow-run/archive.js";
import { createMockLogger } from "../helpers.js";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "risoluto-http-workflow-run-api-"));
  tempDirs.push(dir);
  return dir;
}

async function startApp(app: express.Express): Promise<{ readonly server: http.Server; readonly baseUrl: string }> {
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
  vi.unstubAllEnvs();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Workflow Run HTTP API", () => {
  it("rejects normal run creation without a valid bearer token", async () => {
    vi.stubEnv("RISOLUTO_WRITE_TOKEN", "write-secret");
    const archiveDir = await createTempDir();
    const { server, baseUrl } = await startWorkflowRunApi(archiveDir);
    try {
      const response = await fetch(`${baseUrl}/api/v1/workflow-runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Reject unauthenticated API run", intent: "Do not create a run." }),
      });

      expect(response.status).toBe(401);
      await expect(createWorkflowRunArchive({ archiveDir }).listWorkflowRuns()).resolves.toEqual([]);
    } finally {
      await stopServer(server);
    }
  });

  it("creates a Workflow Run through HTTP using the same archive and run log pipeline as CLI", async () => {
    vi.stubEnv("RISOLUTO_WRITE_TOKEN", "write-secret");
    const archiveDir = await createTempDir();
    const { server, baseUrl } = await startWorkflowRunApi(archiveDir);
    try {
      const response = await fetch(`${baseUrl}/api/v1/workflow-runs`, {
        method: "POST",
        headers: { authorization: "Bearer write-secret", "content-type": "application/json" },
        body: JSON.stringify({
          title: "Start through HTTP",
          intent: "Create the run through the support API.",
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body).toMatchObject({
        type: "workflow_run.started",
        workflowRun: {
          source: "api",
          status: "accepted",
          title: "Start through HTTP",
          intent: "Create the run through the support API.",
          workflowDefinitionId: "single-operator-afk-coder",
        },
      });

      const workflowRunId = body.workflowRun.id as string;
      await expect(createWorkflowRunArchive({ archiveDir }).readWorkflowRunEvents(workflowRunId)).resolves.toEqual([
        expect.objectContaining({
          eventType: "workflow_run.accepted",
          workflowRunId,
          source: "api",
        }),
      ]);
    } finally {
      await stopServer(server);
    }
  });
});

async function startWorkflowRunApi(
  archiveDir: string,
): Promise<{ readonly server: http.Server; readonly baseUrl: string }> {
  const app = express();
  app.use(express.json());
  app.use(createReadGuard());
  app.use(createWriteGuard());
  registerWorkflowRunRoutes(app, {
    archiveDir,
    logger: createMockLogger(),
  } as never);
  return startApp(app);
}
