import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { startAndDriveRunCommand } from "../../src/cli/run-start-command.js";
import { createWorkflowRunArchive, type WorkflowRunArchive } from "../../src/workflow-run/archive.js";
import type { WorkflowRunCiPoller, WorkflowRunCiPollResult } from "../../src/workflow-run/run-action-runner.js";
import {
  workflowRunArtifactIdForContract,
  type WorkflowRunRoleDispatch,
} from "../../src/workflow-run/run-role-runner.js";

const tempDirs: string[] = [];
const FIXED_TIME = "2026-06-01T12:00:00.000Z";

// poll-ci runs the CI babysitter over an injected poller; a trivial planner just lets the run reach the
// after-roles action phase.
const CI_WORKFLOW = `
version: 1
id: ci-flow
defaults: {}
states:
  - id: build
    roles:
      - id: planner
        consumes: [intent.v1]
        produces: [plan.v1]
        dependsOn: []
    gates: []
    hooks: []
actions: [poll-ci]
`;

// A ready publish with no poll-ci action seeds validation + verifier but never produces ci_result.v1.
const CI_PUBLISH_WORKFLOW = `
version: 1
id: ci-publish-flow
defaults: {}
states:
  - id: build
    roles:
      - id: planner
        consumes: [intent.v1]
        produces: [validation_result.v1, verification.v1]
        dependsOn: []
    gates: []
    hooks: []
actions: [publish-pr]
`;

interface CiResultData {
  readonly status: string;
  readonly route: string;
  readonly blockedEvidence: { readonly kind: string } | null;
}

interface PublishResultData {
  readonly status: string;
  readonly reason: string;
}

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeFixture(filename: string, body: string): Promise<string> {
  const workflowDir = await createTempDir("risoluto-ci-workflows-");
  await mkdir(workflowDir, { recursive: true });
  await writeFile(path.join(workflowDir, filename), body.trimStart(), "utf8");
  return workflowDir;
}

function buildArtifact(contractId: string, workflowRunId: string): Record<string, unknown> {
  if (contractId === "plan.v1") {
    return {
      version: 1,
      workflowRunId,
      createdAt: FIXED_TIME,
      summary: "Plan.",
      steps: [{ id: "s1", title: "Apply", status: "ready", dependsOn: [] }],
    };
  }
  if (contractId === "validation_result.v1") {
    return {
      version: 1,
      workflowRunId,
      createdAt: FIXED_TIME,
      profileId: "offline-smoke",
      failureHandling: "stop_on_first",
      status: "passed",
      checks: [{ id: "c1", command: "true", status: "passed", exitCode: 0, stdout: "", stderr: "", durationMs: 1 }],
    };
  }
  if (contractId === "verification.v1") {
    return {
      version: 1,
      workflowRunId,
      createdAt: FIXED_TIME,
      mode: "single",
      decision: "satisfied",
      summary: "seed verifier",
      allowedInputs: [],
      evidenceLinks: [],
    };
  }
  throw new Error(`unexpected seed contract ${contractId}`);
}

function createSeedingDispatch(archive: WorkflowRunArchive): WorkflowRunRoleDispatch {
  return async (input) => {
    for (const contractId of input.role.produces) {
      await archive.writeWorkflowRunArtifact({
        workflowRunId: input.workflowRunId,
        contractId,
        artifactId: workflowRunArtifactIdForContract(contractId),
        data: buildArtifact(contractId, input.workflowRunId),
        producer: { type: "role", id: input.role.id },
      });
    }
  };
}

function fakePollCi(result: WorkflowRunCiPollResult): WorkflowRunCiPoller {
  return async () => result;
}

async function runCiFlow(pollResult: WorkflowRunCiPollResult): Promise<CiResultData> {
  const dataDir = await createTempDir("risoluto-ci-data-");
  const archive = createWorkflowRunArchive({ dataDir });
  const workflowDir = await writeFixture("ci-flow.yaml", CI_WORKFLOW);
  await expect(
    startAndDriveRunCommand(
      [
        "--title",
        "CI",
        "--intent",
        "Watch CI",
        "--data-dir",
        dataDir,
        "--workflow-dir",
        workflowDir,
        "--workflow-definition",
        "ci-flow",
        "--json",
      ],
      { dispatchRole: createSeedingDispatch(archive), pollCi: fakePollCi(pollResult), now: () => FIXED_TIME },
    ),
  ).resolves.toBe(0);
  const runId = (await archive.listWorkflowRuns())[0]?.id ?? "";
  await expect(archive.loadWorkflowRun(runId)).resolves.toMatchObject({ status: "done" });
  const artifact = await archive.readWorkflowRunArtifact({ workflowRunId: runId, artifactId: "ci_result" });
  return (artifact as { data: CiResultData }).data;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("GitHub Actions CI babysitter reachable from `run start` (RIS-216)", () => {
  it("routes a code-caused CI failure back to implementation when retry budget remains", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const result = await runCiFlow({
      checks: [{ id: "c1", name: "build", status: "failed", classification: "code_failure" }],
      retryBudgetRemaining: 2,
      rerunsAllowed: false,
    });
    expect(result).toMatchObject({ status: "failed", route: "retry_implementation" });
  });

  it("produces structured blocked evidence on a CI timeout instead of a silent pass", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const result = await runCiFlow({
      checks: [{ id: "c1", name: "build", status: "timed_out", classification: "timeout" }],
      retryBudgetRemaining: 2,
      rerunsAllowed: true,
    });
    expect(result).toMatchObject({ status: "blocked", route: "block_operator" });
    expect(result.blockedEvidence).toMatchObject({ kind: "timeout" });
  });

  it("requests a rerun for a likely-flaky check when reruns are allowed", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const result = await runCiFlow({
      checks: [{ id: "c1", name: "build", status: "failed", classification: "flaky" }],
      retryBudgetRemaining: 2,
      rerunsAllowed: true,
    });
    expect(result).toMatchObject({ status: "rerun_requested", route: "rerun_ci" });
  });

  it("blocks a ready publish that has no ci_result.v1", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const dataDir = await createTempDir("risoluto-ci-data-");
    const workflowDir = await writeFixture("ci-publish-flow.yaml", CI_PUBLISH_WORKFLOW);
    const archive = createWorkflowRunArchive({ dataDir });

    await expect(
      startAndDriveRunCommand(
        [
          "--title",
          "Publish",
          "--intent",
          "Publish ready",
          "--data-dir",
          dataDir,
          "--workflow-dir",
          workflowDir,
          "--workflow-definition",
          "ci-publish-flow",
          "--publish-mode",
          "ready",
          "--json",
        ],
        { dispatchRole: createSeedingDispatch(archive), now: () => FIXED_TIME },
      ),
    ).resolves.toBe(0);

    const runId = (await archive.listWorkflowRuns())[0]?.id ?? "";
    const artifact = await archive.readWorkflowRunArtifact({ workflowRunId: runId, artifactId: "publish_result" });
    const data = (artifact as { data: PublishResultData }).data;
    expect(data).toMatchObject({ status: "blocked", reason: "ci_result_required" });
  });
});
