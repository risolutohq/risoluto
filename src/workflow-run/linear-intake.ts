import { DEFAULT_WORKFLOW_DEFINITION_ID, toStartedOutput, type WorkflowRunStartedOutput } from "./artifacts.js";
import { acceptWorkflowRunIntake, type WorkflowRunIntakeRule } from "./intake-core.js";

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
  const intake = await acceptWorkflowRunIntake({
    dataDir: input.dataDir,
    archiveDir: input.archiveDir,
    source: "linear",
    mode: "start",
    title: `${input.issue.identifier}: ${input.issue.title}`,
    body: input.issue.description?.trim() || input.issue.title,
    workflowDefinitionId: input.workflowDefinitionId ?? DEFAULT_WORKFLOW_DEFINITION_ID,
    externalObject: {
      provider: "linear",
      id: input.issue.id,
      url: input.issue.url ?? null,
    },
    deliveryId: input.deliveryId ?? null,
    labels: [],
    state: null,
    rules: [defaultLinearIntakeRule(input.workflowDefinitionId ?? DEFAULT_WORKFLOW_DEFINITION_ID)],
    trigger: {
      type: "linear_issue",
      issueId: input.issue.id,
      issueIdentifier: input.issue.identifier,
      issueUrl: input.issue.url ?? null,
      action: input.action,
      deliveryId: input.deliveryId ?? null,
    },
    now: input.now,
    id: input.id,
  });
  return toStartedOutput(intake.workflowRun);
}

function defaultLinearIntakeRule(workflowDefinitionId: string): WorkflowRunIntakeRule {
  return {
    id: "linear-default",
    provider: "linear",
    workflowDefinitionId,
    workspaceKey: "linear",
  };
}
