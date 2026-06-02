import type { CiResultArtifact } from "./ci-babysitter.js";
import type { HandoffArtifact } from "./handoff-contract.js";
import type { PrPublishMode, PublishResultArtifact } from "./publish-policy.js";
import type { CouncilConsensusTag, CouncilVerifierRecord, SingleVerifierDecision } from "./verifier.js";

type PostPublishInputId = "ci_result.v1" | "handoff.v1" | "publish_result.v1";

export interface PostPublishReconfirmRecord {
  readonly required: true;
  readonly prePublishDecision: SingleVerifierDecision;
  readonly decision: SingleVerifierDecision;
  readonly summary: string;
  readonly checkedInputs: readonly PostPublishInputId[];
  readonly contradictedBy: readonly PostPublishInputId[];
}

export type VerificationArtifact = {
  readonly version: 1;
  readonly workflowRunId: string;
  readonly createdAt: string;
  readonly mode: "council" | "single";
  readonly decision: SingleVerifierDecision;
  readonly summary: string;
  readonly allowedInputs: readonly string[];
  readonly evidenceLinks: readonly string[];
  readonly consensus?: CouncilConsensusTag;
  readonly councillors?: readonly CouncilVerifierRecord[];
  readonly postPublishReconfirm?: PostPublishReconfirmRecord;
};

export interface ReconfirmPostPublishVerificationInput {
  readonly verification: VerificationArtifact;
  readonly publish: Pick<PublishResultArtifact, "mode" | "pullRequestUrl" | "status">;
  readonly ci: Pick<CiResultArtifact, "status"> | null;
  readonly handoff: Pick<HandoffArtifact, "outcome"> | null;
}

export type ReconfirmPostPublishVerificationResult =
  | {
      readonly status: "completed";
      readonly artifact: VerificationArtifact & { readonly postPublishReconfirm: PostPublishReconfirmRecord };
    }
  | {
      readonly status: "skipped";
      readonly reason: "mode_not_requiring_reconfirm";
      readonly artifact: VerificationArtifact;
    };

export function reconfirmPostPublishVerification(
  input: ReconfirmPostPublishVerificationInput,
): ReconfirmPostPublishVerificationResult {
  if (!requiresPostPublishReconfirm(input.publish.mode)) {
    return { status: "skipped", reason: "mode_not_requiring_reconfirm", artifact: input.verification };
  }

  const contradictedBy = postPublishContradictions(input);
  const decision = contradictedBy.length > 0 ? "not_satisfied" : input.verification.decision;
  const postPublishReconfirm = postPublishReconfirmRecord(input, decision, contradictedBy);
  return { status: "completed", artifact: { ...input.verification, decision, postPublishReconfirm } };
}

function requiresPostPublishReconfirm(mode: PrPublishMode): boolean {
  return mode === "ready" || mode === "auto_merge";
}

function postPublishContradictions(input: ReconfirmPostPublishVerificationInput): readonly PostPublishInputId[] {
  const contradictedBy: PostPublishInputId[] = [];
  if (input.publish.status !== "published" || !input.publish.pullRequestUrl) {
    contradictedBy.push("publish_result.v1");
  }
  if (!input.ci || input.ci.status !== "passed") {
    contradictedBy.push("ci_result.v1");
  }
  if (!input.handoff || input.handoff.outcome !== "done") {
    contradictedBy.push("handoff.v1");
  }
  return contradictedBy;
}

function postPublishReconfirmRecord(
  input: ReconfirmPostPublishVerificationInput,
  decision: SingleVerifierDecision,
  contradictedBy: readonly PostPublishInputId[],
): PostPublishReconfirmRecord {
  return {
    required: true,
    prePublishDecision: input.verification.decision,
    decision,
    summary: postPublishReconfirmSummary(input.verification.decision, contradictedBy),
    checkedInputs: ["publish_result.v1", "ci_result.v1", "handoff.v1"],
    contradictedBy,
  };
}

function postPublishReconfirmSummary(
  prePublishDecision: SingleVerifierDecision,
  contradictedBy: readonly PostPublishInputId[],
): string {
  if (contradictedBy.length === 0) {
    return `Post-publish evidence reconfirmed ${prePublishDecision}.`;
  }
  return `Post-publish evidence contradicted ${prePublishDecision}: ${contradictedBy.join(", ")}.`;
}
