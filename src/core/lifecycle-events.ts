import type { Issue, RecentEvent } from "./types.js";

export type RuntimeEventRecord = RecentEvent & {
  usage?: unknown;
  rateLimits?: unknown;
  /** Risoluto-owned Workflow Run id (wr_UUID) when known. workflow_run.* emissions prefer this over the
   * tracker issue id so the run is never identified by the tracker issue (CR-03 / ADR-0001 §1). */
  workflowRunId?: string;
};

export type RuntimeEventSink = (event: RuntimeEventRecord) => void;

export interface LifecycleEventInput {
  issue: Pick<Issue, "id" | "identifier" | "workflowRunId">;
  event: string;
  message: string;
  sessionId?: string | null;
  metadata?: Record<string, unknown> | null;
  at?: string;
}

export function createLifecycleEvent(input: LifecycleEventInput): RecentEvent & { workflowRunId?: string } {
  return {
    at: input.at ?? new Date().toISOString(),
    issueId: input.issue.id,
    issueIdentifier: input.issue.identifier,
    sessionId: input.sessionId ?? null,
    event: input.event,
    message: input.message,
    metadata: input.metadata ?? null,
    workflowRunId: input.issue.workflowRunId,
  };
}
