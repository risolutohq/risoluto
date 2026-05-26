import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createWorkflowRunArchive } from "../../src/workflow-run/archive.js";

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

    const artifact = await archive.writeWorkflowRunArtifact({
      workflowRunId: workflowRun.id,
      artifactId: "artifact-plan",
      contractId: "implementation_plan.v1",
      data: { summary: "Use archive-owned artifact persistence." },
    });

    expect(artifact).toMatchObject({
      artifactId: "artifact-plan",
      contractId: "implementation_plan.v1",
    });
    await expect(
      archive.readWorkflowRunArtifact({
        workflowRunId: workflowRun.id,
        artifactId: artifact.artifactId,
      }),
    ).resolves.toEqual({
      contractId: "implementation_plan.v1",
      data: { summary: "Use archive-owned artifact persistence." },
    });
  });
});
