import { WorkflowRunRoleDispatchError, type WorkflowRunRoleDispatch } from "./run-role-runner.js";

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
