import type { JsonRpcConnection } from "../agent/json-rpc-connection.js";
import type { RisolutoLogger } from "../core/types.js";
import { asRecord, asString, extractTurnId } from "./helpers.js";
import { consumeReviewSummary, waitForTurnCompletion, type TurnState } from "./turn-state.js";
import { toErrorString } from "../utils/type-guards.js";
import { CODEX_METHOD } from "../codex/methods.js";

export interface SelfReviewResult {
  passed: boolean | null;
  summary: string;
}

const REVIEW_PASS_PHRASES = [
  "no findings",
  "looks solid",
  "no issues found",
  "nothing to fix",
  "no action needed",
  "nothing to address",
  "all checks passed",
  "no changes required",
  "looks good",
  "no problems",
  "no fix required",
  "no fixes required",
  "no fixes needed",
] as const;

const REVIEW_FAIL_PHRASES = ["issue", "problem", "fix required", "error found"] as const;

function classifyReviewSummary(summary: string): boolean | null {
  const normalized = summary.toLowerCase();
  if (normalized === "review completed") {
    return null;
  }
  if (REVIEW_PASS_PHRASES.some((phrase) => normalized.includes(phrase))) {
    return true;
  }
  // Only treat non-empty summaries as failures when they contain explicit problem indicators.
  if (REVIEW_FAIL_PHRASES.some((phrase) => normalized.includes(phrase))) {
    return false;
  }
  return null;
}

export async function runSelfReview(
  connection: JsonRpcConnection,
  turnState: TurnState,
  threadId: string,
  logger: RisolutoLogger,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<SelfReviewResult | null> {
  try {
    const reviewStart = connection.request(CODEX_METHOD.ReviewStart, {
      threadId,
      delivery: "inline",
      target: { type: "uncommittedChanges" },
    });
    const aborted = new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("aborted", signal.reason ?? "AbortError")), {
        once: true,
      });
    });
    if (signal.aborted) {
      // Already aborted before we entered — bail immediately rather than
      // racing a connection.request that won't receive the signal via its
      // internal timeout.
      return null;
    }
    const result = await Promise.race([reviewStart, aborted]);
    const review = asRecord(result);
    const reviewTurnId = extractTurnId(review);
    if (reviewTurnId) {
      await waitForTurnCompletion(turnState, {
        turnId: reviewTurnId,
        signal,
        timeoutMs,
      });
      const summary = consumeReviewSummary(turnState, reviewTurnId) ?? "review completed";
      return {
        passed: classifyReviewSummary(summary),
        summary,
      };
    }
    return {
      passed: asString(review.status) === "passed" ? true : asString(review.status) ? false : null,
      summary: asString(review.summary) ?? "review completed",
    };
  } catch (error) {
    logger.warn({ error: toErrorString(error) }, "self-review failed (non-fatal)");
    return null;
  }
}
