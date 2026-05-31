import { describe, expect, it } from "vitest";

import { parseWorkflowRunArtifact } from "../../src/workflow-run/artifact-contracts.js";
import { reconfirmPostPublishVerification } from "../../src/workflow-run/post-publish-verifier.js";

const workflowRunId = "wr_post_publish_verifier";
const createdAt = "2026-06-01T00:30:00.000Z";

const prePublishVerification = {
  version: 1,
  workflowRunId,
  createdAt,
  mode: "single",
  decision: "satisfied",
  summary: "Pre-publish verifier accepted the change.",
  allowedInputs: ["intent.v1", "review.v1", "validation_result.v1"],
  evidenceLinks: ["runs/wr_post_publish_verifier/evidence/pre-publish.json"],
} as const;

describe("post-publish verifier reconfirm", () => {
  it("skips draft and none publish modes so they keep the pre-publish pass only", () => {
    for (const mode of ["draft", "none"] as const) {
      const result = reconfirmPostPublishVerification({
        verification: prePublishVerification,
        publish: { mode, status: mode === "none" ? "not_published" : "published", pullRequestUrl: null },
        ci: null,
        handoff: null,
      });

      expect(result).toEqual({
        status: "skipped",
        reason: "mode_not_requiring_reconfirm",
        artifact: prePublishVerification,
      });
    }
  });

  it("keeps the pre-publish verdict when ready-mode evidence does not contradict it", () => {
    const result = reconfirmPostPublishVerification({
      verification: prePublishVerification,
      publish: { mode: "ready", status: "published", pullRequestUrl: "https://github.com/acme/repo/pull/1" },
      ci: { status: "passed" },
      handoff: { outcome: "done" },
    });

    expect(result.status).toBe("completed");
    expect(result.artifact).toMatchObject({
      decision: "satisfied",
      postPublishReconfirm: {
        required: true,
        prePublishDecision: "satisfied",
        decision: "satisfied",
        contradictedBy: [],
      },
    });
    expect(parseWorkflowRunArtifact({ contractId: "verification.v1", data: result.artifact })).toEqual(result.artifact);
  });

  it("flips only when new CI, PR, or handoff evidence contradicts the pre-publish verdict", () => {
    const result = reconfirmPostPublishVerification({
      verification: prePublishVerification,
      publish: { mode: "auto_merge", status: "blocked", pullRequestUrl: null },
      ci: { status: "failed" },
      handoff: { outcome: "blocked" },
    });

    expect(result.status).toBe("completed");
    expect(result.artifact).toMatchObject({
      decision: "not_satisfied",
      postPublishReconfirm: {
        required: true,
        prePublishDecision: "satisfied",
        decision: "not_satisfied",
        checkedInputs: ["publish_result.v1", "ci_result.v1", "handoff.v1"],
        contradictedBy: ["publish_result.v1", "ci_result.v1", "handoff.v1"],
      },
    });
  });
});
