import type {
  WorkflowRunAttemptReference,
  WorkflowRunEventRecord,
  WorkflowRunEventsListedOutput,
} from "./artifacts.js";
import { readWorkflowRunEvents } from "./artifacts.js";

export interface WorkflowRunAttemptSummary {
  id: string;
  workflowRunId: string;
  attemptNumber?: number;
  reason?: WorkflowRunAttemptReference["reason"];
  status: WorkflowRunAttemptReference["status"];
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
  cancelledAt?: string;
  message?: string;
}

export interface WorkflowRunAttemptsListedOutput {
  type: "workflow_run.run_attempts_listed";
  workflowRun: WorkflowRunEventsListedOutput["workflowRun"];
  runAttempts: WorkflowRunAttemptSummary[];
}

export interface ListWorkflowRunAttemptsInput {
  dataDir?: string;
  archiveDir?: string;
  workflowRunId: string;
}

export async function listWorkflowRunAttempts(
  input: ListWorkflowRunAttemptsInput,
): Promise<WorkflowRunAttemptsListedOutput> {
  const listed = await readWorkflowRunEvents(input);
  return {
    type: "workflow_run.run_attempts_listed",
    workflowRun: listed.workflowRun,
    runAttempts: projectRunAttempts(listed.events),
  };
}

function projectRunAttempts(events: WorkflowRunEventRecord[]): WorkflowRunAttemptSummary[] {
  const attempts = new Map<string, WorkflowRunAttemptSummary>();

  for (const event of events) {
    if (event.runAttempt) {
      attempts.set(event.runAttempt.id, applyRunAttemptEvent(attempts.get(event.runAttempt.id), event));
    }
  }

  return Array.from(attempts.values()).sort(compareRunAttempts);
}

function applyRunAttemptEvent(
  current: WorkflowRunAttemptSummary | undefined,
  event: WorkflowRunEventRecord,
): WorkflowRunAttemptSummary {
  const runAttempt = event.runAttempt;
  if (!runAttempt) {
    throw new TypeError("run attempt event is missing runAttempt payload");
  }

  const next: WorkflowRunAttemptSummary = {
    ...current,
    id: runAttempt.id,
    workflowRunId: event.workflowRunId,
    ...(runAttempt.attemptNumber ? { attemptNumber: runAttempt.attemptNumber } : {}),
    ...(runAttempt.reason ? { reason: runAttempt.reason } : {}),
    status: runAttempt.status,
    ...(event.message ? { message: event.message } : {}),
  };

  if (event.eventType === "run_attempt.started") {
    return { ...next, startedAt: event.at };
  }
  if (event.eventType === "run_attempt.completed") {
    return { ...next, completedAt: event.at };
  }
  if (event.eventType === "run_attempt.failed") {
    return { ...next, failedAt: event.at };
  }
  if (event.eventType === "run_attempt.cancelled") {
    return { ...next, cancelledAt: event.at };
  }
  return next;
}

function compareRunAttempts(left: WorkflowRunAttemptSummary, right: WorkflowRunAttemptSummary): number {
  const leftNumber = left.attemptNumber ?? Number.MAX_SAFE_INTEGER;
  const rightNumber = right.attemptNumber ?? Number.MAX_SAFE_INTEGER;
  if (leftNumber !== rightNumber) {
    return leftNumber - rightNumber;
  }
  return left.id.localeCompare(right.id);
}
