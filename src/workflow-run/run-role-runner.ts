import type { ResolvedWorkflowRole } from "../workflow-definition/registry.js";
import type { WorkflowRunArtifactPayload } from "./archive.js";
import { parseWorkflowRunArtifact } from "./artifact-contracts.js";
import type { WorkflowRoleExecutionInput } from "./executor.js";

/**
 * The agent-session effect port. Production binds this to the agent harness; tests inject a hermetic
 * fake. The contract (D1, see `docs/prds/workflow-first-afk-mvp.md` ADDENDUM): the dispatch runs the
 * role's session and MUST deposit a contract-valid artifact for every id in `role.produces` at its
 * canonical archive path before resolving. The runner then reads those artifacts back and types them.
 */
export interface WorkflowRunRoleDispatchInput {
  readonly workflowRunId: string;
  readonly role: ResolvedWorkflowRole;
  readonly artifacts: Readonly<Record<string, unknown>>;
}

export type WorkflowRunRoleDispatch = (input: WorkflowRunRoleDispatchInput) => Promise<void>;

/** Raised when a role session does not deposit a contract-valid artifact for one of `role.produces`. */
export class WorkflowRunRoleDispatchError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorkflowRunRoleDispatchError";
  }
}

export interface CreateWorkflowRunRoleRunnerDeps {
  readonly dispatchRole: WorkflowRunRoleDispatch;
  readonly readArtifact: (input: { workflowRunId: string; artifactId: string }) => Promise<WorkflowRunArtifactPayload>;
}

/**
 * Canonical archive `artifactId` for a contract id: the contract id with its `.v<n>` suffix dropped
 * (`plan.v1` -> `plan`, `change_summary.v1` -> `change_summary`). Mirrors the intake convention used
 * for `intent.v1` -> `intent`.
 */
export function workflowRunArtifactIdForContract(contractId: string): string {
  return contractId.replace(/\.v\d+$/, "");
}

/**
 * Builds the production `runRole` provider: dispatch the role's agent session, then read each produced
 * artifact back from the archive (D1) and parse it into its typed contract. A role that finishes without
 * a contract-valid artifact for every `role.produces` id fails with attribution rather than continuing.
 */
export function createWorkflowRunRoleRunner(
  deps: CreateWorkflowRunRoleRunnerDeps,
): (input: WorkflowRoleExecutionInput) => Promise<Readonly<Record<string, unknown>>> {
  return async (input) => {
    await deps.dispatchRole({ workflowRunId: input.workflowRunId, role: input.role, artifacts: input.artifacts });
    const produced: Record<string, unknown> = {};
    for (const contractId of input.role.produces) {
      produced[contractId] = await readBackProducedArtifact(deps, input.workflowRunId, input.role, contractId);
    }
    return produced;
  };
}

async function readBackProducedArtifact(
  deps: CreateWorkflowRunRoleRunnerDeps,
  workflowRunId: string,
  role: ResolvedWorkflowRole,
  contractId: string,
): Promise<unknown> {
  const artifactId = workflowRunArtifactIdForContract(contractId);
  let payload: WorkflowRunArtifactPayload;
  try {
    payload = await deps.readArtifact({ workflowRunId, artifactId });
  } catch (error) {
    throw new WorkflowRunRoleDispatchError(
      `role ${role.id} did not deposit required artifact ${contractId} (expected ${artifactId}.json in the run archive)`,
      { cause: error },
    );
  }
  return parseWorkflowRunArtifact({ contractId, data: payload.data, producer: { type: "role", id: role.id } });
}
