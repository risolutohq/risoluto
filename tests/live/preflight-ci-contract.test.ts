import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("live preflight CI contract", () => {
  it("lets the central PR live smoke profile choose model defaults", async () => {
    const workflow = await readFile(".github/workflows/ci.yml", "utf8");
    const livePreflightJob = workflow.slice(workflow.indexOf("  live-preflight:"));

    expect(livePreflightJob).toContain("RISOLUTO_LIVE_MODEL_API_KEY");
    expect(livePreflightJob).not.toContain("RISOLUTO_LIVE_MODEL_BASE_URL:");
    expect(livePreflightJob).not.toContain("RISOLUTO_LIVE_MODEL_ID:");
    expect(livePreflightJob).not.toContain("RISOLUTO_LIVE_MODEL_REASONING_EFFORT:");
    expect(livePreflightJob).not.toContain("gpt-5.4-mini");
  });
});
