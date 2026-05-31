import type { ResolvedWorkflowRole, ResolvedWorkflowState } from "../workflow-definition/registry.js";
import type { TokenUsageSnapshot } from "../core/types.js";
import { evaluateValidationResultGate, ValidationProfileError } from "./validation-profile.js";
import { isSatisfiedVerificationArtifact } from "./verifier.js";

export interface WorkflowGateEvaluationInput {
  readonly workflowRunId: string;
  readonly gateId: string;
  readonly state: ResolvedWorkflowState;
  readonly stateRoles: readonly ResolvedWorkflowRole[];
  readonly artifacts: Readonly<Record<string, unknown>>;
}

export interface WorkflowGateEvaluationResult {
  readonly status: "passed" | "failed";
  readonly reason?: string;
  readonly evidence?: Readonly<Record<string, unknown>>;
  readonly tokenUsage?: TokenUsageSnapshot;
}

export interface WorkflowHookExecutionInput {
  readonly workflowRunId: string;
  readonly hookId: string;
  readonly state: ResolvedWorkflowState;
  readonly artifacts: Readonly<Record<string, unknown>>;
}

export interface WorkflowHookExecutionResult {
  readonly evidence: Readonly<Record<string, unknown>>;
}

export interface WorkflowExecutorEvent {
  readonly eventType:
    | "validation_gate.evaluated"
    | "workflow_budget.checked"
    | "workflow_gate.retry_requested"
    | "workflow_hook.fired";
  readonly workflowRunId: string;
  readonly stateId: string;
  readonly gateId?: string;
  readonly hookId?: string;
  readonly status?: WorkflowGateEvaluationResult["status"];
  readonly reason?: string;
  readonly evidence?: Readonly<Record<string, unknown>>;
  readonly tokenUsage?: TokenUsageSnapshot;
  readonly attemptNumber?: number;
}

export interface WorkflowGateFailureEvidence {
  readonly eventType: "validation_gate.evaluated";
  readonly workflowRunId: string;
  readonly stateId: string;
  readonly gateId: string;
  readonly status: "failed";
  readonly reason?: string;
  readonly evidence?: Readonly<Record<string, unknown>>;
  readonly tokenUsage?: TokenUsageSnapshot;
}

export class WorkflowGateHookEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowGateHookEngineError";
  }
}

export interface FireStateEntryHooksInput {
  readonly workflowRunId: string;
  readonly state: ResolvedWorkflowState;
  readonly artifacts: Readonly<Record<string, unknown>>;
  readonly runHook?: (input: WorkflowHookExecutionInput) => Promise<WorkflowHookExecutionResult>;
}

export interface EvaluateStateGatesInput {
  readonly workflowRunId: string;
  readonly state: ResolvedWorkflowState;
  readonly stateRoles: readonly ResolvedWorkflowRole[];
  readonly artifacts: Readonly<Record<string, unknown>>;
  readonly evaluateGate?: (input: WorkflowGateEvaluationInput) => Promise<WorkflowGateEvaluationResult>;
}

export interface EvaluateStateGatesResult {
  readonly status: WorkflowGateEvaluationResult["status"];
  readonly events: readonly WorkflowExecutorEvent[];
  readonly failureEvidence?: WorkflowGateFailureEvidence;
}

export async function fireStateEntryHooks(input: FireStateEntryHooksInput): Promise<readonly WorkflowExecutorEvent[]> {
  const events: WorkflowExecutorEvent[] = [];
  for (const hookId of input.state.hooks) {
    const result = await (input.runHook ?? defaultRunHook)({
      workflowRunId: input.workflowRunId,
      hookId,
      state: input.state,
      artifacts: input.artifacts,
    });
    events.push({
      eventType: "workflow_hook.fired",
      workflowRunId: input.workflowRunId,
      stateId: input.state.id,
      hookId,
      evidence: result.evidence,
    });
  }
  return events;
}

export async function evaluateStateGates(input: EvaluateStateGatesInput): Promise<EvaluateStateGatesResult> {
  const events: WorkflowExecutorEvent[] = [];
  for (const gateId of input.state.gates) {
    const result = await (input.evaluateGate ?? evaluateBuiltInGate)({
      workflowRunId: input.workflowRunId,
      gateId,
      state: input.state,
      stateRoles: input.stateRoles,
      artifacts: input.artifacts,
    });
    const event = buildGateEvent(input.workflowRunId, input.state.id, gateId, result);
    events.push(event);
    if (result.status === "failed") {
      return { status: "failed", events, failureEvidence: buildGateFailureEvidence(event) };
    }
  }
  return { status: "passed", events };
}

async function defaultRunHook(): Promise<WorkflowHookExecutionResult> {
  return { evidence: {} };
}

async function evaluateBuiltInGate(input: WorkflowGateEvaluationInput): Promise<WorkflowGateEvaluationResult> {
  const missingArtifact = missingArtifactForGate(input);
  if (missingArtifact) {
    return { status: "failed", reason: `missing required artifact ${missingArtifact}` };
  }
  if (input.gateId === "validation-passed") {
    return evaluateValidationPassedGate(input.artifacts["validation_result.v1"]);
  }
  if (input.gateId === "verifier-satisfied" && !isSatisfiedVerificationArtifact(input.artifacts["verification.v1"])) {
    return { status: "failed", reason: "verification.v1 decision is not satisfied" };
  }
  return { status: "passed" };
}

function evaluateValidationPassedGate(artifact: unknown): WorkflowGateEvaluationResult {
  try {
    return evaluateValidationResultGate(artifact);
  } catch (error) {
    if (error instanceof ValidationProfileError) {
      return { status: "failed", reason: error.message, evidence: { validationResult: artifact } };
    }
    throw error;
  }
}

function buildGateEvent(
  workflowRunId: string,
  stateId: string,
  gateId: string,
  result: WorkflowGateEvaluationResult,
): WorkflowExecutorEvent {
  return {
    eventType: "validation_gate.evaluated",
    workflowRunId,
    stateId,
    gateId,
    status: result.status,
    ...(result.reason ? { reason: result.reason } : {}),
    ...(result.evidence ? { evidence: result.evidence } : {}),
    ...(result.tokenUsage ? { tokenUsage: result.tokenUsage } : {}),
  };
}

function buildGateFailureEvidence(event: WorkflowExecutorEvent): WorkflowGateFailureEvidence {
  if (event.eventType !== "validation_gate.evaluated" || event.status !== "failed" || !event.gateId) {
    throw new WorkflowGateHookEngineError("cannot build gate failure evidence from a non-failed gate event");
  }
  return {
    eventType: "validation_gate.evaluated",
    workflowRunId: event.workflowRunId,
    stateId: event.stateId,
    gateId: event.gateId,
    status: "failed",
    ...(event.reason ? { reason: event.reason } : {}),
    ...(event.evidence ? { evidence: event.evidence } : {}),
    ...(event.tokenUsage ? { tokenUsage: event.tokenUsage } : {}),
  };
}

function missingArtifactForGate(input: WorkflowGateEvaluationInput): string | null {
  const requiredArtifacts = requiredArtifactsForGate(input);
  return requiredArtifacts.find((contractId) => input.artifacts[contractId] === undefined) ?? null;
}

function requiredArtifactsForGate(input: WorkflowGateEvaluationInput): readonly string[] {
  if (input.gateId === "artifacts-valid") {
    return [...new Set(input.stateRoles.flatMap((role) => [...role.consumes, ...role.produces]))];
  }
  if (input.gateId === "validation-passed") {
    return ["validation_result.v1"];
  }
  if (input.gateId === "verifier-satisfied") {
    return ["verification.v1"];
  }
  if (input.gateId === "budget-available") {
    return [];
  }
  throw new WorkflowGateHookEngineError(`unknown gate id ${input.gateId}`);
}
