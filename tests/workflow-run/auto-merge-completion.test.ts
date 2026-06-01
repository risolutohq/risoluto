import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { completeAutoMerge, type AutoMergeCompletionInput } from "../../src/workflow-run/auto-merge-completion.js";

const workflowRunId = "wr_auto_merge";
const createdAt = "2026-06-01T00:45:00.000Z";
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "risoluto-auto-merge-"));
  tempDirs.push(dir);
  return dir;
}

describe("auto-merge completion", () => {
  it("requests auto-merge only when every composed precondition is satisfied", async () => {
    const dataDir = await createTempDir();
    const requestAutoMerge = vi.fn(async () => undefined);
    const result = await completeAutoMerge(makeInput({ dataDir, requestAutoMerge }));

    expect(result).toEqual({ status: "merge_requested", approvalNonce: "nonce-1" });
    expect(requestAutoMerge).toHaveBeenCalledWith({
      owner: "risolutohq",
      repo: "risoluto",
      pullNumber: 42,
      mergeMethod: "squash",
    });
  });

  it("blocks instead of merging when any single required precondition is missing", async () => {
    const dataDir = await createTempDir();
    const cases = [
      { name: "ci", input: makeInput({ dataDir, ci: { status: "failed" } }), reason: "ci_not_green" },
      { name: "ci result missing", input: makeInput({ dataDir, ci: null }), reason: "ci_not_green" },
      {
        name: "post-publish reconfirm not required",
        input: makeInput({
          dataDir,
          postPublishVerification: {
            decision: "satisfied",
            postPublishReconfirm: {
              required: false,
              prePublishDecision: "satisfied",
              decision: "satisfied",
              summary: "no reconfirm performed",
              checkedInputs: [],
              contradictedBy: [],
            },
          },
        }),
        reason: "post_publish_verifier_not_satisfied",
      },
      {
        name: "auto-merge publish result",
        input: makeInput({ dataDir, publish: { ...readyAutoMergePublish(), status: "blocked", autoMerge: false } }),
        reason: "auto_merge_publish_not_ready",
      },
      {
        name: "post-publish verifier",
        input: makeInput({ dataDir, postPublishVerification: postPublishVerification("not_satisfied") }),
        reason: "post_publish_verifier_not_satisfied",
      },
      {
        name: "merge policy",
        input: makeInput({ dataDir, mergePolicy: { status: "failed" } }),
        reason: "merge_policy_not_satisfied",
      },
      {
        name: "operator approval",
        input: makeInput({ dataDir, operatorApproval: null }),
        reason: "operator_approval_required",
      },
    ] as const;

    for (const scenario of cases) {
      const result = await completeAutoMerge(scenario.input);

      expect(result, scenario.name).toEqual({ status: "blocked", reason: scenario.reason });
      expect(scenario.input.requestAutoMerge, scenario.name).not.toHaveBeenCalled();
    }
  });

  it("blocks a replayed approval nonce after the first merge via the atomic consumed-nonce sentinel", async () => {
    const dataDir = await createTempDir();
    const input = makeInput({ dataDir });

    const first = await completeAutoMerge(input);
    const second = await completeAutoMerge(input);

    expect(first).toEqual({ status: "merge_requested", approvalNonce: "nonce-1" });
    expect(second).toEqual({ status: "blocked", reason: "approval_nonce_already_consumed" });
    expect(input.requestAutoMerge).toHaveBeenCalledTimes(1);
  });

  it("blocks concurrent duplicate approval taps atomically — only one merge is requested", async () => {
    const dataDir = await createTempDir();
    const input = makeInput({ dataDir });

    const results = await Promise.all([completeAutoMerge(input), completeAutoMerge(input)]);

    expect(results.filter((result) => result.status === "merge_requested")).toHaveLength(1);
    expect(results.filter((result) => result.status === "blocked")).toEqual([
      { status: "blocked", reason: "approval_nonce_already_consumed" },
    ]);
    expect(input.requestAutoMerge).toHaveBeenCalledTimes(1);
  });
});

function makeInput(overrides: {
  readonly dataDir: string;
  readonly ci?: AutoMergeCompletionInput["ci"];
  readonly mergePolicy?: AutoMergeCompletionInput["mergePolicy"];
  readonly operatorApproval?: AutoMergeCompletionInput["operatorApproval"];
  readonly postPublishVerification?: AutoMergeCompletionInput["postPublishVerification"];
  readonly publish?: AutoMergeCompletionInput["publish"];
  readonly requestAutoMerge?: AutoMergeCompletionInput["requestAutoMerge"];
}): AutoMergeCompletionInput {
  return {
    dataDir: overrides.dataDir,
    workflowRunId,
    pullRequest: { owner: "risolutohq", repo: "risoluto", pullNumber: 42 },
    mergeMethod: "squash",
    publish: overrides.publish ?? readyAutoMergePublish(),
    ci:
      "ci" in overrides
        ? overrides.ci
        : ({
            version: 1,
            workflowRunId,
            createdAt,
            provider: "github_actions",
            status: "passed",
            route: "continue",
            summary: "all CI checks passed",
            logSummary: null,
            checks: [],
            blockedEvidence: null,
          } as const),
    postPublishVerification:
      "postPublishVerification" in overrides ? overrides.postPublishVerification : postPublishVerification("satisfied"),
    mergePolicy: "mergePolicy" in overrides ? overrides.mergePolicy : ({ status: "passed" } as const),
    operatorApproval:
      "operatorApproval" in overrides
        ? overrides.operatorApproval
        : ({
            version: 1,
            workflowRunId,
            createdAt,
            source: "slack",
            operator: { id: "operator-omer", slackUserId: "U_OK" },
            permission: "approve_auto_merge",
            actionId: "auto-merge-pr",
            nonce: "nonce-1",
            slack: { teamId: "T_OK", userId: "U_OK" },
          } as const),
    requestAutoMerge: overrides.requestAutoMerge ?? vi.fn(async () => undefined),
  };
}

function readyAutoMergePublish(): AutoMergeCompletionInput["publish"] {
  return {
    version: 1,
    workflowRunId,
    createdAt,
    mode: "auto_merge",
    status: "published",
    draft: false,
    autoMerge: true,
    pullRequestUrl: "https://github.com/risolutohq/risoluto/pull/42",
    reason: "auto_merge_allowed",
    checks: [],
  };
}

function postPublishVerification(
  decision: "not_satisfied" | "satisfied",
): NonNullable<AutoMergeCompletionInput["postPublishVerification"]> {
  return {
    decision,
    postPublishReconfirm: {
      required: true,
      prePublishDecision: "satisfied",
      decision,
      summary: "Post-publish evidence reconfirmed satisfied.",
      checkedInputs: ["publish_result.v1", "ci_result.v1", "handoff.v1"],
      contradictedBy: decision === "satisfied" ? [] : ["ci_result.v1"],
    },
  };
}
