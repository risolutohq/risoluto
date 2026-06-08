import { createWorkflowRunArchive, type WorkflowRunArchiveLocation } from "./archive.js";
import {
  executeWorkflowDefinition,
  type ExecuteWorkflowDefinitionInput,
  type WorkflowExecutorResult,
} from "./executor.js";
import { decideUnansweredSlackClarification } from "./slack-interactions.js";

/**
 * Production driver inputs. Mirrors {@link ExecuteWorkflowDefinitionInput} but adds the archive location so
 * the driver can persist status transitions, and makes `recordStatus` optional (it defaults to the archive).
 *
 * `runRole` and `runAction` are injected providers: production wires them to the real agent harness and the
 * built-in action handlers; the dogfood capstone and unit tests inject hermetic fakes. This is the single
 * integration point every intake surface (CLI, tracker, Slack) drives, so they all execute the SAME engine.
 */
export interface DriveWorkflowRunInput extends WorkflowRunArchiveLocation {
  readonly definition: ExecuteWorkflowDefinitionInput["definition"];
  readonly workflowRunId: string;
  readonly initialArtifacts: ExecuteWorkflowDefinitionInput["initialArtifacts"];
  readonly runRole: ExecuteWorkflowDefinitionInput["runRole"];
  readonly runAction?: ExecuteWorkflowDefinitionInput["runAction"];
  readonly runHook?: ExecuteWorkflowDefinitionInput["runHook"];
  readonly evaluateGate?: ExecuteWorkflowDefinitionInput["evaluateGate"];
  readonly retryGate?: ExecuteWorkflowDefinitionInput["retryGate"];
  readonly maxGateRetries?: number;
  readonly budget?: ExecuteWorkflowDefinitionInput["budget"];
  readonly recordStatus?: ExecuteWorkflowDefinitionInput["recordStatus"];
  /** Maximum times the engine re-runs the implementer state on `wait_for_operator`. Defaults to 1. */
  readonly maxClarificationAttempts?: number;
}

/**
 * Advance an accepted Workflow Run by executing its definition. Wires `recordStatus` to the run archive by
 * default so the run's `running` -> terminal transitions are persisted and observable over CLI/HTTP.
 */
export async function driveWorkflowRun(input: DriveWorkflowRunInput): Promise<WorkflowExecutorResult> {
  return executeWorkflowDefinition({
    definition: input.definition,
    workflowRunId: input.workflowRunId,
    initialArtifacts: input.initialArtifacts,
    runRole: input.runRole,
    runAction: input.runAction,
    runHook: input.runHook,
    evaluateGate: input.evaluateGate,
    retryGate: input.retryGate,
    maxGateRetries: input.maxGateRetries,
    budget: input.budget,
    decideUnansweredClarification: decideUnansweredSlackClarification,
    maxClarificationAttempts: input.maxClarificationAttempts,
    // The archive is created lazily inside the default closure so callers that inject their own
    // recordStatus (tests, fakes) do not need to supply an archive location.
    recordStatus:
      input.recordStatus ??
      (async ({ workflowRunId, status }) => {
        await createWorkflowRunArchive(input).updateWorkflowRunStatus(workflowRunId, status);
      }),
  });
}
