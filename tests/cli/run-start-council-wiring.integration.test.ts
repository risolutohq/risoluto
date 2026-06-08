/**
 * Hermetic council-dispatch wiring test (NIN-76).
 *
 * Drives `startAndDriveRunCommand` (the CLI entry point) with a council-configured workflow
 * definition and a fake `dispatchRole` that handles councillor + synthesizer sessions.
 * Asserts that both are dispatched through the production boundary and that a council
 * `verification.v1` with `mode: "council"` and councillor evidence is recorded in the run archive.
 *
 * This test does NOT call `executeWorkflowDefinition` directly — reachability is from the CLI.
 */

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { startAndDriveRunCommand } from "../../src/cli/run-start-command.js";
import { createWorkflowRunArchive, type WorkflowRunArchive } from "../../src/workflow-run/archive.js";
import {
  workflowRunArtifactIdForContract,
  type WorkflowRunRoleDispatch,
} from "../../src/workflow-run/run-role-runner.js";

const tempDirs: string[] = [];
const FIXED_TIME = "2026-06-08T10:00:00.000Z";

/** Minimal council-verifier workflow: single verifier state, 2 councillors, no publish action. */
const COUNCIL_WORKFLOW = `
version: 1
id: council-verifier-flow
defaults: {}
states:
  - id: verify
    roles:
      - id: verifier
        modelProfile: verifier
        verifierMode: council
        councillors:
          - id: alpha
            modelProfile: verifier
            lens: "Correctness review"
          - id: beta
            modelProfile: verifier
            lens: "Security review"
        consumes: [intent.v1]
        produces: [verification.v1]
        dependsOn: []
    gates: []
    hooks: []
actions: []
`;

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeWorkflowFile(definitionId: string, yaml: string): Promise<string> {
  const workflowDir = await createTempDir("risoluto-council-workflows-");
  await mkdir(workflowDir, { recursive: true });
  await writeFile(path.join(workflowDir, `${definitionId}.yaml`), yaml.trimStart(), "utf8");
  return workflowDir;
}

/**
 * Build the fake `dispatchRole` that handles both normal role dispatch and council dispatch.
 * The fake tracks all calls so the test can assert which sessions were dispatched.
 * Normal roles (planner, implementer, etc.) are not in this workflow, so only council
 * contracts appear. The contract is:
 *
 *  - `council_verifier_decision.v1`: deposit a fake councillor verdict (satisfied) using
 *    `role.id` as the `artifactId` (e.g. "council-decision-alpha").
 *  - `council_synthesizer_decision.v1`: deposit a fake synthesizer verdict using `role.id`
 *    as the `artifactId` ("council-synthesis").
 */
function buildFakeCouncilDispatch(archive: WorkflowRunArchive): {
  dispatchRole: WorkflowRunRoleDispatch;
  dispatchedRoleIds: string[];
} {
  const dispatchedRoleIds: string[] = [];

  const dispatchRole: WorkflowRunRoleDispatch = async (input) => {
    dispatchedRoleIds.push(input.role.id);

    if (input.role.produces.includes("council_verifier_decision.v1")) {
      // Each councillor uses its own role.id as the artifact id to avoid conflicts.
      await archive.writeWorkflowRunArtifact({
        workflowRunId: input.workflowRunId,
        contractId: "council_verifier_decision.v1",
        artifactId: input.role.id,
        data: {
          version: 1,
          workflowRunId: input.workflowRunId,
          createdAt: FIXED_TIME,
          status: "completed",
          decision: "satisfied",
          summary: `Councillor ${input.role.id}: implementation looks good.`,
        },
        producer: { type: "role", id: input.role.id },
      });
      return;
    }

    if (input.role.produces.includes("council_synthesizer_decision.v1")) {
      await archive.writeWorkflowRunArtifact({
        workflowRunId: input.workflowRunId,
        contractId: "council_synthesizer_decision.v1",
        artifactId: input.role.id,
        data: {
          version: 1,
          workflowRunId: input.workflowRunId,
          createdAt: FIXED_TIME,
          decision: "satisfied",
          summary: "All council members satisfied: unanimous approval.",
        },
        producer: { type: "role", id: input.role.id },
      });
      return;
    }

    // Deposit artifacts for any non-council roles using the canonical artifact id.
    for (const contractId of input.role.produces) {
      await archive.writeWorkflowRunArtifact({
        workflowRunId: input.workflowRunId,
        contractId,
        artifactId: workflowRunArtifactIdForContract(contractId),
        data: buildMinimalArtifact(contractId, input.workflowRunId),
        producer: { type: "role", id: input.role.id },
      });
    }
  };

  return { dispatchRole, dispatchedRoleIds };
}

function buildMinimalArtifact(contractId: string, workflowRunId: string): Record<string, unknown> {
  const base = { version: 1, workflowRunId, createdAt: FIXED_TIME };
  if (contractId === "plan.v1") {
    return { ...base, summary: "test plan", steps: [{ id: "s1", title: "step", status: "ready", dependsOn: [] }] };
  }
  if (contractId === "change_summary.v1") {
    return { ...base, summary: "test change", changedFiles: [] };
  }
  if (contractId === "review.v1") {
    return { ...base, verdict: "pass", findings: [] };
  }
  return base;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("council verifier wiring from the CLI entry point (NIN-76)", () => {
  it("dispatches both councillors + synthesizer via dispatchRole and records council verification.v1 in archive", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const dataDir = await createTempDir("risoluto-council-data-");
    const workflowDir = await writeWorkflowFile("council-verifier-flow", COUNCIL_WORKFLOW);
    const archive = createWorkflowRunArchive({ dataDir });
    const { dispatchRole, dispatchedRoleIds } = buildFakeCouncilDispatch(archive);

    await expect(
      startAndDriveRunCommand(
        [
          "--title",
          "Council wiring test",
          "--intent",
          "Verify that the council dispatch is wired through the CLI entry point.",
          "--data-dir",
          dataDir,
          "--workflow-dir",
          workflowDir,
          "--workflow-definition",
          "council-verifier-flow",
          "--json",
        ],
        { dispatchRole, now: () => FIXED_TIME },
      ),
    ).resolves.toBe(0);

    // Assert the run reached a terminal state.
    const runId = (await archive.listWorkflowRuns())[0]?.id ?? "";
    const run = await archive.loadWorkflowRun(runId);
    expect(["blocked", "done"]).toContain(run.status);

    // Assert both councillors were dispatched through the production boundary.
    expect(dispatchedRoleIds).toContain("council-decision-alpha");
    expect(dispatchedRoleIds).toContain("council-decision-beta");

    // Assert the synthesizer was dispatched.
    expect(dispatchedRoleIds).toContain("council-synthesis");

    // Assert the council verification.v1 is recorded in the archive with mode:"council".
    const verificationPayload = await archive.readWorkflowRunArtifact({
      workflowRunId: runId,
      artifactId: "verification",
    });
    const verification = verificationPayload.data as {
      mode: string;
      decision: string;
      consensus: string;
      councillors: Array<{ id: string; status: string; decision: string }>;
    };
    expect(verification.mode).toBe("council");
    expect(verification.decision).toBe("satisfied");
    expect(verification.consensus).toBe("unanimous");
    expect(verification.councillors).toHaveLength(2);
    expect(verification.councillors.every((c) => c.status === "completed")).toBe(true);
  });

  it("routes blocked when all councillors fail — no synthesizer dispatch", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const dataDir = await createTempDir("risoluto-council-blocked-data-");
    const workflowDir = await writeWorkflowFile("council-verifier-flow", COUNCIL_WORKFLOW);
    const archive = createWorkflowRunArchive({ dataDir });
    const dispatchedRoleIds: string[] = [];

    const failingDispatch: WorkflowRunRoleDispatch = async (input) => {
      dispatchedRoleIds.push(input.role.id);
      if (input.role.produces.includes("council_verifier_decision.v1")) {
        // Councillor deposits a failed decision.
        await archive.writeWorkflowRunArtifact({
          workflowRunId: input.workflowRunId,
          contractId: "council_verifier_decision.v1",
          artifactId: input.role.id,
          data: {
            version: 1,
            workflowRunId: input.workflowRunId,
            createdAt: FIXED_TIME,
            status: "failed",
            error: "councillor agent failed",
          },
          producer: { type: "role", id: input.role.id },
        });
        return;
      }
      throw new Error(`Unexpected dispatch for ${input.role.id}`);
    };

    await expect(
      startAndDriveRunCommand(
        [
          "--title",
          "Council all-fail test",
          "--intent",
          "Test all-councillors-failed block path.",
          "--data-dir",
          dataDir,
          "--workflow-dir",
          workflowDir,
          "--workflow-definition",
          "council-verifier-flow",
          "--json",
        ],
        { dispatchRole: failingDispatch, now: () => FIXED_TIME },
      ),
    ).resolves.toBe(0);

    const runId = (await archive.listWorkflowRuns())[0]?.id ?? "";
    await expect(archive.loadWorkflowRun(runId)).resolves.toMatchObject({ status: "blocked" });

    // Synthesizer must NOT be dispatched when all councillors fail.
    expect(dispatchedRoleIds).not.toContain("council-synthesis");
  });
});
