import { describe, expect, it } from "vitest";

import { buildAgentRolePrompt } from "../../src/workflow-run/agent-role-prompt.js";
import type { ResolvedWorkflowRole } from "../../src/workflow-definition/registry.js";

const plannerRole: ResolvedWorkflowRole = {
  id: "planner",
  stateId: "plan",
  modelProfile: "balanced",
  consumes: ["intent.v1"],
  produces: ["plan.v1"],
  dependsOn: [],
};

describe("buildAgentRolePrompt", () => {
  it("instructs the agent to deposit each artifact at its canonical archive path in the D1 envelope", () => {
    const prompt = buildAgentRolePrompt({
      role: plannerRole,
      workflowRunId: "wr_test",
      archiveRoot: "/data/archives",
      intentTitle: "Add a feature",
      intentBody: "Implement the thing described in the issue.",
    });

    expect(prompt).toContain('You are the "planner" role');
    expect(prompt).toContain("Add a feature");
    // Canonical D1 path (artifactId = contract id minus the .v1 suffix) and envelope.
    expect(prompt).toContain("/data/archives/workflow-runs/wr_test/artifacts/plan.json");
    expect(prompt).toContain('{ "contractId": "<id>", "data": <DATA> }');
    // The plan.v1 data shape is spelled out, not left to guesswork.
    expect(prompt).toContain('"steps":');
  });

  it("falls back to a generic contract reference for shapes it does not spell out", () => {
    const prompt = buildAgentRolePrompt({
      role: { ...plannerRole, id: "ci_babysitter", produces: ["ci_result.v1"] },
      workflowRunId: "wr_x",
      archiveRoot: "/a",
      intentTitle: "t",
      intentBody: "b",
    });
    expect(prompt).toContain("match the ci_result.v1 contract");
  });
});
