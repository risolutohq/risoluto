import { createWorkflowRunArchive } from "./archive.js";
import type { WorkflowRunStartRecord } from "./artifacts.js";

export interface WorkflowRunsListedOutput {
  type: "workflow_runs.listed";
  workflowRuns: WorkflowRunStartRecord[];
}

export async function listWorkflowRuns(input: {
  dataDir?: string;
  archiveDir?: string;
}): Promise<WorkflowRunsListedOutput> {
  const workflowRuns = await createWorkflowRunArchive(input).listWorkflowRuns();
  return toWorkflowRunsListedOutput(workflowRuns);
}

function toWorkflowRunsListedOutput(workflowRuns: WorkflowRunStartRecord[]): WorkflowRunsListedOutput {
  return {
    type: "workflow_runs.listed",
    workflowRuns,
  };
}
