import { describe, expect, it } from "vitest";

import type { ResolvedWorkflowDefinition } from "../../src/workflow-definition/registry.js";
import { driveWorkflowRun } from "../../src/workflow-run/workflow-run-driver.js";

const workflowRunId = "wr_driver_test";
const createdAt = "2026-06-01T09:00:00.000Z";

function plannerOnlyDefinition(): ResolvedWorkflowDefinition {
  return {
    id: "single-operator-afk-coder",
    validationProfile: "node-pnpm-standard",
    states: [{ id: "plan", gates: [], hooks: [] }],
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
    title: "Ship it",
    body: "Do the thing.",
    externalReferences: [],
  };
}

describe("driveWorkflowRun", () => {
  it("executes the definition through the engine and records the running -> done status transitions", async () => {
    const statuses: string[] = [];

    const result = await driveWorkflowRun({
      definition: plannerOnlyDefinition(),
      workflowRunId,
      initialArtifacts: { "intent.v1": intentArtifact() },
      runRole: async () => ({ "plan.v1": { version: 1, workflowRunId, createdAt, summary: "plan", steps: [] } }),
      recordStatus: async ({ status }) => {
        statuses.push(status);
      },
    });

    expect(result.status).toBe("done");
    expect(result.roleExecutions).toEqual(["planner"]);
    expect(statuses).toEqual(["running", "done"]);
  });

  it("records a running -> blocked transition when a role blocks the run", async () => {
    const statuses: string[] = [];

    const result = await driveWorkflowRun({
      definition: plannerOnlyDefinition(),
      workflowRunId,
      initialArtifacts: { "intent.v1": intentArtifact() },
      runRole: async () => ({
        "plan.v1": {
          version: 1,
          workflowRunId,
          createdAt,
          summary: "blocked",
          steps: [{ id: "step-1", title: "Blocked step", status: "blocked", dependsOn: [] }],
        },
      }),
      recordStatus: async ({ status }) => {
        statuses.push(status);
      },
    });

    expect(result.status).toBe("blocked");
    expect(statuses).toEqual(["running", "blocked"]);
  });
});
