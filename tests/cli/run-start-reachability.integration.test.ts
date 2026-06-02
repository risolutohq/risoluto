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

const HAPPY_WORKFLOW = `
version: 1
id: executor-core-happy
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
  - id: implement
    roles:
      - id: implementer
        consumes: [intent.v1, plan.v1]
        produces: [change_summary.v1]
        dependsOn: [planner]
    gates: []
    hooks: []
  - id: review
    roles:
      - id: reviewer
        consumes: [change_summary.v1]
        produces: [review.v1]
        dependsOn: [implementer]
    gates: []
    hooks: []
actions: []
`;

// implementer consumes review.v1, which only the downstream reviewer produces — so it is absent when
// implementer runs, triggering the missing-required-artifact failure with producer attribution.
const MISSING_INPUT_WORKFLOW = `
version: 1
id: executor-core-missing
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
  - id: implement
    roles:
      - id: implementer
        consumes: [intent.v1, review.v1]
        produces: [change_summary.v1]
        dependsOn: [planner]
    gates: []
    hooks: []
  - id: review
    roles:
      - id: reviewer
        consumes: [change_summary.v1]
        produces: [review.v1]
        dependsOn: [implementer]
    gates: []
    hooks: []
actions: []
`;

interface DispatchOptions {
  readonly plannerBlocked?: boolean;
}

interface DispatchCapture {
  readonly dispatchRole: WorkflowRunRoleDispatch;
  readonly calls: Array<{ roleId: string; received: Record<string, unknown> }>;
}

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeWorkflowFixture(definitionId: string, yaml: string): Promise<string> {
  const workflowDir = await createTempDir("risoluto-run-start-workflows-");
  await mkdir(workflowDir, { recursive: true });
  await writeFile(path.join(workflowDir, `${definitionId}.yaml`), yaml.trimStart(), "utf8");
  return workflowDir;
}

function buildRoleArtifact(contractId: string, workflowRunId: string, options: DispatchOptions): unknown {
  const base = { version: 1 as const, workflowRunId, createdAt: FIXED_TIME };
  if (contractId === "plan.v1") {
    const status = options.plannerBlocked ? "blocked" : "ready";
    return {
      ...base,
      summary: "Plan the change.",
      steps: [{ id: "step-1", title: "Apply patch", status, dependsOn: [] }],
    };
  }
  if (contractId === "change_summary.v1") {
    return {
      ...base,
      summary: "Implemented the change.",
      changedFiles: [{ path: "src/example.ts", changeType: "modified", summary: "Patch behaviour." }],
    };
  }
  if (contractId === "review.v1") {
    return { ...base, verdict: "pass", findings: [] };
  }
  throw new Error(`unexpected fixture contract ${contractId}`);
}

function createDepositingDispatch(archive: WorkflowRunArchive, options: DispatchOptions): DispatchCapture {
  const calls: Array<{ roleId: string; received: Record<string, unknown> }> = [];
  const dispatchRole: WorkflowRunRoleDispatch = async (input) => {
    calls.push({ roleId: input.role.id, received: { ...input.artifacts } });
    for (const contractId of input.role.produces) {
      await archive.writeWorkflowRunArtifact({
        workflowRunId: input.workflowRunId,
        contractId,
        artifactId: workflowRunArtifactIdForContract(contractId),
        data: buildRoleArtifact(contractId, input.workflowRunId, options),
        producer: { type: "role", id: input.role.id },
      });
    }
  };
  return { dispatchRole, calls };
}

function silenceStdout(): void {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("run start drives the workflow executor (NIN-198 reachability)", () => {
  it("executes planner -> implementer -> reviewer in DAG order, each consuming the prior typed artifact", async () => {
    silenceStdout();
    const dataDir = await createTempDir("risoluto-run-start-data-");
    const workflowDir = await writeWorkflowFixture("executor-core-happy", HAPPY_WORKFLOW);
    const archive = createWorkflowRunArchive({ dataDir });
    const { dispatchRole, calls } = createDepositingDispatch(archive, {});

    await expect(
      startAndDriveRunCommand(
        [
          "--title",
          "Reachable run",
          "--intent",
          "Drive the engine from the CLI.",
          "--data-dir",
          dataDir,
          "--workflow-dir",
          workflowDir,
          "--workflow-definition",
          "executor-core-happy",
          "--json",
        ],
        { dispatchRole, now: () => FIXED_TIME },
      ),
    ).resolves.toBe(0);

    expect(calls.map((call) => call.roleId)).toEqual(["planner", "implementer", "reviewer"]);
    // each role received the prior role's typed artifact, not prose
    expect(calls[1]?.received["plan.v1"]).toMatchObject({ steps: [{ status: "ready" }] });
    expect(calls[2]?.received["change_summary.v1"]).toMatchObject({ summary: "Implemented the change." });

    const runs = await archive.listWorkflowRuns();
    expect(runs).toHaveLength(1);
    const runId = runs[0]?.id ?? "";
    await expect(archive.loadWorkflowRun(runId)).resolves.toMatchObject({ status: "done" });
    await expect(
      archive.readWorkflowRunArtifact({ workflowRunId: runId, artifactId: "review" }),
    ).resolves.toMatchObject({
      contractId: "review.v1",
    });
  });

  it("blocks an over-large or ambiguous intent at planner triage before implementation runs", async () => {
    silenceStdout();
    const dataDir = await createTempDir("risoluto-run-start-data-");
    const workflowDir = await writeWorkflowFixture("executor-core-happy", HAPPY_WORKFLOW);
    const archive = createWorkflowRunArchive({ dataDir });
    const { dispatchRole, calls } = createDepositingDispatch(archive, { plannerBlocked: true });

    await expect(
      startAndDriveRunCommand(
        [
          "--title",
          "Ambiguous run",
          "--intent",
          "Too large to plan.",
          "--data-dir",
          dataDir,
          "--workflow-dir",
          workflowDir,
          "--workflow-definition",
          "executor-core-happy",
          "--json",
        ],
        { dispatchRole, now: () => FIXED_TIME },
      ),
    ).resolves.toBe(0);

    expect(calls.map((call) => call.roleId)).toEqual(["planner"]);
    const runId = (await archive.listWorkflowRuns())[0]?.id ?? "";
    await expect(archive.loadWorkflowRun(runId)).resolves.toMatchObject({ status: "blocked" });
    const handoff = await archive.readWorkflowRunArtifact({ workflowRunId: runId, artifactId: "handoff" });
    expect(handoff).toMatchObject({ contractId: "handoff.v1", data: { outcome: "blocked" } });
  });

  it("fails a role missing a required input artifact with producer attribution, not prose", async () => {
    silenceStdout();
    const dataDir = await createTempDir("risoluto-run-start-data-");
    const workflowDir = await writeWorkflowFixture("executor-core-missing", MISSING_INPUT_WORKFLOW);
    const archive = createWorkflowRunArchive({ dataDir });
    const { dispatchRole, calls } = createDepositingDispatch(archive, {});

    await expect(
      startAndDriveRunCommand(
        [
          "--title",
          "Missing input",
          "--intent",
          "Implementer needs an artifact no upstream produced.",
          "--data-dir",
          dataDir,
          "--workflow-dir",
          workflowDir,
          "--workflow-definition",
          "executor-core-missing",
          "--json",
        ],
        { dispatchRole, now: () => FIXED_TIME },
      ),
    ).resolves.toBe(0);

    expect(calls.map((call) => call.roleId)).toEqual(["planner"]);
    const runId = (await archive.listWorkflowRuns())[0]?.id ?? "";
    await expect(archive.loadWorkflowRun(runId)).resolves.toMatchObject({ status: "blocked" });
    const handoff = await archive.readWorkflowRunArtifact({ workflowRunId: runId, artifactId: "handoff" });
    const data = (handoff as { data: { blockers: Array<{ message: string }> } }).data;
    expect(data.blockers[0]?.message).toMatch(
      /implementer is missing required artifact review\.v1 produced by reviewer/,
    );
  });
});

describe("run start is reachable end-to-end from the real CLI", () => {
  it("drives the default workflow to an honest blocked handoff when no agent harness is configured", async () => {
    const dataDir = await createTempDir("risoluto-run-start-data-");
    const stdout: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => {
      stdout.push(line);
    });

    const { main } = await import("../../src/cli/index.js");

    await expect(
      main([
        "run",
        "start",
        "--title",
        "End to end",
        "--intent",
        "Reach the engine through the bin.",
        "--data-dir",
        dataDir,
        "--json",
      ]),
    ).resolves.toBe(0);

    const driven = JSON.parse(stdout[0] ?? "{}") as { type: string; outcome: string };
    expect(driven).toMatchObject({ type: "workflow_run.driven", outcome: "blocked" });

    await expect(
      main(["run", "status", JSON.parse(stdout[0] ?? "{}").workflowRun.id, "--data-dir", dataDir, "--json"]),
    ).resolves.toBe(0);
    const status = JSON.parse(stdout[1] ?? "{}") as { workflowRun: { status: string } };
    expect(status.workflowRun.status).toBe("blocked");

    const runId = (await createWorkflowRunArchive({ dataDir }).listWorkflowRuns())[0]?.id ?? "";
    const handoff = await createWorkflowRunArchive({ dataDir }).readWorkflowRunArtifact({
      workflowRunId: runId,
      artifactId: "handoff",
    });
    const data = (handoff as { data: { outcome: string; blockers: Array<{ message: string }> } }).data;
    expect(data.outcome).toBe("blocked");
    expect(data.blockers[0]?.message).toMatch(/agent harness is not configured for role planner/);
  });
});
