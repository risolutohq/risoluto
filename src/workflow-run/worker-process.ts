import { createWorkflowRunArchive } from "./archive.js";
import type {
  WorkflowRunEventRecord,
  WorkflowRunSource,
  WorkflowRunStartRecord,
  WorkflowRunWorkerProcessReference,
} from "./artifacts.js";

export interface WorkflowRunWorkerProcessRecord extends WorkflowRunWorkerProcessReference {
  workflowRunId: string;
}

export interface WorkflowRunWorkerProcessRecordedOutput {
  type: "workflow_run.worker_process_recorded";
  workerProcess: WorkflowRunWorkerProcessRecord;
  event: WorkflowRunEventRecord;
}

export interface RecordWorkflowRunWorkerProcessInput {
  dataDir?: string;
  archiveDir?: string;
  workflowRunId: string;
  source: WorkflowRunSource;
  workerId: string;
  role: string;
  harness: string;
  status: WorkflowRunWorkerProcessReference["status"];
  exitCode: number;
  now?: () => string;
}

export async function recordWorkflowRunWorkerProcess(
  input: RecordWorkflowRunWorkerProcessInput,
): Promise<WorkflowRunWorkerProcessRecordedOutput> {
  const archive = createWorkflowRunArchive(input);
  const workflowRun = await archive.loadWorkflowRun(input.workflowRunId);
  const workerProcess = buildWorkerProcess(input, workflowRun);
  const event = buildWorkerProcessEvent({
    input,
    workflowRun,
    workerProcess,
    at: input.now?.() ?? new Date().toISOString(),
  });

  const [sequencedEvent] = await archive.appendWorkflowRunEvents(input.workflowRunId, [event]);
  return {
    type: "workflow_run.worker_process_recorded",
    workerProcess,
    event: sequencedEvent!,
  };
}

function buildWorkerProcess(
  input: RecordWorkflowRunWorkerProcessInput,
  workflowRun: WorkflowRunStartRecord,
): WorkflowRunWorkerProcessRecord {
  return {
    workflowRunId: workflowRun.id,
    workerId: input.workerId,
    role: input.role,
    harness: input.harness,
    status: input.status,
    exitCode: input.exitCode,
  };
}

function buildWorkerProcessEvent(input: {
  input: RecordWorkflowRunWorkerProcessInput;
  workflowRun: WorkflowRunStartRecord;
  workerProcess: WorkflowRunWorkerProcessRecord;
  at: string;
}): WorkflowRunEventRecord {
  return {
    at: input.at,
    eventType: input.workerProcess.status === "succeeded" ? "worker_process.completed" : "worker_process.failed",
    workflowRunId: input.workflowRun.id,
    source: input.input.source,
    workflowDefinitionId: input.workflowRun.workflowDefinitionId,
    workerProcess: {
      workerId: input.workerProcess.workerId,
      role: input.workerProcess.role,
      harness: input.workerProcess.harness,
      status: input.workerProcess.status,
      exitCode: input.workerProcess.exitCode,
    },
  };
}
