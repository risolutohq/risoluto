import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { startAndDriveRunCommand } from "../../src/cli/run-start-command.js";
import { createWorkflowRunArchive, type WorkflowRunArchive } from "../../src/workflow-run/archive.js";
import type { WorkflowBudgetPolicy } from "../../src/workflow-run/budget-retry.js";
import type { WorkflowGateRetryInput } from "../../src/workflow-run/gate-retry-controller.js";
import {
  workflowRunArtifactIdForContract,
  type WorkflowRunRoleDispatch,
} from "../../src/workflow-run/run-role-runner.js";

const tempDirs: string[] = [];
const FIXED_TIME = "2026-06-01T12:00:00.000Z";

const BUDGET_WORKFLOW = `
version: 1
id: budget-min
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

// review node carries a verifier-satisfied gate that fails (verification.v1 is never produced).
const RETRY_WORKFLOW = `
version: 1
id: retry-gate
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
    hooks: []
actions: []
`;

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeWorkflowFixture(definitionId: string, yaml: string): Promise<string> {
  const workflowDir = await createTempDir("risoluto-budget-retry-workflows-");
  await mkdir(workflowDir, { recursive: true });
  await writeFile(path.join(workflowDir, `${definitionId}.yaml`), yaml.trimStart(), "utf8");
  return workflowDir;
}

function buildRoleArtifact(contractId: string, workflowRunId: string): unknown {
  const base = { version: 1 as const, workflowRunId, createdAt: FIXED_TIME };
  if (contractId === "plan.v1") {
    return { ...base, summary: "Plan.", steps: [{ id: "s1", title: "Apply", status: "ready", dependsOn: [] }] };
  }
  if (contractId === "review.v1") {
    return { ...base, verdict: "pass", findings: [] };
  }
  throw new Error(`unexpected fixture contract ${contractId}`);
}

function createDepositingDispatch(archive: WorkflowRunArchive): {
  dispatchRole: WorkflowRunRoleDispatch;
  roleIds: string[];
} {
  const roleIds: string[] = [];
  const dispatchRole: WorkflowRunRoleDispatch = async (input) => {
    roleIds.push(input.role.id);
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
  return { dispatchRole, roleIds };
}

function exhaustedBudget(): WorkflowBudgetPolicy {
  return {
    startedAtMs: 0,
    maxWallClockMs: 60_000,
    nowMs: () => 10 * 60 * 60 * 1_000,
    usage: () => ({ usageByModelProfile: {}, modelProfilePrices: {} }),
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("budget enforcement and retry controller reachable from run start (RIS-206)", () => {
  it("hard-stops a run that exceeds its wall-clock budget before the next workflow step starts", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const dataDir = await createTempDir("risoluto-budget-retry-data-");
    const workflowDir = await writeWorkflowFixture("budget-min", BUDGET_WORKFLOW);
    const archive = createWorkflowRunArchive({ dataDir });
    const { dispatchRole, roleIds } = createDepositingDispatch(archive);

    await expect(
      startAndDriveRunCommand(
        [
          "--title",
          "Over budget",
          "--intent",
          "Stop before spending implementation budget.",
          "--data-dir",
          dataDir,
          "--workflow-dir",
          workflowDir,
          "--workflow-definition",
          "budget-min",
          "--json",
        ],
        { dispatchRole, budget: exhaustedBudget(), now: () => FIXED_TIME },
      ),
    ).resolves.toBe(0);

    // The budget check runs before the first role and hard-stops the run — no role ran.
    expect(roleIds).toEqual([]);
    const runId = (await archive.listWorkflowRuns())[0]?.id ?? "";
    await expect(archive.loadWorkflowRun(runId)).resolves.toMatchObject({ status: "blocked" });
    const handoff = await archive.readWorkflowRunArtifact({ workflowRunId: runId, artifactId: "handoff" });
    const handoffData = (handoff as { data: { blockers: Array<{ message: string }> } }).data;
    expect(handoffData.blockers[0]?.message).toMatch(
      /budget exhausted: wall-clock budget exceeded before role planner/,
    );
  });

  it("triggers exactly one gate retry by default, handing it the exact gate failure evidence", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const dataDir = await createTempDir("risoluto-budget-retry-data-");
    const workflowDir = await writeWorkflowFixture("retry-gate", RETRY_WORKFLOW);
    const archive = createWorkflowRunArchive({ dataDir });
    const { dispatchRole } = createDepositingDispatch(archive);
    const retryInputs: WorkflowGateRetryInput[] = [];
    const retryGate = async (input: WorkflowGateRetryInput): Promise<Readonly<Record<string, unknown>>> => {
      retryInputs.push(input);
      return {};
    };

    await expect(
      startAndDriveRunCommand(
        [
          "--title",
          "Retry gate",
          "--intent",
          "Retry the failed gate once with its evidence.",
          "--data-dir",
          dataDir,
          "--workflow-dir",
          workflowDir,
          "--workflow-definition",
          "retry-gate",
          "--json",
        ],
        { dispatchRole, retryGate, now: () => FIXED_TIME },
      ),
    ).resolves.toBe(0);

    // Exactly one retry at the default limit, carrying the exact gate failure evidence.
    expect(retryInputs).toHaveLength(1);
    expect(retryInputs[0]?.attemptNumber).toBe(1);
    expect(retryInputs[0]?.failureEvidence).toMatchObject({
      gateId: "verifier-satisfied",
      status: "failed",
    });
    expect(retryInputs[0]?.failureEvidence.reason).toMatch(/missing required artifact verification\.v1/);

    const runId = (await archive.listWorkflowRuns())[0]?.id ?? "";
    await expect(archive.loadWorkflowRun(runId)).resolves.toMatchObject({ status: "blocked" });
    const events = await archive.readWorkflowRunEvents(runId);
    expect(events.some((event) => event.eventType === "workflow_gate.retry_requested")).toBe(true);
  });
});
