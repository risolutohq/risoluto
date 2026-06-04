import {
  DEFAULT_WORKFLOW_RESOLUTION_DEFAULTS,
  loadWorkflowDefinitionRegistry,
} from "../workflow-definition/registry.js";
import { createWorkflowRunArchive } from "../workflow-run/archive.js";
import { createUnconfiguredAgentRoleDispatch } from "../workflow-run/agent-role-dispatch.js";
import type { WorkflowBudgetPolicy } from "../workflow-run/budget-retry.js";
import { driveAcceptedWorkflowRun, type DriveAcceptedWorkflowRunResult } from "../workflow-run/drive-accepted-run.js";
import type { WorkflowRunIntentArtifact } from "../workflow-run/intake-core.js";
import { createWorkflowRunActionRunner, type WorkflowRunActionEffects } from "../workflow-run/run-action-runner.js";
import { createWorkflowRunRoleRunner, type WorkflowRunRoleDispatch } from "../workflow-run/run-role-runner.js";
import type { RisolutoLogger } from "../core/types.js";

/**
 * Deps for the accepted-run driver. All fields except `archiveDir` and `workflowDir` are optional
 * injection seams: tests inject hermetic fakes; production leaves them unset so the honest-block
 * default ({@link createUnconfiguredAgentRoleDispatch}) is used.
 *
 * Binding the real agent harness here is the LIVE slice (RIS-222, Omer-gated). Until that slice
 * lands, every surface drives to a real blocked handoff instead of sitting in `accepted` forever.
 */
export interface AcceptedRunDriverDeps {
  readonly archiveDir: string;
  readonly workflowDir: string;
  readonly logger: RisolutoLogger;
  /**
   * Injection seam for the role-dispatch boundary. Production defaults to
   * {@link createUnconfiguredAgentRoleDispatch} (honest block). Tests inject a
   * fake dispatchRole that deposits contract-valid artifacts so the run can reach `done`.
   *
   * To bind the real agent harness later, wire `createWorkflowRunAgentDispatch` here.
   */
  readonly dispatchRole?: WorkflowRunRoleDispatch;
  readonly actionEffects?: WorkflowRunActionEffects;
  readonly budget?: WorkflowBudgetPolicy;
  readonly now?: () => string;
  /**
   * Optional test hook: called with the drive result after the background drive completes.
   * Allows integration tests to await the background drive deterministically via a Promise.
   */
  readonly onSettled?: (result: DriveAcceptedWorkflowRunResult) => void;
}

export interface AcceptedRunDriver {
  readonly drive: (workflowRunId: string) => Promise<DriveAcceptedWorkflowRunResult>;
}

/**
 * Create a driver that advances an accepted Workflow Run through the same engine every intake
 * surface drives. Mirrors {@link driveWithDeps} from `run-start-command.ts` without the CLI arg
 * parsing or live-dispatch composition.
 */
export function createAcceptedRunDriver(deps: AcceptedRunDriverDeps): AcceptedRunDriver {
  return { drive: (workflowRunId) => driveRun(deps, workflowRunId) };
}

async function driveRun(deps: AcceptedRunDriverDeps, workflowRunId: string): Promise<DriveAcceptedWorkflowRunResult> {
  const location = { archiveDir: deps.archiveDir };
  const archive = createWorkflowRunArchive(location);
  const workflowRun = await archive.loadWorkflowRun(workflowRunId);

  const intentPayload = await archive.readWorkflowRunArtifact({ workflowRunId, artifactId: "intent" });
  const intent = intentPayload.data as WorkflowRunIntentArtifact;

  const definition = await resolveDefinition(deps, workflowRun.workflowDefinitionId);

  const nowFn = deps.now ?? (() => new Date().toISOString());
  const dispatchRole = deps.dispatchRole ?? createUnconfiguredAgentRoleDispatch();

  const runRole = createWorkflowRunRoleRunner({
    dispatchRole,
    readArtifact: (input) => archive.readWorkflowRunArtifact(input),
  });

  const runAction = createWorkflowRunActionRunner({
    effects: deps.actionEffects ?? {},
    workflowDefinitionId: definition.id,
    now: nowFn,
    writeArtifact: (input) => archive.writeWorkflowRunArtifact(input),
  });

  const result = await driveAcceptedWorkflowRun({
    archiveDir: deps.archiveDir,
    definition,
    workflowRun,
    intent,
    runRole,
    runAction,
    budget: deps.budget ?? createDefaultWorkflowBudget(),
    now: nowFn,
  });

  deps.onSettled?.(result);
  return result;
}

async function resolveDefinition(deps: AcceptedRunDriverDeps, workflowDefinitionId: string) {
  const registry = await loadWorkflowDefinitionRegistry({
    workflowDir: deps.workflowDir,
    globalDefaults: DEFAULT_WORKFLOW_RESOLUTION_DEFAULTS,
  });
  return registry.resolve(workflowDefinitionId);
}

function createDefaultWorkflowBudget(): WorkflowBudgetPolicy {
  const startedAtMs = Date.now();
  return {
    startedAtMs,
    nowMs: () => Date.now(),
    usage: () => ({ usageByModelProfile: {}, modelProfilePrices: {} }),
  };
}
