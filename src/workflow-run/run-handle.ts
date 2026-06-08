import { randomUUID } from "node:crypto";

import { createWorkflowRunArchive, type WorkflowRunArchive, type WorkflowRunArchiveLocation } from "./archive.js";
import type {
  WorkflowRunArtifactReference,
  WorkflowRunAttemptCancelledOutput,
  WorkflowRunAttemptCompletedOutput,
  WorkflowRunAttemptFailedOutput,
  WorkflowRunAttemptStartedOutput,
  WorkflowRunEventRecord,
  WorkflowRunGateReference,
  WorkflowRunHookReference,
  WorkflowRunRoleExecutionCompletedOutput,
  WorkflowRunSource,
  WorkflowRunTransitionRecordedOutput,
  WorkflowRunWorkerProcessRecordedOutput,
  WorkflowRunWorkerProcessReference,
  WorkflowRunWorkspaceCleanupRecordedOutput,
  WorkflowRunWorkspaceCleanupReference,
  WorkflowRunWorkspaceLifecycleRecordedOutput,
} from "./contracts.js";

export interface OpenWorkflowRunInput {
  workflowRunId: string;
  source: WorkflowRunSource;
  now?: () => string;
}

export type RecordWorkerProcessInput = WorkflowRunWorkerProcessReference;

export interface RecordWorkspaceLifecycleInput {
  workspacePath: string;
  workspaceKey: string;
  repoUrl: string;
  branch: string;
}

export interface RecordWorkspaceCleanupInput {
  workspacePath: string;
  workspaceKey: string;
  result: WorkflowRunWorkspaceCleanupReference["result"];
  reason: WorkflowRunWorkspaceCleanupReference["reason"];
}

export interface RecordRoleExecutionInput {
  role: string;
  artifactContractId: string;
  artifactData: unknown;
  roleExecutionId?: string;
  artifactId?: string;
}

export interface RecordTransitionInput {
  fromState: string;
  toState: string;
  gate: WorkflowRunGateReference;
  hook: WorkflowRunHookReference;
}

export interface StartRunAttemptInput {
  attemptId: string;
  attemptNumber: number;
  reason: "initial" | "retry" | "resume";
}

export interface TerminalRunAttemptInput {
  attemptId: string;
  message?: string;
}

/**
 * Handle bound to a single durable Workflow Run. Owns the run's event
 * vocabulary and the event envelope; the underlying archive stays a thin
 * storage seam. The run metadata is loaded once by {@link openWorkflowRun}
 * and held in {@link RunContext}, so every recorded event is stamped from the
 * handle's own state rather than re-derived per call.
 */
export interface WorkflowRun {
  readonly id: string;
  readonly workflowDefinitionId: string;
  appendEvent(input: { eventType: string; message?: string }): Promise<WorkflowRunEventRecord>;
  recordWorkerProcess(input: RecordWorkerProcessInput): Promise<WorkflowRunWorkerProcessRecordedOutput>;
  recordWorkspaceLifecycle(input: RecordWorkspaceLifecycleInput): Promise<WorkflowRunWorkspaceLifecycleRecordedOutput>;
  recordWorkspaceCleanup(input: RecordWorkspaceCleanupInput): Promise<WorkflowRunWorkspaceCleanupRecordedOutput>;
  recordRoleExecution(input: RecordRoleExecutionInput): Promise<WorkflowRunRoleExecutionCompletedOutput>;
  recordTransition(input: RecordTransitionInput): Promise<WorkflowRunTransitionRecordedOutput>;
  startRunAttempt(input: StartRunAttemptInput): Promise<WorkflowRunAttemptStartedOutput>;
  completeRunAttempt(input: TerminalRunAttemptInput): Promise<WorkflowRunAttemptCompletedOutput>;
  failRunAttempt(input: TerminalRunAttemptInput): Promise<WorkflowRunAttemptFailedOutput>;
  cancelRunAttempt(input: TerminalRunAttemptInput): Promise<WorkflowRunAttemptCancelledOutput>;
}

interface RunContext {
  archive: WorkflowRunArchive;
  id: string;
  workflowDefinitionId: string;
  source: WorkflowRunSource;
  clock: () => string;
}

interface EventSpec {
  eventType: string;
  extra: Partial<WorkflowRunEventRecord>;
}

const TERMINAL_ATTEMPT_EVENT_TYPE = {
  completed: "run_attempt.completed",
  failed: "run_attempt.failed",
  cancelled: "run_attempt.cancelled",
} as const;

// The single place the event envelope is built. Every event in a batch shares
// one timestamp, matching the prior per-writer behavior.
async function emitEvents(ctx: RunContext, specs: EventSpec[]): Promise<WorkflowRunEventRecord[]> {
  const at = ctx.clock();
  const events = specs.map<WorkflowRunEventRecord>((spec) => ({
    at,
    eventType: spec.eventType,
    workflowRunId: ctx.id,
    source: ctx.source,
    workflowDefinitionId: ctx.workflowDefinitionId,
    ...spec.extra,
  }));
  return ctx.archive.appendWorkflowRunEvents(ctx.id, events);
}

async function emit(
  ctx: RunContext,
  eventType: string,
  extra: Partial<WorkflowRunEventRecord>,
): Promise<WorkflowRunEventRecord> {
  const [event] = await emitEvents(ctx, [{ eventType, extra }]);
  return event!;
}

async function appendEvent(
  ctx: RunContext,
  input: { eventType: string; message?: string },
): Promise<WorkflowRunEventRecord> {
  return emit(ctx, input.eventType, input.message ? { message: input.message } : {});
}

async function recordWorkerProcess(
  ctx: RunContext,
  worker: RecordWorkerProcessInput,
): Promise<WorkflowRunWorkerProcessRecordedOutput> {
  const eventType = worker.status === "succeeded" ? "worker_process.completed" : "worker_process.failed";
  const event = await emit(ctx, eventType, { workerProcess: { ...worker } });
  return { type: "workflow_run.worker_process_recorded", workerProcess: { workflowRunId: ctx.id, ...worker }, event };
}

async function recordWorkspaceLifecycle(
  ctx: RunContext,
  input: RecordWorkspaceLifecycleInput,
): Promise<WorkflowRunWorkspaceLifecycleRecordedOutput> {
  const workspace = { path: input.workspacePath, key: input.workspaceKey, status: "prepared" as const };
  const repo = { url: input.repoUrl, branch: input.branch, status: "checked_out" as const };
  const events = await emitEvents(ctx, [
    { eventType: "workspace.prepared", extra: { workspace } },
    { eventType: "repo.checked_out", extra: { repo } },
  ]);
  return {
    type: "workflow_run.workspace_lifecycle_recorded",
    lifecycle: { workflowRunId: ctx.id, workspace, repo },
    events,
  };
}

async function recordWorkspaceCleanup(
  ctx: RunContext,
  input: RecordWorkspaceCleanupInput,
): Promise<WorkflowRunWorkspaceCleanupRecordedOutput> {
  const cleanup = {
    workspace: { path: input.workspacePath, key: input.workspaceKey },
    result: input.result,
    reason: input.reason,
  };
  const event = await emit(ctx, "workspace.cleanup_completed", { cleanup });
  return { type: "workflow_run.workspace_cleanup_recorded", cleanup: { workflowRunId: ctx.id, ...cleanup }, event };
}

async function recordRoleExecution(
  ctx: RunContext,
  input: RecordRoleExecutionInput,
): Promise<WorkflowRunRoleExecutionCompletedOutput> {
  const roleExecutionId = input.roleExecutionId ?? `re_${randomUUID()}`;
  const artifact: WorkflowRunArtifactReference = await ctx.archive.writeWorkflowRunArtifact({
    workflowRunId: ctx.id,
    artifactId: input.artifactId,
    contractId: input.artifactContractId,
    data: input.artifactData,
    producer: { type: "role", id: input.role },
  });
  const event = await emit(ctx, "role_execution.completed", { roleExecutionId, role: input.role, artifact });
  return {
    type: "workflow_run.role_execution_completed",
    roleExecution: {
      id: roleExecutionId,
      workflowRunId: ctx.id,
      role: input.role,
      status: "completed",
      completedAt: event.at,
      artifact,
    },
  };
}

async function recordTransition(
  ctx: RunContext,
  input: RecordTransitionInput,
): Promise<WorkflowRunTransitionRecordedOutput> {
  const events = await emitEvents(ctx, [
    { eventType: "validation_gate.evaluated", extra: { gate: input.gate } },
    { eventType: "workflow_transition.applied", extra: { fromState: input.fromState, toState: input.toState } },
    { eventType: "workflow_hook.fired", extra: { hook: input.hook } },
  ]);
  return { type: "workflow_run.transition_recorded", transition: { workflowRunId: ctx.id, ...input }, events };
}

async function startRunAttempt(ctx: RunContext, input: StartRunAttemptInput): Promise<WorkflowRunAttemptStartedOutput> {
  const runAttempt = {
    id: input.attemptId,
    attemptNumber: input.attemptNumber,
    status: "running" as const,
    reason: input.reason,
  };
  const event = await emit(ctx, "run_attempt.started", { runAttempt });
  return {
    type: "workflow_run.run_attempt_started",
    runAttempt: { workflowRunId: ctx.id, startedAt: event.at, ...runAttempt },
    event,
  };
}

function emitTerminalAttempt(
  ctx: RunContext,
  status: "completed" | "failed" | "cancelled",
  input: TerminalRunAttemptInput,
): Promise<WorkflowRunEventRecord> {
  return emit(ctx, TERMINAL_ATTEMPT_EVENT_TYPE[status], {
    ...(input.message ? { message: input.message } : {}),
    runAttempt: { id: input.attemptId, status },
  });
}

async function completeRunAttempt(
  ctx: RunContext,
  input: TerminalRunAttemptInput,
): Promise<WorkflowRunAttemptCompletedOutput> {
  const event = await emitTerminalAttempt(ctx, "completed", input);
  return {
    type: "workflow_run.run_attempt_completed",
    runAttempt: { id: input.attemptId, workflowRunId: ctx.id, status: "completed", completedAt: event.at },
    event,
  };
}

async function failRunAttempt(
  ctx: RunContext,
  input: TerminalRunAttemptInput,
): Promise<WorkflowRunAttemptFailedOutput> {
  const event = await emitTerminalAttempt(ctx, "failed", input);
  return {
    type: "workflow_run.run_attempt_failed",
    runAttempt: { id: input.attemptId, workflowRunId: ctx.id, status: "failed", failedAt: event.at },
    event,
  };
}

async function cancelRunAttempt(
  ctx: RunContext,
  input: TerminalRunAttemptInput,
): Promise<WorkflowRunAttemptCancelledOutput> {
  const event = await emitTerminalAttempt(ctx, "cancelled", input);
  return {
    type: "workflow_run.run_attempt_cancelled",
    runAttempt: { id: input.attemptId, workflowRunId: ctx.id, status: "cancelled", cancelledAt: event.at },
    event,
  };
}

export async function openWorkflowRun(
  location: WorkflowRunArchiveLocation,
  input: OpenWorkflowRunInput,
): Promise<WorkflowRun> {
  const archive = createWorkflowRunArchive(location);
  const { id, workflowDefinitionId } = await archive.loadWorkflowRun(input.workflowRunId);
  const ctx: RunContext = {
    archive,
    id,
    workflowDefinitionId,
    source: input.source,
    clock: input.now ?? (() => new Date().toISOString()),
  };
  return {
    id,
    workflowDefinitionId,
    appendEvent: (event) => appendEvent(ctx, event),
    recordWorkerProcess: (worker) => recordWorkerProcess(ctx, worker),
    recordWorkspaceLifecycle: (workspace) => recordWorkspaceLifecycle(ctx, workspace),
    recordWorkspaceCleanup: (cleanup) => recordWorkspaceCleanup(ctx, cleanup),
    recordRoleExecution: (role) => recordRoleExecution(ctx, role),
    recordTransition: (transition) => recordTransition(ctx, transition),
    startRunAttempt: (attempt) => startRunAttempt(ctx, attempt),
    completeRunAttempt: (attempt) => completeRunAttempt(ctx, attempt),
    failRunAttempt: (attempt) => failRunAttempt(ctx, attempt),
    cancelRunAttempt: (attempt) => cancelRunAttempt(ctx, attempt),
  };
}
