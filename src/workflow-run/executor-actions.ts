import type { ResolvedWorkflowDefinition, ResolvedWorkflowState } from "../workflow-definition/registry.js";
import { parseWorkflowRunArtifact } from "./artifact-contracts.js";

export interface WorkflowActionExecutionInput {
  readonly workflowRunId: string;
  readonly actionId: string;
  readonly artifacts: Readonly<Record<string, unknown>>;
  readonly validationProfile: string;
}

export interface ExecuteConfiguredWorkflowActionsInput {
  readonly definition: ResolvedWorkflowDefinition;
  readonly workflowRunId: string;
  readonly artifacts: Record<string, unknown>;
  readonly actionExecutions: string[];
  /**
   * Dedupe ledger scoped by phase/state/attempt. Global `actionId` dedupe made verifier-driven
   * retries skip `run-validation-profile` and reuse a stale validation result; scoping the key by
   * the retry attempt lets a new attempt re-run validation (NIN-261).
   */
  readonly actionDedupeKeys: string[];
  /** Verifier retry attempt — a new attempt re-scopes the dedupe key so validation re-runs. */
  readonly attempt: number;
  readonly phase: "after_roles" | "before_roles" | "before_state_gates";
  readonly state?: ResolvedWorkflowState;
  readonly runAction?: (input: WorkflowActionExecutionInput) => Promise<Readonly<Record<string, unknown>>>;
}

export async function executeConfiguredWorkflowActions(input: ExecuteConfiguredWorkflowActionsInput): Promise<void> {
  if (!input.runAction) {
    return;
  }
  for (const actionId of input.definition.actions) {
    if (!shouldExecuteAction(input.phase, actionId, input.state)) {
      continue;
    }
    // Dedupe per action PER ATTEMPT (not globally by actionId). Global dedupe ran each action once for
    // the whole run, so a verifier-driven retry reused a stale validation result; scoping by the retry
    // attempt re-runs run-validation-profile on the new attempt while still running each action once per
    // attempt across the before/after phases (NIN-261).
    const dedupeKey = `${actionId}::${input.attempt}`;
    if (input.actionDedupeKeys.includes(dedupeKey)) {
      continue;
    }
    const produced = await input.runAction({
      workflowRunId: input.workflowRunId,
      actionId,
      artifacts: input.artifacts,
      validationProfile: input.definition.validationProfile,
    });
    storeActionArtifacts(input.artifacts, actionId, produced);
    input.actionExecutions.push(actionId);
    input.actionDedupeKeys.push(dedupeKey);
  }
}

function shouldExecuteAction(
  phase: ExecuteConfiguredWorkflowActionsInput["phase"],
  actionId: string,
  state: ResolvedWorkflowState | undefined,
): boolean {
  if (phase === "before_roles") {
    return actionId === "create-worktree";
  }
  if (phase === "before_state_gates") {
    return actionId === "run-validation-profile" && (state?.gates.includes("validation-passed") ?? false);
  }
  // create-worktree is owned by before_roles (dedupe key attempt=0). after_roles keys by
  // attempt=verifierRetryAttempts, so on a verifier retry (>0) its key no longer collides with the
  // before_roles key and the worktree would be re-created. Exclude it here — a worktree is setup,
  // never a post-roles step. run-validation-profile is left in: it keys by verifierRetryAttempts in
  // both before_state_gates and after_roles, so those collide and dedupe, and it must still run as a
  // post-roles action for definitions whose state carries no validation gate (NIN-261).
  return actionId !== "create-worktree";
}

function storeActionArtifacts(
  artifacts: Record<string, unknown>,
  actionId: string,
  produced: Readonly<Record<string, unknown>>,
): void {
  for (const [contractId, data] of Object.entries(produced)) {
    artifacts[contractId] = parseWorkflowRunArtifact({
      contractId,
      data,
      producer: { type: "action", id: actionId },
    });
  }
}
