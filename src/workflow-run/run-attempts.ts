import { createWorkflowRunArchive } from "./archive.js";
import type {
  WorkflowRunAttemptReference,
  WorkflowRunEventRecord,
  WorkflowRunSource,
  WorkflowRunStartRecord,
} from "./artifacts.js";

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

export interface StartWorkflowRunAttemptInput {
  dataDir?: string;
  archiveDir?: string;
  workflowRunId: string;
  source: WorkflowRunSource;
  attemptId: string;
  attemptNumber: number;
  reason: WorkflowRunAttemptReference["reason"];
  now?: () => string;
}

export interface CompleteWorkflowRunAttemptInput {
  dataDir?: string;
  archiveDir?: string;
  workflowRunId: string;
  source: WorkflowRunSource;
  attemptId: string;
  message?: string;
  now?: () => string;
}

export interface FailWorkflowRunAttemptInput {
  dataDir?: string;
  archiveDir?: string;
  workflowRunId: string;
  source: WorkflowRunSource;
  attemptId: string;
  message?: string;
  now?: () => string;
}

export interface CancelWorkflowRunAttemptInput {
  dataDir?: string;
  archiveDir?: string;
  workflowRunId: string;
  source: WorkflowRunSource;
  attemptId: string;
  message?: string;
  now?: () => string;
}

export async function startWorkflowRunAttempt(
  input: StartWorkflowRunAttemptInput,
): Promise<WorkflowRunAttemptStartedOutput> {
  const archive = createWorkflowRunArchive(input);
  const workflowRun = await archive.loadWorkflowRun(input.workflowRunId);
  const startedAt = input.now?.() ?? new Date().toISOString();
  const runAttempt = buildRunAttempt(input, workflowRun, startedAt);
  const event = buildRunAttemptStartedEvent({ input, workflowRun, runAttempt, startedAt });

  const [sequencedEvent] = await archive.appendWorkflowRunEvents(input.workflowRunId, [event]);
  return {
    type: "workflow_run.run_attempt_started",
    runAttempt,
    event: sequencedEvent!,
  };
}

export async function completeWorkflowRunAttempt(
  input: CompleteWorkflowRunAttemptInput,
): Promise<WorkflowRunAttemptCompletedOutput> {
  const archive = createWorkflowRunArchive(input);
  const workflowRun = await archive.loadWorkflowRun(input.workflowRunId);
  const completedAt = input.now?.() ?? new Date().toISOString();
  const runAttempt = {
    id: input.attemptId,
    workflowRunId: workflowRun.id,
    status: "completed" as const,
    completedAt,
  };
  const event = buildRunAttemptCompletedEvent({ input, workflowRun, runAttempt, completedAt });

  const [sequencedEvent] = await archive.appendWorkflowRunEvents(input.workflowRunId, [event]);
  return {
    type: "workflow_run.run_attempt_completed",
    runAttempt,
    event: sequencedEvent!,
  };
}

export async function failWorkflowRunAttempt(
  input: FailWorkflowRunAttemptInput,
): Promise<WorkflowRunAttemptFailedOutput> {
  const archive = createWorkflowRunArchive(input);
  const workflowRun = await archive.loadWorkflowRun(input.workflowRunId);
  const failedAt = input.now?.() ?? new Date().toISOString();
  const runAttempt = {
    id: input.attemptId,
    workflowRunId: workflowRun.id,
    status: "failed" as const,
    failedAt,
  };
  const event = buildRunAttemptFailedEvent({ input, workflowRun, runAttempt, failedAt });

  const [sequencedEvent] = await archive.appendWorkflowRunEvents(input.workflowRunId, [event]);
  return {
    type: "workflow_run.run_attempt_failed",
    runAttempt,
    event: sequencedEvent!,
  };
}

export async function cancelWorkflowRunAttempt(
  input: CancelWorkflowRunAttemptInput,
): Promise<WorkflowRunAttemptCancelledOutput> {
  const archive = createWorkflowRunArchive(input);
  const workflowRun = await archive.loadWorkflowRun(input.workflowRunId);
  const cancelledAt = input.now?.() ?? new Date().toISOString();
  const runAttempt = {
    id: input.attemptId,
    workflowRunId: workflowRun.id,
    status: "cancelled" as const,
    cancelledAt,
  };
  const event = buildRunAttemptCancelledEvent({ input, workflowRun, runAttempt, cancelledAt });

  const [sequencedEvent] = await archive.appendWorkflowRunEvents(input.workflowRunId, [event]);
  return {
    type: "workflow_run.run_attempt_cancelled",
    runAttempt,
    event: sequencedEvent!,
  };
}

function buildRunAttempt(
  input: StartWorkflowRunAttemptInput,
  workflowRun: WorkflowRunStartRecord,
  startedAt: string,
): WorkflowRunAttemptRecord {
  return {
    id: input.attemptId,
    workflowRunId: workflowRun.id,
    attemptNumber: input.attemptNumber,
    status: "running",
    reason: input.reason,
    startedAt,
  };
}

function buildRunAttemptStartedEvent(input: {
  input: StartWorkflowRunAttemptInput;
  workflowRun: WorkflowRunStartRecord;
  runAttempt: WorkflowRunAttemptRecord;
  startedAt: string;
}): WorkflowRunEventRecord {
  return {
    at: input.startedAt,
    eventType: "run_attempt.started",
    workflowRunId: input.workflowRun.id,
    source: input.input.source,
    workflowDefinitionId: input.workflowRun.workflowDefinitionId,
    runAttempt: {
      id: input.runAttempt.id,
      attemptNumber: input.runAttempt.attemptNumber,
      status: input.runAttempt.status,
      reason: input.runAttempt.reason,
    },
  };
}

function buildRunAttemptCompletedEvent(input: {
  input: CompleteWorkflowRunAttemptInput;
  workflowRun: WorkflowRunStartRecord;
  runAttempt: WorkflowRunAttemptCompletedRecord;
  completedAt: string;
}): WorkflowRunEventRecord {
  return {
    at: input.completedAt,
    eventType: "run_attempt.completed",
    workflowRunId: input.workflowRun.id,
    source: input.input.source,
    workflowDefinitionId: input.workflowRun.workflowDefinitionId,
    ...(input.input.message ? { message: input.input.message } : {}),
    runAttempt: {
      id: input.runAttempt.id,
      status: input.runAttempt.status,
    },
  };
}

function buildRunAttemptFailedEvent(input: {
  input: FailWorkflowRunAttemptInput;
  workflowRun: WorkflowRunStartRecord;
  runAttempt: WorkflowRunAttemptFailedRecord;
  failedAt: string;
}): WorkflowRunEventRecord {
  return {
    at: input.failedAt,
    eventType: "run_attempt.failed",
    workflowRunId: input.workflowRun.id,
    source: input.input.source,
    workflowDefinitionId: input.workflowRun.workflowDefinitionId,
    ...(input.input.message ? { message: input.input.message } : {}),
    runAttempt: {
      id: input.runAttempt.id,
      status: input.runAttempt.status,
    },
  };
}

function buildRunAttemptCancelledEvent(input: {
  input: CancelWorkflowRunAttemptInput;
  workflowRun: WorkflowRunStartRecord;
  runAttempt: WorkflowRunAttemptCancelledRecord;
  cancelledAt: string;
}): WorkflowRunEventRecord {
  return {
    at: input.cancelledAt,
    eventType: "run_attempt.cancelled",
    workflowRunId: input.workflowRun.id,
    source: input.input.source,
    workflowDefinitionId: input.workflowRun.workflowDefinitionId,
    ...(input.input.message ? { message: input.input.message } : {}),
    runAttempt: {
      id: input.runAttempt.id,
      status: input.runAttempt.status,
    },
  };
}
