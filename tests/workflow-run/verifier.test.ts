import { describe, expect, it, vi } from "vitest";

import { parseWorkflowRunArtifact } from "../../src/workflow-run/artifact-contracts.js";
import {
  assertPublishAllowedByVerification,
  buildSingleVerifierInput,
  routeSingleVerifierDecision,
  runCouncilVerifier,
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

describe("council verifier policy", () => {
  const singleInput = buildSingleVerifierInput({
    artifacts: {
      "intent.v1": intent,
      "plan.v1": plan,
      "change_summary.v1": changeSummary,
      "review.v1": review,
    },
    evidenceLinks: ["runs/wr_verifier/evidence/review.json"],
  });

  it("records councillor decisions and synthesizer decision with a majority consensus tag", async () => {
    const result = await runCouncilVerifier({
      workflowRunId,
      createdAt,
      input: singleInput,
      councillors: [
        { id: "correctness", modelProfile: "verifier", lens: "intent satisfaction" },
        { id: "risk", modelProfile: "strong", lens: "regression risk" },
        { id: "scope", modelProfile: "verifier", lens: "scope control" },
      ],
      runCouncillor: async ({ councillor }) => ({
        status: "completed",
        decision: councillor.id === "risk" ? "not_satisfied" : "satisfied",
        summary: `${councillor.id} checked.`,
      }),
      synthesize: async () => ({
        decision: "satisfied",
        summary: "Two councillors judged the implementation satisfied.",
      }),
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") {
      throw new Error("expected council verification to complete");
    }
    expect(result.artifact).toMatchObject({
      mode: "council",
      decision: "satisfied",
      consensus: "majority",
      councillors: [
        expect.objectContaining({ id: "correctness", decision: "satisfied", status: "completed" }),
        expect.objectContaining({ id: "risk", decision: "not_satisfied", status: "completed" }),
        expect.objectContaining({ id: "scope", decision: "satisfied", status: "completed" }),
      ],
    });
    expect(
      parseWorkflowRunArtifact({
        contractId: "verification.v1",
        data: result.artifact,
        producer: { type: "role", id: "verifier" },
      }),
    ).toEqual(result.artifact);
  });

  it("records split council evidence without overriding the synthesizer decision", async () => {
    const result = await runCouncilVerifier({
      workflowRunId,
      createdAt,
      input: singleInput,
      councillors: [
        { id: "correctness", modelProfile: "verifier", lens: "intent satisfaction" },
        { id: "risk", modelProfile: "strong", lens: "regression risk" },
      ],
      runCouncillor: async ({ councillor }) => ({
        status: "completed",
        decision: councillor.id === "correctness" ? "satisfied" : "not_satisfied",
        summary: `${councillor.id} checked.`,
      }),
      synthesize: async () => ({
        decision: "satisfied",
        summary: "The split is recorded, but the synthesizer accepts the final evidence.",
      }),
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") {
      throw new Error("expected council verification to complete");
    }
    expect(result.artifact.consensus).toBe("split");
    expect(result.artifact.decision).toBe("satisfied");
    expect(() =>
      assertPublishAllowedByVerification({ artifacts: { "verification.v1": result.artifact } }),
    ).not.toThrow();
  });

  it("uses the synthesizer when only some councillors fail", async () => {
    const synthesize = vi.fn(async () => ({
      decision: "uncertain" as const,
      summary: "One councillor completed and one failed; preserve uncertainty.",
    }));

    const result = await runCouncilVerifier({
      workflowRunId,
      createdAt,
      input: singleInput,
      councillors: [
        { id: "correctness", modelProfile: "verifier", lens: "intent satisfaction" },
        { id: "risk", modelProfile: "strong", lens: "regression risk" },
      ],
      runCouncillor: async ({ councillor }) =>
        councillor.id === "risk"
          ? { status: "failed", error: "model timed out" }
          : { status: "completed", decision: "satisfied", summary: "Looks complete." },
      synthesize,
    });

    expect(result.status).toBe("completed");
    expect(synthesize).toHaveBeenCalledWith(
      expect.objectContaining({
        completedResults: [expect.objectContaining({ id: "correctness", decision: "satisfied" })],
        failedResults: [expect.objectContaining({ id: "risk", error: "model timed out" })],
      }),
    );
  });

  it("blocks when all councillors fail instead of silently passing", async () => {
    const synthesize = vi.fn(async () => ({ decision: "satisfied" as const, summary: "Should not run." }));

    const result = await runCouncilVerifier({
      workflowRunId,
      createdAt,
      input: singleInput,
      councillors: [
        { id: "correctness", modelProfile: "verifier", lens: "intent satisfaction" },
        { id: "risk", modelProfile: "strong", lens: "regression risk" },
      ],
      runCouncillor: async ({ councillor }) => ({ status: "failed", error: `${councillor.id} failed` }),
      synthesize,
    });

    expect(result).toEqual({
      status: "blocked",
      reason: "all_councillors_failed",
      failedResults: [
        expect.objectContaining({ id: "correctness", error: "correctness failed" }),
        expect.objectContaining({ id: "risk", error: "risk failed" }),
      ],
    });
    expect(synthesize).not.toHaveBeenCalled();
  });
});
