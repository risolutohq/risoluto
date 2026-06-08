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

/** planner → implementer → reviewer → verifier, mirroring the executor-test fixture. */
function verifierDefinition(): ResolvedWorkflowDefinition {
  return {
    id: "single-operator-afk-coder",
    validationProfile: "node-pnpm-standard",
    states: [
      { id: "plan", gates: [], hooks: [] },
      { id: "implement", gates: [], hooks: [] },
      { id: "review", gates: [], hooks: [] },
      { id: "verify", gates: [], hooks: [] },
    ],
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
      {
        id: "implementer",
        stateId: "implement",
        modelProfile: "balanced",
        consumes: ["intent.v1", "plan.v1"],
        produces: ["change_summary.v1"],
        dependsOn: ["planner"],
      },
      {
        id: "reviewer",
        stateId: "review",
        modelProfile: "balanced",
        consumes: ["change_summary.v1"],
        produces: ["review.v1"],
        dependsOn: ["implementer"],
      },
      {
        id: "verifier",
        stateId: "verify",
        modelProfile: "verifier",
        consumes: ["change_summary.v1", "review.v1"],
        produces: ["verification.v1"],
        dependsOn: ["reviewer"],
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
  it("executes the definition through the engine and records the queued -> running -> done status transitions", async () => {
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
    expect(statuses).toEqual(["queued", "running", "done"]);
  });

  it("records a queued -> running -> blocked transition when a role blocks the run", async () => {
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
    expect(statuses).toEqual(["queued", "running", "blocked"]);
  });

  it("retries the implementer state on uncertain verdict via decideUnansweredSlackClarification then blocks (NIN-105)", async () => {
    // The driver hard-wires decideUnansweredSlackClarification — the caller does NOT pass it.
    // This test proves the production call chain:
    //   driveWorkflowRun → executeWorkflowDefinition → resolveClarificationStep → decideUnansweredSlackClarification
    const roleRuns: string[] = [];

    const result = await driveWorkflowRun({
      definition: verifierDefinition(),
      workflowRunId,
      initialArtifacts: { "intent.v1": intentArtifact() },
      maxClarificationAttempts: 1,
      recordStatus: async () => {},
      runRole: async ({ role }) => {
        roleRuns.push(role.id);
        if (role.id === "verifier") {
          return {
            "verification.v1": {
              version: 1,
              workflowRunId,
              createdAt,
              mode: "single",
              decision: "uncertain",
              summary: "need operator input",
              allowedInputs: [],
              evidenceLinks: [],
            },
          };
        }
        return roleOutput(role.id);
      },
    });

    expect(result.status).toBe("blocked");
    // First uncertain → retry (attemptsUsed 0 < maxAttempts 1).
    // Second uncertain → block (attemptsUsed 1 >= maxAttempts 1).
    expect(roleRuns.filter((id) => id === "verifier")).toHaveLength(2);
    expect(roleRuns.filter((id) => id === "implementer")).toHaveLength(2);
  });
});

function roleOutput(roleId: string): Readonly<Record<string, unknown>> {
  switch (roleId) {
    case "planner":
      return { "plan.v1": { version: 1, workflowRunId, createdAt, summary: "plan", steps: [] } };
    case "implementer":
      return {
        "change_summary.v1": {
          version: 1,
          workflowRunId,
          createdAt,
          summary: "changed files",
          changedFiles: [{ path: "src/x.ts", changeType: "modified", summary: "fix" }],
        },
      };
    case "reviewer":
      return { "review.v1": { version: 1, workflowRunId, createdAt, verdict: "pass", findings: [] } };
    default:
      throw new Error(`unexpected role ${roleId}`);
  }
}
