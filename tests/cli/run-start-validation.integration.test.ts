import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { startAndDriveRunCommand } from "../../src/cli/run-start-command.js";
import { createWorkflowRunArchive, type WorkflowRunArchive } from "../../src/workflow-run/archive.js";
import type { WorkflowGateRetryInput } from "../../src/workflow-run/gate-retry-controller.js";
import type { WorkflowRunValidationCommandRunner } from "../../src/workflow-run/run-action-runner.js";
import {
  workflowRunArtifactIdForContract,
  type WorkflowRunRoleDispatch,
} from "../../src/workflow-run/run-role-runner.js";
import type {
  ValidationProfileCommandInput,
  ValidationProfileCommandOutput,
} from "../../src/workflow-run/validation-profile.js";

const tempDirs: string[] = [];
const FIXED_TIME = "2026-06-01T12:00:00.000Z";

const STOP_ON_FIRST_WORKFLOW = `
version: 1
id: validation-stop
defaults: {}
states:
  - id: implement
    roles:
      - id: implementer
        consumes: [intent.v1]
        produces: [change_summary.v1]
        dependsOn: []
    gates: [validation-passed]
    hooks: []
actions: [run-validation-profile]
`;

const COLLECT_ALL_WORKFLOW = `
version: 1
id: validation-collect
defaults:
  validationProfile: offline-smoke
states:
  - id: implement
    roles:
      - id: implementer
        consumes: [intent.v1]
        produces: [change_summary.v1]
        dependsOn: []
    gates: [validation-passed]
    hooks: []
actions: [run-validation-profile]
`;

interface ValidationResultArtifactData {
  readonly status: string;
  readonly profileId: string;
  readonly failureHandling: string;
  readonly checks: ReadonlyArray<{ id: string; status: string; stdout: string; stderr: string }>;
}

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeWorkflowFixture(definitionId: string, yaml: string): Promise<string> {
  const workflowDir = await createTempDir("risoluto-validation-workflows-");
  await mkdir(workflowDir, { recursive: true });
  await writeFile(path.join(workflowDir, `${definitionId}.yaml`), yaml.trimStart(), "utf8");
  return workflowDir;
}

function createDepositingDispatch(archive: WorkflowRunArchive): WorkflowRunRoleDispatch {
  return async (input) => {
    for (const contractId of input.role.produces) {
      await archive.writeWorkflowRunArtifact({
        workflowRunId: input.workflowRunId,
        contractId,
        artifactId: workflowRunArtifactIdForContract(contractId),
        data: {
          version: 1,
          workflowRunId: input.workflowRunId,
          createdAt: FIXED_TIME,
          summary: "Implemented the change.",
          changedFiles: [{ path: "src/example.ts", changeType: "modified", summary: "Patch." }],
        },
        producer: { type: "role", id: input.role.id },
      });
    }
  };
}

function createFakeValidationCommand(failing: ReadonlySet<string>): {
  runValidationCommand: WorkflowRunValidationCommandRunner;
  calls: string[];
} {
  const calls: string[] = [];
  const runValidationCommand = async (
    input: ValidationProfileCommandInput,
  ): Promise<ValidationProfileCommandOutput> => {
    calls.push(input.id);
    const failed = failing.has(input.id);
    return {
      exitCode: failed ? 1 : 0,
      stdout: `ran ${input.command}`,
      stderr: failed ? `error in ${input.id}` : "",
      durationMs: 5,
    };
  };
  return { runValidationCommand, calls };
}

async function readValidationResult(archive: WorkflowRunArchive, runId: string): Promise<ValidationResultArtifactData> {
  const payload = await archive.readWorkflowRunArtifact({ workflowRunId: runId, artifactId: "validation_result" });
  return (payload as { data: ValidationResultArtifactData }).data;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("validation profiles reachable from run start (NIN-211)", () => {
  it("halts a stop-on-first profile on the first failing command, captures its output, and routes back to implementation", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const dataDir = await createTempDir("risoluto-validation-data-");
    const workflowDir = await writeWorkflowFixture("validation-stop", STOP_ON_FIRST_WORKFLOW);
    const archive = createWorkflowRunArchive({ dataDir });
    const { runValidationCommand, calls } = createFakeValidationCommand(new Set(["build"]));
    const retryInputs: WorkflowGateRetryInput[] = [];

    await expect(
      startAndDriveRunCommand(
        [
          "--title",
          "Validate",
          "--intent",
          "Run the stop-on-first profile.",
          "--data-dir",
          dataDir,
          "--workflow-dir",
          workflowDir,
          "--workflow-definition",
          "validation-stop",
          "--json",
        ],
        {
          dispatchRole: createDepositingDispatch(archive),
          runValidationCommand,
          retryGate: async (input) => {
            retryInputs.push(input);
            return {};
          },
          now: () => FIXED_TIME,
        },
      ),
    ).resolves.toBe(0);

    // Stop-on-first halts after the first failing command (build); typecheck/test never run.
    expect(calls).toEqual(["build"]);
    const runId = (await archive.listWorkflowRuns())[0]?.id ?? "";
    const result = await readValidationResult(archive, runId);
    expect(result.failureHandling).toBe("stop_on_first");
    expect(result.status).toBe("failed");
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]).toMatchObject({ id: "build", status: "failed", stderr: "error in build" });

    // The failing validation routes back to implementation (one retry of the validation-passed gate).
    expect(retryInputs).toHaveLength(1);
    expect(retryInputs[0]?.failureEvidence.gateId).toBe("validation-passed");
    await expect(archive.loadWorkflowRun(runId)).resolves.toMatchObject({ status: "blocked" });
  });

  it("runs every check of a collect-all profile and aggregates their outputs", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const dataDir = await createTempDir("risoluto-validation-data-");
    const workflowDir = await writeWorkflowFixture("validation-collect", COLLECT_ALL_WORKFLOW);
    const archive = createWorkflowRunArchive({ dataDir });
    const { runValidationCommand, calls } = createFakeValidationCommand(new Set(["build"]));

    await expect(
      startAndDriveRunCommand(
        [
          "--title",
          "Validate all",
          "--intent",
          "Run the collect-all profile.",
          "--data-dir",
          dataDir,
          "--workflow-dir",
          workflowDir,
          "--workflow-definition",
          "validation-collect",
          "--json",
        ],
        { dispatchRole: createDepositingDispatch(archive), runValidationCommand, now: () => FIXED_TIME },
      ),
    ).resolves.toBe(0);

    // Collect-all runs every configured check despite the early failure, and aggregates all outputs.
    expect(calls).toEqual(["build", "test"]);
    const runId = (await archive.listWorkflowRuns())[0]?.id ?? "";
    const result = await readValidationResult(archive, runId);
    expect(result.failureHandling).toBe("collect_all");
    expect(result.checks.map((check) => check.id)).toEqual(["build", "test"]);
    expect(result.checks.map((check) => check.status)).toEqual(["failed", "passed"]);
  });
});
