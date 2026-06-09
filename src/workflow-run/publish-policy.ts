import { z } from "zod";

import type { OperatorPermission } from "./operator-approval-contract.js";

const publishModeSchema = z.enum(["auto_merge", "draft", "incomplete_draft", "none", "ready"]);
const publishStatusSchema = z.enum(["blocked", "not_published", "published"]);
const publishCheckStatusSchema = z.enum(["failed", "passed"]);
const publishCheckIdSchema = z.enum([
  "ci_green",
  "ci_result",
  "local_validation",
  "merge_policy",
  "operator_approval",
  "verifier_satisfied",
]);

const publishCheckSchema = z
  .object({
    id: publishCheckIdSchema,
    status: publishCheckStatusSchema,
    summary: z.string().min(1),
  })
  .strict();

export const publishResultArtifactSchema = z
  .object({
    version: z.literal(1),
    workflowRunId: z.string().min(1),
    createdAt: z.string().min(1),
    mode: publishModeSchema,
    status: publishStatusSchema,
    draft: z.boolean(),
    autoMerge: z.boolean(),
    pullRequestUrl: z.string().min(1).nullable(),
    reason: z.string().min(1),
    checks: z.array(publishCheckSchema),
  })
  .strict();

export type PrPublishMode = z.infer<typeof publishModeSchema>;
export type PublishResultArtifact = z.infer<typeof publishResultArtifactSchema>;

export interface PrPublishPolicyInput {
  readonly workflowRunId: string;
  readonly createdAt: string;
  readonly requestedMode?: PrPublishMode;
  readonly validation: { readonly status: "failed" | "passed" };
  readonly verification: { readonly decision: "not_satisfied" | "satisfied" | "uncertain" } | null;
  readonly ci: { readonly status: "blocked" | "failed" | "passed" | "pending" | "rerun_requested" } | null;
  readonly operatorApproval: { readonly permission: OperatorPermission } | null;
  readonly mergePolicy: { readonly status: "failed" | "passed" } | null;
}

type PublishCheck = z.infer<typeof publishCheckSchema>;

export function evaluatePrPublishPolicy(input: PrPublishPolicyInput): PublishResultArtifact {
  const mode = input.requestedMode ?? "draft";
  const checks = checksForMode(mode, input);
  const failedCheck = checks.find((check) => check.status === "failed");
  const artifact = failedCheck ? blockedResult(input, mode, checks, failedCheck) : allowedResult(input, mode, checks);
  return publishResultArtifactSchema.parse(artifact);
}

function checksForMode(mode: PrPublishMode, input: PrPublishPolicyInput): readonly PublishCheck[] {
  switch (mode) {
    case "auto_merge":
      return [
        localValidationCheck(input),
        verifierCheck(input),
        ciCheck(input),
        operatorApprovalCheck(input, "approve_auto_merge"),
        mergePolicyCheck(input),
      ];
    case "ready":
      return [localValidationCheck(input), verifierCheck(input), ciCheck(input)];
    case "incomplete_draft":
      return [operatorApprovalCheck(input, "approve_pr_create")];
    case "draft":
    case "none":
      return [];
  }
}

function allowedResult(
  input: PrPublishPolicyInput,
  mode: PrPublishMode,
  checks: readonly PublishCheck[],
): PublishResultArtifact {
  return {
    version: 1,
    workflowRunId: input.workflowRunId,
    createdAt: input.createdAt,
    mode,
    status: mode === "none" ? "not_published" : publishedStatusForMode(mode),
    draft: mode === "draft" || mode === "incomplete_draft",
    autoMerge: mode === "auto_merge",
    pullRequestUrl: null,
    reason: allowedReasonForMode(mode),
    checks: [...checks],
  };
}

function blockedResult(
  input: PrPublishPolicyInput,
  mode: PrPublishMode,
  checks: readonly PublishCheck[],
  failedCheck: PublishCheck,
): PublishResultArtifact {
  return {
    version: 1,
    workflowRunId: input.workflowRunId,
    createdAt: input.createdAt,
    mode,
    status: "blocked",
    draft: mode === "incomplete_draft",
    autoMerge: false,
    pullRequestUrl: null,
    reason: blockedReasonForCheck(failedCheck),
    checks: [...checks],
  };
}

function publishedStatusForMode(mode: PrPublishMode): "blocked" | "published" {
  return mode === "incomplete_draft" ? "blocked" : "published";
}

function allowedReasonForMode(mode: PrPublishMode): string {
  switch (mode) {
    case "auto_merge":
      return "auto_merge_allowed";
    case "draft":
      return "draft_publish_allowed";
    case "incomplete_draft":
      return "incomplete_draft_requires_followup";
    case "none":
      return "publish_disabled";
    case "ready":
      return "ready_publish_allowed";
  }
}

function blockedReasonForCheck(check: PublishCheck): string {
  switch (check.id) {
    case "ci_green":
      return "ci_not_green";
    case "ci_result":
      return "ci_result_required";
    case "local_validation":
      return "local_validation_failed";
    case "merge_policy":
      return "merge_policy_not_satisfied";
    case "operator_approval":
      return "operator_approval_required";
    case "verifier_satisfied":
      return "verifier_not_satisfied";
  }
}

function localValidationCheck(input: PrPublishPolicyInput): PublishCheck {
  return {
    id: "local_validation",
    status: input.validation.status === "passed" ? "passed" : "failed",
    summary: input.validation.status === "passed" ? "local validation passed" : "local validation failed",
  };
}

function verifierCheck(input: PrPublishPolicyInput): PublishCheck {
  return {
    id: "verifier_satisfied",
    status: input.verification?.decision === "satisfied" ? "passed" : "failed",
    summary: input.verification?.decision === "satisfied" ? "verifier satisfied" : "verifier not satisfied",
  };
}

function ciCheck(input: PrPublishPolicyInput): PublishCheck {
  if (!input.ci) {
    return {
      id: "ci_result",
      status: "failed",
      summary: "ci_result.v1 is required",
    };
  }
  return {
    id: "ci_green",
    status: input.ci.status === "passed" ? "passed" : "failed",
    summary: input.ci.status === "passed" ? "remote CI passed" : "remote CI is not green",
  };
}

function operatorApprovalCheck(input: PrPublishPolicyInput, requiredPermission: OperatorPermission): PublishCheck {
  const approval = input.operatorApproval;
  let summary: string;
  if (!approval) {
    summary = "operator approval missing";
  } else if (approval.permission !== requiredPermission) {
    summary = `operator approval has wrong permission (got ${approval.permission}, need ${requiredPermission})`;
  } else {
    summary = "operator approval recorded";
  }
  return {
    id: "operator_approval",
    status: approval?.permission === requiredPermission ? "passed" : "failed",
    summary,
  };
}

function mergePolicyCheck(input: PrPublishPolicyInput): PublishCheck {
  return {
    id: "merge_policy",
    status: input.mergePolicy?.status === "passed" ? "passed" : "failed",
    summary: input.mergePolicy?.status === "passed" ? "merge policy satisfied" : "merge policy not satisfied",
  };
}
