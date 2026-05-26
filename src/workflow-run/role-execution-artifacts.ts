import { randomUUID } from "node:crypto";

import { createWorkflowRunArchive } from "./archive.js";
import {
  type WorkflowRunEventRecord,
  type WorkflowRunArtifactReference,
  type WorkflowRunSource,
  type WorkflowRunStartRecord,
} from "./artifacts.js";

export interface WorkflowRunRoleExecutionRecord {
  id: string;
  workflowRunId: string;
  role: string;
  status: "completed";
  completedAt: string;
  artifact: WorkflowRunArtifactReference;
}

export interface WorkflowRunRoleExecutionCompletedOutput {
  type: "workflow_run.role_execution_completed";
  roleExecution: WorkflowRunRoleExecutionRecord;
}

export interface CompleteWorkflowRunRoleExecutionInput {
  dataDir?: string;
  archiveDir?: string;
  workflowRunId: string;
  role: string;
  source: WorkflowRunSource;
  artifactContractId: string;
  artifactData: unknown;
  roleExecutionId?: string;
  artifactId?: string;
  now?: () => string;
}

export async function completeWorkflowRunRoleExecution(
  input: CompleteWorkflowRunRoleExecutionInput,
): Promise<WorkflowRunRoleExecutionCompletedOutput> {
  const archive = createWorkflowRunArchive(input);
  const workflowRun = await archive.loadWorkflowRun(input.workflowRunId);
  const completedAt = input.now?.() ?? new Date().toISOString();
  const artifact = await archive.writeWorkflowRunArtifact({
    workflowRunId: input.workflowRunId,
    artifactId: input.artifactId,
    contractId: input.artifactContractId,
    data: input.artifactData,
  });
  const roleExecution = buildRoleExecution({ input, workflowRun, completedAt, artifact });

  await archive.appendWorkflowRunEvents(input.workflowRunId, [toCompletedEvent(input, workflowRun, roleExecution)]);
  return {
    type: "workflow_run.role_execution_completed",
    roleExecution,
  };
}

function buildRoleExecution(input: {
  input: CompleteWorkflowRunRoleExecutionInput;
  workflowRun: WorkflowRunStartRecord;
  completedAt: string;
  artifact: WorkflowRunArtifactReference;
}): WorkflowRunRoleExecutionRecord {
  return {
    id: input.input.roleExecutionId ?? `re_${randomUUID()}`,
    workflowRunId: input.workflowRun.id,
    role: input.input.role,
    status: "completed",
    completedAt: input.completedAt,
    artifact: input.artifact,
  };
}

function toCompletedEvent(
  input: CompleteWorkflowRunRoleExecutionInput,
  workflowRun: WorkflowRunStartRecord,
  roleExecution: WorkflowRunRoleExecutionRecord,
): WorkflowRunEventRecord {
  return {
    at: roleExecution.completedAt,
    eventType: "role_execution.completed",
    workflowRunId: workflowRun.id,
    source: input.source,
    workflowDefinitionId: workflowRun.workflowDefinitionId,
    roleExecutionId: roleExecution.id,
    role: input.role,
    artifact: roleExecution.artifact,
  };
}
