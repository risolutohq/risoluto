import { describe, expect, it } from "vitest";

import { parseWorkflowRunArtifact } from "../../src/workflow-run/artifact-contracts.js";
import { evaluatePrPublishPolicy } from "../../src/workflow-run/publish-policy.js";

const workflowRunId = "wr_publish_policy";
const createdAt = "2026-05-31T22:30:00.000Z";

describe("PR publishing policy", () => {
  it("refuses ready publishing when local validation is red even if verification is satisfied", () => {
    const result = evaluatePrPublishPolicy({
      workflowRunId,
      createdAt,
      requestedMode: "ready",
      validation: { status: "failed" },
      verification: { decision: "satisfied" },
      ci: null,
      operatorApproval: null,
      mergePolicy: null,
    });

    expect(result).toMatchObject({
      mode: "ready",
      status: "blocked",
      reason: "local_validation_failed",
      checks: expect.arrayContaining([expect.objectContaining({ id: "local_validation", status: "failed" })]),
    });
    expect(parseWorkflowRunArtifact({ contractId: "publish_result.v1", data: result })).toEqual(result);
  });

  it("defaults to draft PR publishing when no explicit mode is configured", () => {
    const result = evaluatePrPublishPolicy({
      workflowRunId,
      createdAt,
      validation: { status: "passed" },
      verification: { decision: "satisfied" },
      ci: null,
      operatorApproval: null,
      mergePolicy: null,
    });

    expect(result).toMatchObject({
      mode: "draft",
      status: "published",
      draft: true,
      autoMerge: false,
      reason: "draft_publish_allowed",
    });
  });

  it("blocks auto-merge when operator approval has not been recorded", () => {
    const result = evaluatePrPublishPolicy({
      workflowRunId,
      createdAt,
      requestedMode: "auto_merge",
      validation: { status: "passed" },
      verification: { decision: "satisfied" },
      ci: { status: "passed" },
      operatorApproval: null,
      mergePolicy: { status: "passed" },
    });

    expect(result).toMatchObject({
      mode: "auto_merge",
      status: "blocked",
      reason: "operator_approval_required",
      checks: expect.arrayContaining([expect.objectContaining({ id: "operator_approval", status: "failed" })]),
    });
  });

  it("accepts an incomplete_draft approved with the lower-risk approve_pr_create permission", () => {
    const result = evaluatePrPublishPolicy({
      workflowRunId,
      createdAt,
      requestedMode: "incomplete_draft",
      validation: { status: "passed" },
      verification: null,
      ci: null,
      operatorApproval: { permission: "approve_pr_create" },
      mergePolicy: null,
    });

    expect(result).toMatchObject({
      mode: "incomplete_draft",
      status: "blocked",
      draft: true,
      reason: "incomplete_draft_requires_followup",
      checks: expect.arrayContaining([expect.objectContaining({ id: "operator_approval", status: "passed" })]),
    });
  });

  it("does not let the lower-risk approve_pr_create permission satisfy an auto_merge approval", () => {
    const result = evaluatePrPublishPolicy({
      workflowRunId,
      createdAt,
      requestedMode: "auto_merge",
      validation: { status: "passed" },
      verification: { decision: "satisfied" },
      ci: { status: "passed" },
      operatorApproval: { permission: "approve_pr_create" },
      mergePolicy: { status: "passed" },
    });

    expect(result).toMatchObject({
      mode: "auto_merge",
      status: "blocked",
      reason: "operator_approval_required",
      checks: expect.arrayContaining([expect.objectContaining({ id: "operator_approval", status: "failed" })]),
    });
  });
});
