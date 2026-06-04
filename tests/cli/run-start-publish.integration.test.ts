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

// A single prep role seeds the verifier / validation / CI artifacts the publish-pr action reads. They are
// normally produced by the verifier role and the validation/CI actions; seeding them via one role keeps
// the publish-policy test focused while still exercising the real after-roles action path from `run start`.
const PUBLISH_WORKFLOW = `
version: 1
id: publish-flow
defaults: {}
states:
  - id: prep
    roles:
      - id: planner
        consumes: [intent.v1]
        produces: [verification.v1, validation_result.v1, ci_result.v1]
        dependsOn: []
    gates: []
    hooks: []
actions: [publish-pr]
`;

interface SeedOptions {
  readonly validationStatus: "failed" | "passed";
  readonly verifierDecision: "not_satisfied" | "satisfied" | "uncertain";
  readonly ciStatus: "blocked" | "failed" | "passed" | "pending" | "rerun_requested";
}

interface PublishResultData {
  readonly mode: string;
  readonly status: string;
  readonly draft: boolean;
  readonly autoMerge: boolean;
  readonly reason: string;
  readonly checks: ReadonlyArray<{ readonly id: string; readonly status: string }>;
}

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeWorkflowFixture(): Promise<string> {
  const workflowDir = await createTempDir("risoluto-publish-workflows-");
  await mkdir(workflowDir, { recursive: true });
  await writeFile(path.join(workflowDir, "publish-flow.yaml"), PUBLISH_WORKFLOW.trimStart(), "utf8");
  return workflowDir;
}

function buildSeedArtifact(contractId: string, workflowRunId: string, opts: SeedOptions): Record<string, unknown> {
  if (contractId === "verification.v1") {
    return {
      version: 1,
      workflowRunId,
      createdAt: FIXED_TIME,
      mode: "single",
      decision: opts.verifierDecision,
      summary: "seed verifier",
      allowedInputs: [],
      evidenceLinks: [],
    };
  }
  if (contractId === "validation_result.v1") {
    const passed = opts.validationStatus === "passed";
    return {
      version: 1,
      workflowRunId,
      createdAt: FIXED_TIME,
      profileId: "offline-smoke",
      failureHandling: "stop_on_first",
      status: opts.validationStatus,
      checks: [
        {
          id: "c1",
          command: "true",
          status: passed ? "passed" : "failed",
          exitCode: passed ? 0 : 1,
          stdout: "",
          stderr: "",
          durationMs: 1,
        },
      ],
    };
  }
  if (contractId === "ci_result.v1") {
    return {
      version: 1,
      workflowRunId,
      createdAt: FIXED_TIME,
      provider: "github_actions",
      status: opts.ciStatus,
      route: "continue",
      summary: "seed ci",
      logSummary: null,
      checks: [],
      blockedEvidence: null,
    };
  }
  throw new Error(`unexpected seed contract ${contractId}`);
}

function createSeedingDispatch(archive: WorkflowRunArchive, opts: SeedOptions): WorkflowRunRoleDispatch {
  return async (input) => {
    for (const contractId of input.role.produces) {
      await archive.writeWorkflowRunArtifact({
        workflowRunId: input.workflowRunId,
        contractId,
        artifactId: workflowRunArtifactIdForContract(contractId),
        data: buildSeedArtifact(contractId, input.workflowRunId, opts),
        producer: { type: "role", id: input.role.id },
      });
    }
  };
}

async function runPublish(
  archive: WorkflowRunArchive,
  dataDir: string,
  workflowDir: string,
  opts: SeedOptions,
  publishMode: string | null,
): Promise<PublishResultData> {
  const modeArgs = publishMode ? ["--publish-mode", publishMode] : [];
  await expect(
    startAndDriveRunCommand(
      [
        "--title",
        "Publish",
        "--intent",
        "Publish a change",
        "--data-dir",
        dataDir,
        "--workflow-dir",
        workflowDir,
        "--workflow-definition",
        "publish-flow",
        ...modeArgs,
        "--json",
      ],
      { dispatchRole: createSeedingDispatch(archive, opts), now: () => FIXED_TIME },
    ),
  ).resolves.toBe(0);

  const runId = (await archive.listWorkflowRuns())[0]?.id ?? "";
  await expect(archive.loadWorkflowRun(runId)).resolves.toMatchObject({ status: "done" });
  const artifact = await archive.readWorkflowRunArtifact({ workflowRunId: runId, artifactId: "publish_result" });
  return (artifact as { data: PublishResultData }).data;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("PR publishing modes reachable from `run start` (RIS-215)", () => {
  it("defaults to a draft PR when no explicit publish mode is configured", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const dataDir = await createTempDir("risoluto-publish-data-");
    const workflowDir = await writeWorkflowFixture();
    const archive = createWorkflowRunArchive({ dataDir });

    const result = await runPublish(
      archive,
      dataDir,
      workflowDir,
      { validationStatus: "passed", verifierDecision: "satisfied", ciStatus: "passed" },
      null,
    );

    expect(result).toMatchObject({ mode: "draft", status: "published", draft: true, reason: "draft_publish_allowed" });
  });

  it("refuses ready publishing when local validation is red even though the verifier is satisfied", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const dataDir = await createTempDir("risoluto-publish-data-");
    const workflowDir = await writeWorkflowFixture();
    const archive = createWorkflowRunArchive({ dataDir });

    const result = await runPublish(
      archive,
      dataDir,
      workflowDir,
      { validationStatus: "failed", verifierDecision: "satisfied", ciStatus: "passed" },
      "ready",
    );

    expect(result).toMatchObject({ mode: "ready", status: "blocked", reason: "local_validation_failed" });
    // The verifier check still passed — red validation alone blocks the ready publish.
    expect(result.checks).toContainEqual(expect.objectContaining({ id: "verifier_satisfied", status: "passed" }));
    expect(result.checks).toContainEqual(expect.objectContaining({ id: "local_validation", status: "failed" }));
  });

  it("blocks auto-merge when no operator approval is recorded", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const dataDir = await createTempDir("risoluto-publish-data-");
    const workflowDir = await writeWorkflowFixture();
    const archive = createWorkflowRunArchive({ dataDir });

    const result = await runPublish(
      archive,
      dataDir,
      workflowDir,
      { validationStatus: "passed", verifierDecision: "satisfied", ciStatus: "passed" },
      "auto_merge",
    );

    expect(result).toMatchObject({ mode: "auto_merge", status: "blocked", autoMerge: false });
    expect(result.reason).toBe("operator_approval_required");
  });
});
