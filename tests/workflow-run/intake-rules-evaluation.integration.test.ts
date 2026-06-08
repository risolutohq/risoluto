import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import YAML from "yaml";

import { createReadGuard } from "../../src/http/read-guard.js";
import { registerWorkflowRunRoutes } from "../../src/http/routes/workflow-runs.js";
import { createWriteGuard } from "../../src/http/write-guard.js";
import { startWorkflowRunCommand } from "../../src/cli/workflow-run-start-command.js";
import { createWorkflowRunArchive } from "../../src/workflow-run/archive.js";
import type { WorkflowRunIntakeRule } from "../../src/workflow-run/intake-rules.js";
import { createMockLogger } from "../helpers.js";

// ---------------------------------------------------------------------------
// Shared test infrastructure
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "risoluto-intake-rules-eval-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * Write intake rules into the overlay YAML at the path the CLI loader reads.
 * The CLI uses dataDir, the daemon writes to {dataDir}/archives/config/overlay.yaml.
 */
async function writeCliOverlayRules(dataDir: string, rules: WorkflowRunIntakeRule[]): Promise<void> {
  const configDir = path.join(dataDir, "archives", "config");
  await mkdir(configDir, { recursive: true });
  await writeFile(path.join(configDir, "overlay.yaml"), YAML.stringify({ intake_rules: { rules } }), "utf8");
}

async function startWorkflowRunApi(
  archiveDir: string,
  intakeRules?: readonly WorkflowRunIntakeRule[],
): Promise<{ readonly server: http.Server; readonly baseUrl: string }> {
  const app = express();
  app.use(express.json());
  app.use(createReadGuard());
  app.use(createWriteGuard());
  registerWorkflowRunRoutes(app, {
    archiveDir,
    logger: createMockLogger(),
    ...(intakeRules !== undefined ? { intakeRules } : {}),
  } as never);
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

function authHeaders(): Record<string, string> {
  return { authorization: "Bearer write-secret", "content-type": "application/json" };
}

// ---------------------------------------------------------------------------
// AC1 — Ambiguous intake: multiple matching rules → rejected with disambiguation error
// ---------------------------------------------------------------------------

describe("intake rule evaluation — AC1: ambiguous intake", () => {
  it("HTTP: rejects intake when two rules both match and returns a 400 disambiguation error", async () => {
    vi.stubEnv("RISOLUTO_WRITE_TOKEN", "write-secret");
    const archiveDir = await createTempDir();
    const rules: WorkflowRunIntakeRule[] = [
      { id: "rule-a", provider: "api", workflowDefinitionId: "single-operator-afk-coder", workspaceKey: "ws-a" },
      { id: "rule-b", provider: "api", workflowDefinitionId: "single-operator-afk-coder", workspaceKey: "ws-b" },
    ];
    const { server, baseUrl } = await startWorkflowRunApi(archiveDir, rules);
    try {
      const response = await fetch(`${baseUrl}/api/v1/workflow-runs`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ title: "Ambiguous intake", intent: "Two rules match." }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("ambiguous_intake");
      expect(body.error.message).toMatch(/rule-a.*rule-b|rule-b.*rule-a/);
    } finally {
      await stopServer(server);
    }
    await expect(createWorkflowRunArchive({ archiveDir }).listWorkflowRuns()).resolves.toEqual([]);
  });

  it("CLI: rejects intake when two matching cli rules are loaded from config", async () => {
    const dataDir = await createTempDir();
    const rules: WorkflowRunIntakeRule[] = [
      { id: "cli-rule-a", provider: "cli", workflowDefinitionId: "single-operator-afk-coder", workspaceKey: "ws-a" },
      { id: "cli-rule-b", provider: "cli", workflowDefinitionId: "single-operator-afk-coder", workspaceKey: "ws-b" },
    ];
    await writeCliOverlayRules(dataDir, rules);

    await expect(
      startWorkflowRunCommand([
        "--title",
        "Ambiguous CLI intake",
        "--intent",
        "Two cli rules match.",
        "--data-dir",
        dataDir,
      ]),
    ).rejects.toThrow(/ambiguous intake rules matched: cli-rule-a.*cli-rule-b|cli-rule-b.*cli-rule-a/i);

    await expect(createWorkflowRunArchive({ dataDir }).listWorkflowRuns()).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC2 — Invalid intake: no matching rule → rejected before any run record is created
// ---------------------------------------------------------------------------

describe("intake rule evaluation — AC2: invalid intake rejected pre-creation", () => {
  it("HTTP: returns 400 when no rule matches and creates no Workflow Run record", async () => {
    vi.stubEnv("RISOLUTO_WRITE_TOKEN", "write-secret");
    const archiveDir = await createTempDir();
    const rules: WorkflowRunIntakeRule[] = [
      {
        id: "slack-only",
        provider: "slack",
        workflowDefinitionId: "single-operator-afk-coder",
        workspaceKey: "default",
      },
    ];
    const { server, baseUrl } = await startWorkflowRunApi(archiveDir, rules);
    try {
      const response = await fetch(`${baseUrl}/api/v1/workflow-runs`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ title: "Rejected intake", intent: "No api rule configured." }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("invalid_intake");
      expect(body.error.message).toMatch(/no intake rule matched/i);
    } finally {
      await stopServer(server);
    }
    await expect(createWorkflowRunArchive({ archiveDir }).listWorkflowRuns()).resolves.toEqual([]);
  });

  it("CLI: rejects intake when no cli rule matches and creates no Workflow Run record", async () => {
    const dataDir = await createTempDir();
    const rules: WorkflowRunIntakeRule[] = [
      {
        id: "api-only",
        provider: "api",
        workflowDefinitionId: "single-operator-afk-coder",
        workspaceKey: "default",
      },
    ];
    await writeCliOverlayRules(dataDir, rules);

    await expect(
      startWorkflowRunCommand([
        "--title",
        "Rejected CLI intake",
        "--intent",
        "No cli rule configured.",
        "--data-dir",
        dataDir,
      ]),
    ).rejects.toThrow(/no intake rule matched/i);

    await expect(createWorkflowRunArchive({ dataDir }).listWorkflowRuns()).resolves.toEqual([]);
  });

  it("HTTP: with required labels missing, rejects before any run record is created", async () => {
    vi.stubEnv("RISOLUTO_WRITE_TOKEN", "write-secret");
    const archiveDir = await createTempDir();
    const rules: WorkflowRunIntakeRule[] = [
      {
        id: "urgent-only",
        provider: "api",
        requiredLabels: ["urgent"],
        workflowDefinitionId: "single-operator-afk-coder",
        workspaceKey: "default",
      },
    ];
    const { server, baseUrl } = await startWorkflowRunApi(archiveDir, rules);
    try {
      // POST without labels — rule requires "urgent"
      const response = await fetch(`${baseUrl}/api/v1/workflow-runs`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ title: "Missing label intake", intent: "No urgent label." }),
      });

      expect(response.status).toBe(400);
    } finally {
      await stopServer(server);
    }
    await expect(createWorkflowRunArchive({ archiveDir }).listWorkflowRuns()).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC3 — Retry signal: resumes existing Workflow Run as new attempt
// ---------------------------------------------------------------------------

describe("intake rule evaluation — AC3: retry signal resumes existing run", () => {
  it("HTTP: second POST with mode=retry and same externalId starts a new attempt on the existing run", async () => {
    vi.stubEnv("RISOLUTO_WRITE_TOKEN", "write-secret");
    const archiveDir = await createTempDir();
    const rules: WorkflowRunIntakeRule[] = [
      { id: "api-rule", provider: "api", workflowDefinitionId: "single-operator-afk-coder", workspaceKey: "default" },
    ];
    const { server, baseUrl } = await startWorkflowRunApi(archiveDir, rules);
    try {
      // First intake: creates the Workflow Run with an external mapping
      const first = await fetch(`${baseUrl}/api/v1/workflow-runs`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          title: "First intake",
          intent: "Initial operator request.",
          externalId: "ext-42",
          externalProvider: "api",
        }),
      });
      expect(first.status).toBe(201);
      const firstBody = (await first.json()) as { workflowRun: { id: string } };
      const runId = firstBody.workflowRun.id;
      expect(runId).toMatch(/^wr_/);

      // Second intake: retry signal — must resume the existing run, not create a duplicate
      const retry = await fetch(`${baseUrl}/api/v1/workflow-runs`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          title: "Retry intake",
          intent: "Operator signals retry.",
          externalId: "ext-42",
          externalProvider: "api",
          mode: "retry",
        }),
      });
      expect(retry.status).toBe(200);
      const retryBody = (await retry.json()) as {
        action: string;
        workflowRun: { id: string };
        runAttempt?: { id: string; workflowRunId: string; reason: string };
      };
      expect(retryBody.action).toBe("retried");
      expect(retryBody.workflowRun.id).toBe(runId);
      expect(retryBody.runAttempt).toBeDefined();
      expect(retryBody.runAttempt?.workflowRunId).toBe(runId);
      expect(retryBody.runAttempt?.reason).toBe("retry");
    } finally {
      await stopServer(server);
    }

    // Only one Workflow Run record must exist — no duplicate
    await expect(createWorkflowRunArchive({ archiveDir }).listWorkflowRuns()).resolves.toHaveLength(1);
  });
});
