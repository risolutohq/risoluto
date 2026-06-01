import type { WorkflowRunEventRecord, WorkflowRunSource } from "./contracts.js";
import type { WorkflowExecutorEvent } from "./gate-hook-engine.js";

export interface ExecutorEventLogContext {
  readonly source: WorkflowRunSource;
  readonly at: string;
}

/**
 * Project the executor's in-memory gate / hook / budget events onto durable Workflow Run event records
 * so they are observable over the CLI (`workflow-run events list`) and HTTP, not just returned in memory.
 * Gates and hooks keep their distinct record shapes (`gate` vs `hook` references) — separate code paths,
 * separate event records.
 */
export function toWorkflowRunEventRecords(
  events: readonly WorkflowExecutorEvent[],
  context: ExecutorEventLogContext,
): WorkflowRunEventRecord[] {
  return events.map((event) => toWorkflowRunEventRecord(event, context));
}

function toWorkflowRunEventRecord(
  event: WorkflowExecutorEvent,
  context: ExecutorEventLogContext,
): WorkflowRunEventRecord {
  const base: WorkflowRunEventRecord = {
    at: context.at,
    eventType: event.eventType,
    workflowRunId: event.workflowRunId,
    source: context.source,
  };
  if (event.eventType === "validation_gate.evaluated" && event.gateId && event.status) {
    return {
      ...base,
      gate: { name: event.gateId, status: event.status },
      ...(event.reason ? { message: event.reason } : {}),
    };
  }
  if (event.eventType === "workflow_hook.fired" && event.hookId) {
    return {
      ...base,
      hook: { name: event.hookId, timing: "state_entry" },
      ...(event.evidence ? { message: `recorded evidence: ${JSON.stringify(event.evidence)}` } : {}),
    };
  }
  return { ...base, ...(event.reason ? { message: event.reason } : {}) };
}
