import type { TokenUsageSnapshot } from "../core/types.js";

export const DEFAULT_WORKFLOW_MAX_WALL_CLOCK_MS = 120 * 60 * 1_000;
export const DEFAULT_WORKFLOW_MAX_COST_USD = 10;
export const DEFAULT_GATE_RETRY_LIMIT = 1;

export interface WorkflowModelProfilePrice {
  readonly inputUsd: number;
  readonly outputUsd: number;
  readonly cacheReadUsd: number;
  readonly cacheWriteUsd: number;
}

export interface WorkflowBudgetUsageSnapshot {
  readonly usageByModelProfile: Readonly<Record<string, TokenUsageSnapshot>>;
  readonly modelProfilePrices: Readonly<Record<string, WorkflowModelProfilePrice>>;
}

export interface WorkflowBudgetPolicy {
  readonly startedAtMs: number;
  readonly maxWallClockMs?: number;
  readonly maxCostUsd?: number;
  readonly nowMs: () => number;
  readonly usage: () => WorkflowBudgetUsageSnapshot;
}

export interface WorkflowBudgetCheckInput {
  readonly policy: WorkflowBudgetPolicy;
  readonly nextStepLabel: string;
}

export interface WorkflowBudgetCheckResult {
  readonly status: "passed" | "failed";
  readonly reason?: string;
  readonly evidence: Readonly<Record<string, unknown>>;
}

export function evaluateWorkflowBudget(input: WorkflowBudgetCheckInput): WorkflowBudgetCheckResult {
  const maxWallClockMs = input.policy.maxWallClockMs ?? DEFAULT_WORKFLOW_MAX_WALL_CLOCK_MS;
  const maxCostUsd = input.policy.maxCostUsd ?? DEFAULT_WORKFLOW_MAX_COST_USD;
  const elapsedMs = Math.max(0, input.policy.nowMs() - input.policy.startedAtMs);
  const usage = input.policy.usage();
  const costUsd = computeWorkflowCostUsd(usage);
  const evidence = { elapsedMs, maxWallClockMs, costUsd, maxCostUsd, usageByModelProfile: usage.usageByModelProfile };

  if (elapsedMs > maxWallClockMs) {
    return { status: "failed", reason: `wall-clock budget exceeded before ${input.nextStepLabel}`, evidence };
  }
  if (costUsd > maxCostUsd) {
    return { status: "failed", reason: `cost budget exceeded before ${input.nextStepLabel}`, evidence };
  }
  return { status: "passed", evidence };
}

export function computeWorkflowCostUsd(input: WorkflowBudgetUsageSnapshot): number {
  return Object.entries(input.usageByModelProfile).reduce((totalCostUsd, [modelProfile, tokenUsage]) => {
    const price = input.modelProfilePrices[modelProfile];
    if (!price) {
      return totalCostUsd;
    }
    return totalCostUsd + computeUsageCostUsd(tokenUsage, price);
  }, 0);
}

function computeUsageCostUsd(tokenUsage: TokenUsageSnapshot, price: WorkflowModelProfilePrice): number {
  const cacheReadTokens = tokenUsage.cacheReadTokens ?? 0;
  const cacheWriteTokens = tokenUsage.cacheWriteTokens ?? 0;
  return (
    (tokenUsage.inputTokens * price.inputUsd +
      tokenUsage.outputTokens * price.outputUsd +
      cacheReadTokens * price.cacheReadUsd +
      cacheWriteTokens * price.cacheWriteUsd) /
    1_000_000
  );
}
