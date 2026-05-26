import { createWorkflowRunArchive } from "./archive.js";
import type {
  WorkflowRunEventRecord,
  WorkflowRunRepoReference,
  WorkflowRunSource,
  WorkflowRunStartRecord,
  WorkflowRunWorkspaceCleanupReference,
  WorkflowRunWorkspaceReference,
} from "./artifacts.js";

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

export interface WorkflowRunWorkspaceCleanupRecordedOutput {
  type: "workflow_run.workspace_cleanup_recorded";
  cleanup: WorkflowRunWorkspaceCleanupRecord;
  event: WorkflowRunEventRecord;
}

export interface WorkflowRunWorkspaceCleanupRecord extends WorkflowRunWorkspaceCleanupReference {
  workflowRunId: string;
}

export interface RecordWorkflowRunWorkspaceLifecycleInput {
  dataDir?: string;
  archiveDir?: string;
  workflowRunId: string;
  source: WorkflowRunSource;
  workspacePath: string;
  workspaceKey: string;
  repoUrl: string;
  branch: string;
  now?: () => string;
}

export interface RecordWorkflowRunWorkspaceCleanupInput {
  dataDir?: string;
  archiveDir?: string;
  workflowRunId: string;
  source: WorkflowRunSource;
  workspacePath: string;
  workspaceKey: string;
  result: WorkflowRunWorkspaceCleanupReference["result"];
  reason: WorkflowRunWorkspaceCleanupReference["reason"];
  now?: () => string;
}

export async function recordWorkflowRunWorkspaceLifecycle(
  input: RecordWorkflowRunWorkspaceLifecycleInput,
): Promise<WorkflowRunWorkspaceLifecycleRecordedOutput> {
  const archive = createWorkflowRunArchive(input);
  const workflowRun = await archive.loadWorkflowRun(input.workflowRunId);
  const lifecycle = buildWorkspaceLifecycle(input, workflowRun);
  const events = buildWorkspaceLifecycleEvents({
    input,
    workflowRun,
    lifecycle,
    at: input.now?.() ?? new Date().toISOString(),
  });

  const sequencedEvents = await archive.appendWorkflowRunEvents(input.workflowRunId, events);
  return {
    type: "workflow_run.workspace_lifecycle_recorded",
    lifecycle,
    events: sequencedEvents,
  };
}

export async function recordWorkflowRunWorkspaceCleanup(
  input: RecordWorkflowRunWorkspaceCleanupInput,
): Promise<WorkflowRunWorkspaceCleanupRecordedOutput> {
  const archive = createWorkflowRunArchive(input);
  const workflowRun = await archive.loadWorkflowRun(input.workflowRunId);
  const cleanup = buildWorkspaceCleanup(input, workflowRun);
  const event = buildWorkspaceCleanupEvent({
    input,
    workflowRun,
    cleanup,
    at: input.now?.() ?? new Date().toISOString(),
  });

  const [sequencedEvent] = await archive.appendWorkflowRunEvents(input.workflowRunId, [event]);
  return {
    type: "workflow_run.workspace_cleanup_recorded",
    cleanup,
    event: sequencedEvent!,
  };
}

function buildWorkspaceLifecycle(
  input: RecordWorkflowRunWorkspaceLifecycleInput,
  workflowRun: WorkflowRunStartRecord,
): WorkflowRunWorkspaceLifecycleRecord {
  return {
    workflowRunId: workflowRun.id,
    workspace: {
      path: input.workspacePath,
      key: input.workspaceKey,
      status: "prepared",
    },
    repo: {
      url: input.repoUrl,
      branch: input.branch,
      status: "checked_out",
    },
  };
}

function buildWorkspaceLifecycleEvents(input: {
  input: RecordWorkflowRunWorkspaceLifecycleInput;
  workflowRun: WorkflowRunStartRecord;
  lifecycle: WorkflowRunWorkspaceLifecycleRecord;
  at: string;
}): WorkflowRunEventRecord[] {
  const base = {
    at: input.at,
    workflowRunId: input.workflowRun.id,
    source: input.input.source,
    workflowDefinitionId: input.workflowRun.workflowDefinitionId,
  };
  return [
    { ...base, eventType: "workspace.prepared", workspace: input.lifecycle.workspace },
    { ...base, eventType: "repo.checked_out", repo: input.lifecycle.repo },
  ];
}

function buildWorkspaceCleanup(
  input: RecordWorkflowRunWorkspaceCleanupInput,
  workflowRun: WorkflowRunStartRecord,
): WorkflowRunWorkspaceCleanupRecord {
  return {
    workflowRunId: workflowRun.id,
    workspace: {
      path: input.workspacePath,
      key: input.workspaceKey,
    },
    result: input.result,
    reason: input.reason,
  };
}

function buildWorkspaceCleanupEvent(input: {
  input: RecordWorkflowRunWorkspaceCleanupInput;
  workflowRun: WorkflowRunStartRecord;
  cleanup: WorkflowRunWorkspaceCleanupRecord;
  at: string;
}): WorkflowRunEventRecord {
  return {
    at: input.at,
    eventType: "workspace.cleanup_completed",
    workflowRunId: input.workflowRun.id,
    source: input.input.source,
    workflowDefinitionId: input.workflowRun.workflowDefinitionId,
    cleanup: {
      workspace: input.cleanup.workspace,
      result: input.cleanup.result,
      reason: input.cleanup.reason,
    },
  };
}
