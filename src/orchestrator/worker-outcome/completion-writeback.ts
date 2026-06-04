import type { Issue } from "../../core/types.js";
import type { RunningEntry } from "../runtime-types.js";
import type { OutcomeContext } from "../context.js";
import { computeAttemptCostUsd } from "../../core/model-pricing.js";
import { toErrorString } from "../../utils/type-guards.js";
import { DEFAULT_WORKFLOW_DEFINITION_ID, type WorkflowRunStatus } from "../../workflow-run/contracts.js";
import {
  type StatusProjectionProvider,
  WorkflowRunStatusProjectionError,
} from "../../workflow-run/status-projection.js";
import { mirrorWorkflowRunStatusToTracker } from "../../workflow-run/status-mirror.js";

export type CompletionWritebackContext = Pick<OutcomeContext, "getConfig"> & {
  deps: Pick<OutcomeContext["deps"], "tracker" | "logger">;
};

export interface CompletionWritebackInput {
  issue: Issue;
  entry: RunningEntry;
  attempt: number | null;
  stopSignal: "done" | "blocked";
  pullRequestUrl: string | null;
  /** Turn count sourced from RunOutcome.turnCount (persisted via prepareWorkerOutcome). */
  turnCount: number | null;
}

export interface FailureWritebackInput {
  issue: Issue;
  entry: RunningEntry;
  attemptCount: number | null;
  errorReason: string;
}

const integerFormatter = new Intl.NumberFormat("en-US");

function formatTokenCount(value: number): string {
  return integerFormatter.format(value);
}

function buildSuccessCommentBody(input: CompletionWritebackInput, durationSeconds: number): string {
  const lines: string[] = ["**Risoluto agent completed**"];
  if (input.attempt !== null) {
    lines.push(`- **Attempt:** ${input.attempt}`);
  }
  if (typeof input.turnCount === "number") {
    lines.push(`- **Turns:** ${input.turnCount}`);
  }
  lines.push(`- **Duration:** ${durationSeconds}s`);
  if (input.entry.tokenUsage) {
    const { totalTokens, inputTokens, outputTokens } = input.entry.tokenUsage;
    lines.push(
      `- **Tokens:** ${formatTokenCount(totalTokens)} ` +
        `(in: ${formatTokenCount(inputTokens)}, out: ${formatTokenCount(outputTokens)})`,
    );
    const costUsd = computeAttemptCostUsd({
      model: input.entry.modelSelection.model,
      tokenUsage: { inputTokens, outputTokens },
    });
    if (costUsd !== null) {
      lines.push(`- **Cost:** $${costUsd.toFixed(4)}`);
    }
  }
  if (input.pullRequestUrl) {
    lines.push(`- **PR:** ${input.pullRequestUrl}`);
  }
  return lines.join("\n");
}

async function transitionToSuccessState(
  ctx: CompletionWritebackContext,
  input: CompletionWritebackInput,
  successState: string,
): Promise<string | null> {
  try {
    const stateId = await ctx.deps.tracker.resolveStateId(successState);
    if (stateId) {
      await ctx.deps.tracker.updateIssueState(input.issue.id, stateId);
      ctx.deps.logger.info(
        { issue_identifier: input.issue.identifier, successState },
        "linear issue transitioned to success state",
      );
      return successState;
    }
    ctx.deps.logger.warn(
      { issue_identifier: input.issue.identifier, successState },
      "success state not found in linear — skipping transition",
    );
    return null;
  } catch (error) {
    ctx.deps.logger.warn(
      { issue_identifier: input.issue.identifier, error: toErrorString(error) },
      "linear state transition failed (non-fatal)",
    );
    return null;
  }
}

function statusProjectionProvider(kind: string): StatusProjectionProvider {
  return kind === "github" ? "github" : "linear";
}

/**
 * Mirror the run outcome to the board through `projectWorkflowRunStatus` (NIN-270). Active only when
 * `tracker.statusMapping` is configured; otherwise returns `configured: false` so the caller keeps the
 * legacy `agent.successState` transition. An unmapped Run Status surfaces a clear projection error and
 * does NOT silently choose a state.
 */
async function mirrorOutcomeViaProjection(
  ctx: CompletionWritebackContext,
  input: CompletionWritebackInput,
  runStatus: WorkflowRunStatus,
): Promise<{ configured: boolean; externalStatus: string | null }> {
  const trackerConfig = ctx.getConfig().tracker;
  const workspaceMapping = trackerConfig.statusMapping;
  if (!workspaceMapping || Object.keys(workspaceMapping).length === 0) {
    return { configured: false, externalStatus: null };
  }

  try {
    const result = await mirrorWorkflowRunStatusToTracker({
      tracker: ctx.deps.tracker,
      workflowRunId: input.issue.workflowRunId ?? input.issue.id,
      workflowDefinitionId: DEFAULT_WORKFLOW_DEFINITION_ID,
      provider: statusProjectionProvider(trackerConfig.kind),
      issueId: input.issue.id,
      runStatus,
      workspaceMapping,
      logger: ctx.deps.logger,
    });
    if (result.applied) {
      ctx.deps.logger.info(
        { issue_identifier: input.issue.identifier, run_status: runStatus, external_status: result.externalStatus },
        "workflow run status projected to tracker",
      );
    }
    return { configured: true, externalStatus: result.applied ? result.externalStatus : null };
  } catch (error) {
    const unmapped = error instanceof WorkflowRunStatusProjectionError;
    ctx.deps.logger.warn(
      { issue_identifier: input.issue.identifier, run_status: runStatus, error: toErrorString(error) },
      unmapped
        ? "status projection blocked — run status is unmapped; skipping tracker mirror"
        : "status projection mirror failed (non-fatal)",
    );
    return { configured: true, externalStatus: null };
  }
}

async function transitionViaSuccessState(
  ctx: CompletionWritebackContext,
  input: CompletionWritebackInput,
): Promise<string | null> {
  const successState = ctx.getConfig().agent.successState;
  return successState ? transitionToSuccessState(ctx, input, successState) : null;
}

async function postSuccessWriteback(
  ctx: CompletionWritebackContext,
  input: CompletionWritebackInput,
  durationSeconds: number,
): Promise<string | null> {
  const commentBody = buildSuccessCommentBody(input, durationSeconds);

  // Prefer the canonical Run Status → board projection when configured; otherwise fall back to the
  // legacy single-success-state transition. State transition and comment are independent — failure of
  // one must not block the other.
  const projection = await mirrorOutcomeViaProjection(ctx, input, "done");
  const transitionedState = projection.configured
    ? projection.externalStatus
    : await transitionViaSuccessState(ctx, input);

  try {
    await ctx.deps.tracker.createComment(input.issue.id, commentBody);
  } catch (error) {
    ctx.deps.logger.warn(
      { issue_identifier: input.issue.identifier, error: toErrorString(error) },
      "linear completion comment failed (non-fatal)",
    );
  }

  return transitionedState;
}

async function postBlockedWriteback(
  ctx: CompletionWritebackContext,
  input: CompletionWritebackInput,
  durationSeconds: number,
): Promise<void> {
  const commentBody = [
    `**Risoluto agent blocked**`,
    `- **Reason:** agent reported blocked`,
    `- **Attempts:** ${input.attempt ?? 1}`,
    `- **Duration:** ${durationSeconds}s`,
  ].join("\n");

  // Mirror the blocked Run Status to the board when projection is configured (no-op otherwise, which
  // preserves the prior "blocked posts a comment but does not transition" behavior).
  await mirrorOutcomeViaProjection(ctx, input, "blocked");

  try {
    await ctx.deps.tracker.createComment(input.issue.id, commentBody);
  } catch (error) {
    ctx.deps.logger.warn(
      { issue_identifier: input.issue.identifier, error: toErrorString(error) },
      "linear blocked comment failed (non-fatal)",
    );
  }
}

export async function writeCompletionWriteback(
  ctx: CompletionWritebackContext,
  input: CompletionWritebackInput,
): Promise<string | null> {
  const durationSeconds = Math.round((Date.now() - input.entry.startedAtMs) / 1000);

  if (input.stopSignal === "done") {
    return postSuccessWriteback(ctx, input, durationSeconds);
  }

  // Blocked stop signal — post failure comment only; no state transition.
  await postBlockedWriteback(ctx, input, durationSeconds);
  return null;
}

/**
 * Posts a failure comment to the tracker for retry-exhausted terminal paths
 * (cancelled or hard failure, max continuations exceeded).
 *
 * Independent of orchestrator state — failures are logged at warn and swallowed.
 */
export async function writeFailureWriteback(
  ctx: CompletionWritebackContext,
  input: FailureWritebackInput,
): Promise<void> {
  const durationSeconds = Math.round((Date.now() - input.entry.startedAtMs) / 1000);
  const lines: string[] = [
    `**Risoluto agent failed**`,
    `- **Reason:** ${input.errorReason}`,
    `- **Attempts:** ${input.attemptCount ?? 1}`,
    `- **Duration:** ${durationSeconds}s`,
  ];
  const commentBody = lines.join("\n");

  try {
    await ctx.deps.tracker.createComment(input.issue.id, commentBody);
  } catch (error) {
    ctx.deps.logger.warn(
      { issue_identifier: input.issue.identifier, error: toErrorString(error) },
      "linear failure comment failed (non-fatal)",
    );
  }
}
