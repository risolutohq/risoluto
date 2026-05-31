import { describe, expect, it, vi } from "vitest";

import { executeWorkflowDefinition, WorkflowExecutorError } from "../../src/workflow-run/executor.js";
import type { ResolvedWorkflowDefinition } from "../../src/workflow-definition/registry.js";

const workflowRunId = "wr_executor";
const createdAt = "2026-05-31T16:00:00.000Z";

function createDefinition(): ResolvedWorkflowDefinition {
  return {
    id: "single-operator-afk-coder",
    validationProfile: "node-pnpm-standard",
    states: [
      { id: "plan", gates: [], hooks: [] },
      { id: "implement", gates: [], hooks: [] },
      { id: "review", gates: [], hooks: [] },
    ],
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
    ],
  };
}

function createPlannerOnlyDefinition(states: ResolvedWorkflowDefinition["states"]): ResolvedWorkflowDefinition {
  const definition = createDefinition();
  const planner = definition.roles.find((role) => role.id === "planner");
  if (!planner) {
    throw new Error("planner fixture role is missing");
  }
  return { ...definition, states, roles: [planner] };
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

describe("executeWorkflowDefinition", () => {
  it("executes planner, implementer, and reviewer in DAG order over typed artifacts", async () => {
    const roleOrder: string[] = [];

    const result = await executeWorkflowDefinition({
      definition: createDefinition(),
      workflowRunId,
      initialArtifacts: { "intent.v1": intentArtifact() },
      runRole: async ({ role, artifacts }) => {
        roleOrder.push(role.id);
        if (role.id === "planner") {
          expect(artifacts["intent.v1"]).toMatchObject({ title: "Fix cache" });
          return { "plan.v1": { version: 1, workflowRunId, createdAt, summary: "Patch cache", steps: [] } };
        }
        if (role.id === "implementer") {
          expect(artifacts["plan.v1"]).toMatchObject({ summary: "Patch cache" });
          return {
            "change_summary.v1": {
              version: 1,
              workflowRunId,
              createdAt,
              summary: "Changed cache invalidation.",
              changedFiles: [{ path: "src/cache.ts", changeType: "modified", summary: "Invalidate correctly." }],
            },
          };
        }
        return {
          "review.v1": { version: 1, workflowRunId, createdAt, verdict: "pass", findings: [] },
        };
      },
    });

    expect(roleOrder).toEqual(["planner", "implementer", "reviewer"]);
    expect(result.status).toBe("done");
    expect(result.workflowStatesVisited).toEqual(["plan", "implement", "review"]);
  });

  it("blocks after planner triage when the plan artifact has only blocked steps", async () => {
    const runRole = vi.fn(async () => ({
      "plan.v1": {
        version: 1,
        workflowRunId,
        createdAt,
        summary: "Intent is too large.",
        steps: [{ id: "scope", title: "Narrow scope", status: "blocked", dependsOn: [] }],
      },
    }));

    const result = await executeWorkflowDefinition({
      definition: createDefinition(),
      workflowRunId,
      initialArtifacts: { "intent.v1": intentArtifact() },
      runRole,
    });

    expect(result.status).toBe("blocked");
    expect(runRole).toHaveBeenCalledOnce();
  });

  it("fails with dependency attribution when a required input artifact is missing", async () => {
    const definition = createDefinition();
    const runRole = vi.fn(async () => ({}));

    await expect(
      executeWorkflowDefinition({
        definition,
        workflowRunId,
        initialArtifacts: {},
        runRole,
      }),
    ).rejects.toThrow(/planner is missing required artifact intent\.v1 from intake/);
    expect(runRole).not.toHaveBeenCalled();
    expect(() => {
      throw new WorkflowExecutorError("example");
    }).toThrow(WorkflowExecutorError);
  });

  it("blocks when a configured gate fails after a role claims success", async () => {
    const definition = createPlannerOnlyDefinition([{ id: "plan", gates: ["validation-passed"], hooks: [] }]);

    const result = await executeWorkflowDefinition({
      definition,
      workflowRunId,
      initialArtifacts: { "intent.v1": intentArtifact() },
      runRole: async () => ({
        "plan.v1": { version: 1, workflowRunId, createdAt, summary: "Patch cache", steps: [] },
      }),
    });

    expect(result.status).toBe("blocked");
    expect(result.events).toContainEqual(
      expect.objectContaining({
        eventType: "validation_gate.evaluated",
        gateId: "validation-passed",
        status: "failed",
        reason: "missing required artifact validation_result.v1",
      }),
    );
  });

  it("fires state-entry hooks as evidence without changing the gate outcome", async () => {
    const calls: string[] = [];
    const definition = createPlannerOnlyDefinition([
      { id: "plan", gates: ["artifacts-valid"], hooks: ["collect-evidence"] },
    ]);

    const result = await executeWorkflowDefinition({
      definition,
      workflowRunId,
      initialArtifacts: { "intent.v1": intentArtifact() },
      runHook: async ({ hookId }) => {
        calls.push(`hook:${hookId}`);
        return { evidence: { archivePath: "runs/wr_executor/evidence/collect-evidence.json" } };
      },
      runRole: async ({ role }) => {
        calls.push(`role:${role.id}`);
        return { "plan.v1": { version: 1, workflowRunId, createdAt, summary: "Patch cache", steps: [] } };
      },
    });

    expect(result.status).toBe("done");
    expect(calls).toEqual(["hook:collect-evidence", "role:planner"]);
    expect(result.events).toEqual([
      expect.objectContaining({
        eventType: "workflow_hook.fired",
        hookId: "collect-evidence",
        evidence: { archivePath: "runs/wr_executor/evidence/collect-evidence.json" },
      }),
      expect.objectContaining({ eventType: "validation_gate.evaluated", gateId: "artifacts-valid", status: "passed" }),
    ]);
  });
});
