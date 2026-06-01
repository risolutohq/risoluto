import type { ResolvedWorkflowDefinition } from "../workflow-definition/registry.js";
import { createWorkflowRunArchive, type WorkflowRunArchive, type WorkflowRunArchiveLocation } from "./archive.js";
import type { WorkflowRunStartRecord } from "./contracts.js";
import { writeDoneHandoff } from "./drive-done-handoff.js";
import {
  createWorkflowRunEvidenceStore,
  type WorkflowRunEvidenceRecord,
  type WriteWorkflowRunEvidenceInput,
} from "./evidence-store.js";
import { toWorkflowRunEventRecords } from "./executor-event-log.js";
import { WorkflowExecutorError, type ExecuteWorkflowDefinitionInput, type WorkflowExecutorResult } from "./executor.js";
import type {
  WorkflowExecutorEvent,
  WorkflowHookExecutionInput,
  WorkflowHookExecutionResult,
} from "./gate-hook-engine.js";
import type { HandoffArtifact } from "./handoff-contract.js";
import type { WorkflowRunIntentArtifact } from "./intake-core.js";
import { createWorkflowRunMemoryStore, type WorkflowRunAttemptMemoryRecord } from "./memory-store.js";
import { WorkflowRunActionError } from "./run-action-runner.js";
import { WorkflowRunRoleDispatchError } from "./run-role-runner.js";
import { driveWorkflowRun } from "./workflow-run-driver.js";

export interface DriveAcceptedWorkflowRunInput extends WorkflowRunArchiveLocation {
  readonly definition: ResolvedWorkflowDefinition;
  readonly workflowRun: WorkflowRunStartRecord;
  readonly intent: WorkflowRunIntentArtifact;
  readonly runRole: ExecuteWorkflowDefinitionInput["runRole"];
  readonly runAction?: ExecuteWorkflowDefinitionInput["runAction"];
  readonly runHook?: ExecuteWorkflowDefinitionInput["runHook"];
  readonly evaluateGate?: ExecuteWorkflowDefinitionInput["evaluateGate"];
  readonly retryGate?: ExecuteWorkflowDefinitionInput["retryGate"];
  readonly maxGateRetries?: number;
  readonly budget?: ExecuteWorkflowDefinitionInput["budget"];
  readonly now?: () => string;
}

export interface DriveAcceptedWorkflowRunResult {
  readonly outcome: "blocked" | "done";
  readonly workflowRunId: string;
  readonly roleExecutions: readonly string[];
  readonly reason?: string;
  readonly handoffArtifactId?: string;
}

/**
 * Advance an accepted Workflow Run through the SAME engine every intake surface drives. On a clean run
 * it returns `done`; on a planner/gate/budget block it returns `blocked`; on a role/dispatch failure it
 * records the block and writes a real `handoff.v1` — an honest handoff, never a stubbed success.
 */
export async function driveAcceptedWorkflowRun(
  input: DriveAcceptedWorkflowRunInput,
): Promise<DriveAcceptedWorkflowRunResult> {
  const archive = createWorkflowRunArchive(input);
  const location = archiveLocation(input);
  const now = input.now ?? defaultNow;
  const { runHook, getEvidenceRefs } = input.runHook
    ? { runHook: input.runHook, getEvidenceRefs: () => [] as EvidenceRef[] }
    : createEvidenceCapturingHook(location, now);
  try {
    const result = await driveWorkflowRun({
      ...location,
      definition: input.definition,
      workflowRunId: input.workflowRun.id,
      initialArtifacts: { "intent.v1": input.intent },
      runRole: input.runRole,
      ...(input.runAction ? { runAction: input.runAction } : {}),
      runHook,
      ...(input.evaluateGate ? { evaluateGate: input.evaluateGate } : {}),
      ...(input.retryGate ? { retryGate: input.retryGate } : {}),
      ...(input.maxGateRetries === undefined ? {} : { maxGateRetries: input.maxGateRetries }),
      ...(input.budget ? { budget: input.budget } : {}),
    });
    const evidenceRefs = getEvidenceRefs();
    const memoryRecord = await writeAttemptMemory(input, location, now, result.status, evidenceRefs);
    return await finishDrivenRun(archive, input, location, result, memoryRecord, evidenceRefs);
  } catch (error) {
    if (
      !(
        error instanceof WorkflowExecutorError ||
        error instanceof WorkflowRunRoleDispatchError ||
        error instanceof WorkflowRunActionError
      )
    ) {
      throw error;
    }
    await writeAttemptMemory(input, location, now, "blocked", getEvidenceRefs());
    return await finishFailedRun(archive, input, error.message);
  }
}

async function finishDrivenRun(
  archive: WorkflowRunArchive,
  input: DriveAcceptedWorkflowRunInput,
  location: WorkflowRunArchiveLocation,
  result: WorkflowExecutorResult,
  memoryRecord: WorkflowRunAttemptMemoryRecord,
  evidenceRefs: readonly EvidenceRef[],
): Promise<DriveAcceptedWorkflowRunResult> {
  await persistExecutorEvents(archive, input, result.events);
  if (result.status === "done") {
    const createdAt = (input.now ?? defaultNow)();
    const handoff = await writeDoneHandoff(
      archive,
      { workflowRunId: input.workflowRun.id, createdAt },
      location,
      result,
      memoryRecord,
      evidenceRefs,
    );
    return {
      outcome: "done",
      workflowRunId: input.workflowRun.id,
      roleExecutions: result.roleExecutions,
      handoffArtifactId: handoff.artifactId,
    };
  }
  const { reason, kind } = blockedOutcome(result.events);
  const handoff = await writeBlockedHandoff(archive, input, reason, kind);
  return {
    outcome: "blocked",
    workflowRunId: input.workflowRun.id,
    roleExecutions: result.roleExecutions,
    reason,
    handoffArtifactId: handoff.artifactId,
  };
}

async function finishFailedRun(
  archive: WorkflowRunArchive,
  input: DriveAcceptedWorkflowRunInput,
  reason: string,
): Promise<DriveAcceptedWorkflowRunResult> {
  await archive.updateWorkflowRunStatus(input.workflowRun.id, "blocked");
  const handoff = await writeBlockedHandoff(archive, input, reason, "failed_gate");
  return {
    outcome: "blocked",
    workflowRunId: input.workflowRun.id,
    roleExecutions: [],
    reason,
    handoffArtifactId: handoff.artifactId,
  };
}

function blockedOutcome(events: readonly WorkflowExecutorEvent[]): {
  reason: string;
  kind: "blocking_question" | "failed_gate";
} {
  const failedGate = [...events]
    .reverse()
    .find((event) => event.eventType === "validation_gate.evaluated" && event.status === "failed");
  if (failedGate) {
    return {
      reason: `gate ${failedGate.gateId} failed${failedGate.reason ? `: ${failedGate.reason}` : ""}`,
      kind: "failed_gate",
    };
  }
  const budgetStop = [...events]
    .reverse()
    .find((event) => event.eventType === "workflow_budget.checked" && event.status === "failed");
  if (budgetStop) {
    return { reason: `budget exhausted${budgetStop.reason ? `: ${budgetStop.reason}` : ""}`, kind: "failed_gate" };
  }
  return { reason: "planner triage blocked the run before implementation budget was spent", kind: "blocking_question" };
}

async function writeBlockedHandoff(
  archive: WorkflowRunArchive,
  input: DriveAcceptedWorkflowRunInput,
  reason: string,
  kind: "blocking_question" | "failed_gate",
): Promise<{ artifactId: string }> {
  const createdAt = (input.now ?? defaultNow)();
  const handoff: HandoffArtifact = {
    version: 1,
    workflowRunId: input.workflowRun.id,
    createdAt,
    outcome: "blocked",
    summary: `Workflow Run ${input.workflowRun.id} blocked: ${reason}`,
    recommendedNextAction: "Resolve the blocker, then retry the run from the CLI.",
    suggestedSkills: ["risoluto-tdd"],
    budget: { elapsedMs: 0, costUsd: 0 },
    validation: { status: "not_run" },
    attemptMemory: [],
    output: { branchName: null, pullRequestUrl: null },
    blockers: [{ kind, message: reason }],
    artifacts: [],
    evidence: [],
  };
  return archive.writeWorkflowRunArtifact({
    workflowRunId: input.workflowRun.id,
    contractId: "handoff.v1",
    artifactId: "handoff",
    data: handoff,
    producer: { type: "action", id: "write-handoff" },
  });
}

async function persistExecutorEvents(
  archive: WorkflowRunArchive,
  input: DriveAcceptedWorkflowRunInput,
  events: readonly WorkflowExecutorEvent[],
): Promise<void> {
  if (events.length === 0) {
    return;
  }
  const records = toWorkflowRunEventRecords(events, {
    source: input.workflowRun.source,
    at: (input.now ?? defaultNow)(),
  });
  await archive.appendWorkflowRunEvents(input.workflowRun.id, records);
}

interface EvidenceRef {
  readonly evidenceId: string;
  readonly path: string;
}

interface EvidenceCapturingHook {
  readonly runHook: (input: WorkflowHookExecutionInput) => Promise<WorkflowHookExecutionResult>;
  readonly getEvidenceRefs: () => readonly EvidenceRef[];
}

function createEvidenceCapturingHook(location: WorkflowRunArchiveLocation, now: () => string): EvidenceCapturingHook {
  const store = createWorkflowRunEvidenceStore(location);
  const refs: EvidenceRef[] = [];
  const runHook = async (hookInput: WorkflowHookExecutionInput): Promise<WorkflowHookExecutionResult> => {
    const evidenceId = `${hookInput.hookId}-${hookInput.state.id}`;
    const writeInput: WriteWorkflowRunEvidenceInput = {
      workflowRunId: hookInput.workflowRunId,
      evidenceId,
      kind: "hook_fired",
      source: hookInput.hookId,
      createdAt: now(),
      content: { hookId: hookInput.hookId, stateId: hookInput.state.id },
      classifiedFields: [],
    };
    const record: WorkflowRunEvidenceRecord = await store.writeEvidence(writeInput);
    refs.push({ evidenceId: record.evidenceId, path: record.path });
    return { evidence: { hookId: hookInput.hookId, stateId: hookInput.state.id, evidenceId } };
  };
  return { runHook, getEvidenceRefs: () => refs };
}

async function writeAttemptMemory(
  input: DriveAcceptedWorkflowRunInput,
  location: WorkflowRunArchiveLocation,
  now: () => string,
  status: "blocked" | "done",
  evidenceRefs: readonly EvidenceRef[],
): Promise<WorkflowRunAttemptMemoryRecord> {
  const store = createWorkflowRunMemoryStore(location);
  return store.writeAttemptMemory({
    workflowRunId: input.workflowRun.id,
    attemptId: "attempt-1",
    attemptNumber: 1,
    createdAt: now(),
    summary: `Workflow Run ${input.workflowRun.id} completed with status: ${status}`,
    evidenceRefs,
  });
}

function archiveLocation(input: WorkflowRunArchiveLocation): WorkflowRunArchiveLocation {
  return {
    ...(input.dataDir ? { dataDir: input.dataDir } : {}),
    ...(input.archiveDir ? { archiveDir: input.archiveDir } : {}),
  };
}

function defaultNow(): string {
  return new Date().toISOString();
}
