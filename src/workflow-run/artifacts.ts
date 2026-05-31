import { createWorkflowRunArchive, storeWorkflowRunRecord } from "./archive.js";
import type {
  WorkflowRunEventAppendedOutput,
  WorkflowRunEventRecord,
  WorkflowRunEventsListedOutput,
  WorkflowRunResolvedDefinitionConfig,
  WorkflowRunSource,
  WorkflowRunStartedOutput,
  WorkflowRunStartRecord,
  WorkflowRunTrigger,
} from "./contracts.js";

export { DEFAULT_WORKFLOW_DEFINITION_ID } from "./contracts.js";
export { openWorkflowRun } from "./run-handle.js";
export type { WorkflowRun } from "./run-handle.js";
export type {
  GitHubIssueWorkflowRunTrigger,
  LinearIssueWorkflowRunTrigger,
  WorkflowRunArtifactReference,
  WorkflowRunAttemptReference,
  WorkflowRunEventAppendedOutput,
  WorkflowRunEventRecord,
  WorkflowRunEventsListedOutput,
  WorkflowRunGateReference,
  WorkflowRunHookReference,
  WorkflowRunRepoReference,
  WorkflowRunResolvedDefinitionConfig,
  WorkflowRunRoleExecutionCompletedOutput,
  WorkflowRunSource,
  WorkflowRunStatus,
  WorkflowRunStartedOutput,
  WorkflowRunStartRecord,
  WorkflowRunTransitionRecord,
  WorkflowRunTransitionRecordedOutput,
  WorkflowRunTrigger,
  WorkflowRunWorkerProcessReference,
  WorkflowRunWorkspaceCleanupReference,
  WorkflowRunWorkspaceReference,
} from "./contracts.js";

export function createWorkflowRunRecord(input: {
  dataDir?: string;
  archiveDir?: string;
  title: string;
  intent: string;
  source: WorkflowRunSource;
  workflowDefinitionId?: string;
  resolvedWorkflowDefinition?: WorkflowRunResolvedDefinitionConfig;
  trigger?: WorkflowRunTrigger;
  now?: () => string;
  id?: () => string;
}): WorkflowRunStartRecord {
  return createWorkflowRunArchive(input).createWorkflowRunRecord(input);
}

export async function writeWorkflowRunRecord(workflowRun: WorkflowRunStartRecord): Promise<void> {
  await storeWorkflowRunRecord(workflowRun);
}

export async function readWorkflowRunEvents(input: {
  dataDir?: string;
  archiveDir?: string;
  workflowRunId: string;
}): Promise<WorkflowRunEventsListedOutput> {
  const archive = createWorkflowRunArchive(input);
  const workflowRun = await archive.loadWorkflowRun(input.workflowRunId);
  const events = await archive.readWorkflowRunEvents(input.workflowRunId);

  return toEventsListedOutput(workflowRun, events);
}

export function toStartedOutput(workflowRun: WorkflowRunStartRecord): WorkflowRunStartedOutput {
  return {
    type: "workflow_run.started",
    workflowRun,
  };
}

export function toEventAppendedOutput(event: WorkflowRunEventRecord): WorkflowRunEventAppendedOutput {
  return {
    type: "workflow_run.event_appended",
    event,
  };
}

export function toEventsListedOutput(
  workflowRun: WorkflowRunStartRecord,
  events: WorkflowRunEventRecord[],
): WorkflowRunEventsListedOutput {
  return {
    type: "workflow_run.events_listed",
    workflowRun,
    events,
  };
}
