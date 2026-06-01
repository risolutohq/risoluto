/**
 * NIN-222 — hermetic composition test for the agent-dispatch seam in `run start`.
 *
 * Covers:
 *  1. Injected-dispatcher path (deps.dispatcher): createWorkflowRunAgentDispatch is composed and the
 *     fake RunAttemptDispatcher.runAttempt is called per role with the projected issue/workspace/model.
 *  2. Default path (no opt-in, no injected deps): the run still reaches createUnconfiguredAgentRoleDispatch
 *     and ends in an honest blocked handoff.
 *
 * Neither test requires RISOLUTO_LIVE_RUN_START or a real Codex/Docker process.
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { startAndDriveRunCommand } from "../../src/cli/run-start-command.js";
import type { ModelSelection, RunOutcome } from "../../src/core/types.js";
import type { RunAttemptDispatcher } from "../../src/dispatch/types.js";
import { createWorkflowRunArchive } from "../../src/workflow-run/archive.js";
import { workflowRunArtifactIdForContract } from "../../src/workflow-run/run-role-runner.js";

const tempDirs: string[] = [];
const FIXED_TIME = "2026-06-01T12:00:00.000Z";

const AGENT_WORKFLOW = `
version: 1
id: nin222-flow
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
  const workflowDir = await createTempDir("risoluto-nin222-workflows-");
  await mkdir(workflowDir, { recursive: true });
  await writeFile(path.join(workflowDir, "nin222-flow.yaml"), AGENT_WORKFLOW.trimStart(), "utf8");
  return workflowDir;
}

function normalOutcome(): RunOutcome {
  return {
    kind: "normal",
    errorCode: null,
    errorMessage: null,
    threadId: "thread-nin222",
    turnId: "turn-1",
    turnCount: 1,
  };
}

function stubModel(): ModelSelection {
  return { model: "stub-model", reasoningEffort: "low", source: "default" };
}

function validPlan(workflowRunId: string): Record<string, unknown> {
  return {
    version: 1,
    workflowRunId,
    createdAt: FIXED_TIME,
    summary: "NIN-222 plan.",
    steps: [{ id: "s1", title: "Implement", status: "ready", dependsOn: [] }],
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("NIN-222: run-start agent-dispatch composition seam", () => {
  it("composes createWorkflowRunAgentDispatch when deps.dispatcher is injected and calls runAttempt per role", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const dataDir = await createTempDir("risoluto-nin222-data-");
    const workflowDir = await writeWorkflowFixture();
    const archive = createWorkflowRunArchive({ dataDir });
    const captured: CapturedAttempt[] = [];

    // Fake RunAttemptDispatcher: deposits the planner artifact, then returns normal.
    const fakeDispatcher: RunAttemptDispatcher = {
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

    const stubWorkspace = { path: "/tmp/nin222-workspace", workspaceKey: "default", createdNow: true };

    await expect(
      startAndDriveRunCommand(
        [
          "--title",
          "NIN-222",
          "--intent",
          "Wire agent dispatch",
          "--data-dir",
          dataDir,
          "--workflow-dir",
          workflowDir,
          "--workflow-definition",
          "nin222-flow",
          "--json",
        ],
        {
          dispatcher: fakeDispatcher,
          workspace: stubWorkspace,
          modelForProfile: () => stubModel(),
          now: () => FIXED_TIME,
        },
      ),
    ).resolves.toBe(0);

    const runId = (await archive.listWorkflowRuns())[0]?.id ?? "";
    // Run drove to completion via the injected dispatcher.
    await expect(archive.loadWorkflowRun(runId)).resolves.toMatchObject({ status: "done" });

    // Exactly one agent session was dispatched for the single planner role.
    expect(captured).toHaveLength(1);

    // The session received the run-keyed issue, the stub workspace, and the resolved model.
    expect(captured[0]?.issue.workflowRunId).toBe(runId);
    expect(captured[0]?.workspace.path).toBe("/tmp/nin222-workspace");
    expect(captured[0]?.modelSelection.model).toBe("stub-model");

    // The prompt included the D1 deposit path and envelope.
    expect(captured[0]?.promptTemplate).toContain(`/workflow-runs/${runId}/artifacts/plan.json`);
  });

  it("reaches createUnconfiguredAgentRoleDispatch (honest block) when no opt-in is present", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const dataDir = await createTempDir("risoluto-nin222-default-");
    const workflowDir = await writeWorkflowFixture();
    const archive = createWorkflowRunArchive({ dataDir });

    // No dispatcher, no dispatchRole, no RISOLUTO_LIVE_RUN_START — should hit honest block.
    delete process.env.RISOLUTO_LIVE_RUN_START;

    await expect(
      startAndDriveRunCommand(
        [
          "--title",
          "NIN-222 default",
          "--intent",
          "Check honest block",
          "--data-dir",
          dataDir,
          "--workflow-dir",
          workflowDir,
          "--workflow-definition",
          "nin222-flow",
          "--json",
        ],
        { now: () => FIXED_TIME },
      ),
    ).resolves.toBe(0);

    const runId = (await archive.listWorkflowRuns())[0]?.id ?? "";
    // Run is blocked because the honest-block dispatch errors the role.
    await expect(archive.loadWorkflowRun(runId)).resolves.toMatchObject({ status: "blocked" });
    const handoff = await archive.readWorkflowRunArtifact({ workflowRunId: runId, artifactId: "handoff" });
    const blockers = (handoff as { data: { blockers: Array<{ message: string }> } }).data.blockers;
    expect(blockers.some((blocker) => /agent harness is not configured/.test(blocker.message))).toBe(true);
  });
});
