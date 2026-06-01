import type { AgentRunnerEventHandler } from "../agent-runner/contracts.js";
import type { Issue, ModelSelection, WorkflowRunReference, Workspace } from "../core/types.js";
import type { RunAttemptDispatcher } from "../dispatch/types.js";
import {
  WorkflowRunRoleDispatchError,
  type WorkflowRunRoleDispatch,
  type WorkflowRunRoleDispatchInput,
} from "./run-role-runner.js";

/**
 * Production agent-session dispatch for entry points that do not yet construct the agent harness
 * (the CLI `run start` path). It honestly fails the role rather than fabricating an artifact, so the
 * driver surfaces a real blocked handoff instead of a stubbed "done". Binding the harness
 * (`RunAttemptDispatcher` + `src/agent-runner/`) so this dispatches a real session is a separate slice;
 * until then every intake surface still reaches the SAME engine and reports the same honest block.
 */
export function createUnconfiguredAgentRoleDispatch(): WorkflowRunRoleDispatch {
  return async (input) => {
    const produces = input.role.produces.join(", ") || "its artifacts";
    throw new WorkflowRunRoleDispatchError(
      `agent harness is not configured for role ${input.role.id}; cannot produce ${produces} from this entry point yet`,
    );
  };
}

/**
 * Run-scoped context for a Workflow Run's agent sessions: the dispatcher boundary, the prepared workspace
 * the sessions run in, the model resolver, the per-role prompt builder, and the run's abort signal. Built
 * once per `run start` and reused for every role dispatch in the run.
 */
export interface AgentRoleDispatchContext {
  readonly dispatcher: RunAttemptDispatcher;
  readonly workspace: Workspace;
  readonly modelForProfile: (modelProfile: string) => ModelSelection;
  readonly promptForRole: (input: WorkflowRunRoleDispatchInput) => string;
  readonly signal: AbortSignal;
  readonly onEvent?: AgentRunnerEventHandler;
  readonly attempt?: number | null;
}

/**
 * Production agent dispatch: run one real agent session per role through the {@link RunAttemptDispatcher}
 * (local AgentRunner -> Docker/Codex, or the remote data plane). The session works in the prepared
 * workspace and, per the D1 deposit protocol (PRD ADDENDUM), writes a contract-valid artifact for each
 * `role.produces` id at its canonical archive path; `createWorkflowRunRoleRunner` then reads them back. A
 * non-normal RunOutcome fails the role honestly so the driver writes a real blocked handoff.
 */
export function createAgentRoleDispatch(context: AgentRoleDispatchContext): WorkflowRunRoleDispatch {
  return async (input) => {
    const outcome = await context.dispatcher.runAttempt({
      issue: issueFromInput(input),
      workflowRun: workflowRunFromInput(input),
      attempt: context.attempt ?? null,
      modelSelection: context.modelForProfile(input.role.modelProfile),
      promptTemplate: context.promptForRole(input),
      workspace: context.workspace,
      signal: context.signal,
      onEvent: context.onEvent ?? noopAgentEvent,
    });
    if (outcome.kind !== "normal") {
      const produces = input.role.produces.join(", ") || "its artifacts";
      throw new WorkflowRunRoleDispatchError(
        `agent session for role ${input.role.id} ended ${outcome.kind}` +
          (outcome.errorMessage ? `: ${outcome.errorMessage}` : "") +
          `; ${produces} not produced`,
      );
    }
  };
}

const noopAgentEvent: AgentRunnerEventHandler = () => {};

/** Project the Workflow Run into the `Issue` shape the agent harness consumes (this entry point is run-keyed). */
function issueFromInput(input: WorkflowRunRoleDispatchInput): Issue {
  return {
    id: input.workflowRunId,
    identifier: input.workflowRunId,
    workflowRunId: input.workflowRunId,
    title: intentField(input, "title") ?? input.workflowRunId,
    description: intentField(input, "body"),
    priority: null,
    state: "in_progress",
    branchName: null,
    url: null,
    labels: [],
    blockedBy: [],
    createdAt: null,
    updatedAt: null,
  };
}

function workflowRunFromInput(input: WorkflowRunRoleDispatchInput): WorkflowRunReference {
  return {
    id: input.workflowRunId,
    identifier: input.workflowRunId,
    title: intentField(input, "title") ?? input.workflowRunId,
    description: intentField(input, "body"),
    url: null,
  };
}

function intentField(input: WorkflowRunRoleDispatchInput, field: "title" | "body"): string | null {
  const intent = input.artifacts["intent.v1"];
  if (typeof intent === "object" && intent !== null && typeof (intent as Record<string, unknown>)[field] === "string") {
    return (intent as Record<string, string>)[field];
  }
  return null;
}
