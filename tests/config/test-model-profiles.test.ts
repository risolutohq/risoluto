import { describe, expect, it } from "vitest";

import { resolveTestModelProfile, TEST_MODEL_PROFILES } from "../../src/config/test-model-profiles.js";

describe("test model profiles", () => {
  it("centralizes the PR live smoke model profile defaults", () => {
    const profile = resolveTestModelProfile("pr-live-smoke", {});

    expect(profile).toEqual({
      name: "pr-live-smoke",
      baseUrl: "https://cliproxy.dreampedia.app",
      model: "gpt-5.4-mini",
      reasoningEffort: "high",
      apiKeyEnv: "RISOLUTO_LIVE_MODEL_API_KEY",
      apiKey: null,
    });
  });

  it("centralizes the release model profile defaults", () => {
    const profile = resolveTestModelProfile("release-live", {});

    expect(profile).toMatchObject({
      name: "release-live",
      baseUrl: "https://cliproxy.dreampedia.app",
      model: "gpt-5.5",
      reasoningEffort: "medium",
      apiKeyEnv: "RISOLUTO_LIVE_MODEL_API_KEY",
    });
  });

  it("uses the locked env names without accepting CLIPROXY_API_KEY", () => {
    const profile = resolveTestModelProfile("pr-live-smoke", {
      CLIPROXY_API_KEY: "stale",
      RISOLUTO_LIVE_MODEL_API_KEY: "live-key",
      RISOLUTO_LIVE_MODEL_ID: "custom-smoke",
      RISOLUTO_LIVE_MODEL_REASONING_EFFORT: "low",
      RISOLUTO_LIVE_MODEL_BASE_URL: "https://proxy.example.test",
    });

    expect(profile).toMatchObject({
      baseUrl: "https://proxy.example.test",
      model: "custom-smoke",
      reasoningEffort: "low",
      apiKeyEnv: "RISOLUTO_LIVE_MODEL_API_KEY",
      apiKey: "live-key",
    });
  });

  it("exposes only named central profiles", () => {
    expect(Object.keys(TEST_MODEL_PROFILES).sort()).toEqual(["pr-live-smoke", "regression-frozen", "release-live"]);
  });
});
