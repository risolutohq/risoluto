import type { WriteWorkflowRunArtifactInput } from "./archive.js";
import type { WorkflowRunArtifactReference } from "./contracts.js";
import type { WorkflowActionExecutionInput } from "./executor-actions.js";
import {
  isValidationProfileId,
  runValidationProfile,
  type ValidationProfileCommandInput,
  type ValidationProfileCommandOutput,
} from "./validation-profile.js";

/** Effect port for the validation profile's commands — the external boundary (real shell vs. test fake). */
export type WorkflowRunValidationCommandRunner = (
  input: ValidationProfileCommandInput,
) => Promise<ValidationProfileCommandOutput>;

/**
 * Real effects each workflow action binds to. Production wires the worktree/validation/publish/CI
 * effects; tests inject fakes for the leaves they exercise. Unset effects fail honestly rather than
 * fabricating an artifact, so the run reaches a real blocked handoff.
 */
export interface WorkflowRunActionEffects {
  readonly runValidationCommand?: WorkflowRunValidationCommandRunner;
}

export class WorkflowRunActionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorkflowRunActionError";
  }
}

export interface CreateWorkflowRunActionRunnerDeps {
  readonly effects: WorkflowRunActionEffects;
  readonly now: () => string;
  readonly writeArtifact: (input: WriteWorkflowRunArtifactInput) => Promise<WorkflowRunArtifactReference>;
}

/**
 * Production `runAction`: map each configured action id to its real effect and deposit the produced
 * artifact in the run archive. `create-worktree` produces no artifact; `run-validation-profile` runs the
 * real stop-on-first / collect-all profile logic over an injected command runner. Other actions are not
 * wired for this entry point yet and fail honestly.
 */
export function createWorkflowRunActionRunner(
  deps: CreateWorkflowRunActionRunnerDeps,
): (input: WorkflowActionExecutionInput) => Promise<Readonly<Record<string, unknown>>> {
  return async (input) => {
    if (input.actionId === "create-worktree") {
      return {};
    }
    if (input.actionId === "run-validation-profile") {
      return runValidationAction(deps, input);
    }
    throw new WorkflowRunActionError(`action ${input.actionId} is not configured for this entry point yet`);
  };
}

async function runValidationAction(
  deps: CreateWorkflowRunActionRunnerDeps,
  input: WorkflowActionExecutionInput,
): Promise<Readonly<Record<string, unknown>>> {
  if (!deps.effects.runValidationCommand) {
    throw new WorkflowRunActionError(
      `validation command runner is not configured for ${input.actionId} (no workspace is checked out yet)`,
    );
  }
  if (!isValidationProfileId(input.validationProfile)) {
    throw new WorkflowRunActionError(`unknown validation profile ${input.validationProfile}`);
  }
  const artifact = await runValidationProfile({
    profileId: input.validationProfile,
    workflowRunId: input.workflowRunId,
    createdAt: deps.now(),
    runCommand: deps.effects.runValidationCommand,
  });
  await deps.writeArtifact({
    workflowRunId: input.workflowRunId,
    contractId: "validation_result.v1",
    artifactId: "validation_result",
    data: artifact,
    producer: { type: "action", id: input.actionId },
  });
  return { "validation_result.v1": artifact };
}
