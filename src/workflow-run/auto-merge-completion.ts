import { createHash } from "node:crypto";

import { createWorkflowRunArchive, type WorkflowRunArchiveLocation } from "./archive.js";
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

export interface AutoMergeCompletionInput extends WorkflowRunArchiveLocation {
  readonly workflowRunId: string;
  readonly pullRequest: Omit<AutoMergeRequest, "mergeMethod">;
  readonly mergeMethod: AutoMergeRequest["mergeMethod"];
  readonly publish: PublishResultArtifact;
  readonly ci: Pick<CiResultArtifact, "status"> | null;
  readonly postPublishVerification: Pick<VerificationArtifact, "decision" | "postPublishReconfirm"> | null;
  readonly mergePolicy: { readonly status: "failed" | "passed" } | null;
  readonly operatorApproval: Pick<OperatorApprovalArtifact, "actionId" | "nonce" | "permission"> | null;
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

  // Atomically stamp the nonce as consumed BEFORE requesting the merge. The wx exclusive-create closes the
  // TOCTOU window in the prior in-memory `consumedApprovalNonces` check so a concurrent or replayed approval
  // tap cannot drive a second merge. A merge that later fails requires a fresh approval — the safe default.
  if (!(await stampConsumedNonce(input, approvalNonce))) {
    return { status: "blocked", reason: "approval_nonce_already_consumed" };
  }
  await input.requestAutoMerge({ ...input.pullRequest, mergeMethod: input.mergeMethod });
  return { status: "merge_requested", approvalNonce };
}

async function stampConsumedNonce(input: AutoMergeCompletionInput, nonce: string): Promise<boolean> {
  try {
    await createWorkflowRunArchive(input).writeWorkflowRunArtifact({
      workflowRunId: input.workflowRunId,
      artifactId: consumedNonceArtifactId(nonce),
      contractId: "consumed_approval_nonce.v1",
      data: { version: 1, workflowRunId: input.workflowRunId, nonce },
      producer: { type: "action", id: "auto-merge-completion" },
      ifNotExists: true,
    });
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      return false;
    }
    throw error;
  }
}

function consumedNonceArtifactId(nonce: string): string {
  return `consumed-nonce-${createHash("sha256").update(nonce).digest("hex").slice(0, 16)}`;
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
