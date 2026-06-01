import type { WriteWorkflowRunArtifactInput } from "./archive.js";
import { evaluateCiBabysitter, type CiCheckResult } from "./ci-babysitter.js";
import type { WorkflowRunArtifactReference } from "./contracts.js";
import type { WorkflowActionExecutionInput } from "./executor-actions.js";
import type { OperatorPermission } from "./operator-approval-contract.js";
import { evaluatePrPublishPolicy, type PrPublishMode, type PrPublishPolicyInput } from "./publish-policy.js";
import {
  isValidationProfileId,
  runValidationProfile,
  type ValidationProfileCommandInput,
  type ValidationProfileCommandOutput,
} from "./validation-profile.js";
import { assertPublishAllowedByVerification, VerifierPolicyError } from "./verifier.js";
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
/** Result of polling a CI provider: the raw checks plus the run's retry/rerun policy context. */
export interface WorkflowRunCiPollResult {
  readonly checks: readonly CiCheckResult[];
  readonly retryBudgetRemaining: number;
  readonly rerunsAllowed: boolean;
}

/** Effect port that polls a CI provider for the babysitter. Production binds GitHub Actions; tests fake it. */
export type WorkflowRunCiPoller = (input: {
  readonly workflowRunId: string;
  readonly provider: "github_actions";
}) => Promise<WorkflowRunCiPollResult>;

export interface WorkflowRunActionEffects {
  readonly prepareWorkspace?: WorkflowRunWorkspacePreparer;
  readonly runValidationCommand?: WorkflowRunValidationCommandRunner;
  readonly pollCi?: WorkflowRunCiPoller;
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
  /** Operator/config-requested publish mode for `publish-pr`. Unset means the policy default (draft). */
  readonly publishMode?: PrPublishMode;
}

/**
 * Production `runAction`: map each configured action id to its real effect and deposit the produced
 * artifact in the run archive. `create-worktree` produces no artifact; `run-validation-profile` runs the
 * real stop-on-first / collect-all profile logic over an injected command runner; `publish-pr` applies
 * the deterministic publish-mode policy and records `publish_result.v1`; `poll-ci` runs the CI babysitter
 * over an injected CI poller and records `ci_result.v1`. Other actions are not wired for this entry point
 * yet and fail honestly.
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
    if (input.actionId === "publish-pr") {
      return publishPrAction(deps, input);
    }
    if (input.actionId === "poll-ci") {
      return pollCiAction(deps, input);
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

const CI_RESULT_STATUSES = ["blocked", "failed", "passed", "pending", "rerun_requested"] as const;
type CiResultStatus = (typeof CI_RESULT_STATUSES)[number];
const VERIFIER_DECISIONS = ["satisfied", "not_satisfied", "uncertain"] as const;
type VerifierDecision = (typeof VERIFIER_DECISIONS)[number];

/**
 * Deterministic PR publishing-mode policy reachable from `run start`. Reads the validation / verifier /
 * CI / operator-approval artifacts the prior roles and actions deposited, applies the requested mode
 * (default draft), and persists the resulting `publish_result.v1`. Live PR creation is a separate slice;
 * this action only records the policy decision.
 */
async function publishPrAction(
  deps: CreateWorkflowRunActionRunnerDeps,
  input: WorkflowActionExecutionInput,
): Promise<Readonly<Record<string, unknown>>> {
  const effectiveMode: PrPublishMode = deps.publishMode ?? "draft";
  if (effectiveMode === "ready" || effectiveMode === "auto_merge") {
    try {
      assertPublishAllowedByVerification({ artifacts: input.artifacts });
    } catch (error) {
      if (error instanceof VerifierPolicyError) {
        throw new WorkflowRunActionError(error.message, { cause: error });
      }
      throw error;
    }
  }
  const artifact = evaluatePrPublishPolicy({
    workflowRunId: input.workflowRunId,
    createdAt: deps.now(),
    ...(deps.publishMode ? { requestedMode: deps.publishMode } : {}),
    validation: { status: readValidationStatus(input.artifacts) },
    verification: readVerification(input.artifacts),
    ci: readCiResult(input.artifacts),
    operatorApproval: readOperatorApproval(input.artifacts),
    mergePolicy: null,
  });
  await deps.writeArtifact({
    workflowRunId: input.workflowRunId,
    contractId: "publish_result.v1",
    artifactId: "publish_result",
    data: artifact,
    producer: { type: "action", id: input.actionId },
  });
  return { "publish_result.v1": artifact };
}

// Absence of an artifact is read as "not green / not present" (never fabricated as passing): ready and
// auto-merge then refuse, while draft/none ignore these inputs entirely.
function readValidationStatus(artifacts: Readonly<Record<string, unknown>>): "failed" | "passed" {
  const validation = artifacts["validation_result.v1"];
  return isRecord(validation) && validation.status === "passed" ? "passed" : "failed";
}

function readVerification(artifacts: Readonly<Record<string, unknown>>): PrPublishPolicyInput["verification"] {
  const verification = artifacts["verification.v1"];
  if (isRecord(verification) && isVerifierDecision(verification.decision)) {
    return { decision: verification.decision };
  }
  return null;
}

function readCiResult(artifacts: Readonly<Record<string, unknown>>): PrPublishPolicyInput["ci"] {
  const ci = artifacts["ci_result.v1"];
  if (isRecord(ci) && isCiResultStatus(ci.status)) {
    return { status: ci.status };
  }
  return null;
}

function readOperatorApproval(artifacts: Readonly<Record<string, unknown>>): PrPublishPolicyInput["operatorApproval"] {
  const approval = artifacts["operator_approval.v1"];
  if (isRecord(approval) && typeof approval.permission === "string") {
    return { permission: approval.permission as OperatorPermission };
  }
  return null;
}

function isCiResultStatus(value: unknown): value is CiResultStatus {
  return typeof value === "string" && (CI_RESULT_STATUSES as readonly string[]).includes(value);
}

function isVerifierDecision(value: unknown): value is VerifierDecision {
  return typeof value === "string" && (VERIFIER_DECISIONS as readonly string[]).includes(value);
}

/**
 * GitHub Actions CI babysitter reachable from `run start`. Polls the configured CI provider for this run's
 * checks, classifies them (code failure -> retry, flaky -> rerun, timeout/unavailable -> blocked evidence),
 * and records `ci_result.v1`. Without a configured poller the action fails honestly rather than fabricating
 * a green result, so a run that reaches CI blocks until a provider is wired.
 */
async function pollCiAction(
  deps: CreateWorkflowRunActionRunnerDeps,
  input: WorkflowActionExecutionInput,
): Promise<Readonly<Record<string, unknown>>> {
  if (!deps.effects.pollCi) {
    throw new WorkflowRunActionError(
      `CI poller is not configured for ${input.actionId} (no CI provider is wired for this entry point yet)`,
    );
  }
  const poll = await deps.effects.pollCi({ workflowRunId: input.workflowRunId, provider: "github_actions" });
  const artifact = evaluateCiBabysitter({
    workflowRunId: input.workflowRunId,
    createdAt: deps.now(),
    provider: "github_actions",
    retryBudgetRemaining: poll.retryBudgetRemaining,
    rerunsAllowed: poll.rerunsAllowed,
    checks: poll.checks,
  });
  await deps.writeArtifact({
    workflowRunId: input.workflowRunId,
    contractId: "ci_result.v1",
    artifactId: "ci_result",
    data: artifact,
    producer: { type: "action", id: input.actionId },
  });
  return { "ci_result.v1": artifact };
}
