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
const FIXED_TIME = "2026-06-01T12:00:00.000Z";

// Workflow with a verifier role (produces verification.v1) followed by publish-pr.
// Tests the executor-level routing (Part B) + the pre-publish assertion (Part A) together.
const VERIFIER_WORKFLOW = `
version: 1
id: verifier-flow
defaults: {}
states:
  - id: verify
    roles:
      - id: verifier
        consumes: [intent.v1]
        produces: [verification.v1]
        dependsOn: []
    gates: []
    hooks: []
actions: [publish-pr]
`;

// Workflow without a verifier role — only validation + CI artifacts reach publish-pr.
// Used to test assertPublishAllowedByVerification in isolation (Part A, NIN-201).
const NO_VERIFIER_WORKFLOW = `
version: 1
id: no-verifier-flow
defaults: {}
states:
  - id: prep
    roles:
      - id: planner
        consumes: [intent.v1]
        produces: [validation_result.v1, ci_result.v1]
        dependsOn: []
    gates: []
    hooks: []
actions: [publish-pr]
`;

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeWorkflowFile(definitionId: string, yaml: string): Promise<string> {
  const workflowDir = await createTempDir("risoluto-verifier-wiring-workflows-");
  await mkdir(workflowDir, { recursive: true });
  await writeFile(path.join(workflowDir, `${definitionId}.yaml`), yaml.trimStart(), "utf8");
  return workflowDir;
}

function buildVerificationArtifact(workflowRunId: string, decision: string): Record<string, unknown> {
  return {
    version: 1,
    workflowRunId,
    createdAt: FIXED_TIME,
    mode: "single",
    decision,
    summary: "verifier result",
    allowedInputs: [],
    evidenceLinks: [],
  };
}

function buildValidationArtifact(workflowRunId: string): Record<string, unknown> {
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

function buildCiArtifact(workflowRunId: string): Record<string, unknown> {
  return {
    version: 1,
    workflowRunId,
    createdAt: FIXED_TIME,
    provider: "github_actions",
    status: "passed",
    route: "continue",
    summary: "seed ci",
    logSummary: null,
    checks: [],
    blockedEvidence: null,
  };
}

function buildContractArtifact(contractId: string, workflowRunId: string, decision: string): Record<string, unknown> {
  if (contractId === "verification.v1") {
    return buildVerificationArtifact(workflowRunId, decision);
  }
  if (contractId === "validation_result.v1") {
    return buildValidationArtifact(workflowRunId);
  }
  if (contractId === "ci_result.v1") {
    return buildCiArtifact(workflowRunId);
  }
  throw new Error(`unexpected contract ${contractId}`);
}

function createDecisionDispatch(archive: WorkflowRunArchive, decision: string): WorkflowRunRoleDispatch {
  return async (input) => {
    for (const contractId of input.role.produces) {
      await archive.writeWorkflowRunArtifact({
        workflowRunId: input.workflowRunId,
        contractId,
        artifactId: workflowRunArtifactIdForContract(contractId),
        data: buildContractArtifact(contractId, input.workflowRunId, decision),
        producer: { type: "role", id: input.role.id },
      });
    }
  };
}

async function runWith(
  archive: WorkflowRunArchive,
  dataDir: string,
  workflowDir: string,
  definitionId: string,
  publishMode: string,
  dispatchRole: WorkflowRunRoleDispatch,
): Promise<void> {
  await expect(
    startAndDriveRunCommand(
      [
        "--title",
        "Verifier wiring",
        "--intent",
        "Test verifier routing",
        "--data-dir",
        dataDir,
        "--workflow-dir",
        workflowDir,
        "--workflow-definition",
        definitionId,
        "--publish-mode",
        publishMode,
        "--json",
      ],
      { dispatchRole, now: () => FIXED_TIME },
    ),
  ).resolves.toBe(0);
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("assertPublishAllowedByVerification gates ready/auto_merge (NIN-201 Part A)", () => {
  it("blocks a ready publish when verification.v1 is absent, writing a handoff with VerifierPolicyError", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const dataDir = await createTempDir("risoluto-vw-data-");
    const workflowDir = await writeWorkflowFile("no-verifier-flow", NO_VERIFIER_WORKFLOW);
    const archive = createWorkflowRunArchive({ dataDir });

    await runWith(archive, dataDir, workflowDir, "no-verifier-flow", "ready", createDecisionDispatch(archive, "n/a"));

    const runId = (await archive.listWorkflowRuns())[0]?.id ?? "";
    await expect(archive.loadWorkflowRun(runId)).resolves.toMatchObject({ status: "blocked" });
    const handoff = await archive.readWorkflowRunArtifact({ workflowRunId: runId, artifactId: "handoff" });
    const data = (handoff as { data: { blockers: Array<{ message: string }> } }).data;
    expect(data.blockers[0]?.message).toMatch(/publish requires satisfied verification\.v1/);
  });

  it("allows a draft publish to proceed without verification.v1 (draft is not gated)", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const dataDir = await createTempDir("risoluto-vw-data-");
    const workflowDir = await writeWorkflowFile("no-verifier-flow", NO_VERIFIER_WORKFLOW);
    const archive = createWorkflowRunArchive({ dataDir });

    await runWith(archive, dataDir, workflowDir, "no-verifier-flow", "draft", createDecisionDispatch(archive, "n/a"));

    const runId = (await archive.listWorkflowRuns())[0]?.id ?? "";
    await expect(archive.loadWorkflowRun(runId)).resolves.toMatchObject({ status: "done" });
    const artifact = await archive.readWorkflowRunArtifact({ workflowRunId: runId, artifactId: "publish_result" });
    expect((artifact as { data: { mode: string } }).data.mode).toBe("draft");
  });
});

describe("verifier role decision routing (NIN-207 Part B)", () => {
  it("blocks the run (retry_implementation) when the verifier produces not_satisfied", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const dataDir = await createTempDir("risoluto-vw-data-");
    const workflowDir = await writeWorkflowFile("verifier-flow", VERIFIER_WORKFLOW);
    const archive = createWorkflowRunArchive({ dataDir });

    await runWith(
      archive,
      dataDir,
      workflowDir,
      "verifier-flow",
      "ready",
      createDecisionDispatch(archive, "not_satisfied"),
    );

    const runId = (await archive.listWorkflowRuns())[0]?.id ?? "";
    await expect(archive.loadWorkflowRun(runId)).resolves.toMatchObject({ status: "blocked" });
    // The publish-pr action must not have run (no publish_result artifact).
    await expect(
      archive.readWorkflowRunArtifact({ workflowRunId: runId, artifactId: "publish_result" }),
    ).rejects.toThrow();
  });

  it("passes the verifier gate and reaches publish-pr when the verifier produces satisfied", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const dataDir = await createTempDir("risoluto-vw-data-");
    const workflowDir = await writeWorkflowFile("verifier-flow", VERIFIER_WORKFLOW);
    const archive = createWorkflowRunArchive({ dataDir });

    await runWith(
      archive,
      dataDir,
      workflowDir,
      "verifier-flow",
      "ready",
      createDecisionDispatch(archive, "satisfied"),
    );

    const runId = (await archive.listWorkflowRuns())[0]?.id ?? "";
    // satisfied → routeVerifierResult → continue_to_publish → executor proceeds to after-roles actions.
    // publish-pr runs; validation is absent so the policy records a blocked publish_result.
    // The run finishes as "done" — no throw, the policy handled missing validation gracefully.
    await expect(archive.loadWorkflowRun(runId)).resolves.toMatchObject({ status: "done" });
    // publish_result must exist — confirming publish-pr was reached (not stopped by verifier routing).
    const artifact = await archive.readWorkflowRunArtifact({ workflowRunId: runId, artifactId: "publish_result" });
    expect((artifact as { data: { mode: string; checks: Array<{ id: string }> } }).data).toMatchObject({
      mode: "ready",
      checks: expect.arrayContaining([expect.objectContaining({ id: "verifier_satisfied" })]),
    });
  });
});
