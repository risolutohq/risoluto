import { describe, expect, it } from "vitest";

import type { WorkflowBudgetPolicy } from "../../src/workflow-run/budget-retry.js";
import { evaluateStateGates } from "../../src/workflow-run/gate-hook-engine.js";

function budgetPolicy(nowMs: number, maxWallClockMs: number): WorkflowBudgetPolicy {
  return {
    startedAtMs: 0,
    maxWallClockMs,
    nowMs: () => nowMs,
    usage: () => ({ usageByModelProfile: {}, modelProfilePrices: {} }),
  };
}

describe("budget-available gate", () => {
  const state = { id: "implement", gates: ["budget-available"], hooks: [] };

  it("passes when the wall-clock budget remains", async () => {
    const result = await evaluateStateGates({
      workflowRunId: "wr_budget_gate",
      state,
      stateRoles: [],
      artifacts: {},
      budget: budgetPolicy(500, 1000),
    });

    expect(result.status).toBe("passed");
  });

  it("blocks when the wall-clock budget is exhausted", async () => {
    const result = await evaluateStateGates({
      workflowRunId: "wr_budget_gate",
      state,
      stateRoles: [],
      artifacts: {},
      budget: budgetPolicy(5000, 1000),
    });

    expect(result.status).toBe("failed");
    expect(result.failureEvidence?.gateId).toBe("budget-available");
  });

  it("passes when no budget policy is injected (budgets are enforced between steps instead)", async () => {
    const result = await evaluateStateGates({
      workflowRunId: "wr_budget_gate",
      state,
      stateRoles: [],
      artifacts: {},
    });

    expect(result.status).toBe("passed");
  });
});
