import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createWorkflowRunArchive } from "../../src/workflow-run/archive.js";
import { openWorkflowRun, type WorkflowRun } from "../../src/workflow-run/run-handle.js";

const tempDirs: string[] = [];

async function openSeededRun(): Promise<{ dataDir: string; runId: string; run: WorkflowRun }> {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "risoluto-run-handle-"));
  tempDirs.push(dataDir);
  const archive = createWorkflowRunArchive({ dataDir });
  const record = archive.createWorkflowRunRecord({
    title: "Handle under test",
    intent: "Exercise the Workflow Run handle.",
    source: "cli",
  });
  await archive.storeWorkflowRun(record);
  const run = await openWorkflowRun({ dataDir }, { workflowRunId: record.id, source: "cli" });
  return { dataDir, runId: record.id, run };
}

async function readEvents(dataDir: string, runId: string) {
  return createWorkflowRunArchive({ dataDir }).readWorkflowRunEvents(runId);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("openWorkflowRun", () => {
  it("appends an operator event stamped from the held run identity", async () => {
    const { dataDir, runId, run } = await openSeededRun();

    const event = await run.appendEvent({ eventType: "operator.note", message: "Escalated." });

    expect(run.id).toBe(runId);
    expect(run.workflowDefinitionId).toBe("single-operator-afk-coder");
    expect(event).toMatchObject({
      eventType: "operator.note",
      workflowRunId: runId,
      source: "cli",
      workflowDefinitionId: "single-operator-afk-coder",
      message: "Escalated.",
      sequence: 2,
    });
    const events = await readEvents(dataDir, runId);
    expect(events.map((entry) => entry.eventType)).toEqual(["workflow_run.accepted", "operator.note"]);
  });

  it("omits message when none is supplied", async () => {
    const { run } = await openSeededRun();
    const event = await run.appendEvent({ eventType: "operator.note" });
    expect(event).not.toHaveProperty("message");
  });

  it("records a worker process outcome with the matching event type", async () => {
    const { dataDir, runId, run } = await openSeededRun();

    const recorded = await run.recordWorkerProcess({
      workerId: "worker-implementer-1",
      role: "implementer",
      harness: "codex",
      status: "succeeded",
      exitCode: 0,
    });

    expect(recorded).toMatchObject({
      type: "workflow_run.worker_process_recorded",
      workerProcess: {
        workflowRunId: runId,
        workerId: "worker-implementer-1",
        role: "implementer",
        status: "succeeded",
      },
      event: { eventType: "worker_process.completed" },
    });
    const events = await readEvents(dataDir, runId);
    expect(events[1]).toMatchObject({ workerProcess: { workerId: "worker-implementer-1", exitCode: 0 } });
  });

  it("records workspace preparation and repo checkout as two events", async () => {
    const { dataDir, runId, run } = await openSeededRun();

    const recorded = await run.recordWorkspaceLifecycle({
      workspacePath: "/tmp/ws/repair",
      workspaceKey: "repair",
      repoUrl: "https://github.com/risolutohq/example.git",
      branch: "risoluto/repair",
    });

    expect(recorded.events.map((event) => event.eventType)).toEqual(["workspace.prepared", "repo.checked_out"]);
    expect(recorded.lifecycle).toMatchObject({
      workflowRunId: runId,
      workspace: { path: "/tmp/ws/repair", key: "repair", status: "prepared" },
      repo: { url: "https://github.com/risolutohq/example.git", branch: "risoluto/repair", status: "checked_out" },
    });
    const events = await readEvents(dataDir, runId);
    expect(events.map((event) => event.eventType)).toEqual([
      "workflow_run.accepted",
      "workspace.prepared",
      "repo.checked_out",
    ]);
  });

  it("records a workspace cleanup outcome", async () => {
    const { runId, run } = await openSeededRun();

    const recorded = await run.recordWorkspaceCleanup({
      workspacePath: "/tmp/ws/publish",
      workspaceKey: "publish",
      result: "removed",
      reason: "workflow_succeeded",
    });

    expect(recorded).toMatchObject({
      type: "workflow_run.workspace_cleanup_recorded",
      cleanup: { workflowRunId: runId, workspace: { key: "publish" }, result: "removed", reason: "workflow_succeeded" },
      event: { eventType: "workspace.cleanup_completed" },
    });
  });

  it("writes an artifact and records a completed role execution", async () => {
    const { dataDir, runId, run } = await openSeededRun();
    const plan = {
      version: 1,
      workflowRunId: runId,
      createdAt: "2026-05-26T18:00:00.000Z",
      summary: "Focused cache patch.",
      steps: [{ id: "step-1", title: "Patch cache invalidation", status: "ready", dependsOn: [] }],
    };

    const completed = await run.recordRoleExecution({
      role: "planner",
      artifactContractId: "plan.v1",
      artifactData: plan,
    });

    expect(completed).toMatchObject({
      type: "workflow_run.role_execution_completed",
      roleExecution: {
        workflowRunId: runId,
        role: "planner",
        status: "completed",
        artifact: { contractId: "plan.v1" },
      },
    });
    await expect(
      createWorkflowRunArchive({ dataDir }).readWorkflowRunArtifact({
        workflowRunId: runId,
        artifactId: completed.roleExecution.artifact.artifactId,
      }),
    ).resolves.toEqual({
      contractId: "plan.v1",
      data: plan,
    });
    const events = await readEvents(dataDir, runId);
    expect(events[1]).toMatchObject({ eventType: "role_execution.completed", role: "planner" });
  });

  it("rejects malformed role output with the producing role in the error", async () => {
    const { run } = await openSeededRun();

    await expect(
      run.recordRoleExecution({
        role: "planner",
        artifactContractId: "plan.v1",
        artifactData: { version: 1 },
      }),
    ).rejects.toThrow(/planner produced invalid artifact plan\.v1/);
  });

  it("records gate, transition, and hook as three ordered events", async () => {
    const { dataDir, runId, run } = await openSeededRun();

    const recorded = await run.recordTransition({
      fromState: "review",
      toState: "validate",
      gate: { name: "tests-pass", status: "passed" },
      hook: { name: "notify-operator", timing: "state_exit" },
    });

    expect(recorded.transition).toMatchObject({ workflowRunId: runId, fromState: "review", toState: "validate" });
    expect(recorded.events.map((event) => event.eventType)).toEqual([
      "validation_gate.evaluated",
      "workflow_transition.applied",
      "workflow_hook.fired",
    ]);
    const events = await readEvents(dataDir, runId);
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
  });

  it("records the run attempt lifecycle: start then terminal outcomes", async () => {
    const { runId, run } = await openSeededRun();

    const started = await run.startRunAttempt({ attemptId: "attempt-1", attemptNumber: 1, reason: "initial" });
    expect(started).toMatchObject({
      type: "workflow_run.run_attempt_started",
      runAttempt: { id: "attempt-1", workflowRunId: runId, attemptNumber: 1, status: "running", reason: "initial" },
      event: { eventType: "run_attempt.started" },
    });

    const completed = await run.completeRunAttempt({ attemptId: "attempt-1", message: "Done." });
    expect(completed).toMatchObject({
      type: "workflow_run.run_attempt_completed",
      runAttempt: { id: "attempt-1", status: "completed" },
      event: { eventType: "run_attempt.completed", message: "Done." },
    });
    expect(completed.runAttempt.completedAt).toBe(completed.event.at);

    const failed = await run.failRunAttempt({ attemptId: "attempt-2" });
    expect(failed.event).toMatchObject({ eventType: "run_attempt.failed" });
    expect(failed.event).not.toHaveProperty("message");

    const cancelled = await run.cancelRunAttempt({ attemptId: "attempt-3", message: "Operator cancelled." });
    expect(cancelled).toMatchObject({
      type: "workflow_run.run_attempt_cancelled",
      runAttempt: { id: "attempt-3", status: "cancelled" },
      event: { eventType: "run_attempt.cancelled", message: "Operator cancelled." },
    });
  });
});
