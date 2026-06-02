import type { WorkflowRunSource, WorkflowRunStatus } from "./contracts.js";

export type StatusProjectionProvider = Extract<WorkflowRunSource, "github" | "linear" | "slack">;
export type WorkflowRunStatusMapping = Partial<Record<WorkflowRunStatus, string>>;

export interface ProjectWorkflowRunStatusInput {
  readonly workflowRunId: string;
  readonly workflowDefinitionId: string;
  readonly provider: StatusProjectionProvider;
  readonly runStatus: WorkflowRunStatus;
  readonly workspaceMapping: WorkflowRunStatusMapping;
  readonly workflowMapping?: WorkflowRunStatusMapping;
}

export interface WorkflowRunStatusProjection {
  readonly workflowRunId: string;
  readonly workflowDefinitionId: string;
  readonly provider: StatusProjectionProvider;
  readonly runStatus: WorkflowRunStatus;
  readonly externalStatus: string;
  readonly mappingScope: "workspace" | "workflow";
}

export interface ObserveExternalStatusChangeInput {
  readonly workflowRunId: string;
  readonly workflowDefinitionId: string;
  readonly provider: StatusProjectionProvider;
  readonly canonicalRunStatus: WorkflowRunStatus;
  readonly externalStatus: string;
  readonly observedAt: string;
}

export type ExternalStatusChangeObservation = ObserveExternalStatusChangeInput;

export class WorkflowRunStatusProjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowRunStatusProjectionError";
  }
}

export function projectWorkflowRunStatus(input: ProjectWorkflowRunStatusInput): WorkflowRunStatusProjection {
  const workflowStatus = input.workflowMapping?.[input.runStatus];
  const workspaceStatus = input.workspaceMapping[input.runStatus];
  const externalStatus = workflowStatus ?? workspaceStatus;
  if (!externalStatus) {
    throw new WorkflowRunStatusProjectionError(
      `no ${input.provider} status mapping for ${input.runStatus} on ${input.workflowRunId}`,
    );
  }
  return {
    workflowRunId: input.workflowRunId,
    workflowDefinitionId: input.workflowDefinitionId,
    provider: input.provider,
    runStatus: input.runStatus,
    externalStatus,
    mappingScope: workflowStatus ? "workflow" : "workspace",
  };
}

export function observeExternalStatusChange(input: ObserveExternalStatusChangeInput): ExternalStatusChangeObservation {
  return {
    workflowRunId: input.workflowRunId,
    workflowDefinitionId: input.workflowDefinitionId,
    provider: input.provider,
    canonicalRunStatus: input.canonicalRunStatus,
    externalStatus: input.externalStatus,
    observedAt: input.observedAt,
  };
}
