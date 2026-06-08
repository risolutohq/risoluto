export const DEFAULT_WORKFLOW_DEFINITION_ID = "single-operator-afk-coder";

export type WorkflowRunSource = "api" | "cli" | "github" | "linear" | "slack";
export type WorkflowRunStatus =
  | "accepted"
  | "queued"
  | "running"
  | "waiting_for_operator"
  | "blocked"
  | "done"
  | "cancelled";

export interface LinearIssueWorkflowRunTrigger {
  type: "linear_issue";
  issueId: string;
  issueIdentifier: string;
  issueUrl: string | null;
  action: string;
  deliveryId: string | null;
}

export interface GitHubIssueWorkflowRunTrigger {
  type: "github_issue";
  issueId: string;
  issueIdentifier: string;
  issueUrl: string | null;
  action: string;
  deliveryId: string | null;
  deliveryKind: "polling" | "webhook";
}

export type WorkflowRunTrigger = GitHubIssueWorkflowRunTrigger | LinearIssueWorkflowRunTrigger;

export interface WorkflowRunStartRecord {
  id: string;
  source: WorkflowRunSource;
  status: WorkflowRunStatus;
  title: string;
  intent: string;
  workflowDefinitionId: string;
  workspaceKey?: string;
  resolvedWorkflowDefinition?: WorkflowRunResolvedDefinitionConfig;
  createdAt: string;
  artifactDir: string;
  trigger?: WorkflowRunTrigger;
}

export interface WorkflowRunResolvedDefinitionConfig {
  workflowDefinitionId: string;
  validationProfile: string;
  modelProfiles: Record<string, string>;
  /**
   * Workflow-level status mapping override (NIN-270). When present it beats the workspace-level
   * `tracker.statusMapping` during projection. Inlined here rather than imported from
   * status-projection.ts to avoid a contracts ↔ status-projection import cycle.
   */
  statusMapping?: Partial<Record<WorkflowRunStatus, string>>;
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

// Result shapes returned by the WorkflowRun handle's record* methods. Each
// pairs a durable domain record with the event(s) appended to the Run Log.

export interface WorkflowRunWorkerProcessRecord extends WorkflowRunWorkerProcessReference {
  workflowRunId: string;
}

export interface WorkflowRunWorkerProcessRecordedOutput {
  type: "workflow_run.worker_process_recorded";
  workerProcess: WorkflowRunWorkerProcessRecord;
  event: WorkflowRunEventRecord;
}

export interface WorkflowRunWorkspaceLifecycleRecord {
  workflowRunId: string;
  workspace: WorkflowRunWorkspaceReference;
  repo: WorkflowRunRepoReference;
}

export interface WorkflowRunWorkspaceLifecycleRecordedOutput {
  type: "workflow_run.workspace_lifecycle_recorded";
  lifecycle: WorkflowRunWorkspaceLifecycleRecord;
  events: WorkflowRunEventRecord[];
}

export interface WorkflowRunWorkspaceCleanupRecord extends WorkflowRunWorkspaceCleanupReference {
  workflowRunId: string;
}

export interface WorkflowRunWorkspaceCleanupRecordedOutput {
  type: "workflow_run.workspace_cleanup_recorded";
  cleanup: WorkflowRunWorkspaceCleanupRecord;
  event: WorkflowRunEventRecord;
}

export interface WorkflowRunRoleExecutionRecord {
  id: string;
  workflowRunId: string;
  role: string;
  status: "completed";
  completedAt: string;
  artifact: WorkflowRunArtifactReference;
}

export interface WorkflowRunRoleExecutionCompletedOutput {
  type: "workflow_run.role_execution_completed";
  roleExecution: WorkflowRunRoleExecutionRecord;
}

export interface WorkflowRunTransitionRecord {
  workflowRunId: string;
  fromState: string;
  toState: string;
  gate: WorkflowRunGateReference;
  hook: WorkflowRunHookReference;
}

export interface WorkflowRunTransitionRecordedOutput {
  type: "workflow_run.transition_recorded";
  transition: WorkflowRunTransitionRecord;
  events: WorkflowRunEventRecord[];
}

export interface WorkflowRunAttemptRecord extends WorkflowRunAttemptReference {
  workflowRunId: string;
  startedAt: string;
}

export interface WorkflowRunAttemptStartedOutput {
  type: "workflow_run.run_attempt_started";
  runAttempt: WorkflowRunAttemptRecord;
  event: WorkflowRunEventRecord;
}

export interface WorkflowRunAttemptCompletedRecord {
  id: string;
  workflowRunId: string;
  status: "completed";
  completedAt: string;
}

export interface WorkflowRunAttemptCompletedOutput {
  type: "workflow_run.run_attempt_completed";
  runAttempt: WorkflowRunAttemptCompletedRecord;
  event: WorkflowRunEventRecord;
}

export interface WorkflowRunAttemptFailedRecord {
  id: string;
  workflowRunId: string;
  status: "failed";
  failedAt: string;
}

export interface WorkflowRunAttemptFailedOutput {
  type: "workflow_run.run_attempt_failed";
  runAttempt: WorkflowRunAttemptFailedRecord;
  event: WorkflowRunEventRecord;
}

export interface WorkflowRunAttemptCancelledRecord {
  id: string;
  workflowRunId: string;
  status: "cancelled";
  cancelledAt: string;
}

export interface WorkflowRunAttemptCancelledOutput {
  type: "workflow_run.run_attempt_cancelled";
  runAttempt: WorkflowRunAttemptCancelledRecord;
  event: WorkflowRunEventRecord;
}
