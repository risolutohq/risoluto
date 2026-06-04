import { randomInt } from "node:crypto";
import { toErrorString } from "./type-guards.js";
import type { RisolutoLogger } from "../core/types.js";

export interface RetryOptions {
  /** Maximum number of attempts (default: 3). Must be a positive safe integer. */
  maxAttempts?: number;
}

/**
 * Upper bound on a single backoff delay, in milliseconds. Without a cap the
 * exponential term overflows Node's timer range for large attempt counts and
 * collapses into near-immediate retries, so every delay is clamped to this.
 */
export const MAX_RETRY_DELAY_MS = 30_000;

const DEFAULT_MAX_ATTEMPTS = 3;

function resolveMaxAttempts(options?: RetryOptions): number {
  const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new TypeError(`withRetry: maxAttempts must be a positive safe integer, received ${String(maxAttempts)}`);
  }
  return maxAttempts;
}

/** Jittered exponential backoff, clamped to {@link MAX_RETRY_DELAY_MS}. */
function computeBackoffDelayMs(attempt: number): number {
  const exponential = 1000 * 2 ** (attempt - 1);
  const capped = Math.min(exponential, MAX_RETRY_DELAY_MS);
  return capped * (randomInt(500, 1000) / 1000);
}

/**
 * Retry a void-returning operation with jittered exponential backoff.
 * On final failure the error is re-thrown so callers fail loudly. Callers for
 * which a final failure is genuinely ignorable must use {@link withNonFatalRetry}.
 */
export async function withRetry(
  logger: RisolutoLogger,
  operation: string,
  fn: () => Promise<void>,
  options?: RetryOptions,
): Promise<void> {
  const maxAttempts = resolveMaxAttempts(options);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fn();
      return;
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }
      const delayMs = computeBackoffDelayMs(attempt);
      logger.warn({ operation, attempt, delayMs, error: toErrorString(error) }, "write-back retry");
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

/**
 * Retry a void-returning operation with jittered exponential backoff.
 * On final failure the error is swallowed and logged as a warning. This is the
 * ONLY path that swallows a final error — use it only where the operation's
 * failure is truly ignorable (best-effort write-backs), never for state mutations.
 */
export async function withNonFatalRetry(
  logger: RisolutoLogger,
  operation: string,
  fn: () => Promise<void>,
  options?: RetryOptions,
): Promise<void> {
  const maxAttempts = resolveMaxAttempts(options);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fn();
      return;
    } catch (error) {
      if (attempt === maxAttempts) {
        logger.warn(
          { operation, attempt, error: toErrorString(error) },
          "write-back failed after max retries (non-fatal)",
        );
        return;
      }
      const delayMs = computeBackoffDelayMs(attempt);
      logger.warn({ operation, attempt, delayMs, error: toErrorString(error) }, "write-back retry");
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

/**
 * Retry a value-returning operation with jittered exponential backoff.
 * On final failure the error is re-thrown.
 */
export async function withRetryReturn<T>(
  logger: RisolutoLogger,
  operation: string,
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const maxAttempts = resolveMaxAttempts(options);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }
      const delayMs = computeBackoffDelayMs(attempt);
      logger.warn({ operation, attempt, delayMs, error: toErrorString(error) }, "write-back retry");
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  /* c8 ignore next -- unreachable: loop always returns or throws */
  throw new Error(`${operation} exhausted retries without result`);
}
