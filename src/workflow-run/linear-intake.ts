import {
  createWorkflowRunRecord,
  DEFAULT_WORKFLOW_DEFINITION_ID,
  toStartedOutput,
  writeWorkflowRunRecord,
  type WorkflowRunStartedOutput,
} from "./artifacts.js";

export interface LinearTriggeredWorkflowRunIssue {
  id: string;
  identifier: string;
  title: string;
  url?: string | null;
  description?: string | null;
}

export interface LinearTriggeredWorkflowRunRequest {
  action: string;
  deliveryId?: string | null;
  issue: LinearTriggeredWorkflowRunIssue;
  workflowDefinitionId?: string;
}

export async function acceptLinearTriggeredWorkflowRun(
  input: {
    dataDir?: string;
    archiveDir?: string;
    now?: () => string;
    id?: () => string;
  } & LinearTriggeredWorkflowRunRequest,
): Promise<WorkflowRunStartedOutput> {
  const workflowRun = createWorkflowRunRecord({
    dataDir: input.dataDir,
    archiveDir: input.archiveDir,
    source: "linear",
    title: `${input.issue.identifier}: ${input.issue.title}`,
    intent: input.issue.description?.trim() || input.issue.title,
    workflowDefinitionId: input.workflowDefinitionId ?? DEFAULT_WORKFLOW_DEFINITION_ID,
    now: input.now,
    id: input.id,
    trigger: {
      type: "linear_issue",
      issueId: input.issue.id,
      issueIdentifier: input.issue.identifier,
      issueUrl: input.issue.url ?? null,
      action: input.action,
      deliveryId: input.deliveryId ?? null,
    },
  });
  await writeWorkflowRunRecord(workflowRun);
  return toStartedOutput(workflowRun);
}
