import path from "node:path";

import type { ModelSelection, Workspace } from "../core/types.js";
import type { RunAttemptDispatcher } from "../dispatch/types.js";
import {
  createUnconfiguredAgentRoleDispatch,
  createWorkflowRunAgentDispatch,
} from "../workflow-run/agent-role-dispatch.js";
import type { WorkflowRunRoleDispatch } from "../workflow-run/run-role-runner.js";
import { LIVE_RUN_START_ENV } from "./constants.js";

/**
 * Injection seam for the agent-dispatch composition in `run start`. Production passes nothing; the
 * honest-block default fires unless an explicit opt-in is present (injected dispatcher for tests, or
 * {@link LIVE_RUN_START_ENV} for a future live configuration pass).
 */
export interface RunStartDispatchDeps {
  /** Pre-assembled dispatcher; present in hermetic tests and future live wiring. */
  readonly dispatcher?: RunAttemptDispatcher;
  /** Prepared workspace the agent sessions run in. Required when dispatcher is injected. */
  readonly workspace?: Workspace;
  /** Resolve a workflow model-profile name to a ModelSelection. Required when dispatcher is injected. */
  readonly modelForProfile?: (modelProfile: string) => ModelSelection;
  /** The run's abort signal, threaded from the CLI so SIGINT/SIGTERM cancels the active agent session. */
  readonly signal?: AbortSignal;
}

/**
 * Resolve the role-dispatch function for a `run start` invocation.
 *
 * Three-way priority:
 *   (a) `deps.dispatchRole` already resolved by the caller → returned unchanged (legacy seam).
 *   (b) `deps.dispatcher` injected (hermetic test) OR {@link LIVE_RUN_START_ENV}=1 (production opt-in)
 *       → compose {@link createWorkflowRunAgentDispatch} over the dispatcher boundary.
 *   (c) Neither opt-in present → {@link createUnconfiguredAgentRoleDispatch} (honest block).
 *
 * The live-env branch (b without deps.dispatcher) is the LIVE slice: the code path exists and is
 * reachable, but it requires the full config stack that is wired in a separate step (NIN-222 live pass).
 */
export function resolveDispatchRole(
  deps: RunStartDispatchDeps,
  dataDir: string,
  preResolved?: WorkflowRunRoleDispatch,
): WorkflowRunRoleDispatch {
  if (preResolved !== undefined) {
    return preResolved;
  }

  const liveEnvOptIn = process.env[LIVE_RUN_START_ENV] === "1";
  const dispatcherOptIn = deps.dispatcher !== undefined;

  if (!liveEnvOptIn && !dispatcherOptIn) {
    return createUnconfiguredAgentRoleDispatch();
  }

  const dispatcher = requireDispatcher(deps.dispatcher, liveEnvOptIn);
  const workspace = requireWorkspace(deps.workspace, liveEnvOptIn);
  const modelForProfile = deps.modelForProfile ?? defaultModelForProfile;

  return createWorkflowRunAgentDispatch({
    dispatcher,
    workspace,
    archiveRoot: path.join(dataDir, "archives"),
    modelForProfile,
    signal: deps.signal ?? new AbortController().signal,
  });
}

/**
 * Retrieve the dispatcher, or raise a descriptive error if the live env was set but the full config
 * stack has not yet been wired to `run start` (future NIN-222 live pass).
 */
function requireDispatcher(injected: RunAttemptDispatcher | undefined, liveEnvOptIn: boolean): RunAttemptDispatcher {
  if (injected !== undefined) {
    return injected;
  }
  if (liveEnvOptIn) {
    throw new Error(
      `${LIVE_RUN_START_ENV}=1 requires the full config stack wired to run start, which is not yet implemented.` +
        " Inject deps.dispatcher for hermetic tests, or wait for the live config pass.",
    );
  }
  // Unreachable: callers only reach here when dispatcherOptIn || liveEnvOptIn.
  throw new Error("unreachable: requireDispatcher called without opt-in");
}

/**
 * Retrieve the workspace, or raise a descriptive error if the live env was set but the workspace has
 * not been prepared via the full config stack (future NIN-222 live pass).
 */
function requireWorkspace(injected: Workspace | undefined, liveEnvOptIn: boolean): Workspace {
  if (injected !== undefined) {
    return injected;
  }
  if (liveEnvOptIn) {
    throw new Error(
      `${LIVE_RUN_START_ENV}=1 requires a prepared workspace from the config stack, which is not yet implemented.` +
        " Inject deps.workspace for hermetic tests, or wait for the live config pass.",
    );
  }
  // Unreachable: callers only reach here when dispatcherOptIn || liveEnvOptIn.
  throw new Error("unreachable: requireWorkspace called without opt-in");
}

/**
 * Fallback model resolver: uses the `RISOLUTO_DEFAULT_MODEL` env var or the sandbox model. The live
 * composition injects a config-driven resolver via {@link RunStartDispatchDeps.modelForProfile}, so this
 * only fires for an injected dispatcher that omits a resolver.
 */
function defaultModelForProfile(_modelProfile: string): ModelSelection {
  const model = process.env.RISOLUTO_DEFAULT_MODEL ?? "gpt-5.4-mini";
  return { model, reasoningEffort: "high", source: "default" };
}
