import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createObservabilityHub } from "../../src/observability/hub.js";
import {
  buildProcessSnapshotPath,
  readComponentSnapshots,
  writeComponentSnapshot,
} from "../../src/observability/snapshot.js";

describe("ObservabilityHub", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function createTempDir(): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "risoluto-observability-"));
    tempDirs.push(dir);
    return dir;
  }

  function findDeadPid(start = 999_999): number {
    let candidate = start;
    while (candidate < start + 10_000) {
      try {
        process.kill(candidate, 0);
        candidate += 1;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") {
          return candidate;
        }
        candidate += 1;
      }
    }
    throw new Error("Could not find a dead pid for snapshot pruning test");
  }

  it("writes component snapshots to disk and aggregates them", async () => {
    const archiveDir = await createTempDir();
    const hub = createObservabilityHub({ archiveDir });
    const observer = hub.getComponent("http");

    observer.recordOperation({
      metric: "api_request",
      operation: "http_request",
      outcome: "success",
      correlationId: "req-1",
      durationMs: 12,
      data: { path: "/api/v1/state" },
    });
    observer.setHealth({
      surface: "http",
      status: "ok",
      reason: "request handling healthy",
    });
    observer.setSession("req-1", {
      status: "completed",
      correlationId: "req-1",
      metadata: { path: "/api/v1/state" },
    });
    await observer.drain();

    const persisted = await readComponentSnapshots(path.join(archiveDir, "observability"));
    expect(persisted).toHaveLength(1);
    expect(persisted[0].component).toBe("http");
    expect(persisted[0].metrics.api_request.total).toBe(1);

    const summary = await hub.aggregate({
      runtimeState: {
        generated_at: "2026-04-06T00:00:00Z",
        counts: { running: 0, retrying: 0 },
        running: [],
        retrying: [],
        queued: [],
        completed: [],
        workflow_columns: [],
        codex_totals: {
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
          seconds_running: 0,
          cost_usd: 0,
        },
        rate_limits: null,
        recent_events: [],
      },
      rawMetrics: "# HELP risoluto_http_requests_total Total HTTP requests\nrisoluto_http_requests_total 1\n",
      attemptStoreConfigured: true,
    });

    expect(summary.components).toHaveLength(1);
    expect(summary.health.status).toBe("ok");
    expect(summary.sessionState).toHaveLength(1);
    expect(summary.rawMetrics).toContain("risoluto_http_requests_total 1");
  });

  it("redacts secret-bearing values from snapshot session metadata and trace data (NIN-264)", async () => {
    const archiveDir = await createTempDir();
    const hub = createObservabilityHub({ archiveDir });
    const observer = hub.getComponent("http");

    observer.recordOperation({
      metric: "api_request",
      outcome: "success",
      data: { token: "sk-tracetoken456", path: "/api/v1/state" },
    });
    observer.setSession("req-secret", {
      status: "completed",
      metadata: { apiKey: "sk-supersecret123", path: "/api/v1/state" },
    });

    await hub.drain();

    const serialized = JSON.stringify(observer.snapshot());
    expect(serialized).not.toContain("sk-supersecret123");
    expect(serialized).not.toContain("sk-tracetoken456");
    // Non-secret fields survive the redaction pass.
    expect(serialized).toContain("/api/v1/state");
  });

  it("deduplicates snapshots by component name keeping the most recent updatedAt", async () => {
    const archiveDir = await createTempDir();
    const hub = createObservabilityHub({ archiveDir });
    const root = hub.snapshotRoot;

    // Write a stale disk snapshot for "api" component tagged with the current PID
    // (so isProcessAlive passes) but with an old updatedAt
    const staleSnapshot = {
      component: "api",
      pid: process.pid,
      updatedAt: "2026-01-01T00:00:00Z",
      metrics: {},
      health: {},
      traces: [],
      sessions: {},
    };
    await writeComponentSnapshot(root, staleSnapshot);

    // Register an in-memory observer for the same component — it will have a later timestamp
    const observer = hub.getComponent("api");
    observer.setHealth({ surface: "api", status: "ok" });
    await observer.drain();

    const summary = await hub.aggregate({
      runtimeState: {},
      rawMetrics: "",
      attemptStoreConfigured: false,
    });

    // Only one component "api" should appear despite disk + memory both having it
    const apiComponents = summary.components.filter((c) => c.component === "api");
    expect(apiComponents).toHaveLength(1);
    // The in-memory snapshot should win (it was set just now, so later than 2026-01-01)
    expect(Date.parse(apiComponents[0]!.updatedAt)).toBeGreaterThan(Date.parse("2026-01-01T00:00:00Z"));
  });

  it("ignores snapshots from dead processes and prunes them from disk", async () => {
    const archiveDir = await createTempDir();
    const root = path.join(archiveDir, "observability");
    const deadPid = findDeadPid();
    const snapshotPath = buildProcessSnapshotPath(root, "http", deadPid);

    await writeComponentSnapshot(
      root,
      {
        component: "http",
        pid: deadPid,
        updatedAt: "2026-04-06T00:00:00Z",
        metrics: {},
        health: {
          http: {
            surface: "http",
            component: "http",
            status: "warn",
            updatedAt: "2026-04-06T00:00:00Z",
            reason: "http server stopped",
          },
        },
        traces: [],
        sessions: {},
      },
      deadPid,
    );

    const persisted = await readComponentSnapshots(root);

    expect(persisted).toEqual([]);
    await expect(access(snapshotPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
