import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { vi } from "vitest";

import { startAndDriveRunCommand } from "../../src/cli/run-start-command.js";
import { createWorkflowRunArchive, type WorkflowRunArchive } from "../../src/workflow-run/archive.js";
import {
  workflowRunArtifactIdForContract,
  type WorkflowRunRoleDispatch,
} from "../../src/workflow-run/run-role-runner.js";

/** Fixed clock so archived artifacts and events are deterministic across the e2e tier. */
export const E2E_FIXED_TIME = "2026-06-01T12:00:00.000Z";

/** Workflow definition id the default fixture registers; e2e tests drive this through a real intake. */
export const E2E_DEFAULT_WORKFLOW_ID = "e2e-intake-default";

// A plan -> implement -> review fixture. A capability e2e drives it through a real intake adapter and
// asserts the reviewer's archived `review.v1` — the observable end-to-end effect, not an internal call.
const E2E_DEFAULT_WORKFLOW = `
version: 1
id: ${E2E_DEFAULT_WORKFLOW_ID}
defaults: {}
states:
  - id: plan
    roles:
      - id: planner
        consumes: [intent.v1]
        produces: [plan.v1]
        dependsOn: []
    gates: []
    hooks: []
  - id: implement
    roles:
      - id: implementer
        consumes: [intent.v1, plan.v1]
        produces: [change_summary.v1]
        dependsOn: [planner]
    gates: []
    hooks: []
  - id: review
    roles:
      - id: reviewer
        consumes: [change_summary.v1]
        produces: [review.v1]
        dependsOn: [implementer]
    gates: []
    hooks: []
actions: []
`;

export interface IntakeE2EHarness {
  readonly dataDir: string;
  readonly workflowDir: string;
  readonly archive: WorkflowRunArchive;
  /** Role ids the faked agent dispatcher was asked to run, in order. */
  readonly dispatchedRoleIds: () => readonly string[];
  /** Drive CLI `run start` through real argument parsing with the faked agent boundary. */
  readonly runCliStart: (extraArgs?: readonly string[]) => Promise<number>;
  /** Read an archived artifact (e.g. `"review"`) of the single run; rejects when it is absent. */
  readonly readArtifact: (artifactId: string) => Promise<unknown>;
  readonly cleanup: () => Promise<void>;
}

/**
 * Compose the e2e intake boundary once: a temp data dir + workflow fixture, a faked agent dispatcher
 * that deposits the typed artifact each role declares it produces, and assertions over the archive.
 *
 * Only the true external — the agent dispatcher (the LLM session) — is faked. CLI argument parsing,
 * intake, the executor, the gate/retry controller, and the archive all run for real, so the test fails
 * if the intake-to-engine wiring is missing even when every unit passes. Sibling adapter e2e (HTTP,
 * Slack) extend this harness with the same faked boundary plus git/GitHub fakes when they publish.
 */
export async function createIntakeE2E(): Promise<IntakeE2EHarness> {
  const tempDirs: string[] = [];
  const makeTempDir = async (prefix: string): Promise<string> => {
    const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  };

  const dataDir = await makeTempDir("risoluto-e2e-data-");
  const workflowDir = await makeTempDir("risoluto-e2e-workflows-");
  await mkdir(workflowDir, { recursive: true });
  await writeFile(path.join(workflowDir, `${E2E_DEFAULT_WORKFLOW_ID}.yaml`), E2E_DEFAULT_WORKFLOW.trimStart(), "utf8");

  const archive = createWorkflowRunArchive({ dataDir });
  const dispatched: string[] = [];
  const dispatchRole: WorkflowRunRoleDispatch = async (input) => {
    dispatched.push(input.role.id);
    for (const contractId of input.role.produces) {
      await archive.writeWorkflowRunArtifact({
        workflowRunId: input.workflowRunId,
        contractId,
        artifactId: workflowRunArtifactIdForContract(contractId),
        data: buildFakeRoleArtifact(contractId, input.workflowRunId),
        producer: { type: "role", id: input.role.id },
      });
    }
  };

  const readArtifact = async (artifactId: string): Promise<unknown> => {
    const runId = (await archive.listWorkflowRuns())[0]?.id ?? "";
    return archive.readWorkflowRunArtifact({ workflowRunId: runId, artifactId });
  };

  const runCliStart = async (extraArgs: readonly string[] = []): Promise<number> => {
    const restore = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      return await startAndDriveRunCommand(
        [
          "--title",
          "E2E intake run",
          "--intent",
          "Drive the engine through a real intake adapter.",
          "--data-dir",
          dataDir,
          "--workflow-dir",
          workflowDir,
          "--workflow-definition",
          E2E_DEFAULT_WORKFLOW_ID,
          "--json",
          ...extraArgs,
        ],
        { dispatchRole, now: () => E2E_FIXED_TIME },
      );
    } finally {
      restore.mockRestore();
    }
  };

  return {
    dataDir,
    workflowDir,
    archive,
    dispatchedRoleIds: () => [...dispatched],
    runCliStart,
    readArtifact,
    cleanup: async () => {
      await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
    },
  };
}

function buildFakeRoleArtifact(contractId: string, workflowRunId: string): unknown {
  const base = { version: 1 as const, workflowRunId, createdAt: E2E_FIXED_TIME };
  if (contractId === "plan.v1") {
    return {
      ...base,
      summary: "Plan the change.",
      steps: [{ id: "step-1", title: "Apply patch", status: "ready", dependsOn: [] }],
    };
  }
  if (contractId === "change_summary.v1") {
    return {
      ...base,
      summary: "Implemented the change.",
      changedFiles: [{ path: "src/example.ts", changeType: "modified", summary: "Patch behaviour." }],
    };
  }
  if (contractId === "review.v1") {
    return { ...base, verdict: "pass", findings: [] };
  }
  throw new Error(`e2e harness has no fake artifact for contract ${contractId}`);
}
