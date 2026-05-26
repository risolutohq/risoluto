import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createWorkflowRunArchive } from "../../src/workflow-run/archive.js";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "risoluto-cli-workflow-run-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("workflow-run start CLI", () => {
  it("prints human-readable Workflow Run output without issue vocabulary", async () => {
    const dataDir = await createTempDir();
    const stdout: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => {
      stdout.push(line);
    });

    const { main } = await import("../../src/cli/index.js");

    await expect(
      main([
        "workflow-run",
        "start",
        "--title",
        "Triage release blocker",
        "--intent",
        "Classify and route the release blocker.",
        "--data-dir",
        dataDir,
      ]),
    ).resolves.toBe(0);
    await expect(main(["workflow-run", "list", "--data-dir", dataDir])).resolves.toBe(0);

    expect(stdout[0]).toMatch(/^Started Workflow Run wr_[^:]+: Triage release blocker$/);
    expect(stdout[1]).toBe("Listed 1 Workflow Runs");
    expect(stdout.join("\n")).not.toMatch(/\bissue\b/i);
  });

  it("starts a durable Workflow Run from operator intent", async () => {
    const dataDir = await createTempDir();
    const stdout: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => {
      stdout.push(line);
    });

    const { main } = await import("../../src/cli/index.js");

    await expect(
      main([
        "workflow-run",
        "start",
        "--title",
        "Investigate flaky deploy",
        "--intent",
        "Find and fix the failing deployment path.",
        "--data-dir",
        dataDir,
        "--json",
      ]),
    ).resolves.toBe(0);

    expect(stdout).toHaveLength(1);
    const output = JSON.parse(stdout[0]) as {
      type: string;
      workflowRun: {
        id: string;
        source: string;
        status: string;
        title: string;
        intent: string;
        workflowDefinitionId: string;
        artifactDir: string;
      };
    };

    expect(output).toMatchObject({
      type: "workflow_run.started",
      workflowRun: {
        source: "cli",
        status: "accepted",
        title: "Investigate flaky deploy",
        intent: "Find and fix the failing deployment path.",
        workflowDefinitionId: "single-operator-afk-coder",
      },
    });
    expect(output.workflowRun.id).toMatch(/^wr_/);

    const archive = createWorkflowRunArchive({ dataDir });
    await expect(archive.loadWorkflowRun(output.workflowRun.id)).resolves.toMatchObject({
      source: "cli",
      title: "Investigate flaky deploy",
    });
    await expect(archive.readWorkflowRunEvents(output.workflowRun.id)).resolves.toMatchObject([
      { eventType: "workflow_run.accepted", workflowRunId: output.workflowRun.id },
    ]);
  });

  it("appends a durable operator event to an existing Workflow Run", async () => {
    const dataDir = await createTempDir();
    const stdout: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => {
      stdout.push(line);
    });

    const { main } = await import("../../src/cli/index.js");

    await expect(
      main([
        "workflow-run",
        "start",
        "--title",
        "Investigate flaky deploy",
        "--intent",
        "Find and fix the failing deployment path.",
        "--data-dir",
        dataDir,
        "--json",
      ]),
    ).resolves.toBe(0);
    const started = JSON.parse(stdout[0]) as {
      workflowRun: { id: string; artifactDir: string };
    };

    await expect(
      main([
        "workflow-run",
        "event",
        "append",
        "--run-id",
        started.workflowRun.id,
        "--event-type",
        "operator.note",
        "--message",
        "Escalated to release verification.",
        "--data-dir",
        dataDir,
        "--json",
      ]),
    ).resolves.toBe(0);

    const appended = JSON.parse(stdout[1]) as {
      type: string;
      event: {
        eventType: string;
        workflowRunId: string;
        message: string;
        source: string;
      };
    };
    expect(appended).toMatchObject({
      type: "workflow_run.event_appended",
      event: {
        eventType: "operator.note",
        workflowRunId: started.workflowRun.id,
        message: "Escalated to release verification.",
        source: "cli",
      },
    });

    const events = await createWorkflowRunArchive({ dataDir }).readWorkflowRunEvents(started.workflowRun.id);
    expect(events.map((event) => event.eventType)).toEqual(["workflow_run.accepted", "operator.note"]);
    expect(events[1]).toMatchObject({
      workflowRunId: started.workflowRun.id,
      message: "Escalated to release verification.",
      source: "cli",
    });
  });

  it("lists a Workflow Run event log through the CLI", async () => {
    const dataDir = await createTempDir();
    const stdout: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => {
      stdout.push(line);
    });

    const { main } = await import("../../src/cli/index.js");

    await expect(
      main([
        "workflow-run",
        "start",
        "--title",
        "Investigate flaky deploy",
        "--intent",
        "Find and fix the failing deployment path.",
        "--data-dir",
        dataDir,
        "--json",
      ]),
    ).resolves.toBe(0);
    const started = JSON.parse(stdout[0]) as {
      workflowRun: { id: string };
    };

    await expect(
      main([
        "workflow-run",
        "event",
        "append",
        "--run-id",
        started.workflowRun.id,
        "--event-type",
        "operator.note",
        "--message",
        "Escalated to release verification.",
        "--data-dir",
        dataDir,
        "--json",
      ]),
    ).resolves.toBe(0);
    await expect(
      main([
        "workflow-run",
        "event",
        "append",
        "--run-id",
        started.workflowRun.id,
        "--event-type",
        "operator.decision",
        "--message",
        "Release verification owns the next step.",
        "--data-dir",
        dataDir,
        "--json",
      ]),
    ).resolves.toBe(0);

    await expect(
      main(["workflow-run", "events", "list", "--run-id", started.workflowRun.id, "--data-dir", dataDir, "--json"]),
    ).resolves.toBe(0);

    const listed = JSON.parse(stdout[3]) as {
      type: string;
      workflowRun: {
        id: string;
        status: string;
        title: string;
      };
      events: Array<{
        sequence: number;
        eventType: string;
        workflowRunId: string;
        message?: string;
      }>;
    };
    expect(listed).toMatchObject({
      type: "workflow_run.events_listed",
      workflowRun: {
        id: started.workflowRun.id,
        status: "accepted",
        title: "Investigate flaky deploy",
      },
    });
    expect(listed.events.map((event) => event.eventType)).toEqual([
      "workflow_run.accepted",
      "operator.note",
      "operator.decision",
    ]);
    expect(listed.events.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(listed.events[1]).toMatchObject({
      workflowRunId: started.workflowRun.id,
      message: "Escalated to release verification.",
    });
    expect(listed.events[2]).toMatchObject({
      workflowRunId: started.workflowRun.id,
      message: "Release verification owns the next step.",
    });
  });

  it("lists durable Workflow Runs through the CLI without issue vocabulary", async () => {
    const dataDir = await createTempDir();
    const stdout: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => {
      stdout.push(line);
    });

    const { main } = await import("../../src/cli/index.js");

    await expect(
      main([
        "workflow-run",
        "start",
        "--title",
        "Prepare release notes",
        "--intent",
        "Summarize validated changes for the release.",
        "--data-dir",
        dataDir,
        "--json",
      ]),
    ).resolves.toBe(0);
    await expect(
      main([
        "workflow-run",
        "start",
        "--title",
        "Verify sandbox cleanup",
        "--intent",
        "Confirm successful live resources are cleaned up.",
        "--data-dir",
        dataDir,
        "--json",
      ]),
    ).resolves.toBe(0);

    await expect(main(["workflow-run", "list", "--data-dir", dataDir, "--json"])).resolves.toBe(0);

    const listed = JSON.parse(stdout[2]) as {
      type: string;
      workflowRuns: Array<{
        id: string;
        title: string;
        source: string;
        status: string;
      }>;
    };
    expect(listed).toMatchObject({
      type: "workflow_runs.listed",
      workflowRuns: expect.arrayContaining([
        expect.objectContaining({
          title: "Prepare release notes",
          source: "cli",
          status: "accepted",
        }),
        expect.objectContaining({
          title: "Verify sandbox cleanup",
          source: "cli",
          status: "accepted",
        }),
      ]),
    });
    expect(JSON.stringify(listed)).not.toMatch(/\bissue\b/i);
  });

  it("records a completed Role Execution artifact in the Workflow Run log", async () => {
    const dataDir = await createTempDir();
    const stdout: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => {
      stdout.push(line);
    });

    const { main } = await import("../../src/cli/index.js");

    await expect(
      main([
        "workflow-run",
        "start",
        "--title",
        "Implement cache repair",
        "--intent",
        "Plan and implement a cache repair safely.",
        "--data-dir",
        dataDir,
        "--json",
      ]),
    ).resolves.toBe(0);
    const started = JSON.parse(stdout[0]) as {
      workflowRun: { id: string };
    };

    await expect(
      main([
        "workflow-run",
        "role-execution",
        "complete",
        "--run-id",
        started.workflowRun.id,
        "--role",
        "planner",
        "--artifact-contract",
        "implementation_plan.v1",
        "--artifact-json",
        '{"summary":"Use a focused cache invalidation patch.","risk":"low"}',
        "--data-dir",
        dataDir,
        "--json",
      ]),
    ).resolves.toBe(0);

    const completed = JSON.parse(stdout[1]) as {
      type: string;
      roleExecution: {
        workflowRunId: string;
        role: string;
        status: string;
        artifact: {
          contractId: string;
          path: string;
        };
      };
    };
    expect(completed).toMatchObject({
      type: "workflow_run.role_execution_completed",
      roleExecution: {
        workflowRunId: started.workflowRun.id,
        role: "planner",
        status: "completed",
        artifact: {
          contractId: "implementation_plan.v1",
        },
      },
    });

    await expect(
      createWorkflowRunArchive({ dataDir }).readWorkflowRunArtifact({
        workflowRunId: started.workflowRun.id,
        artifactId: completed.roleExecution.artifact.artifactId,
      }),
    ).resolves.toEqual({
      contractId: "implementation_plan.v1",
      data: {
        summary: "Use a focused cache invalidation patch.",
        risk: "low",
      },
    });

    await expect(
      main(["workflow-run", "events", "list", "--run-id", started.workflowRun.id, "--data-dir", dataDir, "--json"]),
    ).resolves.toBe(0);

    const listed = JSON.parse(stdout[2]) as {
      events: Array<{
        eventType: string;
        roleExecutionId?: string;
        role?: string;
        artifact?: { contractId: string; path: string };
      }>;
    };
    expect(listed.events.map((event) => event.eventType)).toEqual([
      "workflow_run.accepted",
      "role_execution.completed",
    ]);
    expect(listed.events[1]).toMatchObject({
      role: "planner",
      artifact: {
        contractId: "implementation_plan.v1",
        path: completed.roleExecution.artifact.path,
      },
    });
  });

  it("records a Run Attempt start in the Workflow Run log", async () => {
    const dataDir = await createTempDir();
    const stdout: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => {
      stdout.push(line);
    });

    const { main } = await import("../../src/cli/index.js");

    await expect(
      main([
        "workflow-run",
        "start",
        "--title",
        "Retry implementation safely",
        "--intent",
        "Track each execution attempt under the durable Workflow Run.",
        "--data-dir",
        dataDir,
        "--json",
      ]),
    ).resolves.toBe(0);
    const started = JSON.parse(stdout[0]) as {
      workflowRun: { id: string };
    };

    await expect(
      main([
        "workflow-run",
        "run-attempt",
        "start",
        "--run-id",
        started.workflowRun.id,
        "--attempt-id",
        "attempt-1",
        "--attempt-number",
        "1",
        "--reason",
        "initial",
        "--data-dir",
        dataDir,
        "--json",
      ]),
    ).resolves.toBe(0);

    const recorded = JSON.parse(stdout[1]) as {
      type: string;
      runAttempt: {
        id: string;
        workflowRunId: string;
        attemptNumber: number;
        status: string;
        reason: string;
      };
      event: { eventType: string };
    };
    expect(recorded).toMatchObject({
      type: "workflow_run.run_attempt_started",
      runAttempt: {
        id: "attempt-1",
        workflowRunId: started.workflowRun.id,
        attemptNumber: 1,
        status: "running",
        reason: "initial",
      },
      event: { eventType: "run_attempt.started" },
    });

    await expect(
      main(["workflow-run", "events", "list", "--run-id", started.workflowRun.id, "--data-dir", dataDir, "--json"]),
    ).resolves.toBe(0);

    const listed = JSON.parse(stdout[2]) as {
      events: Array<{
        eventType: string;
        runAttempt?: {
          id: string;
          attemptNumber: number;
          status: string;
          reason: string;
        };
      }>;
    };
    expect(listed.events.map((event) => event.eventType)).toEqual(["workflow_run.accepted", "run_attempt.started"]);
    expect(listed.events[1]).toMatchObject({
      runAttempt: {
        id: "attempt-1",
        attemptNumber: 1,
        status: "running",
        reason: "initial",
      },
    });
    expect(JSON.stringify(recorded)).not.toMatch(/\bissue\b/i);
    expect(JSON.stringify(listed.events[1])).not.toMatch(/\bissue\b/i);
  });

  it("records a Run Attempt completion in the Workflow Run log", async () => {
    const dataDir = await createTempDir();
    const stdout: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => {
      stdout.push(line);
    });

    const { main } = await import("../../src/cli/index.js");

    await expect(
      main([
        "workflow-run",
        "start",
        "--title",
        "Complete implementation attempt",
        "--intent",
        "Close an execution attempt under the durable Workflow Run.",
        "--data-dir",
        dataDir,
        "--json",
      ]),
    ).resolves.toBe(0);
    const started = JSON.parse(stdout[0]) as {
      workflowRun: { id: string };
    };

    await expect(
      main([
        "workflow-run",
        "run-attempt",
        "start",
        "--run-id",
        started.workflowRun.id,
        "--attempt-id",
        "attempt-1",
        "--attempt-number",
        "1",
        "--reason",
        "initial",
        "--data-dir",
        dataDir,
        "--json",
      ]),
    ).resolves.toBe(0);

    await expect(
      main([
        "workflow-run",
        "run-attempt",
        "complete",
        "--run-id",
        started.workflowRun.id,
        "--attempt-id",
        "attempt-1",
        "--message",
        "Implementation and validation completed.",
        "--data-dir",
        dataDir,
        "--json",
      ]),
    ).resolves.toBe(0);

    const completed = JSON.parse(stdout[2]) as {
      type: string;
      runAttempt: {
        id: string;
        workflowRunId: string;
        status: string;
      };
      event: { eventType: string; message: string };
    };
    expect(completed).toMatchObject({
      type: "workflow_run.run_attempt_completed",
      runAttempt: {
        id: "attempt-1",
        workflowRunId: started.workflowRun.id,
        status: "completed",
      },
      event: {
        eventType: "run_attempt.completed",
        message: "Implementation and validation completed.",
      },
    });

    await expect(
      main(["workflow-run", "events", "list", "--run-id", started.workflowRun.id, "--data-dir", dataDir, "--json"]),
    ).resolves.toBe(0);

    const listed = JSON.parse(stdout[3]) as {
      events: Array<{
        eventType: string;
        message?: string;
        runAttempt?: { id: string; status: string };
      }>;
    };
    expect(listed.events.map((event) => event.eventType)).toEqual([
      "workflow_run.accepted",
      "run_attempt.started",
      "run_attempt.completed",
    ]);
    expect(listed.events[2]).toMatchObject({
      message: "Implementation and validation completed.",
      runAttempt: {
        id: "attempt-1",
        status: "completed",
      },
    });
    expect(JSON.stringify(completed)).not.toMatch(/\bissue\b/i);
    expect(JSON.stringify(listed.events[2])).not.toMatch(/\bissue\b/i);
  });

  it("records a Run Attempt failure in the Workflow Run log", async () => {
    const dataDir = await createTempDir();
    const stdout: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => {
      stdout.push(line);
    });

    const { main } = await import("../../src/cli/index.js");

    await expect(
      main([
        "workflow-run",
        "start",
        "--title",
        "Fail implementation attempt",
        "--intent",
        "Close a failed execution attempt under the durable Workflow Run.",
        "--data-dir",
        dataDir,
        "--json",
      ]),
    ).resolves.toBe(0);
    const started = JSON.parse(stdout[0]) as {
      workflowRun: { id: string };
    };

    await expect(
      main([
        "workflow-run",
        "run-attempt",
        "start",
        "--run-id",
        started.workflowRun.id,
        "--attempt-id",
        "attempt-1",
        "--attempt-number",
        "1",
        "--reason",
        "initial",
        "--data-dir",
        dataDir,
        "--json",
      ]),
    ).resolves.toBe(0);

    await expect(
      main([
        "workflow-run",
        "run-attempt",
        "fail",
        "--run-id",
        started.workflowRun.id,
        "--attempt-id",
        "attempt-1",
        "--message",
        "Validation failed after the worker exited.",
        "--data-dir",
        dataDir,
        "--json",
      ]),
    ).resolves.toBe(0);

    const failed = JSON.parse(stdout[2]) as {
      type: string;
      runAttempt: {
        id: string;
        workflowRunId: string;
        status: string;
      };
      event: { eventType: string; message: string };
    };
    expect(failed).toMatchObject({
      type: "workflow_run.run_attempt_failed",
      runAttempt: {
        id: "attempt-1",
        workflowRunId: started.workflowRun.id,
        status: "failed",
      },
      event: {
        eventType: "run_attempt.failed",
        message: "Validation failed after the worker exited.",
      },
    });

    await expect(
      main(["workflow-run", "events", "list", "--run-id", started.workflowRun.id, "--data-dir", dataDir, "--json"]),
    ).resolves.toBe(0);

    const listed = JSON.parse(stdout[3]) as {
      events: Array<{
        eventType: string;
        message?: string;
        runAttempt?: { id: string; status: string };
      }>;
    };
    expect(listed.events.map((event) => event.eventType)).toEqual([
      "workflow_run.accepted",
      "run_attempt.started",
      "run_attempt.failed",
    ]);
    expect(listed.events[2]).toMatchObject({
      message: "Validation failed after the worker exited.",
      runAttempt: {
        id: "attempt-1",
        status: "failed",
      },
    });
    expect(JSON.stringify(failed)).not.toMatch(/\bissue\b/i);
    expect(JSON.stringify(listed.events[2])).not.toMatch(/\bissue\b/i);
  });

  it("records a Run Attempt cancellation in the Workflow Run log", async () => {
    const dataDir = await createTempDir();
    const stdout: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => {
      stdout.push(line);
    });

    const { main } = await import("../../src/cli/index.js");

    await expect(
      main([
        "workflow-run",
        "start",
        "--title",
        "Cancel implementation attempt",
        "--intent",
        "Close a cancelled execution attempt under the durable Workflow Run.",
        "--data-dir",
        dataDir,
        "--json",
      ]),
    ).resolves.toBe(0);
    const started = JSON.parse(stdout[0]) as {
      workflowRun: { id: string };
    };

    await expect(
      main([
        "workflow-run",
        "run-attempt",
        "start",
        "--run-id",
        started.workflowRun.id,
        "--attempt-id",
        "attempt-1",
        "--attempt-number",
        "1",
        "--reason",
        "initial",
        "--data-dir",
        dataDir,
        "--json",
      ]),
    ).resolves.toBe(0);

    await expect(
      main([
        "workflow-run",
        "run-attempt",
        "cancel",
        "--run-id",
        started.workflowRun.id,
        "--attempt-id",
        "attempt-1",
        "--message",
        "Operator cancelled the worker.",
        "--data-dir",
        dataDir,
        "--json",
      ]),
    ).resolves.toBe(0);

    const cancelled = JSON.parse(stdout[2]) as {
      type: string;
      runAttempt: {
        id: string;
        workflowRunId: string;
        status: string;
      };
      event: { eventType: string; message: string };
    };
    expect(cancelled).toMatchObject({
      type: "workflow_run.run_attempt_cancelled",
      runAttempt: {
        id: "attempt-1",
        workflowRunId: started.workflowRun.id,
        status: "cancelled",
      },
      event: {
        eventType: "run_attempt.cancelled",
        message: "Operator cancelled the worker.",
      },
    });

    await expect(
      main(["workflow-run", "events", "list", "--run-id", started.workflowRun.id, "--data-dir", dataDir, "--json"]),
    ).resolves.toBe(0);

    const listed = JSON.parse(stdout[3]) as {
      events: Array<{
        eventType: string;
        message?: string;
        runAttempt?: { id: string; status: string };
      }>;
    };
    expect(listed.events.map((event) => event.eventType)).toEqual([
      "workflow_run.accepted",
      "run_attempt.started",
      "run_attempt.cancelled",
    ]);
    expect(listed.events[2]).toMatchObject({
      message: "Operator cancelled the worker.",
      runAttempt: {
        id: "attempt-1",
        status: "cancelled",
      },
    });
    expect(JSON.stringify(cancelled)).not.toMatch(/\bissue\b/i);
    expect(JSON.stringify(listed.events[2])).not.toMatch(/\bissue\b/i);
  });

  it("lists Run Attempt history from the Workflow Run log", async () => {
    const dataDir = await createTempDir();
    const stdout: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => {
      stdout.push(line);
    });

    const { main } = await import("../../src/cli/index.js");

    await expect(
      main([
        "workflow-run",
        "start",
        "--title",
        "Retry until validation passes",
        "--intent",
        "Summarize execution attempts from durable run events.",
        "--data-dir",
        dataDir,
        "--json",
      ]),
    ).resolves.toBe(0);
    const started = JSON.parse(stdout[0]) as {
      workflowRun: { id: string };
    };

    await expect(
      main([
        "workflow-run",
        "run-attempt",
        "start",
        "--run-id",
        started.workflowRun.id,
        "--attempt-id",
        "attempt-1",
        "--attempt-number",
        "1",
        "--reason",
        "initial",
        "--data-dir",
        dataDir,
        "--json",
      ]),
    ).resolves.toBe(0);
    await expect(
      main([
        "workflow-run",
        "run-attempt",
        "fail",
        "--run-id",
        started.workflowRun.id,
        "--attempt-id",
        "attempt-1",
        "--message",
        "First attempt failed validation.",
        "--data-dir",
        dataDir,
        "--json",
      ]),
    ).resolves.toBe(0);
    await expect(
      main([
        "workflow-run",
        "run-attempt",
        "start",
        "--run-id",
        started.workflowRun.id,
        "--attempt-id",
        "attempt-2",
        "--attempt-number",
        "2",
        "--reason",
        "retry",
        "--data-dir",
        dataDir,
        "--json",
      ]),
    ).resolves.toBe(0);
    await expect(
      main([
        "workflow-run",
        "run-attempt",
        "complete",
        "--run-id",
        started.workflowRun.id,
        "--attempt-id",
        "attempt-2",
        "--message",
        "Retry passed validation.",
        "--data-dir",
        dataDir,
        "--json",
      ]),
    ).resolves.toBe(0);

    await expect(
      main([
        "workflow-run",
        "run-attempts",
        "list",
        "--run-id",
        started.workflowRun.id,
        "--data-dir",
        dataDir,
        "--json",
      ]),
    ).resolves.toBe(0);

    const listed = JSON.parse(stdout[5]) as {
      type: string;
      workflowRun: { id: string };
      runAttempts: Array<{
        id: string;
        workflowRunId: string;
        attemptNumber?: number;
        reason?: string;
        status: string;
        message?: string;
      }>;
    };
    expect(listed).toMatchObject({
      type: "workflow_run.run_attempts_listed",
      workflowRun: {
        id: started.workflowRun.id,
      },
      runAttempts: [
        {
          id: "attempt-1",
          workflowRunId: started.workflowRun.id,
          attemptNumber: 1,
          reason: "initial",
          status: "failed",
          message: "First attempt failed validation.",
        },
        {
          id: "attempt-2",
          workflowRunId: started.workflowRun.id,
          attemptNumber: 2,
          reason: "retry",
          status: "completed",
          message: "Retry passed validation.",
        },
      ],
    });
    expect(JSON.stringify(listed)).not.toMatch(/\bissue\b/i);
  });

  it("records gate evaluation, transition, and hook firing as separate Workflow Run events", async () => {
    const dataDir = await createTempDir();
    const stdout: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => {
      stdout.push(line);
    });

    const { main } = await import("../../src/cli/index.js");

    await expect(
      main([
        "workflow-run",
        "start",
        "--title",
        "Validate release path",
        "--intent",
        "Move through review only after validation passes.",
        "--data-dir",
        dataDir,
        "--json",
      ]),
    ).resolves.toBe(0);
    const started = JSON.parse(stdout[0]) as {
      workflowRun: { id: string };
    };

    await expect(
      main([
        "workflow-run",
        "transition",
        "record",
        "--run-id",
        started.workflowRun.id,
        "--from-state",
        "review",
        "--to-state",
        "validate",
        "--gate",
        "tests-pass",
        "--gate-status",
        "passed",
        "--hook",
        "notify-operator",
        "--hook-timing",
        "state_exit",
        "--data-dir",
        dataDir,
        "--json",
      ]),
    ).resolves.toBe(0);

    const recorded = JSON.parse(stdout[1]) as {
      type: string;
      transition: {
        workflowRunId: string;
        fromState: string;
        toState: string;
        gate: { name: string; status: string };
        hook: { name: string; timing: string };
      };
      events: Array<{ eventType: string }>;
    };
    expect(recorded).toMatchObject({
      type: "workflow_run.transition_recorded",
      transition: {
        workflowRunId: started.workflowRun.id,
        fromState: "review",
        toState: "validate",
        gate: { name: "tests-pass", status: "passed" },
        hook: { name: "notify-operator", timing: "state_exit" },
      },
    });
    expect(recorded.events.map((event) => event.eventType)).toEqual([
      "validation_gate.evaluated",
      "workflow_transition.applied",
      "workflow_hook.fired",
    ]);

    await expect(
      main(["workflow-run", "events", "list", "--run-id", started.workflowRun.id, "--data-dir", dataDir, "--json"]),
    ).resolves.toBe(0);

    const listed = JSON.parse(stdout[2]) as {
      events: Array<{
        eventType: string;
        fromState?: string;
        toState?: string;
        gate?: { name: string; status: string };
        hook?: { name: string; timing: string };
      }>;
    };
    expect(listed.events.map((event) => event.eventType)).toEqual([
      "workflow_run.accepted",
      "validation_gate.evaluated",
      "workflow_transition.applied",
      "workflow_hook.fired",
    ]);
    expect(listed.events[1]).toMatchObject({
      gate: { name: "tests-pass", status: "passed" },
    });
    expect(listed.events[2]).toMatchObject({
      fromState: "review",
      toState: "validate",
    });
    expect(listed.events[3]).toMatchObject({
      hook: { name: "notify-operator", timing: "state_exit" },
    });
  });

  it("records prepared workspace and repository checkout lifecycle in the Workflow Run log", async () => {
    const dataDir = await createTempDir();
    const stdout: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => {
      stdout.push(line);
    });

    const { main } = await import("../../src/cli/index.js");

    await expect(
      main([
        "workflow-run",
        "start",
        "--title",
        "Repair checkout cache",
        "--intent",
        "Prepare an isolated workspace before implementation.",
        "--data-dir",
        dataDir,
        "--json",
      ]),
    ).resolves.toBe(0);
    const started = JSON.parse(stdout[0]) as {
      workflowRun: { id: string };
    };

    await expect(
      main([
        "workflow-run",
        "workspace",
        "record",
        "--run-id",
        started.workflowRun.id,
        "--workspace-path",
        path.join(dataDir, "workspaces", "repair-checkout-cache"),
        "--workspace-key",
        "repair-checkout-cache",
        "--repo-url",
        "https://github.com/risolutohq/example-service.git",
        "--branch",
        "risoluto/repair-checkout-cache",
        "--data-dir",
        dataDir,
        "--json",
      ]),
    ).resolves.toBe(0);

    const recorded = JSON.parse(stdout[1]) as {
      type: string;
      lifecycle: {
        workflowRunId: string;
        workspace: {
          path: string;
          key: string;
          status: string;
        };
        repo: {
          url: string;
          branch: string;
          status: string;
        };
      };
      events: Array<{ eventType: string }>;
    };
    expect(recorded).toMatchObject({
      type: "workflow_run.workspace_lifecycle_recorded",
      lifecycle: {
        workflowRunId: started.workflowRun.id,
        workspace: {
          path: path.join(dataDir, "workspaces", "repair-checkout-cache"),
          key: "repair-checkout-cache",
          status: "prepared",
        },
        repo: {
          url: "https://github.com/risolutohq/example-service.git",
          branch: "risoluto/repair-checkout-cache",
          status: "checked_out",
        },
      },
    });
    expect(recorded.events.map((event) => event.eventType)).toEqual(["workspace.prepared", "repo.checked_out"]);

    await expect(
      main(["workflow-run", "events", "list", "--run-id", started.workflowRun.id, "--data-dir", dataDir, "--json"]),
    ).resolves.toBe(0);

    const listed = JSON.parse(stdout[2]) as {
      events: Array<{
        eventType: string;
        workspace?: { path: string; key: string; status: string };
        repo?: { url: string; branch: string; status: string };
      }>;
    };
    expect(listed.events.map((event) => event.eventType)).toEqual([
      "workflow_run.accepted",
      "workspace.prepared",
      "repo.checked_out",
    ]);
    expect(listed.events[1]).toMatchObject({
      workspace: {
        path: path.join(dataDir, "workspaces", "repair-checkout-cache"),
        key: "repair-checkout-cache",
        status: "prepared",
      },
    });
    expect(listed.events[2]).toMatchObject({
      repo: {
        url: "https://github.com/risolutohq/example-service.git",
        branch: "risoluto/repair-checkout-cache",
        status: "checked_out",
      },
    });
  });

  it("records workspace cleanup outcome in the Workflow Run log", async () => {
    const dataDir = await createTempDir();
    const stdout: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => {
      stdout.push(line);
    });

    const { main } = await import("../../src/cli/index.js");

    await expect(
      main([
        "workflow-run",
        "start",
        "--title",
        "Publish completed patch",
        "--intent",
        "Clean up the workspace after a successful run.",
        "--data-dir",
        dataDir,
        "--json",
      ]),
    ).resolves.toBe(0);
    const started = JSON.parse(stdout[0]) as {
      workflowRun: { id: string };
    };
    const workspacePath = path.join(dataDir, "workspaces", "publish-completed-patch");

    await expect(
      main([
        "workflow-run",
        "workspace",
        "cleanup",
        "record",
        "--run-id",
        started.workflowRun.id,
        "--workspace-path",
        workspacePath,
        "--workspace-key",
        "publish-completed-patch",
        "--result",
        "removed",
        "--reason",
        "workflow_succeeded",
        "--data-dir",
        dataDir,
        "--json",
      ]),
    ).resolves.toBe(0);

    const recorded = JSON.parse(stdout[1]) as {
      type: string;
      cleanup: {
        workflowRunId: string;
        workspace: {
          path: string;
          key: string;
        };
        result: string;
        reason: string;
      };
      event: { eventType: string };
    };
    expect(recorded).toMatchObject({
      type: "workflow_run.workspace_cleanup_recorded",
      cleanup: {
        workflowRunId: started.workflowRun.id,
        workspace: {
          path: workspacePath,
          key: "publish-completed-patch",
        },
        result: "removed",
        reason: "workflow_succeeded",
      },
      event: { eventType: "workspace.cleanup_completed" },
    });

    await expect(
      main(["workflow-run", "events", "list", "--run-id", started.workflowRun.id, "--data-dir", dataDir, "--json"]),
    ).resolves.toBe(0);

    const listed = JSON.parse(stdout[2]) as {
      events: Array<{
        eventType: string;
        cleanup?: {
          workspace: { path: string; key: string };
          result: string;
          reason: string;
        };
      }>;
    };
    expect(listed.events.map((event) => event.eventType)).toEqual([
      "workflow_run.accepted",
      "workspace.cleanup_completed",
    ]);
    expect(listed.events[1]).toMatchObject({
      cleanup: {
        workspace: {
          path: workspacePath,
          key: "publish-completed-patch",
        },
        result: "removed",
        reason: "workflow_succeeded",
      },
    });
  });

  it("records completed worker process outcome in the Workflow Run log", async () => {
    const dataDir = await createTempDir();
    const stdout: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => {
      stdout.push(line);
    });

    const { main } = await import("../../src/cli/index.js");

    await expect(
      main([
        "workflow-run",
        "start",
        "--title",
        "Implement retry fix",
        "--intent",
        "Run the implementer role through the configured harness.",
        "--data-dir",
        dataDir,
        "--json",
      ]),
    ).resolves.toBe(0);
    const started = JSON.parse(stdout[0]) as {
      workflowRun: { id: string };
    };

    await expect(
      main([
        "workflow-run",
        "worker-process",
        "record",
        "--run-id",
        started.workflowRun.id,
        "--worker-id",
        "worker-implementer-1",
        "--role",
        "implementer",
        "--harness",
        "codex",
        "--status",
        "succeeded",
        "--exit-code",
        "0",
        "--data-dir",
        dataDir,
        "--json",
      ]),
    ).resolves.toBe(0);

    const recorded = JSON.parse(stdout[1]) as {
      type: string;
      workerProcess: {
        workflowRunId: string;
        workerId: string;
        role: string;
        harness: string;
        status: string;
        exitCode: number;
      };
      event: { eventType: string };
    };
    expect(recorded).toMatchObject({
      type: "workflow_run.worker_process_recorded",
      workerProcess: {
        workflowRunId: started.workflowRun.id,
        workerId: "worker-implementer-1",
        role: "implementer",
        harness: "codex",
        status: "succeeded",
        exitCode: 0,
      },
      event: { eventType: "worker_process.completed" },
    });

    await expect(
      main(["workflow-run", "events", "list", "--run-id", started.workflowRun.id, "--data-dir", dataDir, "--json"]),
    ).resolves.toBe(0);

    const listed = JSON.parse(stdout[2]) as {
      events: Array<{
        eventType: string;
        workerProcess?: {
          workerId: string;
          role: string;
          harness: string;
          status: string;
          exitCode: number;
        };
      }>;
    };
    expect(listed.events.map((event) => event.eventType)).toEqual([
      "workflow_run.accepted",
      "worker_process.completed",
    ]);
    expect(listed.events[1]).toMatchObject({
      workerProcess: {
        workerId: "worker-implementer-1",
        role: "implementer",
        harness: "codex",
        status: "succeeded",
        exitCode: 0,
      },
    });
  });
});
