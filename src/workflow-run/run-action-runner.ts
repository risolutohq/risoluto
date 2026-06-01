import type { WriteWorkflowRunArtifactInput } from "./archive.js";
import type { WorkflowRunArtifactReference } from "./contracts.js";
import type { WorkflowActionExecutionInput } from "./executor-actions.js";
import {
  isValidationProfileId,
  runValidationProfile,
  type ValidationProfileCommandInput,
  type ValidationProfileCommandOutput,
} from "./validation-profile.js";
import type { WorkflowRunWorkspacePreparer } from "./workspace-preparer.js";

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
  readonly prepareWorkspace?: WorkflowRunWorkspacePreparer;
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
  readonly workflowDefinitionId: string;
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
      return createWorktreeAction(deps, input);
    }
    if (input.actionId === "run-validation-profile") {
      return runValidationAction(deps, input);
    }
    throw new WorkflowRunActionError(`action ${input.actionId} is not configured for this entry point yet`);
  };
}

async function createWorktreeAction(
  deps: CreateWorkflowRunActionRunnerDeps,
  input: WorkflowActionExecutionInput,
): Promise<Readonly<Record<string, unknown>>> {
  // No workspace is configured for this entry point yet, so worktree preparation is a no-op; the run
  // still reaches the role chain (which blocks honestly without an agent). Once a workspace is wired,
  // this renders the branch and prepares the worktree, failing the run on a dirty workspace.
  if (!deps.effects.prepareWorkspace) {
    return {};
  }
  try {
    await deps.effects.prepareWorkspace({
      workflowRunId: input.workflowRunId,
      workflowDefinitionId: deps.workflowDefinitionId,
      intent: extractIntentText(input.artifacts),
      createdAt: deps.now(),
    });
  } catch (error) {
    // Dirty-workspace / branch-template failures abort the run as an honest blocked handoff.
    throw new WorkflowRunActionError(error instanceof Error ? error.message : String(error), { cause: error });
  }
  return {};
}

function extractIntentText(artifacts: Readonly<Record<string, unknown>>): string {
  const intent = artifacts["intent.v1"];
  if (isRecord(intent) && typeof intent.body === "string") {
    return intent.body;
  }
  return "";
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
