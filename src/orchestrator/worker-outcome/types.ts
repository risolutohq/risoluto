import type { Issue, ModelSelection, RunOutcome, WorkflowRunReference, Workspace } from "../../core/types.js";
import type { RunningEntry } from "../runtime-types.js";

export interface WorkerOutcomeInput {
  outcome: RunOutcome;
  entry: RunningEntry;
  issue: Issue;
  workspace: Workspace;
  attempt: number | null;
}

export interface PreparedWorkerOutcome extends WorkerOutcomeInput {
  latestIssue: Issue;
  modelSelection: ModelSelection;
}

export function issueRef(issue: Issue) {
  return { id: issue.id, identifier: issue.identifier, title: issue.title, state: issue.state, url: issue.url };
}

export function workflowRunRef(issue: Issue): WorkflowRunReference {
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description,
    url: issue.url,
  };
}

export type WorkerTerminalStatus = "completed" | "timed_out" | "stalled" | "cancelled" | "failed";

const STATUS_MAP: Record<RunOutcome["kind"], WorkerTerminalStatus> = {
  normal: "completed",
  timed_out: "timed_out",
  stalled: "stalled",
  cancelled: "cancelled",
  failed: "failed",
};

export function outcomeToStatus(kind: RunOutcome["kind"]): WorkerTerminalStatus {
  return STATUS_MAP[kind];
}
