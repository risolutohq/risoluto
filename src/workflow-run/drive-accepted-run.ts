import type { ResolvedWorkflowDefinition } from "../workflow-definition/registry.js";
import { createWorkflowRunArchive, type WorkflowRunArchive, type WorkflowRunArchiveLocation } from "./archive.js";
import { parseWorkflowRunArtifact } from "./artifact-contracts.js";
import type { WorkflowRunStartRecord } from "./contracts.js";
import { budgetFromPolicy, writeDoneHandoff, writeHandoffMarkdown } from "./drive-done-handoff.js";
import {
  createWorkflowRunEvidenceStore,
  type WorkflowRunEvidenceRecord,
  type WriteWorkflowRunEvidenceInput,
} from "./evidence-store.js";
import { toWorkflowRunEventRecords } from "./executor-event-log.js";
import { WorkflowExecutorError, type ExecuteWorkflowDefinitionInput, type WorkflowExecutorResult } from "./executor.js";
import type {
  WorkflowExecutorEvent,
  WorkflowHookExecutionInput,
  WorkflowHookExecutionResult,
} from "./gate-hook-engine.js";
import type { HandoffArtifact } from "./handoff-contract.js";
import type { WorkflowRunIntentArtifact } from "./intake-core.js";
import {
  createWorkflowRunMemoryStore,
  type ProjectMemoryPromotionMode,
  type WorkflowRunAttemptMemoryRecord,
} from "./memory-store.js";
import { reconfirmPostPublishVerification, type VerificationArtifact } from "./post-publish-verifier.js";
import type { PrPublishMode } from "./publish-policy.js";
import { WorkflowRunActionError } from "./run-action-runner.js";
import { WorkflowRunRoleDispatchError } from "./run-role-runner.js";
import { driveWorkflowRun, type DriveWorkflowRunInput } from "./workflow-run-driver.js";
import { isRecord, toErrorString } from "../utils/type-guards.js";

export interface DriveAcceptedWorkflowRunInput extends WorkflowRunArchiveLocation {
  readonly definition: ResolvedWorkflowDefinition;
  readonly workflowRun: WorkflowRunStartRecord;
  readonly intent: WorkflowRunIntentArtifact;
  readonly runRole: ExecuteWorkflowDefinitionInput["runRole"];
  readonly runAction?: ExecuteWorkflowDefinitionInput["runAction"];
  readonly runHook?: ExecuteWorkflowDefinitionInput["runHook"];
  readonly evaluateGate?: ExecuteWorkflowDefinitionInput["evaluateGate"];
  readonly retryGate?: ExecuteWorkflowDefinitionInput["retryGate"];
  readonly maxGateRetries?: number;
  readonly budget?: ExecuteWorkflowDefinitionInput["budget"];
  readonly now?: () => string;
  /** Council verifier callbacks (NIN-76). When present, council-mode verifier roles dispatch real sessions. */
  readonly runCouncillor?: ExecuteWorkflowDefinitionInput["runCouncillor"];
  readonly synthesizeCouncil?: ExecuteWorkflowDefinitionInput["synthesizeCouncil"];
  readonly councilClock?: ExecuteWorkflowDefinitionInput["councilClock"];
  /**
   * Run on the DONE path BEFORE the handoff is written: commit + push the agent's workspace and open a
   * PR. Its `pullRequestUrl` is threaded into `handoff.output` and the result so callers can surface it.
   */
  readonly publishOnDone?: () => Promise<{ pullRequestUrl: string | null }>;
  /**
   * Run on the DONE path AFTER the PR is published (NIN-272): route the run's archived gates through
   * `completeAutoMerge` (see `completeAutoMergeForRun`). Only invoked when a PR URL was published. Must not
   * throw — it owns its own result handling and logging; a blocked or failed auto-merge never un-does the
   * already-finalized run.
   */
  readonly completeAutoMergeOnDone?: (input: { pullRequestUrl: string }) => Promise<void>;
  /**
   * Ordinal position of this attempt within the Workflow Run (1-based). Used to read prior attempt memory
   * before execution and to write attempt memory with the correct sequence number (NIN-104). Defaults to 1
   * when not supplied — pass the intake-derived attempt number for retries.
   */
  readonly attemptNumber?: number;
  /**
   * Controls whether project-memory candidates emitted during this run are auto-promoted or kept as
   * proposals only (NIN-104). Defaults to `"propose_only"`.
   */
  readonly projectMemoryMode?: ProjectMemoryPromotionMode;
}

export interface DriveAcceptedWorkflowRunResult {
  readonly outcome: "blocked" | "done";
  readonly workflowRunId: string;
  readonly roleExecutions: readonly string[];
  readonly reason?: string;
  readonly handoffArtifactId?: string;
  readonly pullRequestUrl?: string | null;
}

/**
 * Advance an accepted Workflow Run through the SAME engine every intake surface drives. On a clean run
 * it returns `done`; on a planner/gate/budget block it returns `blocked`; on a role/dispatch failure it
 * records the block and writes a real `handoff.v1` — an honest handoff, never a stubbed success.
 */
export async function driveAcceptedWorkflowRun(
  input: DriveAcceptedWorkflowRunInput,
): Promise<DriveAcceptedWorkflowRunResult> {
  const archive = createWorkflowRunArchive(input);
  const location = archiveLocation(input);
  const now = input.now ?? defaultNow;
  const attemptNumber = input.attemptNumber ?? 1;
  const { runHook, getEvidenceRefs } = input.runHook
    ? { runHook: input.runHook, getEvidenceRefs: () => [] as EvidenceRef[] }
    : createEvidenceCapturingHook(location, now);
  const priorAttemptMemory = await readPriorAttemptMemoryForRun(location, input.workflowRun.id, attemptNumber);
  try {
    const result = await driveWorkflowRun({
      ...location,
      definition: input.definition,
      workflowRunId: input.workflowRun.id,
      initialArtifacts: buildInitialArtifacts(input.intent, priorAttemptMemory),
      runRole: input.runRole,
      ...(input.runAction ? { runAction: input.runAction } : {}),
      runHook,
      ...(input.evaluateGate ? { evaluateGate: input.evaluateGate } : {}),
      ...(input.retryGate ? { retryGate: input.retryGate } : {}),
      ...(input.maxGateRetries === undefined ? {} : { maxGateRetries: input.maxGateRetries }),
      ...(input.budget ? { budget: input.budget } : {}),
      ...buildCouncilDriveOpts(input),
      // Defer the terminal "done" persistence until after publishOnDone (in finishDrivenRun). If the
      // executor wrote "done" here, the archive's terminal-status guard would reject the later
      // done -> blocked transition when a PR publish fails, stranding a "done" run with no PR
      // (RIS-260). "running"/"blocked" still persist immediately.
      recordStatus: async ({ workflowRunId, status }) => {
        if (status !== "done") {
          await archive.updateWorkflowRunStatus(workflowRunId, status);
        }
      },
    });
    await persistCouncilVerificationIfPresent(archive, input.workflowRun.id, result.artifacts);
    const evidenceRefs = getEvidenceRefs();
    const memoryRecord = await writeAttemptMemoryAndCandidate(
      input,
      location,
      now,
      result.status,
      evidenceRefs,
      attemptNumber,
    );
    return await finishDrivenRun(archive, input, location, result, memoryRecord, evidenceRefs);
  } catch (error) {
    if (
      !(
        error instanceof WorkflowExecutorError ||
        error instanceof WorkflowRunRoleDispatchError ||
        error instanceof WorkflowRunActionError
      )
    ) {
      throw error;
    }
    await writeAttemptMemoryAndCandidate(input, location, now, "blocked", getEvidenceRefs(), attemptNumber);
    return await finishFailedRun(archive, input, error.message);
  }
}

async function finishDrivenRun(
  archive: WorkflowRunArchive,
  input: DriveAcceptedWorkflowRunInput,
  location: WorkflowRunArchiveLocation,
  result: WorkflowExecutorResult,
  memoryRecord: WorkflowRunAttemptMemoryRecord,
  evidenceRefs: readonly EvidenceRef[],
): Promise<DriveAcceptedWorkflowRunResult> {
  await persistExecutorEvents(archive, input, result.events);
  if (result.status === "done") {
    const createdAt = (input.now ?? defaultNow)();
    // Publish the PR BEFORE the run is finalized as done. If publishing fails, move the run
    // to blocked with a handoff rather than leaving a terminal "done" run with no PR (RIS-260).
    let published: { pullRequestUrl: string | null } | null = null;
    if (input.publishOnDone) {
      try {
        published = await input.publishOnDone();
      } catch (error) {
        return await finishPublishFailedRun(archive, input, result.roleExecutions, toErrorString(error));
      }
    }
    // The PR is published (or there was no publish step) — only now finalize the run as done. The
    // executor's terminal "done" write was deferred (see recordStatus above) so the publish-failure
    // path above could still route to blocked past the archive's terminal guard (RIS-260).
    await archive.updateWorkflowRunStatus(input.workflowRun.id, "done");
    // Post-publish verification reconfirm (NIN-103): update the archived verification artifact with
    // post-publish evidence so the auto-merge gate reads the reconfirmed decision.
    if (published) {
      await reconfirmAndPersistVerification(archive, input.workflowRun.id, result, published);
    }
    // The run is finalized done and the PR is published — now run the auto-merge completion gate (NIN-272).
    // Post-finalization and best-effort: the callback owns its result/errors, so it can never un-do the run.
    if (published?.pullRequestUrl && input.completeAutoMergeOnDone) {
      await input.completeAutoMergeOnDone({ pullRequestUrl: published.pullRequestUrl });
    }
    const handoff = await writeDoneHandoff(
      archive,
      { workflowRunId: input.workflowRun.id, createdAt, ...(input.budget ? { budget: input.budget } : {}) },
      location,
      result,
      memoryRecord,
      evidenceRefs,
      published?.pullRequestUrl ?? null,
    );
    return {
      outcome: "done",
      workflowRunId: input.workflowRun.id,
      roleExecutions: result.roleExecutions,
      handoffArtifactId: handoff.artifactId,
      ...(published ? { pullRequestUrl: published.pullRequestUrl } : {}),
    };
  }
  const { reason, kind } = blockedOutcome(result.events);
  const handoff = await writeBlockedHandoff(archive, input, reason, kind);
  return {
    outcome: "blocked",
    workflowRunId: input.workflowRun.id,
    roleExecutions: result.roleExecutions,
    reason,
    handoffArtifactId: handoff.artifactId,
  };
}

async function finishFailedRun(
  archive: WorkflowRunArchive,
  input: DriveAcceptedWorkflowRunInput,
  reason: string,
): Promise<DriveAcceptedWorkflowRunResult> {
  await archive.updateWorkflowRunStatus(input.workflowRun.id, "blocked");
  const handoff = await writeBlockedHandoff(archive, input, reason, "failed_gate");
  return {
    outcome: "blocked",
    workflowRunId: input.workflowRun.id,
    roleExecutions: [],
    reason,
    handoffArtifactId: handoff.artifactId,
  };
}

async function finishPublishFailedRun(
  archive: WorkflowRunArchive,
  input: DriveAcceptedWorkflowRunInput,
  roleExecutions: readonly string[],
  publishError: string,
): Promise<DriveAcceptedWorkflowRunResult> {
  const reason = `PR publish failed before the run could be marked done: ${publishError}`;
  await archive.updateWorkflowRunStatus(input.workflowRun.id, "blocked");
  const handoff = await writeBlockedHandoff(archive, input, reason, "failed_gate");
  return {
    outcome: "blocked",
    workflowRunId: input.workflowRun.id,
    roleExecutions,
    reason,
    handoffArtifactId: handoff.artifactId,
  };
}

function blockedOutcome(events: readonly WorkflowExecutorEvent[]): {
  reason: string;
  kind: "blocking_question" | "failed_gate";
} {
  const failedGate = [...events]
    .reverse()
    .find((event) => event.eventType === "validation_gate.evaluated" && event.status === "failed");
  if (failedGate) {
    return {
      reason: `gate ${failedGate.gateId} failed${failedGate.reason ? `: ${failedGate.reason}` : ""}`,
      kind: "failed_gate",
    };
  }
  const budgetStop = [...events]
    .reverse()
    .find((event) => event.eventType === "workflow_budget.checked" && event.status === "failed");
  if (budgetStop) {
    return { reason: `budget exhausted${budgetStop.reason ? `: ${budgetStop.reason}` : ""}`, kind: "failed_gate" };
  }
  return { reason: "planner triage blocked the run before implementation budget was spent", kind: "blocking_question" };
}

async function writeBlockedHandoff(
  archive: WorkflowRunArchive,
  input: DriveAcceptedWorkflowRunInput,
  reason: string,
  kind: "blocking_question" | "failed_gate",
): Promise<{ artifactId: string }> {
  const createdAt = (input.now ?? defaultNow)();
  const handoff: HandoffArtifact = {
    version: 1,
    workflowRunId: input.workflowRun.id,
    createdAt,
    outcome: "blocked",
    summary: `Workflow Run ${input.workflowRun.id} blocked: ${reason}`,
    recommendedNextAction: "Resolve the blocker, then retry the run from the CLI.",
    suggestedSkills: ["risoluto-tdd"],
    budget: budgetFromPolicy(input.budget),
    validation: { status: "not_run" },
    attemptMemory: [],
    output: { branchName: null, pullRequestUrl: null },
    blockers: [{ kind, message: reason }],
    artifacts: [],
    evidence: [],
  };
  const record = await archive.writeWorkflowRunArtifact({
    workflowRunId: input.workflowRun.id,
    contractId: "handoff.v1",
    artifactId: "handoff",
    data: handoff,
    producer: { type: "action", id: "write-handoff" },
  });
  await writeHandoffMarkdown(archiveLocation(input), input.workflowRun.id, handoff);
  return record;
}

async function persistExecutorEvents(
  archive: WorkflowRunArchive,
  input: DriveAcceptedWorkflowRunInput,
  events: readonly WorkflowExecutorEvent[],
): Promise<void> {
  if (events.length === 0) {
    return;
  }
  const records = toWorkflowRunEventRecords(events, {
    source: input.workflowRun.source,
    at: (input.now ?? defaultNow)(),
  });
  await archive.appendWorkflowRunEvents(input.workflowRun.id, records);
}

interface EvidenceRef {
  readonly evidenceId: string;
  readonly path: string;
}

interface EvidenceCapturingHook {
  readonly runHook: (input: WorkflowHookExecutionInput) => Promise<WorkflowHookExecutionResult>;
  readonly getEvidenceRefs: () => readonly EvidenceRef[];
}

function createEvidenceCapturingHook(location: WorkflowRunArchiveLocation, now: () => string): EvidenceCapturingHook {
  const store = createWorkflowRunEvidenceStore(location);
  const refs: EvidenceRef[] = [];
  const runHook = async (hookInput: WorkflowHookExecutionInput): Promise<WorkflowHookExecutionResult> => {
    const evidenceId = `${hookInput.hookId}-${hookInput.state.id}`;
    const writeInput: WriteWorkflowRunEvidenceInput = {
      workflowRunId: hookInput.workflowRunId,
      evidenceId,
      kind: "hook_fired",
      source: hookInput.hookId,
      createdAt: now(),
      content: { hookId: hookInput.hookId, stateId: hookInput.state.id },
      classifiedFields: [],
    };
    const record: WorkflowRunEvidenceRecord = await store.writeEvidence(writeInput);
    refs.push({ evidenceId: record.evidenceId, path: record.path });
    return { evidence: { hookId: hookInput.hookId, stateId: hookInput.state.id, evidenceId } };
  };
  return { runHook, getEvidenceRefs: () => refs };
}

/**
 * Read prior attempt memory for the run. Returns an empty array for the first attempt (no prior
 * history), avoiding an unnecessary FS scan (NIN-104).
 */
async function readPriorAttemptMemoryForRun(
  location: WorkflowRunArchiveLocation,
  workflowRunId: string,
  currentAttemptNumber: number,
): Promise<readonly WorkflowRunAttemptMemoryRecord[]> {
  if (currentAttemptNumber <= 1) {
    return [];
  }
  return createWorkflowRunMemoryStore(location).readPriorAttemptMemory({
    workflowRunId,
    beforeAttemptNumber: currentAttemptNumber,
  });
}

/**
 * Build the executor's initial artifact map. Includes prior attempt memory so retry attempts can
 * surface what earlier attempts learned (NIN-104).
 */
function buildInitialArtifacts(
  intent: WorkflowRunIntentArtifact,
  priorAttemptMemory: readonly WorkflowRunAttemptMemoryRecord[],
): Record<string, unknown> {
  const artifacts: Record<string, unknown> = { "intent.v1": intent };
  if (priorAttemptMemory.length > 0) {
    artifacts["prior_attempt_memory.v1"] = priorAttemptMemory;
  }
  return artifacts;
}

/**
 * Write the attempt-memory record and, when evidence refs are present, a project-memory candidate
 * with provenance pointing to the first collected evidence ref (NIN-104).
 */
async function writeAttemptMemoryAndCandidate(
  input: DriveAcceptedWorkflowRunInput,
  location: WorkflowRunArchiveLocation,
  now: () => string,
  status: "blocked" | "done",
  evidenceRefs: readonly EvidenceRef[],
  attemptNumber: number,
): Promise<WorkflowRunAttemptMemoryRecord> {
  const store = createWorkflowRunMemoryStore(location);
  const attemptId = `attempt-${attemptNumber}`;
  const record = await store.writeAttemptMemory({
    workflowRunId: input.workflowRun.id,
    attemptId,
    attemptNumber,
    createdAt: now(),
    summary: `Workflow Run ${input.workflowRun.id} completed with status: ${status}`,
    evidenceRefs,
  });
  if (evidenceRefs.length > 0) {
    await store.writeProjectMemoryCandidate({
      workflowRunId: input.workflowRun.id,
      candidateId: `${attemptId}-memory`,
      createdAt: now(),
      text: record.summary,
      sourceEvidence: evidenceRefs[0]!,
      promotionMode: input.projectMemoryMode ?? "propose_only",
    });
  }
  return record;
}

/**
 * Run the post-publish verification reconfirm (NIN-103). Extracts the pre-publish verification and
 * publish mode from the executor's in-memory result, computes contradictions from post-publish
 * evidence, and overwrites the archived `verification.v1` artifact with the reconfirmed decision
 * so the auto-merge gate and handoff see an up-to-date verdict.
 *
 * A missing verification or publish artifact → silently skips (reconfirm is only applicable
 * when both are present). Parse errors on the verification → silently skip (the gate will block on
 * the absent post-publish record as the safe default).
 */
async function reconfirmAndPersistVerification(
  archive: WorkflowRunArchive,
  workflowRunId: string,
  result: WorkflowExecutorResult,
  published: { pullRequestUrl: string | null },
): Promise<void> {
  const rawVerification = result.artifacts["verification.v1"];
  const rawPublish = result.artifacts["publish_result.v1"];
  if (!rawVerification || !isRecord(rawPublish)) return;

  let verification: VerificationArtifact;
  try {
    verification = parseWorkflowRunArtifact({
      contractId: "verification.v1",
      data: rawVerification,
    }) as VerificationArtifact;
  } catch {
    return;
  }

  const publishMode = typeof rawPublish["mode"] === "string" ? (rawPublish["mode"] as PrPublishMode) : null;
  if (!publishMode) return;

  const reconfirmResult = reconfirmPostPublishVerification({
    verification,
    publish: {
      mode: publishMode,
      pullRequestUrl: published.pullRequestUrl,
      status: published.pullRequestUrl ? "published" : "not_published",
    },
    ci: extractCiStatus(result.artifacts),
    handoff: { outcome: "done" },
  });

  if (reconfirmResult.status !== "completed") return;

  await archive.writeWorkflowRunArtifact({
    workflowRunId,
    contractId: "verification.v1",
    artifactId: "verification",
    data: reconfirmResult.artifact,
    producer: { type: "action", id: "post-publish-reconfirm" },
  });
}

function extractCiStatus(artifacts: Readonly<Record<string, unknown>>): { status: "failed" | "passed" } | null {
  const raw = artifacts["ci_result.v1"];
  if (!isRecord(raw)) return null;
  if (raw["status"] === "passed") return { status: "passed" };
  if (raw["status"] === "failed") return { status: "failed" };
  return null;
}

function archiveLocation(input: WorkflowRunArchiveLocation): WorkflowRunArchiveLocation {
  return {
    ...(input.dataDir ? { dataDir: input.dataDir } : {}),
    ...(input.archiveDir ? { archiveDir: input.archiveDir } : {}),
  };
}

/** Extract optional council deps so `driveAcceptedWorkflowRun` stays within the complexity ceiling. */
function buildCouncilDriveOpts(
  input: DriveAcceptedWorkflowRunInput,
): Pick<DriveWorkflowRunInput, "runCouncillor" | "synthesizeCouncil" | "councilClock"> {
  return {
    ...(input.runCouncillor ? { runCouncillor: input.runCouncillor } : {}),
    ...(input.synthesizeCouncil ? { synthesizeCouncil: input.synthesizeCouncil } : {}),
    ...(input.councilClock ? { councilClock: input.councilClock } : {}),
  };
}

function defaultNow(): string {
  return new Date().toISOString();
}

/**
 * Persist the council `verification.v1` to the run archive (NIN-76). The executor assembles the
 * council artifact in-memory via `runCouncilVerifier`; without this step it would not be readable
 * from the archive by downstream code (handoffs, post-publish reconfirm, tests). Uses `ifNotExists`
 * so a subsequent `reconfirmAndPersistVerification` call can freely overwrite.
 */
async function persistCouncilVerificationIfPresent(
  archive: WorkflowRunArchive,
  workflowRunId: string,
  artifacts: Readonly<Record<string, unknown>>,
): Promise<void> {
  const verification = artifacts["verification.v1"];
  if (!isRecord(verification) || verification["mode"] !== "council") {
    return;
  }
  await archive.writeWorkflowRunArtifact({
    workflowRunId,
    contractId: "verification.v1",
    artifactId: "verification",
    data: verification,
    producer: { type: "action", id: "council-verification" },
    ifNotExists: true,
  });
}
