/**
 * NIN-75 hermetic wiring: drives `startAndDriveRunCommand` with `--publish-mode auto_merge` through
 * a FAKE merge client + FAKE dispatchRole, asserting:
 *
 * (a) `merge_policy_result.v1` is persisted to the run archive at publish time (the evaluateMergePolicy
 *     seam is called and its result is written).
 * (b) The `requestAutoMerge` fake is called on the done path with the parsed PR coordinates when all
 *     gates pass (verification satisfied, CI green, merge policy passed, operator approval present).
 * (c) `requestAutoMerge` is NOT called when operator approval is absent: the publish policy blocks at
 *     `operator_approval_required`, so `publish_result.v1.autoMerge === false`, and the post-run
 *     completion gate returns `auto_merge_publish_not_ready` without requesting the merge.
 *
 * These three cases together prove CLI → auto-merge-gate reachability from the `run start` entry point.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { startAndDriveRunCommand } from "../../src/cli/run-start-command.js";
import { createWorkflowRunArchive, type WorkflowRunArchive } from "../../src/workflow-run/archive.js";
import {
  workflowRunArtifactIdForContract,
  type WorkflowRunRoleDispatch,
} from "../../src/workflow-run/run-role-runner.js";

const FIXED_TIME = "2026-06-01T12:00:00.000Z";
const FAKE_PR_URL = "https://github.com/risolutohq/risoluto/pull/42";
const tempDirs: string[] = [];

// Workflow with operator approval: all artifacts the publish-pr action needs for auto_merge.
const WORKFLOW_WITH_APPROVAL = `
version: 1
id: auto-merge-with-approval
defaults: {}
states:
  - id: prep
    roles:
      - id: planner
        consumes: [intent.v1]
        produces: [verification.v1, validation_result.v1, ci_result.v1, operator_approval.v1]
        dependsOn: []
    gates: []
    hooks: []
actions: [publish-pr]
`;

// Workflow without operator approval: same structure but the role does not produce an approval.
const WORKFLOW_NO_APPROVAL = `
version: 1
id: auto-merge-no-approval
defaults: {}
states:
  - id: prep
    roles:
      - id: planner
        consumes: [intent.v1]
        produces: [verification.v1, validation_result.v1, ci_result.v1]
        dependsOn: []
    gates: []
    hooks: []
actions: [publish-pr]
`;

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeWorkflowFixtures(workflowDir: string): Promise<void> {
  await mkdir(workflowDir, { recursive: true });
  await writeFile(path.join(workflowDir, "auto-merge-with-approval.yaml"), WORKFLOW_WITH_APPROVAL.trimStart(), "utf8");
  await writeFile(path.join(workflowDir, "auto-merge-no-approval.yaml"), WORKFLOW_NO_APPROVAL.trimStart(), "utf8");
}

function buildSeedArtifact(contractId: string, workflowRunId: string): Record<string, unknown> {
  const base = { version: 1, workflowRunId, createdAt: FIXED_TIME };
  if (contractId === "verification.v1") {
    return {
      ...base,
      mode: "single",
      decision: "satisfied",
      summary: "verifier satisfied (hermetic seed)",
      allowedInputs: [],
      evidenceLinks: [],
    };
  }
  if (contractId === "validation_result.v1") {
    return {
      ...base,
      profileId: "offline-smoke",
      failureHandling: "stop_on_first",
      status: "passed",
      checks: [{ id: "smoke", command: "true", status: "passed", exitCode: 0, stdout: "", stderr: "", durationMs: 1 }],
    };
  }
  if (contractId === "ci_result.v1") {
    return {
      ...base,
      provider: "github_actions",
      status: "passed",
      route: "continue",
      summary: "CI green (hermetic seed)",
      logSummary: null,
      checks: [],
      blockedEvidence: null,
    };
  }
  if (contractId === "operator_approval.v1") {
    return {
      ...base,
      source: "slack",
      operator: { id: "op-hermetic", slackUserId: "U0HERMETIC" },
      permission: "approve_auto_merge",
      actionId: "auto-merge-pr",
      nonce: "hermetic-nonce-42",
      slack: { teamId: null, userId: "U0HERMETIC" },
    };
  }
  throw new Error(`hermetic seed has no fixture for contract ${contractId}`);
}

function createSeedDispatch(archive: WorkflowRunArchive): WorkflowRunRoleDispatch {
  return async (input) => {
    for (const contractId of input.role.produces) {
      await archive.writeWorkflowRunArtifact({
        workflowRunId: input.workflowRunId,
        contractId,
        artifactId: workflowRunArtifactIdForContract(contractId),
        data: buildSeedArtifact(contractId, input.workflowRunId),
        producer: { type: "role", id: input.role.id },
      });
    }
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("NIN-75 auto-merge gate wiring from `run start` (hermetic)", () => {
  it("(a)+(b) persists merge_policy_result.v1 and calls requestAutoMerge when all gates pass", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const dataDir = await makeTempDir("risoluto-am-data-");
    const workflowDir = await makeTempDir("risoluto-am-workflows-");
    await writeWorkflowFixtures(workflowDir);
    const archive = createWorkflowRunArchive({ dataDir });
    const requestAutoMerge = vi
      .fn<[{ owner: string; repo: string; pullNumber: number; mergeMethod: string }], Promise<void>>()
      .mockResolvedValue(undefined);

    const exitCode = await startAndDriveRunCommand(
      [
        "--title",
        "Auto-merge hermetic",
        "--intent",
        "Test NIN-75 end-to-end wiring.",
        "--data-dir",
        dataDir,
        "--workflow-dir",
        workflowDir,
        "--workflow-definition",
        "auto-merge-with-approval",
        "--publish-mode",
        "auto_merge",
        "--json",
      ],
      {
        dispatchRole: createSeedDispatch(archive),
        now: () => FIXED_TIME,
        mergePolicyForPublish: vi.fn().mockResolvedValue({ status: "passed", mergeMethod: "squash" }),
        publishOnDone: vi.fn().mockResolvedValue({ pullRequestUrl: FAKE_PR_URL }),
        requestAutoMerge,
      },
    );

    expect(exitCode).toBe(0);

    const runId = (await archive.listWorkflowRuns())[0]?.id ?? "";
    await expect(archive.loadWorkflowRun(runId)).resolves.toMatchObject({ status: "done" });

    // (a) merge_policy_result.v1 was persisted at publish time.
    const policyArtifact = await archive.readWorkflowRunArtifact({
      workflowRunId: runId,
      artifactId: "merge_policy_result",
    });
    expect(policyArtifact.contractId).toBe("merge_policy_result.v1");
    expect(policyArtifact.data).toMatchObject({ status: "passed", mergeMethod: "squash" });

    // (b) requestAutoMerge was called with the parsed PR coordinates.
    expect(requestAutoMerge).toHaveBeenCalledOnce();
    expect(requestAutoMerge).toHaveBeenCalledWith({
      owner: "risolutohq",
      repo: "risoluto",
      pullNumber: 42,
      mergeMethod: "squash",
    });
  });

  it("(c) does NOT call requestAutoMerge when operator approval is absent (publish policy blocks)", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const dataDir = await makeTempDir("risoluto-am-noapproval-data-");
    const workflowDir = await makeTempDir("risoluto-am-noapproval-workflows-");
    await writeWorkflowFixtures(workflowDir);
    const archive = createWorkflowRunArchive({ dataDir });
    const requestAutoMerge = vi
      .fn<[{ owner: string; repo: string; pullNumber: number; mergeMethod: string }], Promise<void>>()
      .mockResolvedValue(undefined);

    // publishOnDone returns a URL (simulating a real git push), but the publish POLICY blocked at
    // operator_approval_required, so publish_result.v1.autoMerge === false. The post-run gate then
    // blocks at auto_merge_publish_not_ready and never calls requestAutoMerge.
    const exitCode = await startAndDriveRunCommand(
      [
        "--title",
        "Auto-merge no approval",
        "--intent",
        "Test NIN-75 blocked path.",
        "--data-dir",
        dataDir,
        "--workflow-dir",
        workflowDir,
        "--workflow-definition",
        "auto-merge-no-approval",
        "--publish-mode",
        "auto_merge",
        "--json",
      ],
      {
        dispatchRole: createSeedDispatch(archive),
        now: () => FIXED_TIME,
        mergePolicyForPublish: vi.fn().mockResolvedValue({ status: "passed", mergeMethod: "squash" }),
        publishOnDone: vi.fn().mockResolvedValue({ pullRequestUrl: FAKE_PR_URL }),
        requestAutoMerge,
      },
    );

    expect(exitCode).toBe(0);

    const runId = (await archive.listWorkflowRuns())[0]?.id ?? "";
    await expect(archive.loadWorkflowRun(runId)).resolves.toMatchObject({ status: "done" });

    // Publish policy blocked at operator_approval_required; auto-merge gate stays blocked.
    const publishArtifact = await archive.readWorkflowRunArtifact({
      workflowRunId: runId,
      artifactId: "publish_result",
    });
    expect(publishArtifact.data).toMatchObject({ mode: "auto_merge", autoMerge: false });

    // (c) requestAutoMerge is never reached.
    expect(requestAutoMerge).not.toHaveBeenCalled();
  });
});
