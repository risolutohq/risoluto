import type { ResolvedWorkflowDefinition, ResolvedWorkflowRole } from "../workflow-definition/registry.js";
import { isRecord } from "../utils/type-guards.js";
import type { WorkflowBudgetPolicy } from "./budget-retry.js";
import { DEFAULT_GATE_RETRY_LIMIT, evaluateWorkflowBudget } from "./budget-retry.js";
import type { SlackClarificationDecision, UnansweredSlackClarificationInput } from "./slack-interactions.js";
import type { WorkflowRunStatus } from "./contracts.js";
import { transitionWorkflowRunStatus, type RunStatusTransitionEvent } from "./run-status.js";
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
import {
  buildSingleVerifierInput,
  routeSingleVerifierDecision,
  runCouncilVerifier,
  type CouncilSynthesizerInput,
  type CouncilSynthesizerResult,
  type CouncilVerifier,
  type CouncilVerifierResult,
  type RunCouncilVerifierResult,
  type SingleVerifierInput,
} from "./verifier.js";

export { WorkflowExecutorError } from "./executor-errors.js";

export interface ExecuteWorkflowDefinitionInput {
  readonly definition: ResolvedWorkflowDefinition;
  readonly workflowRunId: string;
  readonly initialArtifacts: Readonly<Record<string, unknown>>;
  readonly evaluateGate?: (input: WorkflowGateEvaluationInput) => Promise<WorkflowGateEvaluationResult>;
  readonly runHook?: (input: WorkflowHookExecutionInput) => Promise<WorkflowHookExecutionResult>;
  readonly runRole: (input: WorkflowRoleExecutionInput) => Promise<Readonly<Record<string, unknown>>>;
  /**
   * Council verifier dispatch (NIN-271). When the verifier role is `verifierMode: "council"` and both
   * callbacks are present, the executor routes that role through `runCouncilVerifier` instead of `runRole`:
   * `runCouncillor` runs one councillor session, `synthesizeCouncil` reconciles the completed verdicts, and
   * `councilClock` stamps the council `verification.v1`. Absent these, a council role degrades to single mode.
   */
  readonly runCouncillor?: (input: {
    readonly input: SingleVerifierInput;
    readonly councillor: CouncilVerifier;
  }) => Promise<CouncilVerifierResult>;
  readonly synthesizeCouncil?: (input: CouncilSynthesizerInput) => Promise<CouncilSynthesizerResult>;
  readonly councilClock?: () => string;
  readonly runAction?: (input: WorkflowActionExecutionInput) => Promise<Readonly<Record<string, unknown>>>;
  readonly recordStatus?: (input: WorkflowStatusRecordInput) => Promise<void>;
  readonly retryGate?: (input: WorkflowGateRetryInput) => Promise<Readonly<Record<string, unknown>>>;
  readonly maxGateRetries?: number;
  readonly budget?: WorkflowBudgetPolicy;
  /**
   * Called when a verifier's `uncertain` verdict routes the run to `wait_for_operator` (NIN-105).
   * While retry budget remains and clarification attempts are not exhausted, the engine loops back
   * to the implementer state so the operator's clarification can be incorporated. When the decision
   * says to block — either because attempts are exhausted or the budget is spent — the run routes to
   * `blocked`. Falls back to blocking immediately when absent.
   */
  readonly decideUnansweredClarification?: (input: UnansweredSlackClarificationInput) => SlackClarificationDecision;
  /** Maximum times the engine re-runs the implementer state on `wait_for_operator`. Defaults to 1. */
  readonly maxClarificationAttempts?: number;
}

export interface WorkflowRoleExecutionInput {
  readonly workflowRunId: string;
  readonly role: ResolvedWorkflowRole;
  readonly artifacts: Readonly<Record<string, unknown>>;
}

export interface WorkflowStatusRecordInput {
  readonly workflowRunId: string;
  readonly status: WorkflowRunStatus;
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
  /** Phase/state/attempt-scoped dedupe ledger so a verifier retry re-runs validation (RIS-261). */
  readonly actionDedupeKeys: string[];
  readonly events: WorkflowExecutorEvent[];
}

export async function executeWorkflowDefinition(
  input: ExecuteWorkflowDefinitionInput,
): Promise<WorkflowExecutorResult> {
  const state = createWorkflowExecutionState(input);
  const orderedRoles = orderRoles(input.definition.roles);
  let currentStateId: string | undefined;
  let gateRetryAttempts = 0;
  let verifierRetryAttempts = 0;
  let clarificationRetryAttempts = 0;

  await advanceRunStatus(input, "accepted", "queue");
  await advanceRunStatus(input, "queued", "start");
  await executeConfiguredWorkflowActions({ ...input, ...state, phase: "before_roles", attempt: 0 });
  let index = 0;
  while (index < orderedRoles.length) {
    const role = orderedRoles[index];
    if (appendBudgetEvent(state.events, input.budget, role.id, input.workflowRunId)) {
      return finishWorkflowExecution(input, "blocked", state);
    }
    const roleOutcome = await runOrderedRole(input, state, role, currentStateId);
    currentStateId = roleOutcome.nextStateId;
    if (roleOutcome.blocked) {
      return finishWorkflowExecution(input, "blocked", state);
    }
    if (role.id === "planner" && plannerBlocked(state.artifacts["plan.v1"])) {
      return finishWorkflowExecution(input, "blocked", state);
    }
    if (role.produces.includes("verification.v1")) {
      const retryBudgetRemaining = (input.maxGateRetries ?? DEFAULT_GATE_RETRY_LIMIT) - verifierRetryAttempts;
      const verifierStep = resolveVerifierStep(state.artifacts, retryBudgetRemaining, orderedRoles);
      if (verifierStep.kind === "block") {
        return finishWorkflowExecution(input, "blocked", state);
      }
      if (verifierStep.kind === "retry") {
        verifierRetryAttempts += 1;
        currentStateId = undefined;
        index = verifierStep.index;
        continue;
      }
      if (verifierStep.kind === "wait_for_operator") {
        const clarificationStep = resolveClarificationStep(input, clarificationRetryAttempts, orderedRoles);
        if (clarificationStep.kind === "retry") {
          clarificationRetryAttempts += 1;
          currentStateId = undefined;
          index = clarificationStep.index;
          continue;
        }
        return finishWorkflowExecution(input, "blocked", state);
      }
    }
    if (nextRoleStartsNewState(orderedRoles, index, role.stateId)) {
      const gateResult = await evaluateGatesAfterRole(input, role, state, gateRetryAttempts, verifierRetryAttempts);
      gateRetryAttempts = gateResult.retryAttemptsUsed;
      state.events.push(...gateResult.events);
      if (gateResult.failed) {
        return finishWorkflowExecution(input, "blocked", state);
      }
    }
    index += 1;
  }

  await executeConfiguredWorkflowActions({ ...input, ...state, phase: "after_roles", attempt: verifierRetryAttempts });
  return finishWorkflowExecution(input, "done", state);
}

/**
 * Fire state-entry hooks, assert required inputs, dispatch one role session, and store its produced
 * artifacts. Returns the (possibly new) current state id so the caller can track state transitions.
 */
interface RoleDispatchOutcome {
  readonly nextStateId: string | undefined;
  readonly blocked: boolean;
}

async function runOrderedRole(
  input: ExecuteWorkflowDefinitionInput,
  state: WorkflowExecutionState,
  role: ResolvedWorkflowRole,
  currentStateId: string | undefined,
): Promise<RoleDispatchOutcome> {
  const nextStateId = await fireHooksForNewState(input, state.artifacts, state.events, role, currentStateId);
  assertRequiredArtifacts(role, state.artifacts, input.definition.roles);
  rememberState(state.statesVisited, role.stateId);
  const dispatch = await dispatchRoleSession(input, role, state.artifacts);
  if (dispatch.blocked) {
    return { nextStateId, blocked: true };
  }
  storeProducedArtifacts(state.artifacts, role, dispatch.produced);
  state.roleExecutions.push(role.id);
  return { nextStateId, blocked: false };
}

/**
 * Run one role session and return its produced artifacts. A council-mode verifier role (NIN-271) routes
 * through `runCouncilVerifier`, persisting the council `verification.v1` (councillor evidence + synthesizer
 * decision); when every councillor fails it produces no verdict and the run blocks. All other roles run
 * via the generic `runRole` session.
 */
async function dispatchRoleSession(
  input: ExecuteWorkflowDefinitionInput,
  role: ResolvedWorkflowRole,
  artifacts: Readonly<Record<string, unknown>>,
): Promise<{ readonly produced: Readonly<Record<string, unknown>>; readonly blocked: boolean }> {
  if (isCouncilVerifierRole(role) && input.runCouncillor && input.synthesizeCouncil) {
    const result = await runCouncilVerifierForRole(
      input,
      role,
      artifacts,
      input.runCouncillor,
      input.synthesizeCouncil,
    );
    return result.status === "completed"
      ? { produced: { "verification.v1": result.artifact }, blocked: false }
      : { produced: {}, blocked: true };
  }
  const produced = await input.runRole({
    workflowRunId: input.workflowRunId,
    role,
    artifacts: pickArtifacts(artifacts, role.consumes),
  });
  return { produced, blocked: false };
}

function isCouncilVerifierRole(role: ResolvedWorkflowRole): boolean {
  return role.verifierMode === "council" && (role.councillors?.length ?? 0) > 0;
}

async function runCouncilVerifierForRole(
  input: ExecuteWorkflowDefinitionInput,
  role: ResolvedWorkflowRole,
  artifacts: Readonly<Record<string, unknown>>,
  runCouncillor: NonNullable<ExecuteWorkflowDefinitionInput["runCouncillor"]>,
  synthesize: NonNullable<ExecuteWorkflowDefinitionInput["synthesizeCouncil"]>,
): Promise<RunCouncilVerifierResult> {
  return runCouncilVerifier({
    workflowRunId: input.workflowRunId,
    createdAt: (input.councilClock ?? defaultCouncilClock)(),
    input: buildSingleVerifierInput({ artifacts, evidenceLinks: [] }),
    councillors: role.councillors ?? [],
    runCouncillor,
    synthesize,
  });
}

function defaultCouncilClock(): string {
  return new Date().toISOString();
}

async function finishWorkflowExecution(
  input: ExecuteWorkflowDefinitionInput,
  status: Extract<WorkflowRunStatus, "blocked" | "done">,
  state: WorkflowExecutionState,
): Promise<WorkflowExecutorResult> {
  await advanceRunStatus(input, "running", status === "done" ? "complete" : "prerequisite_failed");
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
    actionDedupeKeys: [],
    events: [],
  };
}

async function evaluateGatesAfterRole(
  input: ExecuteWorkflowDefinitionInput,
  role: ResolvedWorkflowRole,
  executionState: WorkflowExecutionState,
  retryAttemptsUsed: number,
  verifierRetryAttempts: number,
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
    actionDedupeKeys: executionState.actionDedupeKeys,
    attempt: verifierRetryAttempts,
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

/**
 * Advance the Run Status through the validated lifecycle machine (NIN-109/197) and record the result.
 * Routing every status write through `transitionWorkflowRunStatus` enforces the
 * `accepted -> queued -> running` ordering — so `queued` is observed in production — and the
 * active -> `blocked` guard, instead of ad-hoc `recordWorkflowRunStatus` writes.
 */
async function advanceRunStatus(
  input: ExecuteWorkflowDefinitionInput,
  from: WorkflowRunStatus,
  event: RunStatusTransitionEvent,
): Promise<void> {
  const { to } = transitionWorkflowRunStatus({ from, event });
  await recordWorkflowRunStatus(input, to);
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
 * Read the `verification.v1` decision from the raw artifacts bag and route it via
 * `routeSingleVerifierDecision`. Artifact-allowlist filtering for the verifier role happens
 * in `runOrderedRole` via `pickArtifacts` before `runRole` is dispatched, not here.
 * Returns the route action — only `continue_to_publish` lets the run proceed; all others block.
 */
function routeVerifierResult(artifacts: Readonly<Record<string, unknown>>, retryBudgetRemaining: number): string {
  const verification = artifacts["verification.v1"];
  const decision = isRecord(verification) && typeof verification.decision === "string" ? verification.decision : null;
  if (decision !== "satisfied" && decision !== "not_satisfied" && decision !== "uncertain") {
    return routeSingleVerifierDecision({ decision: "uncertain", retryBudgetRemaining }).action;
  }
  return routeSingleVerifierDecision({ decision, retryBudgetRemaining }).action;
}

type VerifierStep =
  | { readonly kind: "continue" }
  | { readonly kind: "retry"; readonly index: number }
  | { readonly kind: "block" }
  | { readonly kind: "wait_for_operator" };

/**
 * Map the verifier's decision to the next executor move. `continue_to_publish` advances the run;
 * `retry_implementation` (verifier `not_satisfied` with retry budget remaining) loops back to the start of
 * the implementer's state so implementation → review → verification re-run under the surviving budget;
 * every other route blocks. A workflow with no implementer role has nothing to retry, so a retry route
 * degrades to a block rather than spinning.
 */
function resolveVerifierStep(
  artifacts: Readonly<Record<string, unknown>>,
  retryBudgetRemaining: number,
  orderedRoles: readonly ResolvedWorkflowRole[],
): VerifierStep {
  const action = routeVerifierResult(artifacts, retryBudgetRemaining);
  if (action === "continue_to_publish") {
    return { kind: "continue" };
  }
  if (action === "retry_implementation") {
    const retryIndex = implementerStateStartIndex(orderedRoles);
    return retryIndex >= 0 ? { kind: "retry", index: retryIndex } : { kind: "block" };
  }
  if (action === "wait_for_operator") {
    return { kind: "wait_for_operator" };
  }
  return { kind: "block" };
}

/**
 * Consult the `decideUnansweredClarification` callback to determine whether the engine should
 * retry the implementer state (budget + attempts allow it) or route the run to `blocked` (NIN-105).
 * Falls back to `{ kind: "block" }` when no callback is wired.
 */
function resolveClarificationStep(
  input: ExecuteWorkflowDefinitionInput,
  clarificationAttemptsUsed: number,
  orderedRoles: readonly ResolvedWorkflowRole[],
): { readonly kind: "retry"; readonly index: number } | { readonly kind: "block" } {
  if (!input.decideUnansweredClarification) {
    return { kind: "block" };
  }
  const budgetRemaining =
    !input.budget ||
    evaluateWorkflowBudget({ policy: input.budget, nextStepLabel: "clarification-retry" }).status === "passed";
  const decision = input.decideUnansweredClarification({
    workflowRunId: input.workflowRunId,
    questionId: `${input.workflowRunId}-clarification`,
    attemptsUsed: clarificationAttemptsUsed,
    maxAttempts: input.maxClarificationAttempts ?? 1,
    budgetRemaining,
  });
  if (decision.type !== "slack_clarification.retry") {
    return { kind: "block" };
  }
  const retryIndex = implementerStateStartIndex(orderedRoles);
  return retryIndex >= 0 ? { kind: "retry", index: retryIndex } : { kind: "block" };
}

/** Index of the first role in the implementer's state, or -1 when the workflow has no implementer to retry. */
function implementerStateStartIndex(orderedRoles: readonly ResolvedWorkflowRole[]): number {
  const implementer = orderedRoles.find((role) => role.id === "implementer");
  if (!implementer) {
    return -1;
  }
  return orderedRoles.findIndex((role) => role.stateId === implementer.stateId);
}
