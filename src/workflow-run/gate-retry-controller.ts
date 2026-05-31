import type { ResolvedWorkflowRole, ResolvedWorkflowState } from "../workflow-definition/registry.js";
import { DEFAULT_GATE_RETRY_LIMIT, evaluateWorkflowBudget, type WorkflowBudgetPolicy } from "./budget-retry.js";
import {
  evaluateStateGates,
  type WorkflowExecutorEvent,
  type WorkflowGateEvaluationInput,
  type WorkflowGateEvaluationResult,
  type WorkflowGateFailureEvidence,
} from "./gate-hook-engine.js";

export interface WorkflowGateRetryInput {
  readonly workflowRunId: string;
  readonly gateId: string;
  readonly state: ResolvedWorkflowState;
  readonly stateRoles: readonly ResolvedWorkflowRole[];
  readonly artifacts: Readonly<Record<string, unknown>>;
  readonly failureEvidence: WorkflowGateFailureEvidence;
  readonly attemptNumber: number;
}

export interface EvaluateStateGatesWithRetryInput {
  readonly workflowRunId: string;
  readonly artifacts: Record<string, unknown>;
  readonly state: ResolvedWorkflowState;
  readonly stateRoles: readonly ResolvedWorkflowRole[];
  readonly evaluateGate?: (input: WorkflowGateEvaluationInput) => Promise<WorkflowGateEvaluationResult>;
  readonly retryGate?: (input: WorkflowGateRetryInput) => Promise<Readonly<Record<string, unknown>>>;
  readonly maxGateRetries?: number;
  readonly budget?: WorkflowBudgetPolicy;
  readonly retryAttemptsUsed: number;
}

export interface EvaluateStateGatesWithRetryResult {
  readonly status: WorkflowGateEvaluationResult["status"];
  readonly events: readonly WorkflowExecutorEvent[];
  readonly retryAttemptsUsed: number;
}

export async function evaluateStateGatesWithRetry(
  input: EvaluateStateGatesWithRetryInput,
): Promise<EvaluateStateGatesWithRetryResult> {
  const gateResult = await evaluateStateGates({
    workflowRunId: input.workflowRunId,
    state: input.state,
    stateRoles: input.stateRoles,
    artifacts: input.artifacts,
    evaluateGate: input.evaluateGate,
  });
  if (gateResult.status === "passed" || !gateResult.failureEvidence) {
    return { status: gateResult.status, events: gateResult.events, retryAttemptsUsed: input.retryAttemptsUsed };
  }
  return retryFailedGate(input, gateResult.events, gateResult.failureEvidence);
}

async function retryFailedGate(
  input: EvaluateStateGatesWithRetryInput,
  gateEvents: readonly WorkflowExecutorEvent[],
  failureEvidence: WorkflowGateFailureEvidence,
): Promise<EvaluateStateGatesWithRetryResult> {
  const retryLimit = input.maxGateRetries ?? DEFAULT_GATE_RETRY_LIMIT;
  if (!input.retryGate || input.retryAttemptsUsed >= retryLimit) {
    return { status: "failed", events: gateEvents, retryAttemptsUsed: input.retryAttemptsUsed };
  }
  const budgetEvent = evaluateBudgetBeforeRetry(input, failureEvidence);
  if (budgetEvent) {
    const events = [...gateEvents, budgetEvent];
    if (budgetEvent.status === "failed") {
      return { status: "failed", events, retryAttemptsUsed: input.retryAttemptsUsed };
    }
    return retryAllowedGate(input, events, failureEvidence, input.retryGate);
  }
  return retryAllowedGate(input, gateEvents, failureEvidence, input.retryGate);
}

async function retryAllowedGate(
  input: EvaluateStateGatesWithRetryInput,
  gateEvents: readonly WorkflowExecutorEvent[],
  failureEvidence: WorkflowGateFailureEvidence,
  retryGate: (input: WorkflowGateRetryInput) => Promise<Readonly<Record<string, unknown>>>,
): Promise<EvaluateStateGatesWithRetryResult> {
  const attemptNumber = input.retryAttemptsUsed + 1;
  const produced = await retryGate({
    workflowRunId: input.workflowRunId,
    gateId: failureEvidence.gateId,
    state: input.state,
    stateRoles: input.stateRoles,
    artifacts: input.artifacts,
    failureEvidence,
    attemptNumber,
  });
  storeRetryArtifacts(input.artifacts, produced);
  return evaluateRetriedGate(input, gateEvents, failureEvidence, attemptNumber);
}

function evaluateBudgetBeforeRetry(
  input: EvaluateStateGatesWithRetryInput,
  failureEvidence: WorkflowGateFailureEvidence,
): WorkflowExecutorEvent | null {
  if (!input.budget) {
    return null;
  }
  const result = evaluateWorkflowBudget({
    policy: input.budget,
    nextStepLabel: `gate retry ${failureEvidence.gateId}`,
  });
  return {
    eventType: "workflow_budget.checked",
    workflowRunId: input.workflowRunId,
    stateId: input.state.id,
    gateId: failureEvidence.gateId,
    status: result.status,
    evidence: result.evidence,
    ...(result.reason ? { reason: result.reason } : {}),
  };
}

async function evaluateRetriedGate(
  input: EvaluateStateGatesWithRetryInput,
  gateEvents: readonly WorkflowExecutorEvent[],
  failureEvidence: WorkflowGateFailureEvidence,
  attemptNumber: number,
): Promise<EvaluateStateGatesWithRetryResult> {
  const retriedGateResult = await evaluateStateGates({
    workflowRunId: input.workflowRunId,
    state: input.state,
    stateRoles: input.stateRoles,
    artifacts: input.artifacts,
    evaluateGate: input.evaluateGate,
  });
  return {
    status: retriedGateResult.status,
    events: [
      ...gateEvents,
      buildGateRetryEvent(input.workflowRunId, input.state.id, failureEvidence, attemptNumber),
      ...retriedGateResult.events,
    ],
    retryAttemptsUsed: attemptNumber,
  };
}

function storeRetryArtifacts(artifacts: Record<string, unknown>, produced: Readonly<Record<string, unknown>>): void {
  for (const [contractId, artifact] of Object.entries(produced)) {
    artifacts[contractId] = artifact;
  }
}

function buildGateRetryEvent(
  workflowRunId: string,
  stateId: string,
  failureEvidence: WorkflowGateFailureEvidence,
  attemptNumber: number,
): WorkflowExecutorEvent {
  return {
    eventType: "workflow_gate.retry_requested",
    workflowRunId,
    stateId,
    gateId: failureEvidence.gateId,
    status: "passed",
    evidence: { failureEvidence },
    attemptNumber,
  };
}
