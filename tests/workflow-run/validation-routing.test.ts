import { describe, expect, it, vi } from "vitest";

import type { ResolvedWorkflowDefinition } from "../../src/workflow-definition/registry.js";
import { executeWorkflowDefinition } from "../../src/workflow-run/executor.js";

const workflowRunId = "wr_validation_routing";
const createdAt = "2026-05-31T18:40:00.000Z";

function createDefinition(): ResolvedWorkflowDefinition {
  return {
    id: "single-operator-afk-coder",
    validationProfile: "node-pnpm-standard",
    states: [{ id: "plan", gates: ["validation-passed"], hooks: [] }],
    actions: [],
    roles: [
      {
        id: "planner",
        stateId: "plan",
        modelProfile: "balanced",
        consumes: ["intent.v1"],
        produces: ["plan.v1"],
        dependsOn: [],
      },
    ],
  };
}

function intentArtifact() {
  return {
    version: 1,
    workflowRunId,
    createdAt,
    source: "cli",
    title: "Fix cache",
    body: "Fix the cache invalidation bug.",
    externalReferences: [],
  };
}

function failedValidationArtifact() {
  return {
    version: 1,
    workflowRunId,
    createdAt,
    profileId: "node-pnpm-standard",
    failureHandling: "stop_on_first",
    status: "failed",
    checks: [
      {
        id: "build",
        command: "pnpm run build",
        status: "failed",
        exitCode: 1,
        stdout: "TypeScript error output",
        stderr: "build failed",
        durationMs: 42,
      },
    ],
  };
}

describe("validation repair routing", () => {
  it("routes failing validation evidence back to implementation when retry budget remains", async () => {
    const retryGate = vi.fn(async () => ({
      "validation_result.v1": {
        version: 1,
        workflowRunId,
        createdAt,
        profileId: "node-pnpm-standard",
        failureHandling: "stop_on_first",
        status: "passed",
        checks: [
          {
            id: "build",
            command: "pnpm run build",
            status: "passed",
            exitCode: 0,
            stdout: "build passed",
            stderr: "",
            durationMs: 31,
          },
        ],
      },
    }));

    const result = await executeWorkflowDefinition({
      definition: createDefinition(),
      workflowRunId,
      initialArtifacts: {
        "intent.v1": intentArtifact(),
        "validation_result.v1": failedValidationArtifact(),
      },
      retryGate,
      runRole: async () => ({
        "plan.v1": { version: 1, workflowRunId, createdAt, summary: "Patch cache", steps: [] },
      }),
    });

    expect(result.status).toBe("done");
    expect(retryGate).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptNumber: 1,
        failureEvidence: expect.objectContaining({
          gateId: "validation-passed",
          reason: "validation profile node-pnpm-standard failed",
          evidence: { validationResult: failedValidationArtifact() },
        }),
      }),
    );
  });
});
