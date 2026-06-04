import type { RisolutoLogger } from "../core/types.js";
import type { TrackerPort } from "../tracker/port.js";
import type { WorkflowRunStatus } from "./contracts.js";
import {
  projectWorkflowRunStatus,
  type StatusProjectionProvider,
  type WorkflowRunStatusMapping,
} from "./status-projection.js";

export interface MirrorWorkflowRunStatusInput {
  readonly tracker: Pick<TrackerPort, "resolveStateId" | "updateIssueState">;
  readonly workflowRunId: string;
  readonly workflowDefinitionId: string;
  readonly provider: StatusProjectionProvider;
  readonly issueId: string;
  readonly runStatus: WorkflowRunStatus;
  /** Workspace-level mapping (tracker config). Always required. */
  readonly workspaceMapping: WorkflowRunStatusMapping;
  /** Workflow-level override (resolved workflow definition). Beats the workspace mapping. */
  readonly workflowMapping?: WorkflowRunStatusMapping;
  readonly logger?: Pick<RisolutoLogger, "warn">;
}

export interface MirroredWorkflowRunStatus {
  readonly externalStatus: string;
  readonly mappingScope: "workspace" | "workflow";
  /** False when the projected external state is unknown to the tracker, so no board write was made. */
  readonly applied: boolean;
}

/**
 * Project a canonical Run Status to the configured external board state and mirror it through the
 * tracker port. This is the production caller of {@link projectWorkflowRunStatus}: an unmapped Run
 * Status throws {@link WorkflowRunStatusProjectionError} here (propagated, not swallowed) so the mirror
 * blocks with a clear error instead of silently choosing a state. External status is a projection of
 * canonical truth, never its source.
 */
export async function mirrorWorkflowRunStatusToTracker(
  input: MirrorWorkflowRunStatusInput,
): Promise<MirroredWorkflowRunStatus> {
  const projection = projectWorkflowRunStatus({
    workflowRunId: input.workflowRunId,
    workflowDefinitionId: input.workflowDefinitionId,
    provider: input.provider,
    runStatus: input.runStatus,
    workspaceMapping: input.workspaceMapping,
    workflowMapping: input.workflowMapping,
  });

  const stateId = await input.tracker.resolveStateId(projection.externalStatus);
  if (!stateId) {
    input.logger?.warn(
      { workflow_run_id: input.workflowRunId, external_status: projection.externalStatus, provider: input.provider },
      "projected external status not found on tracker — skipping status mirror",
    );
    return { externalStatus: projection.externalStatus, mappingScope: projection.mappingScope, applied: false };
  }

  await input.tracker.updateIssueState(input.issueId, stateId);
  return { externalStatus: projection.externalStatus, mappingScope: projection.mappingScope, applied: true };
}
