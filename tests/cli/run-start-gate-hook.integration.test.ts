import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { startAndDriveRunCommand } from "../../src/cli/run-start-command.js";
import { createWorkflowRunArchive, type WorkflowRunArchive } from "../../src/workflow-run/archive.js";
import {
  workflowRunArtifactIdForContract,
  type WorkflowRunRoleDispatch,
} from "../../src/workflow-run/run-role-runner.js";

const tempDirs: string[] = [];
const FIXED_TIME = "2026-06-01T12:00:00.000Z";

// review node carries BOTH a gate (verifier-satisfied — fails, verification.v1 was never produced) and a
// hook (notify-operator at state entry). The reviewer "claims success" by depositing review.v1.
const GATE_HOOK_WORKFLOW = `
version: 1
id: gate-hook-node
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
  - id: review
    roles:
      - id: reviewer
        consumes: [plan.v1]
        produces: [review.v1]
        dependsOn: [planner]
    gates: [verifier-satisfied]
    hooks: [notify-operator]
actions: []
`;

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeWorkflowFixture(): Promise<string> {
  const workflowDir = await createTempDir("risoluto-gate-hook-workflows-");
  await mkdir(workflowDir, { recursive: true });
  await writeFile(path.join(workflowDir, "gate-hook-node.yaml"), GATE_HOOK_WORKFLOW.trimStart(), "utf8");
  return workflowDir;
}

function buildRoleArtifact(contractId: string, workflowRunId: string): unknown {
  const base = { version: 1 as const, workflowRunId, createdAt: FIXED_TIME };
  if (contractId === "plan.v1") {
    return {
      ...base,
      summary: "Plan the change.",
      steps: [{ id: "s1", title: "Apply", status: "ready", dependsOn: [] }],
    };
  }
  if (contractId === "review.v1") {
    return { ...base, verdict: "pass", findings: [] };
  }
  throw new Error(`unexpected fixture contract ${contractId}`);
}

function createDepositingDispatch(archive: WorkflowRunArchive): WorkflowRunRoleDispatch {
  return async (input) => {
    for (const contractId of input.role.produces) {
      await archive.writeWorkflowRunArtifact({
        workflowRunId: input.workflowRunId,
        contractId,
        artifactId: workflowRunArtifactIdForContract(contractId),
        data: buildRoleArtifact(contractId, input.workflowRunId),
        producer: { type: "role", id: input.role.id },
      });
    }
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("gate and hook engine reachable from run start (RIS-200)", () => {
  it("blocks on a failed gate and records the gate and hook as separate event records", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const dataDir = await createTempDir("risoluto-gate-hook-data-");
    const workflowDir = await writeWorkflowFixture();
    const archive = createWorkflowRunArchive({ dataDir });
    const dispatchRole = createDepositingDispatch(archive);

    await expect(
      startAndDriveRunCommand(
        [
          "--title",
          "Gate + hook",
          "--intent",
          "Drive a node with a gate and a hook.",
          "--data-dir",
          dataDir,
          "--workflow-dir",
          workflowDir,
          "--workflow-definition",
          "gate-hook-node",
          "--json",
        ],
        { dispatchRole, now: () => FIXED_TIME },
      ),
    ).resolves.toBe(0);

    const runId = (await archive.listWorkflowRuns())[0]?.id ?? "";

    // Criterion 1: the gate fails on the missing verification.v1 and blocks the run even though the
    // reviewer claimed success (deposited a passing review.v1).
    await expect(archive.loadWorkflowRun(runId)).resolves.toMatchObject({ status: "blocked" });
    const handoff = await archive.readWorkflowRunArtifact({ workflowRunId: runId, artifactId: "handoff" });
    const handoffData = (handoff as { data: { blockers: Array<{ message: string }> } }).data;
    expect(handoffData.blockers[0]?.message).toMatch(
      /gate verifier-satisfied failed: missing required artifact verification\.v1/,
    );

    // Criteria 2 + 3: the hook fired at state entry and recorded evidence, and the gate and hook are
    // distinct durable event records — separate code paths, separate records. (Budget checks fire before
    // every role under the default budget; filter them out to assert the gate/hook record stream.)
    const events = await archive.readWorkflowRunEvents(runId);
    const recordStream = events
      .map((event) => event.eventType)
      .filter((eventType) => eventType !== "workflow_budget.checked");
    expect(recordStream).toEqual(["workflow_run.accepted", "workflow_hook.fired", "validation_gate.evaluated"]);
    const hookEvent = events.find((event) => event.eventType === "workflow_hook.fired");
    const gateEvent = events.find((event) => event.eventType === "validation_gate.evaluated");
    expect(hookEvent).toMatchObject({ hook: { name: "notify-operator", timing: "state_entry" } });
    expect(hookEvent?.message).toMatch(/recorded evidence/);
    expect(gateEvent).toMatchObject({ gate: { name: "verifier-satisfied", status: "failed" } });
  });
});
