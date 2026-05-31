import type { WorkflowRunArtifactReference } from "./artifacts.js";
import { createWorkflowRunArchive, type WorkflowRunArchiveLocation } from "./archive.js";
import { verifySlackSignature } from "../webhook/signature.js";
import type { OperatorApprovalArtifact, OperatorPermission } from "./operator-approval-contract.js";

const SLACK_REPLAY_WINDOW_SECONDS = 300;

export interface SlackOperatorIdentity {
  readonly id: string;
  readonly slackUserId: string;
  readonly permissions: readonly OperatorPermission[];
}

export interface SlackApprovalInput {
  readonly workflowRunId: string;
  readonly actionId: string;
  readonly nonce: string;
  readonly permission: OperatorPermission;
  readonly slackUserId: string;
  readonly slackTeamId: string | null;
}

export interface RecordSlackOperatorApprovalInput extends WorkflowRunArchiveLocation {
  readonly signingSecret: string;
  readonly signature: string;
  readonly timestampEpochSeconds: number;
  readonly receivedAtEpochSeconds: number;
  readonly rawBody: Buffer;
  readonly approval: SlackApprovalInput;
  readonly operators: readonly SlackOperatorIdentity[];
  readonly allowedSlackTeamIds: readonly string[];
  readonly now: () => string;
}

export type SlackOperatorApprovalResult =
  | { readonly type: "slack_approval.rejected"; readonly reason: SlackApprovalRejectionReason }
  | {
      readonly type: "slack_approval.recorded";
      readonly approval: OperatorApprovalArtifact;
      readonly artifact: WorkflowRunArtifactReference;
    };

export type SlackApprovalRejectionReason =
  | "operator_unmapped"
  | "permission_denied"
  | "duplicate_nonce"
  | "replay_window"
  | "signature_invalid"
  | "team_not_allowed";

export async function recordSlackOperatorApproval(
  input: RecordSlackOperatorApprovalInput,
): Promise<SlackOperatorApprovalResult> {
  if (!isWithinSlackReplayWindow(input.timestampEpochSeconds, input.receivedAtEpochSeconds)) {
    return rejected("replay_window");
  }
  if (!verifySlackSignature(input.rawBody, input.signature, input.signingSecret, input.timestampEpochSeconds)) {
    return rejected("signature_invalid");
  }
  if (!isAllowedSlackTeam(input.approval.slackTeamId, input.allowedSlackTeamIds)) {
    return rejected("team_not_allowed");
  }

  const operator = input.operators.find((entry) => entry.slackUserId === input.approval.slackUserId);
  if (!operator) {
    return rejected("operator_unmapped");
  }
  if (!operator.permissions.includes(input.approval.permission)) {
    return rejected("permission_denied");
  }
  if (await hasRecordedApproval(input)) {
    return rejected("duplicate_nonce");
  }

  const approval = toOperatorApprovalArtifact(input, operator);
  const artifact = await createWorkflowRunArchive(input).writeWorkflowRunArtifact({
    workflowRunId: approval.workflowRunId,
    artifactId: approvalArtifactId(approval.nonce),
    contractId: "operator_approval.v1",
    data: approval,
    producer: { type: "action", id: "slack-operator-approval" },
  });
  return { type: "slack_approval.recorded", approval, artifact };
}

function rejected(reason: SlackApprovalRejectionReason): SlackOperatorApprovalResult {
  return { type: "slack_approval.rejected", reason };
}

function isWithinSlackReplayWindow(timestampEpochSeconds: number, receivedAtEpochSeconds: number): boolean {
  return Math.abs(receivedAtEpochSeconds - timestampEpochSeconds) <= SLACK_REPLAY_WINDOW_SECONDS;
}

function isAllowedSlackTeam(slackTeamId: string | null, allowedSlackTeamIds: readonly string[]): boolean {
  return slackTeamId !== null && allowedSlackTeamIds.includes(slackTeamId);
}

async function hasRecordedApproval(input: RecordSlackOperatorApprovalInput): Promise<boolean> {
  try {
    await createWorkflowRunArchive(input).readWorkflowRunArtifact({
      workflowRunId: input.approval.workflowRunId,
      artifactId: approvalArtifactId(input.approval.nonce),
    });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function toOperatorApprovalArtifact(
  input: RecordSlackOperatorApprovalInput,
  operator: SlackOperatorIdentity,
): OperatorApprovalArtifact {
  return {
    version: 1,
    workflowRunId: input.approval.workflowRunId,
    createdAt: input.now(),
    source: "slack",
    operator: {
      id: operator.id,
      slackUserId: operator.slackUserId,
    },
    permission: input.approval.permission,
    actionId: input.approval.actionId,
    nonce: input.approval.nonce,
    slack: {
      teamId: input.approval.slackTeamId,
      userId: input.approval.slackUserId,
    },
  };
}

function approvalArtifactId(nonce: string): string {
  const sanitized = nonce.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 64);
  return `operator-approval-${sanitized || "nonce"}`;
}
