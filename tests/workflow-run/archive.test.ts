import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { useTempDirs } from "../helpers.js";
import { createWorkflowRunArchive } from "../../src/workflow-run/archive.js";
import { writeWorkflowRunRecord } from "../../src/workflow-run/artifacts.js";

const eventsPathFor = (dataDir: string, runId: string): string =>
  path.join(dataDir, "archives", "workflow-runs", runId, "events.jsonl");

const metadataPathFor = (dataDir: string, runId: string): string =>
  path.join(dataDir, "archives", "workflow-runs", runId, "metadata.json");

const createTempDir = useTempDirs("risoluto-workflow-run-archive-");

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

  it("refuses status writes from a terminal state so done cannot overwrite a cancel (RIS-255)", async () => {
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

  it("serializes concurrent status updates under a per-run lock so the first terminal wins (RIS-255)", async () => {
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

  it("assigns event sequences atomically under concurrent appends (RIS-263)", async () => {
    const dataDir = await createTempDir();
    const archive = createWorkflowRunArchive({ dataDir });
    const workflowRun = archive.createWorkflowRunRecord({
      title: "Concurrent event sequencing",
      intent: "Two concurrent appends must not collide on the next sequence.",
      source: "cli",
      id: () => "wr_concurrent_events",
      now: () => "2026-05-26T17:25:00.000Z",
    });
    await archive.storeWorkflowRun(workflowRun);

    const appendCount = 10;
    await Promise.all(
      Array.from({ length: appendCount }, (_unused, index) =>
        archive.appendWorkflowRunEvents(workflowRun.id, [
          {
            at: "2026-05-26T17:26:00.000Z",
            eventType: "operator.note",
            workflowRunId: workflowRun.id,
            source: "cli",
            message: `concurrent append ${index}`,
          },
        ]),
      ),
    );

    const events = await archive.readWorkflowRunEvents(workflowRun.id);
    const sequences = events.map((event) => event.sequence);
    // 1 accepted event + 10 appends, each sequence assigned exactly once and contiguous.
    expect(sequences).toEqual(Array.from({ length: appendCount + 1 }, (_unused, index) => index + 1));
    expect(new Set(sequences).size).toBe(appendCount + 1);
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

  it("tolerates a torn final event line on recovery: still appends and lists (audit T-5)", async () => {
    const dataDir = await createTempDir();
    const archive = createWorkflowRunArchive({ dataDir });
    const run = archive.createWorkflowRunRecord({
      title: "Torn tail recovery",
      intent: "A crash mid-append must not poison the next append.",
      source: "cli",
      id: () => "wr_torn_tail",
      now: () => "2026-05-26T18:00:00.000Z",
    });
    // Model the state a restart finds: the run's files were written by a previous process, and a crash
    // mid-appendFile left a torn final line (partial JSON, no trailing newline). Lay the files down
    // directly rather than via storeWorkflowRun — whose cache seed would turn the next append into a
    // cache hit and skip the recovery path under test (a real restart starts with an empty cache).
    await mkdir(path.dirname(eventsPathFor(dataDir, run.id)), { recursive: true });
    await writeFile(metadataPathFor(dataDir, run.id), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    const acceptedLine = JSON.stringify({
      at: run.createdAt,
      sequence: 1,
      eventType: "workflow_run.accepted",
      workflowRunId: run.id,
      source: run.source,
      workflowDefinitionId: run.workflowDefinitionId,
    });
    await writeFile(
      eventsPathFor(dataDir, run.id),
      `${acceptedLine}\n{"at":"2026-05-26T18:00:30.000Z","eventType":"torn`,
      "utf8",
    );

    const recovered = createWorkflowRunArchive({ dataDir });
    const appended = await recovered.appendWorkflowRunEvents(run.id, [
      {
        at: "2026-05-26T18:01:00.000Z",
        eventType: "operator.note",
        workflowRunId: run.id,
        source: "cli",
        message: "after recovery",
      },
    ]);

    // Sequence computed from the valid accepted event (torn line dropped), not a raw SyntaxError.
    expect(appended.map((event) => event.sequence)).toEqual([2]);
    // The recovery rewrite removed the torn line, so the appended event is durable and readable.
    const events = await recovered.readWorkflowRunEvents(run.id);
    expect(events.map((event) => event.eventType)).toEqual(["workflow_run.accepted", "operator.note"]);
    await expect(recovered.listWorkflowRuns()).resolves.toHaveLength(1);
  });

  it("public readWorkflowRunEvents tolerates a torn final line before any healing append (audit review)", async () => {
    const dataDir = await createTempDir();
    const archive = createWorkflowRunArchive({ dataDir });
    const run = archive.createWorkflowRunRecord({
      title: "Torn tail read",
      intent: "A crash mid-append must not make the run unreadable via the public API.",
      source: "cli",
      id: () => "wr_torn_read",
      now: () => "2026-05-26T18:30:00.000Z",
    });
    await archive.storeWorkflowRun(run);
    // Simulate a crash mid-appendFile: a partial JSON line with no trailing newline. No append has
    // healed the log yet, so the public reader must drop the unacknowledged torn line, not throw.
    await appendFile(eventsPathFor(dataDir, run.id), '{"at":"2026-05-26T18:30:30.000Z","eventType":"torn');

    const events = await createWorkflowRunArchive({ dataDir }).readWorkflowRunEvents(run.id);
    expect(events.map((event) => event.eventType)).toEqual(["workflow_run.accepted"]);
  });

  it("writes run metadata atomically: a status update leaves no temp file behind (audit T-5)", async () => {
    const dataDir = await createTempDir();
    const archive = createWorkflowRunArchive({ dataDir });
    const run = archive.createWorkflowRunRecord({
      title: "Atomic metadata",
      intent: "Metadata writes go through write-temp-then-rename.",
      source: "cli",
      id: () => "wr_atomic_meta",
      now: () => "2026-05-26T18:10:00.000Z",
    });
    await archive.storeWorkflowRun(run);
    await archive.updateWorkflowRunStatus(run.id, "running");

    const runDir = path.join(dataDir, "archives", "workflow-runs", run.id);
    const entries = await readdir(runDir);
    // The temp file was renamed over metadata.json, never left behind.
    expect(entries.filter((entry) => entry.includes(".tmp-"))).toEqual([]);
    expect(entries).toContain("metadata.json");
    await expect(archive.loadWorkflowRun(run.id)).resolves.toMatchObject({ status: "running" });

    // A stray temp file from an interrupted write does not corrupt reads or listings.
    await writeFile(path.join(runDir, "metadata.json.tmp-deadbeef"), "{ partial json", "utf8");
    await expect(archive.loadWorkflowRun(run.id)).resolves.toMatchObject({ status: "running" });
    await expect(archive.listWorkflowRuns()).resolves.toHaveLength(1);
  });

  it("steady-state appends use the cached sequence and do not re-read the log (audit T-5)", async () => {
    const dataDir = await createTempDir();
    const archive = createWorkflowRunArchive({ dataDir });
    const run = archive.createWorkflowRunRecord({
      title: "Sequence cache",
      intent: "Appends after the first must not re-read the whole log.",
      source: "cli",
      id: () => "wr_seq_cache",
      now: () => "2026-05-26T18:20:00.000Z",
    });
    await archive.storeWorkflowRun(run);

    // storeWorkflowRun seeded the cache (next sequence 2), so this append is a cache hit from the start.
    const first = await archive.appendWorkflowRunEvents(run.id, [
      { at: "2026-05-26T18:21:00.000Z", eventType: "operator.note", workflowRunId: run.id, source: "cli" },
    ]);
    expect(first.map((event) => event.sequence)).toEqual([2]);

    // Corrupt a NON-final line on disk. If the next append re-read and re-parsed the log it would throw
    // a parse error on this line; instead it uses the cached sequence and appends without reading.
    const eventsPath = eventsPathFor(dataDir, run.id);
    const lines = (await readFile(eventsPath, "utf8")).trimEnd().split("\n");
    lines[0] = "{ not json";
    await writeFile(eventsPath, `${lines.join("\n")}\n`, "utf8");

    const second = await archive.appendWorkflowRunEvents(run.id, [
      { at: "2026-05-26T18:22:00.000Z", eventType: "operator.note", workflowRunId: run.id, source: "cli" },
    ]);
    expect(second.map((event) => event.sequence)).toEqual([3]);
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
