import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createWorkflowRunArchive } from "../../src/workflow-run/archive.js";
import { writeWorkflowRunRecord } from "../../src/workflow-run/artifacts.js";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "risoluto-workflow-run-archive-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("WorkflowRunArchive", () => {
  it("stores and projects Workflow Run metadata through the archive interface", async () => {
    const dataDir = await createTempDir();
    const archive = createWorkflowRunArchive({ dataDir });
    const workflowRun = archive.createWorkflowRunRecord({
      title: "Deepen the archive module",
      intent: "Keep Workflow Run persistence behind one public archive interface.",
      source: "cli",
      id: () => "wr_archive_metadata",
      now: () => "2026-05-26T17:10:00.000Z",
    });

    await archive.storeWorkflowRun(workflowRun);

    await expect(archive.loadWorkflowRun(workflowRun.id)).resolves.toEqual(workflowRun);
    await expect(archive.listWorkflowRuns()).resolves.toEqual([workflowRun]);
  });

  it("refuses status writes from a terminal state so done cannot overwrite a cancel (NIN-255)", async () => {
    const dataDir = await createTempDir();
    const archive = createWorkflowRunArchive({ dataDir });
    const workflowRun = archive.createWorkflowRunRecord({
      title: "Terminal status guard",
      intent: "Once cancelled, a run stays cancelled.",
      source: "cli",
      id: () => "wr_terminal_guard",
      now: () => "2026-05-26T17:30:00.000Z",
    });
    await archive.storeWorkflowRun(workflowRun);

    await archive.updateWorkflowRunStatus(workflowRun.id, "running");
    const cancelled = await archive.updateWorkflowRunStatus(workflowRun.id, "cancelled");
    expect(cancelled.status).toBe("cancelled");

    // A done write after cancel is refused — the run stays cancelled on disk too.
    const afterDone = await archive.updateWorkflowRunStatus(workflowRun.id, "done");
    expect(afterDone.status).toBe("cancelled");
    await expect(archive.loadWorkflowRun(workflowRun.id)).resolves.toMatchObject({ status: "cancelled" });
  });

  it("serializes concurrent status updates under a per-run lock so the first terminal wins (NIN-255)", async () => {
    const dataDir = await createTempDir();
    const archive = createWorkflowRunArchive({ dataDir });
    const workflowRun = archive.createWorkflowRunRecord({
      title: "Concurrent status guard",
      intent: "A cancel racing a done must not be clobbered.",
      source: "cli",
      id: () => "wr_concurrent_guard",
      now: () => "2026-05-26T17:35:00.000Z",
    });
    await archive.storeWorkflowRun(workflowRun);
    await archive.updateWorkflowRunStatus(workflowRun.id, "running");

    const [first, second] = await Promise.all([
      archive.updateWorkflowRunStatus(workflowRun.id, "cancelled"),
      archive.updateWorkflowRunStatus(workflowRun.id, "done"),
    ]);

    // The lock serializes the two writes: cancelled lands first, done is then refused.
    expect(first.status).toBe("cancelled");
    expect(second.status).toBe("cancelled");
    await expect(archive.loadWorkflowRun(workflowRun.id)).resolves.toMatchObject({ status: "cancelled" });
  });

  it("appends and reads sequenced Run Log events through the archive interface", async () => {
    const dataDir = await createTempDir();
    const archive = createWorkflowRunArchive({ dataDir });
    const workflowRun = archive.createWorkflowRunRecord({
      title: "Sequence archive events",
      intent: "Keep Run Log sequencing inside the Workflow Run archive.",
      source: "cli",
      id: () => "wr_archive_events",
      now: () => "2026-05-26T17:20:00.000Z",
    });
    await archive.storeWorkflowRun(workflowRun);

    const appended = await archive.appendWorkflowRunEvents(workflowRun.id, [
      {
        at: "2026-05-26T17:21:00.000Z",
        eventType: "operator.note",
        workflowRunId: workflowRun.id,
        source: "cli",
        message: "First archive-owned append.",
      },
      {
        at: "2026-05-26T17:22:00.000Z",
        eventType: "operator.decision",
        workflowRunId: workflowRun.id,
        source: "cli",
        message: "Second archive-owned append.",
      },
    ]);

    expect(appended.map((event) => event.sequence)).toEqual([2, 3]);
    await expect(archive.readWorkflowRunEvents(workflowRun.id)).resolves.toMatchObject([
      { sequence: 1, eventType: "workflow_run.accepted", workflowRunId: workflowRun.id },
      { sequence: 2, eventType: "operator.note", message: "First archive-owned append." },
      { sequence: 3, eventType: "operator.decision", message: "Second archive-owned append." },
    ]);
  });

  it("stores and reads Workflow Run artifacts through the archive interface", async () => {
    const dataDir = await createTempDir();
    const archive = createWorkflowRunArchive({ dataDir });
    const workflowRun = archive.createWorkflowRunRecord({
      title: "Store archive artifact",
      intent: "Keep role artifact persistence behind the Workflow Run archive.",
      source: "cli",
      id: () => "wr_archive_artifact",
      now: () => "2026-05-26T17:30:00.000Z",
    });
    await archive.storeWorkflowRun(workflowRun);
    const plan = {
      version: 1,
      workflowRunId: workflowRun.id,
      createdAt: "2026-05-26T17:31:00.000Z",
      summary: "Use archive-owned artifact persistence.",
      steps: [{ id: "step-1", title: "Patch cache invalidation", status: "ready", dependsOn: [] }],
    };

    const artifact = await archive.writeWorkflowRunArtifact({
      workflowRunId: workflowRun.id,
      artifactId: "artifact-plan",
      contractId: "plan.v1",
      data: plan,
    });

    expect(artifact).toMatchObject({
      artifactId: "artifact-plan",
      contractId: "plan.v1",
    });
    await expect(
      archive.readWorkflowRunArtifact({
        workflowRunId: workflowRun.id,
        artifactId: artifact.artifactId,
      }),
    ).resolves.toEqual({
      contractId: "plan.v1",
      data: plan,
    });
  });

  it("writes and reads a valid intent.v1 artifact without shape loss", async () => {
    const dataDir = await createTempDir();
    const archive = createWorkflowRunArchive({ dataDir });
    const workflowRun = archive.createWorkflowRunRecord({
      title: "Capture operator intent",
      intent: "Normalize the operator request before workflow execution.",
      source: "cli",
      id: () => "wr_archive_intent_contract",
      now: () => "2026-05-26T17:40:00.000Z",
    });
    await archive.storeWorkflowRun(workflowRun);
    const intent = {
      version: 1,
      workflowRunId: workflowRun.id,
      createdAt: "2026-05-26T17:41:00.000Z",
      source: "cli",
      title: "Capture operator intent",
      body: "Normalize the operator request before workflow execution.",
      externalReferences: [],
    };

    const artifact = await archive.writeWorkflowRunArtifact({
      workflowRunId: workflowRun.id,
      artifactId: "artifact-intent",
      contractId: "intent.v1",
      data: intent,
    });

    await expect(
      archive.readWorkflowRunArtifact({
        workflowRunId: workflowRun.id,
        artifactId: artifact.artifactId,
      }),
    ).resolves.toEqual({
      contractId: "intent.v1",
      data: intent,
    });
  });

  it("rejects writeWorkflowRunRecord when artifactDir escapes the archive root", async () => {
    const dataDir = await createTempDir();
    const archive = createWorkflowRunArchive({ dataDir });
    const workflowRun = archive.createWorkflowRunRecord({
      title: "Escape attempt",
      intent: "Ensure path-traversal is rejected.",
      source: "cli",
      id: () => "wr_escape_test",
      now: () => "2026-05-26T18:00:00.000Z",
    });
    // Forge a record with an artifactDir outside the archive root.
    const forgedRun = { ...workflowRun, artifactDir: "/tmp/escape" };
    await expect(writeWorkflowRunRecord(forgedRun, { dataDir })).rejects.toThrow(/artifactDir escapes archive root/);
  });

  it("rejects an unknown artifact contract id before storing the artifact", async () => {
    const dataDir = await createTempDir();
    const archive = createWorkflowRunArchive({ dataDir });
    const workflowRun = archive.createWorkflowRunRecord({
      title: "Reject unknown contract",
      intent: "Unknown contracts must fail before gates consume them.",
      source: "cli",
      id: () => "wr_archive_unknown_contract",
      now: () => "2026-05-26T17:50:00.000Z",
    });
    await archive.storeWorkflowRun(workflowRun);

    await expect(
      archive.writeWorkflowRunArtifact({
        workflowRunId: workflowRun.id,
        artifactId: "artifact-unknown",
        contractId: "unknown.v1",
        data: { version: 1 },
      }),
    ).rejects.toThrow(/unknown artifact contract id unknown\.v1/);
  });
});
