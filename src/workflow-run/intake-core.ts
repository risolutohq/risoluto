import { randomUUID } from "node:crypto";
import { setImmediate } from "node:timers/promises";

import { createWorkflowRunArchive, type WorkflowRunArchive, type WorkflowRunArchiveLocation } from "./archive.js";
import {
  createWorkflowRunRecord,
  DEFAULT_WORKFLOW_DEFINITION_ID,
  openWorkflowRun,
  writeWorkflowRunRecord,
} from "./artifacts.js";
import type {
  WorkflowRunResolvedDefinitionConfig,
  WorkflowRunSource,
  WorkflowRunStartRecord,
  WorkflowRunTrigger,
} from "./contracts.js";
import {
  claimDeliveryMapping,
  claimExternalMapping,
  readDeliveryMapping,
  readExternalMapping,
} from "./intake-idempotency-store.js";
import {
  AmbiguousWorkflowRunIntakeError,
  InvalidWorkflowRunIntakeError,
  resolveWorkflowRunIntake,
  type ResolvedWorkflowRunIntake,
  type WorkflowRunIntakeRule,
} from "./intake-rules.js";

export type WorkflowRunIntakeSource = WorkflowRunSource;
export type WorkflowRunIntakeMode = "retry" | "start";
export type WorkflowRunIntakeAction = "created" | "deduplicated" | "retried";
export type { WorkflowRunIntakeRule } from "./intake-rules.js";
export { AmbiguousWorkflowRunIntakeError, InvalidWorkflowRunIntakeError };

export interface WorkflowRunIntakeExternalObject {
  readonly provider: WorkflowRunIntakeSource;
  readonly id: string;
  readonly url: string | null;
}

export interface WorkflowRunIntentArtifact {
  readonly version: 1;
  readonly workflowRunId: string;
  readonly createdAt: string;
  readonly source: WorkflowRunIntakeSource;
  readonly title: string;
  readonly body: string;
  readonly externalReferences: readonly WorkflowRunIntakeExternalObject[];
}

export interface WorkflowRunIntakeOutput {
  readonly type: "workflow_run_intake.accepted";
  readonly action: WorkflowRunIntakeAction;
  readonly workflowRun: WorkflowRunStartRecord;
  readonly intent: WorkflowRunIntentArtifact;
  readonly runAttempt?: {
    readonly id: string;
    readonly workflowRunId: string;
    readonly attemptNumber?: number;
    readonly reason?: "initial" | "retry" | "resume";
  };
}

export interface AcceptWorkflowRunIntakeInput extends WorkflowRunArchiveLocation {
  readonly source: WorkflowRunIntakeSource;
  readonly mode: WorkflowRunIntakeMode;
  readonly title: string;
  readonly body: string;
  readonly externalObject: WorkflowRunIntakeExternalObject | null;
  readonly deliveryId?: string | null;
  readonly labels?: readonly string[];
  readonly state?: string | null;
  readonly rules?: readonly WorkflowRunIntakeRule[];
  readonly workflowDefinitionId?: string;
  readonly resolvedWorkflowDefinition?: WorkflowRunResolvedDefinitionConfig;
  readonly workspaceKey?: string;
  readonly trigger?: WorkflowRunTrigger;
  readonly now?: () => string;
  readonly id?: () => string;
  readonly attemptId?: () => string;
}

export async function acceptWorkflowRunIntake(input: AcceptWorkflowRunIntakeInput): Promise<WorkflowRunIntakeOutput> {
  const delivery = await readDeliveryMapping({
    location: input,
    provider: input.source,
    deliveryId: input.deliveryId,
  });
  if (delivery) {
    return toExistingOutput(input, delivery.workflowRunId, "deduplicated");
  }

  const existing = await readExternalMapping({ location: input, externalObject: input.externalObject });
  if (existing) {
    const action = input.mode === "retry" ? "retried" : "deduplicated";
    return acceptExistingWorkflowRunIntake(input, existing.workflowRunId, tryResolveWorkflowRunIntake(input), action);
  }

  return createNewWorkflowRunIntake(input, resolveWorkflowRunIntake(input));
}

// On the dedup paths the issue already maps to a run, so rule resolution is best-effort: a tracker edit
// that newly makes labels ambiguous/invalid must still deduplicate, not throw. Strict resolution is only
// required when creating a brand-new run.
function tryResolveWorkflowRunIntake(input: AcceptWorkflowRunIntakeInput): ResolvedWorkflowRunIntake {
  try {
    return resolveWorkflowRunIntake(input);
  } catch (error) {
    if (error instanceof AmbiguousWorkflowRunIntakeError || error instanceof InvalidWorkflowRunIntakeError) {
      return {
        rule: null,
        workflowDefinitionId: input.workflowDefinitionId ?? DEFAULT_WORKFLOW_DEFINITION_ID,
        workspaceKey: input.workspaceKey ?? "default",
      };
    }
    throw error;
  }
}

async function createNewWorkflowRunIntake(
  input: AcceptWorkflowRunIntakeInput,
  resolved: ResolvedWorkflowRunIntake,
): Promise<WorkflowRunIntakeOutput> {
  const archive = createWorkflowRunArchive(input);
  const workflowRun = createWorkflowRunRecord({
    ...input,
    intent: input.body,
    workflowDefinitionId: resolved.workflowDefinitionId,
    workspaceKey: resolved.workspaceKey,
    resolvedWorkflowDefinition: input.resolvedWorkflowDefinition,
    source: input.source,
    trigger: input.trigger,
  });
  const intent = normalizeWorkflowRunIntent({
    workflowRunId: workflowRun.id,
    createdAt: workflowRun.createdAt,
    source: input.source,
    title: input.title,
    body: input.body,
    externalObject: input.externalObject,
  });
  const externalClaim = await claimExternalMapping({
    location: input,
    externalObject: input.externalObject,
    workflowRunId: workflowRun.id,
    ruleId: resolved.rule?.id ?? null,
  });
  if (externalClaim.status === "existing") {
    const action = input.mode === "retry" ? "retried" : "deduplicated";
    return acceptExistingWorkflowRunIntake(input, externalClaim.mapping.workflowRunId, resolved, action);
  }
  await claimDeliveryMapping({
    location: input,
    provider: input.source,
    deliveryId: input.deliveryId,
    workflowRunId: workflowRun.id,
    ruleId: resolved.rule?.id ?? null,
  });
  await writeWorkflowRunRecord(workflowRun);
  await archive.writeWorkflowRunArtifact({
    workflowRunId: workflowRun.id,
    artifactId: "intent",
    contractId: "intent.v1",
    data: intent,
    producer: { type: "action", id: "workflow-run-intake" },
  });
  return { type: "workflow_run_intake.accepted", action: "created", workflowRun, intent };
}

async function acceptExistingWorkflowRunIntake(
  input: AcceptWorkflowRunIntakeInput,
  workflowRunId: string,
  resolved: ResolvedWorkflowRunIntake,
  action: WorkflowRunIntakeAction,
): Promise<WorkflowRunIntakeOutput> {
  await claimDeliveryMapping({
    location: input,
    provider: input.source,
    deliveryId: input.deliveryId,
    workflowRunId,
    ruleId: resolved.rule?.id ?? null,
  });
  return toExistingOutput(input, workflowRunId, action);
}

export function normalizeWorkflowRunIntent(input: {
  readonly workflowRunId: string;
  readonly createdAt: string;
  readonly source: WorkflowRunIntakeSource;
  readonly title: string;
  readonly body: string;
  readonly externalObject: WorkflowRunIntakeExternalObject | null;
}): WorkflowRunIntentArtifact {
  return {
    version: 1,
    workflowRunId: input.workflowRunId,
    createdAt: input.createdAt,
    source: input.source,
    title: input.title,
    body: input.body,
    externalReferences: input.externalObject ? [input.externalObject] : [],
  };
}

async function toExistingOutput(
  input: AcceptWorkflowRunIntakeInput,
  workflowRunId: string,
  action: WorkflowRunIntakeAction,
): Promise<WorkflowRunIntakeOutput> {
  const archive = createWorkflowRunArchive(input);
  const workflowRun = await loadClaimedWorkflowRun(archive, workflowRunId);
  const intent = normalizeWorkflowRunIntent({
    workflowRunId: workflowRun.id,
    createdAt: workflowRun.createdAt,
    source: input.source,
    title: input.title,
    body: input.body,
    externalObject: input.externalObject,
  });
  if (action !== "retried") {
    return { type: "workflow_run_intake.accepted", action, workflowRun, intent };
  }

  const run = await openWorkflowRun(input, { workflowRunId, source: workflowRun.source, now: input.now });
  const events = await archive.readWorkflowRunEvents(workflowRunId);
  const attemptNumber = nextAttemptNumber(events);
  const started = await run.startRunAttempt({
    attemptId: input.attemptId?.() ?? `attempt_${randomUUID()}`,
    attemptNumber,
    reason: "retry",
  });
  return { type: "workflow_run_intake.accepted", action, workflowRun, intent, runAttempt: started.runAttempt };
}

async function loadClaimedWorkflowRun(
  archive: WorkflowRunArchive,
  workflowRunId: string,
): Promise<WorkflowRunStartRecord> {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return await archive.loadWorkflowRun(workflowRunId);
    } catch (error) {
      if (!isErrorCode(error, "ENOENT") || attempt === 5) {
        throw error;
      }
      await setImmediate();
    }
  }
  throw new TypeError(`claimed Workflow Run was not committed: ${workflowRunId}`);
}

function nextAttemptNumber(events: readonly { readonly runAttempt?: { readonly attemptNumber?: number } }[]): number {
  return Math.max(0, ...events.map((event) => event.runAttempt?.attemptNumber ?? 0)) + 1;
}

function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
