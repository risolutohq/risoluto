import { afterEach, describe, expect, it } from "vitest";

import { resolveWorkflowRunIntake } from "../../src/cli/workflow-run-intake.js";
import { createIntakeE2E, E2E_DEFAULT_WORKFLOW_ID, type IntakeE2EHarness } from "./intake-harness.js";

const open: IntakeE2EHarness[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((harness) => harness.cleanup()));
});

describe("CLI run start e2e (verification ladder NIN-155)", () => {
  it("drives run start through real argument parsing to an archived review.v1 effect", async () => {
    const harness = await createIntakeE2E();
    open.push(harness);

    await expect(harness.runCliStart()).resolves.toBe(0);

    // intake-to-engine ran real: the role DAG executed in order through the faked agent boundary
    expect(harness.dispatchedRoleIds()).toEqual(["planner", "implementer", "reviewer"]);
    // the asserted effect is an archived artifact, not an internal function call
    await expect(harness.readArtifact("review")).resolves.toMatchObject({ contractId: "review.v1" });
    const runs = await harness.archive.listWorkflowRuns();
    await expect(harness.archive.loadWorkflowRun(runs[0]?.id ?? "")).resolves.toMatchObject({ status: "done" });
  });

  it("bites: intake without the engine wiring leaves the capability unreached (no vacuous green)", async () => {
    const harness = await createIntakeE2E();
    open.push(harness);

    // Simulate the intake-to-engine wiring stubbed out: run intake only, never drive the executor.
    await resolveWorkflowRunIntake({
      dataDir: harness.dataDir,
      title: "Stubbed wiring",
      intent: "Intake only — the drive step is missing.",
      workflowDefinitionId: E2E_DEFAULT_WORKFLOW_ID,
      workspaceKey: "default",
      workflowDir: harness.workflowDir,
    });

    // No role ran and the capability's effect is absent — the positive assertion above would fail.
    expect(harness.dispatchedRoleIds()).toEqual([]);
    await expect(harness.readArtifact("review")).rejects.toThrow();
  });
});
