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
  readonly phase: "after_roles" | "before_roles" | "before_state_gates";
  readonly state?: ResolvedWorkflowState;
  readonly runAction?: (input: WorkflowActionExecutionInput) => Promise<Readonly<Record<string, unknown>>>;
}

export async function executeConfiguredWorkflowActions(input: ExecuteConfiguredWorkflowActionsInput): Promise<void> {
  if (!input.runAction) {
    return;
  }
  for (const actionId of input.definition.actions) {
    if (input.actionExecutions.includes(actionId) || !shouldExecuteAction(input.phase, actionId, input.state)) {
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
  return true;
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
