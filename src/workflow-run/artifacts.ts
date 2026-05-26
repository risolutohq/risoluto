import { createWorkflowRunArchive, storeWorkflowRunRecord } from "./archive.js";

export { DEFAULT_WORKFLOW_DEFINITION_ID } from "./archive.js";

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

export interface RecordWorkflowRunTransitionInput {
  dataDir?: string;
  archiveDir?: string;
  workflowRunId: string;
  fromState: string;
  toState: string;
  source: WorkflowRunSource;
  gate: WorkflowRunGateReference;
  hook: WorkflowRunHookReference;
  now?: () => string;
}

export function createWorkflowRunRecord(input: {
  dataDir?: string;
  archiveDir?: string;
  title: string;
  intent: string;
  source: WorkflowRunSource;
  workflowDefinitionId?: string;
  trigger?: WorkflowRunTrigger;
  now?: () => string;
  id?: () => string;
}): WorkflowRunStartRecord {
  return createWorkflowRunArchive(input).createWorkflowRunRecord(input);
}

export async function writeWorkflowRunRecord(workflowRun: WorkflowRunStartRecord): Promise<void> {
  await storeWorkflowRunRecord(workflowRun);
}

export async function appendWorkflowRunEvent(input: {
  dataDir?: string;
  archiveDir?: string;
  workflowRunId: string;
  eventType: string;
  source: WorkflowRunSource;
  message?: string;
  now?: () => string;
}): Promise<WorkflowRunEventRecord> {
  const archive = createWorkflowRunArchive(input);
  const workflowRun = await archive.loadWorkflowRun(input.workflowRunId);
  const event: WorkflowRunEventRecord = {
    at: input.now?.() ?? new Date().toISOString(),
    eventType: input.eventType,
    workflowRunId: workflowRun.id,
    source: input.source,
    ...(workflowRun.workflowDefinitionId ? { workflowDefinitionId: workflowRun.workflowDefinitionId } : {}),
    ...(input.message ? { message: input.message } : {}),
  };
  const [sequencedEvent] = await archive.appendWorkflowRunEvents(input.workflowRunId, [event]);
  return sequencedEvent!;
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

export async function recordWorkflowRunTransition(
  input: RecordWorkflowRunTransitionInput,
): Promise<WorkflowRunTransitionRecordedOutput> {
  const archive = createWorkflowRunArchive(input);
  const workflowRun = await archive.loadWorkflowRun(input.workflowRunId);
  const at = input.now?.() ?? new Date().toISOString();
  const transition: WorkflowRunTransitionRecord = {
    workflowRunId: workflowRun.id,
    fromState: input.fromState,
    toState: input.toState,
    gate: input.gate,
    hook: input.hook,
  };
  const events = buildTransitionEvents({ input, workflowRun, at });
  const sequencedEvents = await archive.appendWorkflowRunEvents(input.workflowRunId, events);
  return toTransitionRecordedOutput(transition, sequencedEvents);
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

export function toTransitionRecordedOutput(
  transition: WorkflowRunTransitionRecord,
  events: WorkflowRunEventRecord[],
): WorkflowRunTransitionRecordedOutput {
  return {
    type: "workflow_run.transition_recorded",
    transition,
    events,
  };
}

function buildTransitionEvents(input: {
  input: RecordWorkflowRunTransitionInput;
  workflowRun: WorkflowRunStartRecord;
  at: string;
}): WorkflowRunEventRecord[] {
  const base = {
    at: input.at,
    workflowRunId: input.workflowRun.id,
    source: input.input.source,
    workflowDefinitionId: input.workflowRun.workflowDefinitionId,
  };
  return [
    { ...base, eventType: "validation_gate.evaluated", gate: input.input.gate },
    {
      ...base,
      eventType: "workflow_transition.applied",
      fromState: input.input.fromState,
      toState: input.input.toState,
    },
    { ...base, eventType: "workflow_hook.fired", hook: input.input.hook },
  ];
}
