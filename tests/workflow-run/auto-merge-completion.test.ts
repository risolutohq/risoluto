import { describe, expect, it, vi } from "vitest";

import { completeAutoMerge, type AutoMergeCompletionInput } from "../../src/workflow-run/auto-merge-completion.js";

const workflowRunId = "wr_auto_merge";
const createdAt = "2026-06-01T00:45:00.000Z";

describe("auto-merge completion", () => {
  it("requests auto-merge only when every composed precondition is satisfied", async () => {
    const requestAutoMerge = vi.fn(async () => undefined);
    const result = await completeAutoMerge(makeInput({ requestAutoMerge }));

    expect(result).toEqual({ status: "merge_requested", approvalNonce: "nonce-1" });
    expect(requestAutoMerge).toHaveBeenCalledWith({
      owner: "risolutohq",
      repo: "risoluto",
      pullNumber: 42,
      mergeMethod: "squash",
    });
  });

  it("blocks instead of merging when any single required precondition is missing", async () => {
    const cases = [
      {
        name: "ci",
        input: makeInput({ ci: { status: "failed" } }),
        reason: "ci_not_green",
      },
      {
        name: "auto-merge publish result",
        input: makeInput({ publish: { ...readyAutoMergePublish(), status: "blocked", autoMerge: false } }),
        reason: "auto_merge_publish_not_ready",
      },
      {
        name: "post-publish verifier",
        input: makeInput({ postPublishVerification: postPublishVerification("not_satisfied") }),
        reason: "post_publish_verifier_not_satisfied",
      },
      {
        name: "merge policy",
        input: makeInput({ mergePolicy: { status: "failed" } }),
        reason: "merge_policy_not_satisfied",
      },
      {
        name: "operator approval",
        input: makeInput({ operatorApproval: null }),
        reason: "operator_approval_required",
      },
    ] as const;

    for (const scenario of cases) {
      const result = await completeAutoMerge(scenario.input);

      expect(result, scenario.name).toEqual({ status: "blocked", reason: scenario.reason });
      expect(scenario.input.requestAutoMerge, scenario.name).not.toHaveBeenCalled();
    }
  });

  it("blocks stale or duplicate approval nonces without requesting a merge", async () => {
    const input = makeInput({ consumedApprovalNonces: ["nonce-1"] });

    const result = await completeAutoMerge(input);

    expect(result).toEqual({ status: "blocked", reason: "approval_nonce_already_consumed" });
    expect(input.requestAutoMerge).not.toHaveBeenCalled();
  });
});

function makeInput(overrides: {
  readonly ci?: AutoMergeCompletionInput["ci"];
  readonly consumedApprovalNonces?: readonly string[];
  readonly mergePolicy?: AutoMergeCompletionInput["mergePolicy"];
  readonly operatorApproval?: AutoMergeCompletionInput["operatorApproval"];
  readonly postPublishVerification?: AutoMergeCompletionInput["postPublishVerification"];
  readonly publish?: AutoMergeCompletionInput["publish"];
  readonly requestAutoMerge?: AutoMergeCompletionInput["requestAutoMerge"];
}): AutoMergeCompletionInput {
  return {
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
    consumedApprovalNonces: overrides.consumedApprovalNonces ?? [],
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
