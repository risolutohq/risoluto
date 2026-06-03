import { describe, expect, it } from "vitest";

import { parseWorkflowRunArtifact } from "../../src/workflow-run/artifact-contracts.js";
import { evaluateCiBabysitter } from "../../src/workflow-run/ci-babysitter.js";
import { evaluatePrPublishPolicy } from "../../src/workflow-run/publish-policy.js";

const workflowRunId = "wr_ci_babysitter";
const createdAt = "2026-05-31T23:00:00.000Z";

describe("CI babysitter", () => {
  it("routes code-caused CI failures back to implementation when retry budget remains", () => {
    const result = evaluateCiBabysitter({
      workflowRunId,
      createdAt,
      provider: "github_actions",
      retryBudgetRemaining: 1,
      rerunsAllowed: true,
      checks: [
        {
          id: "test",
          name: "unit tests",
          status: "failed",
          classification: "code_failure",
          logEvidence: "AssertionError in cache.test.ts",
        },
      ],
    });

    expect(result).toMatchObject({
      status: "failed",
      route: "retry_implementation",
      summary: "unit tests failed because code changed behavior",
      logSummary: "AssertionError in cache.test.ts",
    });
    expect(parseWorkflowRunArtifact({ contractId: "ci_result.v1", data: result })).toEqual(result);
  });

  it("turns CI timeouts into structured blocked evidence", () => {
    const result = evaluateCiBabysitter({
      workflowRunId,
      createdAt,
      provider: "github_actions",
      retryBudgetRemaining: 1,
      rerunsAllowed: true,
      checks: [{ id: "build", name: "build", status: "timed_out", classification: "timeout" }],
    });

    expect(result).toMatchObject({
      status: "blocked",
      route: "block_operator",
      blockedEvidence: { kind: "timeout", checkId: "build" },
    });
  });

  it("turns unavailable providers into structured blocked evidence", () => {
    const result = evaluateCiBabysitter({
      workflowRunId,
      createdAt,
      provider: "github_actions",
      retryBudgetRemaining: 1,
      rerunsAllowed: true,
      checks: [
        {
          id: "actions-api",
          name: "GitHub Actions API",
          status: "unavailable",
          classification: "provider_unavailable",
          logEvidence: "503 from GitHub Actions",
        },
      ],
    });

    expect(result).toMatchObject({
      status: "blocked",
      route: "block_operator",
      blockedEvidence: { kind: "provider_unavailable", checkId: "actions-api", summary: "503 from GitHub Actions" },
      logSummary: "503 from GitHub Actions",
    });
  });

  it("requests a rerun for likely flaky checks when reruns are allowed", () => {
    const result = evaluateCiBabysitter({
      workflowRunId,
      createdAt,
      provider: "github_actions",
      retryBudgetRemaining: 1,
      rerunsAllowed: true,
      checks: [{ id: "integration", name: "integration", status: "failed", classification: "flaky" }],
    });

    expect(result).toMatchObject({
      status: "rerun_requested",
      route: "rerun_ci",
      summary: "integration looks flaky; rerun requested",
    });
  });

  it("records pending checks without treating remote CI as green", () => {
    const result = evaluateCiBabysitter({
      workflowRunId,
      createdAt,
      provider: "github_actions",
      retryBudgetRemaining: 1,
      rerunsAllowed: true,
      checks: [{ id: "deploy-preview", name: "deploy preview", status: "pending", classification: "unknown" }],
    });

    expect(result).toMatchObject({
      status: "pending",
      route: "wait_for_ci",
      summary: "deploy preview is still pending",
    });
  });

  it("continues after all CI checks pass", () => {
    const result = evaluateCiBabysitter({
      workflowRunId,
      createdAt,
      provider: "github_actions",
      retryBudgetRemaining: 1,
      rerunsAllowed: true,
      checks: [{ id: "build", name: "build", status: "passed", classification: "unknown" }],
    });

    expect(result).toMatchObject({
      status: "passed",
      route: "continue",
      summary: "all CI checks passed",
      logSummary: null,
    });
  });

  it("blocks with 'no checks observed' evidence when the check list is empty (NIN-260)", () => {
    const result = evaluateCiBabysitter({
      workflowRunId,
      createdAt,
      provider: "github_actions",
      retryBudgetRemaining: 1,
      rerunsAllowed: true,
      checks: [],
    });

    // An empty check list must never read as "all CI passed".
    expect(result.status).toBe("blocked");
    expect(result.route).toBe("block_operator");
    expect(result).toMatchObject({
      summary: "no CI checks were observed",
      blockedEvidence: { kind: "provider_unavailable", checkId: "no-checks-observed" },
    });
    expect(parseWorkflowRunArtifact({ contractId: "ci_result.v1", data: result })).toEqual(result);
  });

  it("requires ci_result.v1 before ready and auto_merge publish modes can complete", () => {
    for (const requestedMode of ["ready", "auto_merge"] as const) {
      const result = evaluatePrPublishPolicy({
        workflowRunId,
        createdAt,
        requestedMode,
        validation: { status: "passed" },
        verification: { decision: "satisfied" },
        ci: null,
        operatorApproval: { permission: "approve_auto_merge" },
        mergePolicy: { status: "passed" },
      });

      expect(result).toMatchObject({
        mode: requestedMode,
        status: "blocked",
        reason: "ci_result_required",
      });
    }
  });
});
