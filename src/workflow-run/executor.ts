import type {
  ResolvedWorkflowDefinition,
  ResolvedWorkflowRole,
  ResolvedWorkflowState,
} from "../workflow-definition/registry.js";
import { evaluateWorkflowBudget, type WorkflowBudgetPolicy } from "./budget-retry.js";
import { parseWorkflowRunArtifact } from "./artifact-contracts.js";
import type { WorkflowRunStatus } from "./contracts.js";
import { evaluateStateGatesWithRetry, type WorkflowGateRetryInput } from "./gate-retry-controller.js";
import {
  fireStateEntryHooks,
  type WorkflowExecutorEvent,
  type WorkflowGateEvaluationInput,
  type WorkflowGateEvaluationResult,
  type WorkflowHookExecutionInput,
  type WorkflowHookExecutionResult,
} from "./gate-hook-engine.js";

export interface ExecuteWorkflowDefinitionInput {
  readonly definition: ResolvedWorkflowDefinition;
  readonly workflowRunId: string;
  readonly initialArtifacts: Readonly<Record<string, unknown>>;
  readonly evaluateGate?: (input: WorkflowGateEvaluationInput) => Promise<WorkflowGateEvaluationResult>;
  readonly runHook?: (input: WorkflowHookExecutionInput) => Promise<WorkflowHookExecutionResult>;
  readonly runRole: (input: WorkflowRoleExecutionInput) => Promise<Readonly<Record<string, unknown>>>;
  readonly retryGate?: (input: WorkflowGateRetryInput) => Promise<Readonly<Record<string, unknown>>>;
  readonly maxGateRetries?: number;
  readonly budget?: WorkflowBudgetPolicy;
}

export interface WorkflowRoleExecutionInput {
  readonly workflowRunId: string;
  readonly role: ResolvedWorkflowRole;
  readonly artifacts: Readonly<Record<string, unknown>>;
}

export interface WorkflowExecutorResult {
  readonly status: Extract<WorkflowRunStatus, "blocked" | "done">;
  readonly workflowStatesVisited: readonly string[];
  readonly roleExecutions: readonly string[];
  readonly events: readonly WorkflowExecutorEvent[];
  readonly artifacts: Readonly<Record<string, unknown>>;
}

export class WorkflowExecutorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowExecutorError";
  }
}

export async function executeWorkflowDefinition(
  input: ExecuteWorkflowDefinitionInput,
): Promise<WorkflowExecutorResult> {
  const artifacts: Record<string, unknown> = { ...input.initialArtifacts };
  const statesVisited: string[] = [];
  const roleExecutions: string[] = [];
  const events: WorkflowExecutorEvent[] = [];
  const orderedRoles = orderRoles(input.definition.roles);
  let currentStateId: string | undefined;
  let gateRetryAttempts = 0;

  for (const [index, role] of orderedRoles.entries()) {
    if (appendBudgetEvent(events, input.budget, role.id, input.workflowRunId)) {
      return { status: "blocked", workflowStatesVisited: statesVisited, roleExecutions, events, artifacts };
    }
    currentStateId = await fireHooksForNewState(input, artifacts, events, role, currentStateId);
    assertRequiredArtifacts(role, artifacts, input.definition.roles);
    rememberState(statesVisited, role.stateId);
    const produced = await input.runRole({
      workflowRunId: input.workflowRunId,
      role,
      artifacts: pickArtifacts(artifacts, role.consumes),
    });
    storeProducedArtifacts(artifacts, role, produced);
    roleExecutions.push(role.id);
    if (role.id === "planner" && plannerBlocked(artifacts["plan.v1"])) {
      return { status: "blocked", workflowStatesVisited: statesVisited, roleExecutions, events, artifacts };
    }
    if (nextRoleStartsNewState(orderedRoles, index, role.stateId)) {
      const gateResult = await evaluateStateGatesWithRetry({
        workflowRunId: input.workflowRunId,
        artifacts,
        state: stateForRole(input.definition, role),
        stateRoles: rolesForState(input.definition.roles, role.stateId),
        evaluateGate: input.evaluateGate,
        retryGate: input.retryGate,
        maxGateRetries: input.maxGateRetries,
        budget: input.budget,
        retryAttemptsUsed: gateRetryAttempts,
      });
      gateRetryAttempts = gateResult.retryAttemptsUsed;
      events.push(...gateResult.events);
      if (gateResult.status === "failed") {
        return { status: "blocked", workflowStatesVisited: statesVisited, roleExecutions, events, artifacts };
      }
    }
  }

  return { status: "done", workflowStatesVisited: statesVisited, roleExecutions, events, artifacts };
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

function orderRoles(roles: readonly ResolvedWorkflowRole[]): ResolvedWorkflowRole[] {
  const pending = new Map(roles.map((role) => [role.id, role]));
  const ordered: ResolvedWorkflowRole[] = [];
  while (pending.size > 0) {
    const ready = [...pending.values()].find((role) => role.dependsOn.every((dependency) => !pending.has(dependency)));
    if (!ready) {
      throw new WorkflowExecutorError("workflow role DAG contains a cycle or unknown dependency");
    }
    ordered.push(ready);
    pending.delete(ready.id);
  }
  return ordered;
}

function rolesForState(roles: readonly ResolvedWorkflowRole[], stateId: string): readonly ResolvedWorkflowRole[] {
  return roles.filter((role) => role.stateId === stateId);
}

function nextRoleStartsNewState(roles: readonly ResolvedWorkflowRole[], index: number, stateId: string): boolean {
  return roles[index + 1]?.stateId !== stateId;
}

function stateForRole(definition: ResolvedWorkflowDefinition, role: ResolvedWorkflowRole): ResolvedWorkflowState {
  return definition.states.find((state) => state.id === role.stateId) ?? { id: role.stateId, gates: [], hooks: [] };
}

function assertRequiredArtifacts(
  role: ResolvedWorkflowRole,
  artifacts: Readonly<Record<string, unknown>>,
  roles: readonly ResolvedWorkflowRole[],
): void {
  for (const contractId of role.consumes) {
    if (artifacts[contractId] === undefined) {
      throw new WorkflowExecutorError(
        `${role.id} is missing required artifact ${contractId} ${producerFor(contractId, roles)}`,
      );
    }
  }
}

function producerFor(contractId: string, roles: readonly ResolvedWorkflowRole[]): string {
  const producer = roles.find((role) => role.produces.includes(contractId));
  if (producer) {
    return `produced by ${producer.id}`;
  }
  return "from intake";
}

function pickArtifacts(
  artifacts: Readonly<Record<string, unknown>>,
  contractIds: readonly string[],
): Readonly<Record<string, unknown>> {
  const picked: Record<string, unknown> = {};
  for (const contractId of contractIds) {
    picked[contractId] = artifacts[contractId];
  }
  return picked;
}

function storeProducedArtifacts(
  artifacts: Record<string, unknown>,
  role: ResolvedWorkflowRole,
  produced: Readonly<Record<string, unknown>>,
): void {
  for (const contractId of role.produces) {
    const artifact = produced[contractId];
    if (artifact === undefined) {
      throw new WorkflowExecutorError(`${role.id} did not produce required artifact ${contractId}`);
    }
    artifacts[contractId] = parseWorkflowRunArtifact({
      contractId,
      data: artifact,
      producer: { type: "role", id: role.id },
    });
  }
}

function appendBudgetEvent(
  events: WorkflowExecutorEvent[],
  budget: WorkflowBudgetPolicy | undefined,
  roleId: string,
  workflowRunId: string,
): boolean {
  const event = evaluateBudgetBeforeRole(budget, roleId, workflowRunId);
  if (!event) {
    return false;
  }
  events.push(event);
  return event.status === "failed";
}

function evaluateBudgetBeforeRole(
  budget: WorkflowBudgetPolicy | undefined,
  roleId: string,
  workflowRunId: string,
): WorkflowExecutorEvent | null {
  if (!budget) {
    return null;
  }
  const result = evaluateWorkflowBudget({ policy: budget, nextStepLabel: `role ${roleId}` });
  return {
    eventType: "workflow_budget.checked",
    workflowRunId,
    stateId: roleId,
    status: result.status,
    evidence: result.evidence,
    ...(result.reason ? { reason: result.reason } : {}),
  };
}

function rememberState(statesVisited: string[], stateId: string): void {
  if (statesVisited.at(-1) !== stateId) {
    statesVisited.push(stateId);
  }
}

function plannerBlocked(planArtifact: unknown): boolean {
  if (!isRecord(planArtifact)) {
    return false;
  }
  const steps = planArtifact.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    return false;
  }
  return steps.every((step) => isRecord(step) && step.status === "blocked");
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
