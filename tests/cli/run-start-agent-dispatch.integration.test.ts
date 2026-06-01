import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { startAndDriveRunCommand } from "../../src/cli/run-start-command.js";
import type { ModelSelection, RunOutcome } from "../../src/core/types.js";
import type { RunAttemptDispatcher } from "../../src/dispatch/types.js";
import { createAgentRoleDispatch } from "../../src/workflow-run/agent-role-dispatch.js";
import { createWorkflowRunArchive, type WorkflowRunArchive } from "../../src/workflow-run/archive.js";
import { workflowRunArtifactIdForContract } from "../../src/workflow-run/run-role-runner.js";

const tempDirs: string[] = [];
const FIXED_TIME = "2026-06-01T12:00:00.000Z";

const AGENT_WORKFLOW = `
version: 1
id: agent-flow
defaults: {}
states:
  - id: plan
    roles:
      - id: planner
        consumes: [intent.v1]
        produces: [plan.v1]
        dependsOn: []
    gates: []
    hooks: []
actions: []
`;

type CapturedAttempt = Parameters<RunAttemptDispatcher["runAttempt"]>[0];

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeWorkflowFixture(): Promise<string> {
  const workflowDir = await createTempDir("risoluto-agent-workflows-");
  await mkdir(workflowDir, { recursive: true });
  await writeFile(path.join(workflowDir, "agent-flow.yaml"), AGENT_WORKFLOW.trimStart(), "utf8");
  return workflowDir;
}

function normalOutcome(): RunOutcome {
  return { kind: "normal", errorCode: null, errorMessage: null, threadId: "thread-1", turnId: "turn-1", turnCount: 1 };
}

function failedOutcome(): RunOutcome {
  return {
    kind: "failed",
    errorCode: "agent_error",
    errorMessage: "codex session crashed",
    threadId: null,
    turnId: null,
    turnCount: 0,
  };
}

function liveModel(): ModelSelection {
  return { model: "gpt-5.4-mini", reasoningEffort: "high", source: "default" };
}

function validPlan(workflowRunId: string): Record<string, unknown> {
  return {
    version: 1,
    workflowRunId,
    createdAt: FIXED_TIME,
    summary: "Plan.",
    steps: [{ id: "s1", title: "Apply", status: "ready", dependsOn: [] }],
  };
}

// A D1-compliant fake agent session: deposits the planner artifact at its canonical archive path, exactly
// as a real Codex session would when driven by the prompt, then returns a normal outcome.
function depositingDispatcher(archive: WorkflowRunArchive, captured: CapturedAttempt[]): RunAttemptDispatcher {
  return {
    runAttempt: async (input) => {
      captured.push(input);
      const runId = input.issue.workflowRunId ?? input.issue.id;
      await archive.writeWorkflowRunArtifact({
        workflowRunId: runId,
        contractId: "plan.v1",
        artifactId: workflowRunArtifactIdForContract("plan.v1"),
        data: validPlan(runId),
        producer: { type: "role", id: "planner" },
      });
      return normalOutcome();
    },
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("agent role dispatch adapter drives the engine from `run start` (NIN-222)", () => {
  it("runs one agent session per role with the resolved model/prompt/workspace and deposits per D1", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const dataDir = await createTempDir("risoluto-agent-data-");
    const workflowDir = await writeWorkflowFixture();
    const archive = createWorkflowRunArchive({ dataDir });
    const captured: CapturedAttempt[] = [];

    const dispatchRole = createAgentRoleDispatch({
      dispatcher: depositingDispatcher(archive, captured),
      workspace: { path: "/tmp/agent-workspace", workspaceKey: "default", createdNow: true },
      modelForProfile: () => liveModel(),
      promptForRole: (input) => `Role ${input.role.id}: produce ${input.role.produces.join(", ")}`,
      signal: new AbortController().signal,
    });

    await expect(
      startAndDriveRunCommand(
        [
          "--title",
          "Agent",
          "--intent",
          "Ship a change",
          "--data-dir",
          dataDir,
          "--workflow-dir",
          workflowDir,
          "--workflow-definition",
          "agent-flow",
          "--json",
        ],
        { dispatchRole, now: () => FIXED_TIME },
      ),
    ).resolves.toBe(0);

    const runId = (await archive.listWorkflowRuns())[0]?.id ?? "";
    await expect(archive.loadWorkflowRun(runId)).resolves.toMatchObject({ status: "done" });
    // The adapter dispatched exactly one session, with the run-keyed issue, resolved model, built prompt,
    // and the prepared workspace.
    expect(captured).toHaveLength(1);
    expect(captured[0]?.issue.workflowRunId).toBe(runId);
    expect(captured[0]?.modelSelection.model).toBe("gpt-5.4-mini");
    expect(captured[0]?.promptTemplate).toContain("plan.v1");
    expect(captured[0]?.workspace.path).toBe("/tmp/agent-workspace");
    const plan = await archive.readWorkflowRunArtifact({ workflowRunId: runId, artifactId: "plan" });
    expect((plan as { data: { summary: string } }).data.summary).toBe("Plan.");
  });

  it("fails the role honestly when the agent session ends non-normally", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const dataDir = await createTempDir("risoluto-agent-data-");
    const workflowDir = await writeWorkflowFixture();
    const archive = createWorkflowRunArchive({ dataDir });

    const dispatchRole = createAgentRoleDispatch({
      dispatcher: { runAttempt: async () => failedOutcome() },
      workspace: { path: "/tmp/agent-workspace", workspaceKey: "default", createdNow: true },
      modelForProfile: () => liveModel(),
      promptForRole: () => "do the work",
      signal: new AbortController().signal,
    });

    await expect(
      startAndDriveRunCommand(
        [
          "--title",
          "Agent",
          "--intent",
          "Ship a change",
          "--data-dir",
          dataDir,
          "--workflow-dir",
          workflowDir,
          "--workflow-definition",
          "agent-flow",
          "--json",
        ],
        { dispatchRole, now: () => FIXED_TIME },
      ),
    ).resolves.toBe(0);

    const runId = (await archive.listWorkflowRuns())[0]?.id ?? "";
    await expect(archive.loadWorkflowRun(runId)).resolves.toMatchObject({ status: "blocked" });
    const handoff = await archive.readWorkflowRunArtifact({ workflowRunId: runId, artifactId: "handoff" });
    const blockers = (handoff as { data: { blockers: Array<{ message: string }> } }).data.blockers;
    expect(blockers.some((blocker) => /ended failed|codex session crashed/.test(blocker.message))).toBe(true);
  });
});
