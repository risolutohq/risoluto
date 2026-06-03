import type {
  ResolvedWorkflowDefinition,
  ResolvedWorkflowRole,
  ResolvedWorkflowState,
} from "../workflow-definition/registry.js";
import { isRecord } from "../utils/type-guards.js";
import { parseWorkflowRunArtifact } from "./artifact-contracts.js";
import { evaluateWorkflowBudget, type WorkflowBudgetPolicy } from "./budget-retry.js";
import type { WorkflowExecutorEvent } from "./gate-hook-engine.js";
import { WorkflowExecutorError } from "./executor-errors.js";

export function orderRoles(roles: readonly ResolvedWorkflowRole[]): ResolvedWorkflowRole[] {
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

export function rolesForState(
  roles: readonly ResolvedWorkflowRole[],
  stateId: string,
): readonly ResolvedWorkflowRole[] {
  return roles.filter((role) => role.stateId === stateId);
}

export function nextRoleStartsNewState(
  roles: readonly ResolvedWorkflowRole[],
  index: number,
  stateId: string,
): boolean {
  return roles[index + 1]?.stateId !== stateId;
}

export function stateForRole(
  definition: ResolvedWorkflowDefinition,
  role: ResolvedWorkflowRole,
): ResolvedWorkflowState {
  return definition.states.find((state) => state.id === role.stateId) ?? { id: role.stateId, gates: [], hooks: [] };
}

export function assertRequiredArtifacts(
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

export function pickArtifacts(
  artifacts: Readonly<Record<string, unknown>>,
  contractIds: readonly string[],
): Readonly<Record<string, unknown>> {
  const picked: Record<string, unknown> = {};
  for (const contractId of contractIds) {
    picked[contractId] = artifacts[contractId];
  }
  return picked;
}

export function storeProducedArtifacts(
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

export function appendBudgetEvent(
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

export function plannerBlocked(planArtifact: unknown): boolean {
  if (!isRecord(planArtifact)) {
    return false;
  }
  const steps = planArtifact.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    return false;
  }
  return steps.every((step) => isRecord(step) && step.status === "blocked");
}

function producerFor(contractId: string, roles: readonly ResolvedWorkflowRole[]): string {
  const producer = roles.find((role) => role.produces.includes(contractId));
  if (producer) {
    return `produced by ${producer.id}`;
  }
  return "from intake";
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
