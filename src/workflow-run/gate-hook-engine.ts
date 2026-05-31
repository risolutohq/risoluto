import type { ResolvedWorkflowRole, ResolvedWorkflowState } from "../workflow-definition/registry.js";

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
  readonly eventType: "validation_gate.evaluated" | "workflow_hook.fired";
  readonly workflowRunId: string;
  readonly stateId: string;
  readonly gateId?: string;
  readonly hookId?: string;
  readonly status?: WorkflowGateEvaluationResult["status"];
  readonly reason?: string;
  readonly evidence?: Readonly<Record<string, unknown>>;
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
    events.push(buildGateEvent(input.workflowRunId, input.state.id, gateId, result));
    if (result.status === "failed") {
      return { status: "failed", events };
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
  return { status: "passed" };
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
