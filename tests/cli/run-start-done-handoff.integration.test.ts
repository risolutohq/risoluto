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

// Simple done workflow — no publish action; verifier decision is satisfied so the run completes.
const SIMPLE_DONE_WORKFLOW = `
version: 1
id: done-handoff-simple
defaults: {}
states:
  - id: implement
    roles:
      - id: implementer
        consumes: [intent.v1]
        produces: [verification.v1, validation_result.v1]
        dependsOn: []
    gates: []
    hooks: []
actions: []
`;

// Done workflow with publish-pr — produces a publish_result.v1 artifact on DONE path.
const DONE_WITH_PUBLISH_WORKFLOW = `
version: 1
id: done-handoff-publish
defaults: {}
states:
  - id: implement
    roles:
      - id: implementer
        consumes: [intent.v1]
        produces: [verification.v1, validation_result.v1, ci_result.v1]
        dependsOn: []
    gates: []
    hooks: []
actions: [publish-pr]
`;

interface HandoffData {
  readonly version: number;
  readonly outcome: string;
  readonly summary: string;
  readonly recommendedNextAction: string;
  readonly suggestedSkills: readonly string[];
  readonly validation: { readonly status: string; readonly artifact?: { readonly artifactId: string } };
  readonly attemptMemory: ReadonlyArray<{ readonly attemptId: string; readonly summary: string }>;
  readonly output: { readonly branchName: string | null; readonly pullRequestUrl: string | null };
  readonly blockers: readonly unknown[];
  readonly artifacts: ReadonlyArray<{ readonly contractId: string; readonly artifactId: string }>;
}

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeWorkflowFixture(definitionId: string, yaml: string): Promise<string> {
  const workflowDir = await createTempDir("risoluto-done-handoff-workflows-");
  await mkdir(workflowDir, { recursive: true });
  await writeFile(path.join(workflowDir, `${definitionId}.yaml`), yaml.trimStart(), "utf8");
  return workflowDir;
}

function buildSeedArtifact(contractId: string, workflowRunId: string): Record<string, unknown> {
  if (contractId === "verification.v1") {
    return {
      version: 1,
      workflowRunId,
      createdAt: FIXED_TIME,
      mode: "single",
      decision: "satisfied",
      summary: "All checks passed.",
      allowedInputs: [],
      evidenceLinks: [],
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
      checks: [{ id: "build", command: "true", status: "passed", exitCode: 0, stdout: "", stderr: "", durationMs: 1 }],
    };
  }
  if (contractId === "ci_result.v1") {
    return {
      version: 1,
      workflowRunId,
      createdAt: FIXED_TIME,
      provider: "github_actions",
      status: "passed",
      route: "continue",
      summary: "CI green.",
      logSummary: null,
      checks: [],
      blockedEvidence: null,
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
        data: buildSeedArtifact(contractId, input.workflowRunId),
        producer: { type: "role", id: input.role.id },
      });
    }
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("DONE-path handoff written on successful run completion (NIN-210)", () => {
  it("writes a handoff.v1 with outcome done and validation reference on a simple DONE run", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const dataDir = await createTempDir("risoluto-done-handoff-data-");
    const workflowDir = await writeWorkflowFixture("done-handoff-simple", SIMPLE_DONE_WORKFLOW);
    const archive = createWorkflowRunArchive({ dataDir });

    await expect(
      startAndDriveRunCommand(
        [
          "--title",
          "Done handoff test",
          "--intent",
          "Drive a run to DONE and assert handoff.v1 is written.",
          "--data-dir",
          dataDir,
          "--workflow-dir",
          workflowDir,
          "--workflow-definition",
          "done-handoff-simple",
          "--json",
        ],
        { dispatchRole: createSeedingDispatch(archive), now: () => FIXED_TIME },
      ),
    ).resolves.toBe(0);

    const runId = (await archive.listWorkflowRuns())[0]?.id ?? "";
    await expect(archive.loadWorkflowRun(runId)).resolves.toMatchObject({ status: "done" });

    const payload = await archive.readWorkflowRunArtifact({ workflowRunId: runId, artifactId: "handoff" });
    const handoff = (payload as { data: HandoffData }).data;

    expect(handoff.outcome).toBe("done");
    expect(handoff.blockers).toHaveLength(0);
    // Attempt memory is referenced (not copied) — one entry for this attempt.
    expect(handoff.attemptMemory).toHaveLength(1);
    expect(handoff.attemptMemory[0]).toMatchObject({
      attemptId: "attempt-1",
      summary: expect.stringContaining("done"),
    });
    // Validation result artifact is referenced.
    expect(handoff.validation.status).toBe("passed");
    expect(handoff.validation.artifact).toMatchObject({
      artifactId: "validation_result",
      contractId: "validation_result.v1",
      path: expect.stringContaining(path.join(runId, "artifacts", "validation_result.json")),
    });
    // Artifacts list references the artifacts produced during the run.
    expect(handoff.artifacts).toContainEqual(
      expect.objectContaining({ contractId: "validation_result.v1", artifactId: "validation_result" }),
    );
    expect(handoff.artifacts).toContainEqual(
      expect.objectContaining({ contractId: "verification.v1", artifactId: "verification" }),
    );
    // No PR link since no publish action ran.
    expect(handoff.output.pullRequestUrl).toBeNull();
    expect(handoff.suggestedSkills).toContain("risoluto-review-handoff");
  });

  it("populates pullRequestUrl from publish_result.v1 on a DONE run with publish-pr action", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const dataDir = await createTempDir("risoluto-done-handoff-publish-data-");
    const workflowDir = await writeWorkflowFixture("done-handoff-publish", DONE_WITH_PUBLISH_WORKFLOW);
    const archive = createWorkflowRunArchive({ dataDir });

    await expect(
      startAndDriveRunCommand(
        [
          "--title",
          "Done handoff publish",
          "--intent",
          "Drive a run to DONE with publish-pr and assert handoff.v1 contains publish_result ref.",
          "--data-dir",
          dataDir,
          "--workflow-dir",
          workflowDir,
          "--workflow-definition",
          "done-handoff-publish",
          "--json",
        ],
        { dispatchRole: createSeedingDispatch(archive), now: () => FIXED_TIME },
      ),
    ).resolves.toBe(0);

    const runId = (await archive.listWorkflowRuns())[0]?.id ?? "";
    await expect(archive.loadWorkflowRun(runId)).resolves.toMatchObject({ status: "done" });

    const payload = await archive.readWorkflowRunArtifact({ workflowRunId: runId, artifactId: "handoff" });
    const handoff = (payload as { data: HandoffData }).data;

    expect(handoff.outcome).toBe("done");
    expect(handoff.blockers).toHaveLength(0);
    // publish_result.v1 artifact is referenced in the artifacts list.
    expect(handoff.artifacts).toContainEqual(
      expect.objectContaining({ contractId: "publish_result.v1", artifactId: "publish_result" }),
    );
    // Draft publish does not produce a real PR URL (policy returns null for draft).
    expect(handoff.output).toMatchObject({ pullRequestUrl: null });
  });
});
