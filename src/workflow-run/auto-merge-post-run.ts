import { createWorkflowRunArchive, type WorkflowRunArchive, type WorkflowRunArchiveLocation } from "./archive.js";
import { parseWorkflowRunArtifact } from "./artifact-contracts.js";
import {
  type AutoMergeCompletionInput,
  type AutoMergeCompletionResult,
  type AutoMergeRequest,
  completeAutoMerge,
} from "./auto-merge-completion.js";
import type { CiResultArtifact } from "./ci-babysitter.js";
import type { MergePolicyResultArtifact } from "./merge-policy-result-contract.js";
import type { OperatorApprovalArtifact } from "./operator-approval-contract.js";
import type { VerificationArtifact } from "./post-publish-verifier.js";
import type { PublishResultArtifact } from "./publish-policy.js";

export interface CompleteAutoMergeForRunInput extends WorkflowRunArchiveLocation {
  readonly workflowRunId: string;
  readonly pullRequest: Omit<AutoMergeRequest, "mergeMethod">;
  readonly requestAutoMerge: AutoMergeCompletionInput["requestAutoMerge"];
}

/**
 * Post-run auto-merge completion gate (NIN-272). Reads the run's archived publish / CI / post-publish
 * verification / operator-approval / merge-policy artifacts back and routes them through
 * `completeAutoMerge`, which enforces green CI + a satisfied post-publish verifier + a passing merge policy
 * + a single-use operator approval before requesting the merge. A missing artifact reads as not-present, so
 * the gate blocks (the safe default) rather than fabricating a precondition. When `publish_result.v1` is
 * absent there is nothing to merge.
 */
export async function completeAutoMergeForRun(input: CompleteAutoMergeForRunInput): Promise<AutoMergeCompletionResult> {
  const archive = createWorkflowRunArchive(input);
  const publish = await readRunArtifact<PublishResultArtifact>(
    archive,
    input.workflowRunId,
    "publish_result",
    "publish_result.v1",
  );
  if (!publish) {
    return { status: "blocked", reason: "auto_merge_publish_not_ready" };
  }

  // The remaining gate artifacts are independent reads keyed on the same run, so fetch them concurrently.
  const [ci, verification, approval, mergePolicy] = await Promise.all([
    readRunArtifact<CiResultArtifact>(archive, input.workflowRunId, "ci_result", "ci_result.v1"),
    readRunArtifact<VerificationArtifact>(archive, input.workflowRunId, "verification", "verification.v1"),
    readRunArtifact<OperatorApprovalArtifact>(
      archive,
      input.workflowRunId,
      "operator_approval",
      "operator_approval.v1",
    ),
    readRunArtifact<MergePolicyResultArtifact>(
      archive,
      input.workflowRunId,
      "merge_policy_result",
      "merge_policy_result.v1",
    ),
  ]);

  return completeAutoMerge({
    ...archiveLocation(input),
    workflowRunId: input.workflowRunId,
    pullRequest: input.pullRequest,
    mergeMethod: mergePolicy?.mergeMethod ?? "squash",
    publish,
    ci: ci ? { status: ci.status } : null,
    postPublishVerification: verification
      ? { decision: verification.decision, postPublishReconfirm: verification.postPublishReconfirm }
      : null,
    mergePolicy: mergePolicy ? { status: mergePolicy.status } : null,
    operatorApproval: approval
      ? { actionId: approval.actionId, nonce: approval.nonce, permission: approval.permission }
      : null,
    requestAutoMerge: input.requestAutoMerge,
  });
}

/**
 * Read one archived artifact back and parse it through its contract. A missing or malformed artifact
 * resolves to null (the gate then blocks), which is the safe default.
 */
async function readRunArtifact<T>(
  archive: WorkflowRunArchive,
  workflowRunId: string,
  artifactId: string,
  contractId: string,
): Promise<T | null> {
  try {
    const payload = await archive.readWorkflowRunArtifact({ workflowRunId, artifactId });
    return parseWorkflowRunArtifact({
      contractId,
      data: payload.data,
      producer: { type: "action", id: "auto-merge-completion" },
    }) as T;
  } catch {
    return null;
  }
}

function archiveLocation(input: WorkflowRunArchiveLocation): WorkflowRunArchiveLocation {
  return {
    ...(input.dataDir ? { dataDir: input.dataDir } : {}),
    ...(input.archiveDir ? { archiveDir: input.archiveDir } : {}),
  };
}
