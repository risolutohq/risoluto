import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createWorkflowRunArchive } from "../../src/workflow-run/archive.js";
import { completeAutoMergeForRun } from "../../src/workflow-run/auto-merge-post-run.js";

/**
 * NIN-272 reachability: the post-run completion gate reads the run's archived gates and routes them through
 * `completeAutoMerge`. These drive `completeAutoMergeForRun` against a REAL archive (not a direct
 * `completeAutoMerge` call), so the no-approval block and the full-preconditions merge are enforced by the
 * real completion path, not dead code.
 */
const workflowRunId = "wr_auto_merge";
const createdAt = "2026-06-04T17:00:00.000Z";
const pullRequest = { owner: "risolutohq", repo: "risoluto", pullNumber: 99 };

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "risoluto-auto-merge-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

function publishResult(): Record<string, unknown> {
  return {
    version: 1,
    workflowRunId,
    createdAt,
    mode: "auto_merge",
    status: "published",
    draft: false,
    autoMerge: true,
    pullRequestUrl: "https://github.com/risolutohq/risoluto/pull/99",
    reason: "auto-merge publish allowed",
    checks: [],
  };
}

function ciResult(): Record<string, unknown> {
  return {
    version: 1,
    workflowRunId,
    createdAt,
    provider: "github_actions",
    status: "passed",
    route: "continue",
    summary: "all checks passed",
    logSummary: null,
    checks: [],
    blockedEvidence: null,
  };
}

function verification(): Record<string, unknown> {
  return {
    version: 1,
    workflowRunId,
    createdAt,
    mode: "single",
    decision: "satisfied",
    summary: "verified",
    allowedInputs: [],
    evidenceLinks: [],
    postPublishReconfirm: {
      required: true,
      prePublishDecision: "satisfied",
      decision: "satisfied",
      summary: "reconfirmed after publish",
      checkedInputs: ["publish_result.v1", "ci_result.v1"],
      contradictedBy: [],
    },
  };
}

function operatorApproval(): Record<string, unknown> {
  return {
    version: 1,
    workflowRunId,
    createdAt,
    source: "slack",
    operator: { id: "op-1", slackUserId: "U123" },
    permission: "approve_auto_merge",
    actionId: "auto-merge-pr",
    nonce: "nonce-abc",
    slack: { teamId: "T1", userId: "U123" },
  };
}

function mergePolicyResult(): Record<string, unknown> {
  return { version: 1, workflowRunId, createdAt, status: "passed", mergeMethod: "squash" };
}

async function seedArtifacts(
  artifacts: ReadonlyArray<{ artifactId: string; contractId: string; data: unknown }>,
): Promise<void> {
  const archive = createWorkflowRunArchive({ dataDir });
  for (const artifact of artifacts) {
    await archive.writeWorkflowRunArtifact({
      workflowRunId,
      artifactId: artifact.artifactId,
      contractId: artifact.contractId,
      data: artifact.data,
      producer: { type: "action", id: "test" },
    });
  }
}

describe("completeAutoMergeForRun (NIN-272)", () => {
  it("stays blocked and does not merge when no operator approval is recorded", async () => {
    // Every precondition EXCEPT the operator approval is satisfied.
    await seedArtifacts([
      { artifactId: "publish_result", contractId: "publish_result.v1", data: publishResult() },
      { artifactId: "ci_result", contractId: "ci_result.v1", data: ciResult() },
      { artifactId: "verification", contractId: "verification.v1", data: verification() },
      { artifactId: "merge_policy_result", contractId: "merge_policy_result.v1", data: mergePolicyResult() },
    ]);
    const requestAutoMerge = vi.fn(async () => {});

    const result = await completeAutoMergeForRun({ dataDir, workflowRunId, pullRequest, requestAutoMerge });

    expect(result).toEqual({ status: "blocked", reason: "operator_approval_required" });
    expect(requestAutoMerge).not.toHaveBeenCalled();
  });

  it("completes the merge through completeAutoMerge when CI is green, the post-publish verifier is satisfied, and approval is recorded", async () => {
    await seedArtifacts([
      { artifactId: "publish_result", contractId: "publish_result.v1", data: publishResult() },
      { artifactId: "ci_result", contractId: "ci_result.v1", data: ciResult() },
      { artifactId: "verification", contractId: "verification.v1", data: verification() },
      { artifactId: "operator_approval", contractId: "operator_approval.v1", data: operatorApproval() },
      { artifactId: "merge_policy_result", contractId: "merge_policy_result.v1", data: mergePolicyResult() },
    ]);
    const requestAutoMerge = vi.fn(async () => {});

    const result = await completeAutoMergeForRun({ dataDir, workflowRunId, pullRequest, requestAutoMerge });

    expect(result).toEqual({ status: "merge_requested", approvalNonce: "nonce-abc" });
    expect(requestAutoMerge).toHaveBeenCalledWith({ ...pullRequest, mergeMethod: "squash" });
  });
});
