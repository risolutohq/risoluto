/**
 * Static model pricing table for cost estimation.
 *
 * Prices are USD per 1 million tokens. Applied at read time so rates
 * can be updated retroactively without schema changes.
 */

interface ModelPrice {
  inputUsd: number;
  outputUsd: number;
}

const PRICES: Record<string, ModelPrice> = {
  // OpenAI
  "gpt-5.4": { inputUsd: 3, outputUsd: 12 },
  "gpt-4.1": { inputUsd: 2, outputUsd: 8 },
  "gpt-4.1-mini": { inputUsd: 0.4, outputUsd: 1.6 },
  "gpt-4.1-nano": { inputUsd: 0.1, outputUsd: 0.4 },
  "gpt-4o": { inputUsd: 2.5, outputUsd: 10 },
  "gpt-4o-mini": { inputUsd: 0.15, outputUsd: 0.6 },
  o3: { inputUsd: 10, outputUsd: 40 },
  "o4-mini": { inputUsd: 1.1, outputUsd: 4.4 },
  "o3-mini": { inputUsd: 1.1, outputUsd: 4.4 },
  // Anthropic
  "claude-opus-4-6": { inputUsd: 15, outputUsd: 75 },
  "claude-sonnet-4-6": { inputUsd: 3, outputUsd: 15 },
  "claude-haiku-4-5": { inputUsd: 0.8, outputUsd: 4 },
};

/** Returns the USD-per-1M-token price for a given model name, or `null` if unknown. */
export function lookupModelPrice(model: string): ModelPrice | null {
  return PRICES[model] ?? null;
}

/** A token count must be a finite, non-negative safe integer to yield a valid cost. */
function isValidTokenCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * Computes cost in USD for a single attempt. Returns `null` when token usage or
 * pricing is unavailable, or when reported token counts are not finite,
 * non-negative safe integers (guards against NaN/Infinity/negative propagating
 * into invalid totals).
 */
export function computeAttemptCostUsd(attempt: {
  model: string;
  tokenUsage: { inputTokens: number; outputTokens: number } | null;
}): number | null {
  if (!attempt.tokenUsage) return null;
  const { inputTokens, outputTokens } = attempt.tokenUsage;
  if (!isValidTokenCount(inputTokens) || !isValidTokenCount(outputTokens)) return null;
  const price = lookupModelPrice(attempt.model);
  if (!price) return null;
  return (inputTokens * price.inputUsd + outputTokens * price.outputUsd) / 1_000_000;
}

/** Returns all model IDs present in the pricing table. */
export function getAvailableModelIds(): string[] {
  return Object.keys(PRICES);
}
