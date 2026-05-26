export const DEFAULT_WORKFLOW_DEFINITION_ID = "single-operator-afk-coder";

export type WorkflowRunSource = "cli" | "linear";

export interface LinearIssueWorkflowRunTrigger {
  type: "linear_issue";
  issueId: string;
  issueIdentifier: string;
  issueUrl: string | null;
  action: string;
  deliveryId: string | null;
}

export type WorkflowRunTrigger = LinearIssueWorkflowRunTrigger;

export interface WorkflowRunStartRecord {
  id: string;
  source: WorkflowRunSource;
  status: "accepted";
  title: string;
  intent: string;
  workflowDefinitionId: string;
  createdAt: string;
  artifactDir: string;
  trigger?: WorkflowRunTrigger;
}

export interface WorkflowRunStartedOutput {
  type: "workflow_run.started";
  workflowRun: WorkflowRunStartRecord;
}

export interface WorkflowRunEventRecord {
  sequence?: number;
  at: string;
  eventType: string;
  workflowRunId: string;
  source: WorkflowRunSource;
  workflowDefinitionId?: string;
  message?: string;
  trigger?: WorkflowRunTrigger;
  roleExecutionId?: string;
  role?: string;
  artifact?: WorkflowRunArtifactReference;
  runAttempt?: WorkflowRunAttemptReference;
  workspace?: WorkflowRunWorkspaceReference;
  repo?: WorkflowRunRepoReference;
  cleanup?: WorkflowRunWorkspaceCleanupReference;
  workerProcess?: WorkflowRunWorkerProcessReference;
  fromState?: string;
  toState?: string;
  gate?: WorkflowRunGateReference;
  hook?: WorkflowRunHookReference;
}

export interface WorkflowRunEventAppendedOutput {
  type: "workflow_run.event_appended";
  event: WorkflowRunEventRecord;
}

export interface WorkflowRunEventsListedOutput {
  type: "workflow_run.events_listed";
  workflowRun: WorkflowRunStartRecord;
  events: WorkflowRunEventRecord[];
}

export interface WorkflowRunArtifactReference {
  artifactId: string;
  contractId: string;
  path: string;
}

export interface WorkflowRunAttemptReference {
  id: string;
  attemptNumber?: number;
  status: "running" | "completed" | "failed" | "cancelled";
  reason?: "initial" | "retry" | "resume";
}

export interface WorkflowRunGateReference {
  name: string;
  status: "passed" | "failed";
}

export interface WorkflowRunHookReference {
  name: string;
  timing: "state_entry" | "state_exit" | "dag_node";
}

export interface WorkflowRunWorkspaceReference {
  path: string;
  key: string;
  status: "prepared";
}

export interface WorkflowRunRepoReference {
  url: string;
  branch: string;
  status: "checked_out";
}

export interface WorkflowRunWorkspaceCleanupReference {
  workspace: {
    path: string;
    key: string;
  };
  result: "removed" | "kept";
  reason: "workflow_succeeded" | "workflow_failed";
}

export interface WorkflowRunWorkerProcessReference {
  workerId: string;
  role: string;
  harness: string;
  status: "succeeded" | "failed";
  exitCode: number;
}
