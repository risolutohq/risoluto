import type { CiResultArtifact } from "./ci-babysitter.js";
import type { OperatorApprovalArtifact } from "./operator-approval-contract.js";
import type { VerificationArtifact } from "./post-publish-verifier.js";
import type { PublishResultArtifact } from "./publish-policy.js";

export type AutoMergeBlockReason =
  | "approval_nonce_already_consumed"
  | "auto_merge_publish_not_ready"
  | "ci_not_green"
  | "merge_policy_not_satisfied"
  | "operator_approval_required"
  | "post_publish_verifier_not_satisfied";

export interface AutoMergeRequest {
  readonly owner: string;
  readonly repo: string;
  readonly pullNumber: number;
  readonly mergeMethod: "merge" | "rebase" | "squash";
}

export interface AutoMergeCompletionInput {
  readonly workflowRunId: string;
  readonly pullRequest: Omit<AutoMergeRequest, "mergeMethod">;
  readonly mergeMethod: AutoMergeRequest["mergeMethod"];
  readonly publish: PublishResultArtifact;
  readonly ci: Pick<CiResultArtifact, "status"> | null;
  readonly postPublishVerification: Pick<VerificationArtifact, "decision" | "postPublishReconfirm"> | null;
  readonly mergePolicy: { readonly status: "failed" | "passed" } | null;
  readonly operatorApproval: Pick<OperatorApprovalArtifact, "actionId" | "nonce" | "permission"> | null;
  readonly consumedApprovalNonces: readonly string[];
  readonly requestAutoMerge: (request: AutoMergeRequest) => Promise<void>;
}

export type AutoMergeCompletionResult =
  | { readonly status: "blocked"; readonly reason: AutoMergeBlockReason }
  | { readonly status: "merge_requested"; readonly approvalNonce: string };

export async function completeAutoMerge(input: AutoMergeCompletionInput): Promise<AutoMergeCompletionResult> {
  const blockReason = autoMergeBlockReason(input);
  if (blockReason) {
    return { status: "blocked", reason: blockReason };
  }

  const approvalNonce = input.operatorApproval?.nonce;
  if (!approvalNonce) {
    return { status: "blocked", reason: "operator_approval_required" };
  }
  await input.requestAutoMerge({ ...input.pullRequest, mergeMethod: input.mergeMethod });
  return { status: "merge_requested", approvalNonce };
}

function autoMergeBlockReason(input: AutoMergeCompletionInput): AutoMergeBlockReason | null {
  if (!isPublishReadyForAutoMerge(input.publish)) {
    return "auto_merge_publish_not_ready";
  }
  if (input.ci?.status !== "passed") {
    return "ci_not_green";
  }
  if (!isPostPublishVerificationSatisfied(input.postPublishVerification)) {
    return "post_publish_verifier_not_satisfied";
  }
  if (input.mergePolicy?.status !== "passed") {
    return "merge_policy_not_satisfied";
  }
  if (!isUsableAutoMergeApproval(input.operatorApproval)) {
    return "operator_approval_required";
  }
  if (input.consumedApprovalNonces.includes(input.operatorApproval.nonce)) {
    return "approval_nonce_already_consumed";
  }
  return null;
}

function isPublishReadyForAutoMerge(publish: PublishResultArtifact): boolean {
  return (
    publish.mode === "auto_merge" && publish.status === "published" && publish.autoMerge && !!publish.pullRequestUrl
  );
}

function isPostPublishVerificationSatisfied(
  verification: AutoMergeCompletionInput["postPublishVerification"],
): boolean {
  return (
    verification?.decision === "satisfied" &&
    verification.postPublishReconfirm?.required === true &&
    verification.postPublishReconfirm.decision === "satisfied"
  );
}

function isUsableAutoMergeApproval(
  approval: AutoMergeCompletionInput["operatorApproval"],
): approval is Pick<OperatorApprovalArtifact, "actionId" | "nonce" | "permission"> {
  return approval?.permission === "approve_auto_merge" && approval.actionId === "auto-merge-pr";
}
