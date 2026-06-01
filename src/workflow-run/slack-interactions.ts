import { createHash } from "node:crypto";

import type { WorkflowRunArtifactReference } from "./artifacts.js";
import { createWorkflowRunArchive, type WorkflowRunArchiveLocation } from "./archive.js";
import { acceptWorkflowRunIntake, type WorkflowRunIntakeOutput, type WorkflowRunIntakeRule } from "./intake-core.js";
import type { OperatorResponseArtifact } from "./operator-response-contract.js";
import {
  recordSlackOperatorApproval,
  type RecordSlackOperatorApprovalInput,
  type SlackOperatorApprovalResult,
} from "./slack-operator-approval.js";

export interface SlackModalSubmission {
  readonly viewId: string;
  readonly teamId: string;
  readonly userId: string;
  readonly title: string;
  readonly body: string;
  readonly workflowDefinitionId: string;
  readonly workspaceKey: string;
}

export interface AcceptSlackModalWorkflowRunInput extends WorkflowRunArchiveLocation {
  readonly modal: SlackModalSubmission;
  readonly rules: readonly WorkflowRunIntakeRule[];
  readonly now: () => string;
  readonly id: () => string;
}

export interface RecordSlackOperatorResponseInput extends WorkflowRunArchiveLocation {
  readonly workflowRunId: string;
  readonly questionId: string;
  readonly response: string;
  readonly operator: {
    readonly id: string;
    readonly slackUserId: string;
  };
  readonly slack: {
    readonly teamId: string;
    readonly userId: string;
  };
  readonly now: () => string;
}

export interface SlackOperatorResponseResult {
  readonly response: OperatorResponseArtifact;
  readonly artifact: WorkflowRunArtifactReference;
}

export interface UnansweredSlackClarificationInput {
  readonly workflowRunId: string;
  readonly questionId: string;
  readonly attemptsUsed: number;
  readonly maxAttempts: number;
  readonly budgetRemaining: boolean;
}

export type SlackClarificationDecision =
  | {
      readonly type: "slack_clarification.retry";
      readonly workflowRunId: string;
      readonly questionId: string;
      readonly nextAttempt: number;
    }
  | {
      readonly type: "slack_clarification.block";
      readonly workflowRunId: string;
      readonly questionId: string;
      readonly runStatus: "blocked";
      readonly reason: "budget_exhausted" | "clarification_unanswered";
    };

export async function acceptSlackModalWorkflowRun(
  input: AcceptSlackModalWorkflowRunInput,
): Promise<WorkflowRunIntakeOutput> {
  return acceptWorkflowRunIntake({
    dataDir: input.dataDir,
    archiveDir: input.archiveDir,
    source: "slack",
    mode: "start",
    title: input.modal.title,
    body: input.modal.body,
    externalObject: {
      provider: "slack",
      id: input.modal.viewId,
      url: null,
    },
    deliveryId: input.modal.viewId,
    labels: [],
    state: "submitted",
    rules: input.rules,
    workflowDefinitionId: input.modal.workflowDefinitionId,
    workspaceKey: input.modal.workspaceKey,
    now: input.now,
    id: input.id,
  });
}

export async function handleSlackApprovalTap(
  input: RecordSlackOperatorApprovalInput,
): Promise<SlackOperatorApprovalResult> {
  return recordSlackOperatorApproval(input);
}

export async function recordSlackOperatorResponse(
  input: RecordSlackOperatorResponseInput,
): Promise<SlackOperatorResponseResult> {
  const response = toOperatorResponseArtifact(input);
  const artifact = await createWorkflowRunArchive(input).writeWorkflowRunArtifact({
    workflowRunId: input.workflowRunId,
    artifactId: operatorResponseArtifactId(input.questionId),
    contractId: "operator_response.v1",
    data: response,
    producer: { type: "action", id: "slack-operator-response" },
  });
  return { response, artifact };
}

export function decideUnansweredSlackClarification(
  input: UnansweredSlackClarificationInput,
): SlackClarificationDecision {
  if (input.budgetRemaining && input.attemptsUsed < input.maxAttempts) {
    return {
      type: "slack_clarification.retry",
      workflowRunId: input.workflowRunId,
      questionId: input.questionId,
      nextAttempt: input.attemptsUsed + 1,
    };
  }
  return {
    type: "slack_clarification.block",
    workflowRunId: input.workflowRunId,
    questionId: input.questionId,
    runStatus: "blocked",
    reason: input.budgetRemaining ? "clarification_unanswered" : "budget_exhausted",
  };
}

function toOperatorResponseArtifact(input: RecordSlackOperatorResponseInput): OperatorResponseArtifact {
  return {
    version: 1,
    workflowRunId: input.workflowRunId,
    createdAt: input.now(),
    source: "slack",
    operator: input.operator,
    questionId: input.questionId,
    response: input.response,
    slack: input.slack,
  };
}

function operatorResponseArtifactId(questionId: string): string {
  return `operator-response-${createHash("sha256").update(questionId).digest("hex").slice(0, 16)}`;
}
