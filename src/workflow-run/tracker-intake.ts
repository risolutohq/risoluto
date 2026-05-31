import { DEFAULT_WORKFLOW_DEFINITION_ID } from "./artifacts.js";
import type { GitHubIssueWorkflowRunTrigger, WorkflowRunStartedOutput, WorkflowRunTrigger } from "./contracts.js";
import {
  acceptWorkflowRunIntake,
  type WorkflowRunIntakeOutput,
  type WorkflowRunIntakeRule,
  type WorkflowRunIntakeSource,
} from "./intake-core.js";

export type TrackerIntakeProvider = Extract<WorkflowRunIntakeSource, "github" | "linear">;
export type TrackerDeliveryKind = "polling" | "webhook";

export interface TrackerWorkflowRunIssue {
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly url?: string | null;
  readonly description?: string | null;
  readonly labels?: readonly string[];
  readonly state?: string | null;
  readonly comments?: readonly string[];
}

export interface AcceptTrackerIssueWorkflowRunInput {
  readonly dataDir?: string;
  readonly archiveDir?: string;
  readonly provider: TrackerIntakeProvider;
  readonly deliveryKind: TrackerDeliveryKind;
  readonly action: string;
  readonly deliveryId?: string | null;
  readonly issue: TrackerWorkflowRunIssue;
  readonly workflowDefinitionId?: string;
  readonly rules?: readonly WorkflowRunIntakeRule[];
  readonly now?: () => string;
  readonly id?: () => string;
  readonly attemptId?: () => string;
}

export type GitHubTriggeredWorkflowRunRequest = Omit<AcceptTrackerIssueWorkflowRunInput, "provider">;

export async function acceptTrackerIssueWorkflowRun(
  input: AcceptTrackerIssueWorkflowRunInput,
): Promise<WorkflowRunIntakeOutput> {
  const workflowDefinitionId = input.workflowDefinitionId ?? DEFAULT_WORKFLOW_DEFINITION_ID;
  return acceptWorkflowRunIntake({
    dataDir: input.dataDir,
    archiveDir: input.archiveDir,
    source: input.provider,
    mode: hasRetrySignal(input.issue) ? "retry" : "start",
    title: `${input.issue.identifier}: ${input.issue.title}`,
    body: issueBody(input.issue),
    workflowDefinitionId,
    externalObject: {
      provider: input.provider,
      id: input.issue.id,
      url: input.issue.url ?? null,
    },
    deliveryId: input.deliveryId ?? null,
    labels: input.issue.labels ?? [],
    state: input.issue.state ?? null,
    rules: input.rules ?? [defaultTrackerIntakeRule(input.provider, workflowDefinitionId)],
    trigger: buildTrackerTrigger(input),
    now: input.now,
    id: input.id,
    attemptId: input.attemptId,
  });
}

export async function acceptGitHubTriggeredWorkflowRun(
  input: GitHubTriggeredWorkflowRunRequest,
): Promise<WorkflowRunStartedOutput> {
  const intake = await acceptTrackerIssueWorkflowRun({ ...input, provider: "github" });
  return { type: "workflow_run.started", workflowRun: intake.workflowRun };
}

function defaultTrackerIntakeRule(
  provider: TrackerIntakeProvider,
  workflowDefinitionId: string,
): WorkflowRunIntakeRule {
  return {
    id: `${provider}-default`,
    provider,
    workflowDefinitionId,
    workspaceKey: provider,
  };
}

function issueBody(issue: TrackerWorkflowRunIssue): string {
  const description = issue.description?.trim();
  return description && description.length > 0 ? description : issue.title;
}

function hasRetrySignal(issue: TrackerWorkflowRunIssue): boolean {
  const labels = new Set((issue.labels ?? []).map((label) => label.trim().toLowerCase()));
  if (labels.has("risoluto:retry") || labels.has("retry")) {
    return true;
  }
  return (issue.comments ?? []).some((comment) => isRetryComment(comment));
}

function isRetryComment(comment: string): boolean {
  const normalized = comment.trim().toLowerCase();
  return normalized === "/risoluto retry" || normalized === "risoluto retry";
}

function buildTrackerTrigger(input: AcceptTrackerIssueWorkflowRunInput): WorkflowRunTrigger {
  switch (input.provider) {
    case "linear":
      return {
        type: "linear_issue",
        issueId: input.issue.id,
        issueIdentifier: input.issue.identifier,
        issueUrl: input.issue.url ?? null,
        action: input.action,
        deliveryId: input.deliveryId ?? null,
      };
    case "github":
      return {
        type: "github_issue",
        issueId: input.issue.id,
        issueIdentifier: input.issue.identifier,
        issueUrl: input.issue.url ?? null,
        action: input.action,
        deliveryId: input.deliveryId ?? null,
        deliveryKind: input.deliveryKind,
      } satisfies GitHubIssueWorkflowRunTrigger;
  }
}
