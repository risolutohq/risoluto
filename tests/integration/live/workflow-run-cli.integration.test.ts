/**
 * Live smoke test for the `risoluto run start` engine drive.
 *
 * `run start` reaches the SAME workflow executor every intake surface drives. With no agent harness
 * wired for the CLI yet, a real drive ends in an honest blocked handoff; once the harness lands it runs
 * plan -> implement -> review -> verify end-to-end and opens a reviewable draft PR.
 *
 * Opt in with `RISOLUTO_LIVE_RUN_START=1`; otherwise the suite skips. Runs only under
 * `pnpm run test:integration:live`.
 */

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { createWorkflowRunArchive } from "../../../src/workflow-run/archive.js";

const LIVE_ENABLED = process.env.RISOLUTO_LIVE_RUN_START === "1";
const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe.skipIf(!LIVE_ENABLED)("run start drives a real Workflow Run end-to-end", () => {
  it("reaches the executor from the real CLI and writes a durable terminal handoff", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "risoluto-live-run-start-"));
    tempDirs.push(dataDir);

    const { main } = await import("../../../src/cli/index.js");
    const stdout: string[] = [];
    const originalLog = console.log;
    console.log = (line: string) => {
      stdout.push(line);
    };
    try {
      await expect(
        main([
          "run",
          "start",
          "--title",
          "Live engine drive",
          "--intent",
          "Drive the workflow engine for real.",
          "--data-dir",
          dataDir,
          "--json",
        ]),
      ).resolves.toBe(0);
    } finally {
      console.log = originalLog;
    }

    const driven = JSON.parse(stdout[0] ?? "{}") as { type: string; outcome: string; workflowRun: { id: string } };
    expect(driven.type).toBe("workflow_run.driven");
    expect(["blocked", "done"]).toContain(driven.outcome);

    const archive = createWorkflowRunArchive({ dataDir });
    await expect(archive.loadWorkflowRun(driven.workflowRun.id)).resolves.toMatchObject({
      status: driven.outcome,
    });
    const handoff = await archive.readWorkflowRunArtifact({
      workflowRunId: driven.workflowRun.id,
      artifactId: "handoff",
    });
    expect(handoff).toMatchObject({ contractId: "handoff.v1" });
  });

  // Pending the agent-harness binding for `runRole` (RunAttemptDispatcher + src/agent-runner/): once
  // the CLI constructs the harness, a live run should plan -> implement -> review -> verify and open a
  // reviewable draft PR. Tracked as the SEAM-1 follow-up `discovered` issue.
  it.todo("opens a reviewable draft PR after a full plan -> verify run");
});
