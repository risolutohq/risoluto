import { describe, expect, it } from "vitest";

import { parseWorkflowRunArtifact } from "../../src/workflow-run/artifact-contracts.js";
import {
  assertPublishAllowedByVerification,
  buildSingleVerifierInput,
  routeSingleVerifierDecision,
  VerifierPolicyError,
} from "../../src/workflow-run/verifier.js";

const workflowRunId = "wr_verifier";
const createdAt = "2026-05-31T17:30:00.000Z";

const intent = {
  version: 1,
  workflowRunId,
  createdAt,
  source: "cli",
  title: "Fix cache",
  body: "Fix cache invalidation without changing public API.",
  externalReferences: [],
};

const plan = {
  version: 1,
  workflowRunId,
  createdAt,
  summary: "Patch cache invalidation.",
  steps: [{ id: "implement", title: "Patch cache", status: "ready", dependsOn: [] }],
};

const changeSummary = {
  version: 1,
  workflowRunId,
  createdAt,
  summary: "Changed cache invalidation.",
  changedFiles: [{ path: "src/cache.ts", changeType: "modified", summary: "Invalidates on write." }],
};

const review = {
  version: 1,
  workflowRunId,
  createdAt,
  verdict: "pass",
  findings: [],
};

const satisfiedVerification = {
  version: 1,
  workflowRunId,
  createdAt,
  mode: "single",
  decision: "satisfied",
  summary: "The change satisfies the original intent.",
  allowedInputs: ["intent.v1", "plan.v1", "change_summary.v1", "review.v1"],
  evidenceLinks: ["runs/wr_verifier/evidence/review.json"],
};

describe("single verifier policy", () => {
  it("builds a fixed allowlist and excludes the implementer transcript", () => {
    const input = buildSingleVerifierInput({
      artifacts: {
        "intent.v1": intent,
        "plan.v1": plan,
        "change_summary.v1": changeSummary,
        "review.v1": review,
        "validation_result.v1": { status: "passed" },
        implementer_transcript: "secret implementation narrative",
      },
      diff: "diff --git a/src/cache.ts b/src/cache.ts",
      evidenceLinks: ["runs/wr_verifier/evidence/validation.log"],
    });

    expect(Object.keys(input.artifacts)).toEqual([
      "intent.v1",
      "plan.v1",
      "change_summary.v1",
      "review.v1",
      "validation_result.v1",
    ]);
    expect(input.diff).toBe("diff --git a/src/cache.ts b/src/cache.ts");
    expect(JSON.stringify(input)).not.toContain("secret implementation narrative");
  });

  it("routes not_satisfied back to implementation when retry budget remains", () => {
    const route = routeSingleVerifierDecision({ decision: "not_satisfied", retryBudgetRemaining: 1 });

    expect(route).toEqual({ action: "retry_implementation", reason: "verifier_not_satisfied" });
  });

  it("blocks publishing until satisfied verification exists", () => {
    expect(() => assertPublishAllowedByVerification({ artifacts: { "review.v1": review } })).toThrow(
      VerifierPolicyError,
    );
    expect(() =>
      assertPublishAllowedByVerification({ artifacts: { "verification.v1": satisfiedVerification } }),
    ).not.toThrow();
  });

  it("parses verification.v1 as the single verifier contract", () => {
    expect(
      parseWorkflowRunArtifact({
        contractId: "verification.v1",
        data: satisfiedVerification,
        producer: { type: "role", id: "verifier" },
      }),
    ).toEqual(satisfiedVerification);
  });
});
