import { describe, expect, it } from "vitest";

import { lookupModelPrice, computeAttemptCostUsd } from "../../src/core/model-pricing.js";

describe("lookupModelPrice", () => {
  it("returns the correct price for a known OpenAI model", () => {
    const price = lookupModelPrice("gpt-4o");
    expect(price).toEqual({ inputUsd: 2.5, outputUsd: 10.0 });
  });

  it("returns the correct price for a known Anthropic model", () => {
    const price = lookupModelPrice("claude-sonnet-4-6");
    expect(price).toEqual({ inputUsd: 3.0, outputUsd: 15.0 });
  });

  it("returns the correct price for gpt-5.4", () => {
    const price = lookupModelPrice("gpt-5.4");
    expect(price).toEqual({ inputUsd: 3.0, outputUsd: 12.0 });
  });

  it("returns null for an unknown model", () => {
    expect(lookupModelPrice("unknown-model-xyz")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(lookupModelPrice("")).toBeNull();
  });

  it("is case-sensitive — does not match uppercase variants", () => {
    expect(lookupModelPrice("GPT-4O")).toBeNull();
    expect(lookupModelPrice("Claude-Sonnet-4-6")).toBeNull();
  });

  it("covers all seeded models without throwing", () => {
    const models = [
      "gpt-5.4",
      "gpt-4.1",
      "gpt-4.1-mini",
      "gpt-4.1-nano",
      "gpt-4o",
      "gpt-4o-mini",
      "o3",
      "o4-mini",
      "o3-mini",
      "claude-opus-4-6",
      "claude-sonnet-4-6",
      "claude-haiku-4-5",
    ];
    for (const model of models) {
      const price = lookupModelPrice(model);
      expect(price).not.toBeNull();
      expect(price!.inputUsd).toBeGreaterThan(0);
      expect(price!.outputUsd).toBeGreaterThan(0);
    }
  });
});

describe("computeAttemptCostUsd (NIN-235)", () => {
  it("computes a valid cost for finite non-negative token counts", () => {
    const cost = computeAttemptCostUsd({
      model: "gpt-4o",
      tokenUsage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
    });
    expect(cost).toBeCloseTo(12.5);
  });

  it("returns null when token usage is absent", () => {
    expect(computeAttemptCostUsd({ model: "gpt-4o", tokenUsage: null })).toBeNull();
  });

  it("returns null for an unknown model", () => {
    expect(computeAttemptCostUsd({ model: "unknown-xyz", tokenUsage: { inputTokens: 1, outputTokens: 1 } })).toBeNull();
  });

  it("returns null (not NaN) for NaN token counts", () => {
    expect(computeAttemptCostUsd({ model: "gpt-4o", tokenUsage: { inputTokens: NaN, outputTokens: 5 } })).toBeNull();
  });

  it("returns null for infinite token counts", () => {
    expect(
      computeAttemptCostUsd({ model: "gpt-4o", tokenUsage: { inputTokens: Infinity, outputTokens: 5 } }),
    ).toBeNull();
  });

  it("returns null for negative token counts", () => {
    expect(computeAttemptCostUsd({ model: "gpt-4o", tokenUsage: { inputTokens: -1, outputTokens: 5 } })).toBeNull();
  });

  it("returns null for non-integer token counts", () => {
    expect(computeAttemptCostUsd({ model: "gpt-4o", tokenUsage: { inputTokens: 1.5, outputTokens: 5 } })).toBeNull();
  });
});
