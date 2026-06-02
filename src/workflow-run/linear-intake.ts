import { DEFAULT_WORKFLOW_DEFINITION_ID, toStartedOutput, type WorkflowRunStartedOutput } from "./artifacts.js";
import { acceptTrackerIssueWorkflowRun } from "./tracker-intake.js";

export interface LinearTriggeredWorkflowRunIssue {
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly url?: string | null;
  readonly description?: string | null;
  readonly labels?: readonly string[];
  readonly state?: string | null;
  readonly comments?: readonly string[];
}

export interface LinearTriggeredWorkflowRunRequest {
  readonly action: string;
  readonly deliveryId?: string | null;
  readonly issue: LinearTriggeredWorkflowRunIssue;
  readonly workflowDefinitionId?: string;
}

export async function acceptLinearTriggeredWorkflowRun(
  input: {
    dataDir?: string;
    archiveDir?: string;
    now?: () => string;
    id?: () => string;
    attemptId?: () => string;
  } & LinearTriggeredWorkflowRunRequest,
): Promise<WorkflowRunStartedOutput> {
  const intake = await acceptTrackerIssueWorkflowRun({
    dataDir: input.dataDir,
    archiveDir: input.archiveDir,
    provider: "linear",
    deliveryKind: "webhook",
    action: input.action,
    deliveryId: input.deliveryId ?? null,
    issue: input.issue,
    workflowDefinitionId: input.workflowDefinitionId ?? DEFAULT_WORKFLOW_DEFINITION_ID,
    now: input.now,
    id: input.id,
    attemptId: input.attemptId,
  });
  return toStartedOutput(intake.workflowRun);
}
