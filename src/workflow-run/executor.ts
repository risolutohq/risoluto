import type { ResolvedWorkflowDefinition, ResolvedWorkflowRole } from "../workflow-definition/registry.js";
import type { WorkflowBudgetPolicy } from "./budget-retry.js";
import { DEFAULT_GATE_RETRY_LIMIT } from "./budget-retry.js";
import type { WorkflowRunStatus } from "./contracts.js";
import { executeConfiguredWorkflowActions, type WorkflowActionExecutionInput } from "./executor-actions.js";
import { evaluateStateGatesWithRetry, type WorkflowGateRetryInput } from "./gate-retry-controller.js";
import {
  fireStateEntryHooks,
  type WorkflowExecutorEvent,
  type WorkflowGateEvaluationInput,
  type WorkflowGateEvaluationResult,
  type WorkflowHookExecutionInput,
  type WorkflowHookExecutionResult,
} from "./gate-hook-engine.js";
import {
  appendBudgetEvent,
  assertRequiredArtifacts,
  nextRoleStartsNewState,
  orderRoles,
  pickArtifacts,
  plannerBlocked,
  rolesForState,
  stateForRole,
  storeProducedArtifacts,
} from "./executor-roles.js";
import { buildSingleVerifierInput, routeSingleVerifierDecision } from "./verifier.js";

export { WorkflowExecutorError } from "./executor-errors.js";

export interface ExecuteWorkflowDefinitionInput {
  readonly definition: ResolvedWorkflowDefinition;
  readonly workflowRunId: string;
  readonly initialArtifacts: Readonly<Record<string, unknown>>;
  readonly evaluateGate?: (input: WorkflowGateEvaluationInput) => Promise<WorkflowGateEvaluationResult>;
  readonly runHook?: (input: WorkflowHookExecutionInput) => Promise<WorkflowHookExecutionResult>;
  readonly runRole: (input: WorkflowRoleExecutionInput) => Promise<Readonly<Record<string, unknown>>>;
  readonly runAction?: (input: WorkflowActionExecutionInput) => Promise<Readonly<Record<string, unknown>>>;
  readonly recordStatus?: (input: WorkflowStatusRecordInput) => Promise<void>;
  readonly retryGate?: (input: WorkflowGateRetryInput) => Promise<Readonly<Record<string, unknown>>>;
  readonly maxGateRetries?: number;
  readonly budget?: WorkflowBudgetPolicy;
}

export interface WorkflowRoleExecutionInput {
  readonly workflowRunId: string;
  readonly role: ResolvedWorkflowRole;
  readonly artifacts: Readonly<Record<string, unknown>>;
}

export interface WorkflowStatusRecordInput {
  readonly workflowRunId: string;
  readonly status: Extract<WorkflowRunStatus, "blocked" | "done" | "running">;
}

export interface WorkflowExecutorResult {
  readonly status: Extract<WorkflowRunStatus, "blocked" | "done">;
  readonly workflowStatesVisited: readonly string[];
  readonly roleExecutions: readonly string[];
  readonly actionExecutions: readonly string[];
  readonly events: readonly WorkflowExecutorEvent[];
  readonly artifacts: Readonly<Record<string, unknown>>;
}

interface WorkflowExecutionState {
  readonly artifacts: Record<string, unknown>;
  readonly statesVisited: string[];
  readonly roleExecutions: string[];
  readonly actionExecutions: string[];
  readonly events: WorkflowExecutorEvent[];
}

export async function executeWorkflowDefinition(
  input: ExecuteWorkflowDefinitionInput,
): Promise<WorkflowExecutorResult> {
  const state = createWorkflowExecutionState(input);
  const orderedRoles = orderRoles(input.definition.roles);
  let currentStateId: string | undefined;
  let gateRetryAttempts = 0;

  await recordWorkflowRunStatus(input, "running");
  await executeConfiguredWorkflowActions({ ...input, ...state, phase: "before_roles" });
  for (const [index, role] of orderedRoles.entries()) {
    if (appendBudgetEvent(state.events, input.budget, role.id, input.workflowRunId)) {
      return finishWorkflowExecution(input, "blocked", state);
    }
    currentStateId = await fireHooksForNewState(input, state.artifacts, state.events, role, currentStateId);
    assertRequiredArtifacts(role, state.artifacts, input.definition.roles);
    rememberState(state.statesVisited, role.stateId);
    const produced = await input.runRole({
      workflowRunId: input.workflowRunId,
      role,
      artifacts: pickArtifacts(state.artifacts, role.consumes),
    });
    storeProducedArtifacts(state.artifacts, role, produced);
    state.roleExecutions.push(role.id);
    if (role.id === "planner" && plannerBlocked(state.artifacts["plan.v1"])) {
      return finishWorkflowExecution(input, "blocked", state);
    }
    if (role.produces.includes("verification.v1")) {
      const retryBudgetRemaining = (input.maxGateRetries ?? DEFAULT_GATE_RETRY_LIMIT) - gateRetryAttempts;
      const verifierRoute = routeVerifierResult(state.artifacts, retryBudgetRemaining);
      if (verifierRoute !== "continue_to_publish") {
        return finishWorkflowExecution(input, "blocked", state);
      }
    }
    if (nextRoleStartsNewState(orderedRoles, index, role.stateId)) {
      const gateResult = await evaluateGatesAfterRole(input, role, state, gateRetryAttempts);
      gateRetryAttempts = gateResult.retryAttemptsUsed;
      state.events.push(...gateResult.events);
      if (gateResult.failed) {
        return finishWorkflowExecution(input, "blocked", state);
      }
    }
  }

  await executeConfiguredWorkflowActions({ ...input, ...state, phase: "after_roles" });
  return finishWorkflowExecution(input, "done", state);
}

async function finishWorkflowExecution(
  input: ExecuteWorkflowDefinitionInput,
  status: Extract<WorkflowRunStatus, "blocked" | "done">,
  state: WorkflowExecutionState,
): Promise<WorkflowExecutorResult> {
  await recordWorkflowRunStatus(input, status);
  return {
    status,
    workflowStatesVisited: state.statesVisited,
    roleExecutions: state.roleExecutions,
    actionExecutions: state.actionExecutions,
    events: state.events,
    artifacts: state.artifacts,
  };
}

function createWorkflowExecutionState(input: ExecuteWorkflowDefinitionInput): WorkflowExecutionState {
  return {
    artifacts: { ...input.initialArtifacts },
    statesVisited: [],
    roleExecutions: [],
    actionExecutions: [],
    events: [],
  };
}

async function evaluateGatesAfterRole(
  input: ExecuteWorkflowDefinitionInput,
  role: ResolvedWorkflowRole,
  executionState: WorkflowExecutionState,
  retryAttemptsUsed: number,
): Promise<{
  readonly events: readonly WorkflowExecutorEvent[];
  readonly failed: boolean;
  readonly retryAttemptsUsed: number;
}> {
  const state = stateForRole(input.definition, role);
  await executeConfiguredWorkflowActions({
    ...input,
    artifacts: executionState.artifacts,
    actionExecutions: executionState.actionExecutions,
    phase: "before_state_gates",
    state,
  });
  const gateResult = await evaluateStateGatesWithRetry({
    workflowRunId: input.workflowRunId,
    artifacts: executionState.artifacts,
    state,
    stateRoles: rolesForState(input.definition.roles, role.stateId),
    evaluateGate: input.evaluateGate,
    retryGate: input.retryGate,
    maxGateRetries: input.maxGateRetries,
    budget: input.budget,
    retryAttemptsUsed,
  });
  return {
    events: gateResult.events,
    failed: gateResult.status === "failed",
    retryAttemptsUsed: gateResult.retryAttemptsUsed,
  };
}

async function recordWorkflowRunStatus(
  input: ExecuteWorkflowDefinitionInput,
  status: WorkflowStatusRecordInput["status"],
): Promise<void> {
  await input.recordStatus?.({ workflowRunId: input.workflowRunId, status });
}

async function fireHooksForNewState(
  input: ExecuteWorkflowDefinitionInput,
  artifacts: Readonly<Record<string, unknown>>,
  events: WorkflowExecutorEvent[],
  role: ResolvedWorkflowRole,
  currentStateId: string | undefined,
): Promise<string | undefined> {
  if (role.stateId === currentStateId) {
    return currentStateId;
  }
  const hookEvents = await fireStateEntryHooks({
    workflowRunId: input.workflowRunId,
    state: stateForRole(input.definition, role),
    artifacts,
    runHook: input.runHook,
  });
  events.push(...hookEvents);
  return role.stateId;
}

function rememberState(statesVisited: string[], stateId: string): void {
  if (statesVisited.at(-1) !== stateId) {
    statesVisited.push(stateId);
  }
}

/**
 * Apply allowlist filtering + decision routing after a verifier role deposits `verification.v1`.
 * `buildSingleVerifierInput` enforces the artifact allowlist (no implementer transcript) for what
 * the verifier read; `routeSingleVerifierDecision` maps the resulting decision to a run action.
 * Returns the route action — only `continue_to_publish` lets the run proceed; all others block.
 */
function routeVerifierResult(artifacts: Readonly<Record<string, unknown>>, retryBudgetRemaining: number): string {
  buildSingleVerifierInput({ artifacts, evidenceLinks: [] });
  const verification = artifacts["verification.v1"];
  const decision = isRecord(verification) && typeof verification.decision === "string" ? verification.decision : null;
  if (decision !== "satisfied" && decision !== "not_satisfied" && decision !== "uncertain") {
    return routeSingleVerifierDecision({ decision: "uncertain", retryBudgetRemaining }).action;
  }
  return routeSingleVerifierDecision({ decision, retryBudgetRemaining }).action;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
