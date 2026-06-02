import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { startAndDriveRunCommand } from "../../src/cli/run-start-command.js";
import { createWorkflowRunArchive, type WorkflowRunArchive } from "../../src/workflow-run/archive.js";
import { createWorkflowRunEvidenceStore } from "../../src/workflow-run/evidence-store.js";
import { createWorkflowRunMemoryStore } from "../../src/workflow-run/memory-store.js";
import {
  workflowRunArtifactIdForContract,
  type WorkflowRunRoleDispatch,
} from "../../src/workflow-run/run-role-runner.js";

const tempDirs: string[] = [];
const FIXED_TIME = "2026-06-01T12:00:00.000Z";

// A workflow with a hook on the review state — hook fires at state entry, evidence is written.
const HOOK_WORKFLOW = `
version: 1
id: evidence-memory-hook
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
  - id: review
    roles:
      - id: reviewer
        consumes: [plan.v1]
        produces: [review.v1]
        dependsOn: [planner]
    gates: []
    hooks: [notify-operator]
actions: []
`;

// A hookless workflow — no hooks fire, so evidenceRefs is empty; attempt memory still gets written.
const NO_HOOK_WORKFLOW = `
version: 1
id: evidence-memory-nohook
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
actions: []
`;

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeWorkflowFixture(definitionId: string, yaml: string): Promise<string> {
  const workflowDir = await createTempDir("risoluto-ev-mem-workflows-");
  await mkdir(workflowDir, { recursive: true });
  await writeFile(path.join(workflowDir, `${definitionId}.yaml`), yaml.trimStart(), "utf8");
  return workflowDir;
}

function buildRoleArtifact(contractId: string, workflowRunId: string): unknown {
  const base = { version: 1 as const, workflowRunId, createdAt: FIXED_TIME };
  if (contractId === "plan.v1") {
    return { ...base, summary: "Plan.", steps: [{ id: "s1", title: "Step", status: "ready", dependsOn: [] }] };
  }
  if (contractId === "review.v1") {
    return { ...base, verdict: "pass", findings: [] };
  }
  throw new Error(`unexpected fixture contract ${contractId}`);
}

function createDepositingDispatch(archive: WorkflowRunArchive): WorkflowRunRoleDispatch {
  return async (input) => {
    for (const contractId of input.role.produces) {
      await archive.writeWorkflowRunArtifact({
        workflowRunId: input.workflowRunId,
        contractId,
        artifactId: workflowRunArtifactIdForContract(contractId),
        data: buildRoleArtifact(contractId, input.workflowRunId),
        producer: { type: "role", id: input.role.id },
      });
    }
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("evidence and attempt-memory recorded during run start (NIN-204 + NIN-214)", () => {
  it("writes an evidence record for each hook firing and an attempt-memory record for the run", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const dataDir = await createTempDir("risoluto-ev-mem-data-");
    const workflowDir = await writeWorkflowFixture("evidence-memory-hook", HOOK_WORKFLOW);
    const archive = createWorkflowRunArchive({ dataDir });

    await expect(
      startAndDriveRunCommand(
        [
          "--title",
          "Evidence run",
          "--intent",
          "Record evidence and attempt memory.",
          "--data-dir",
          dataDir,
          "--workflow-dir",
          workflowDir,
          "--workflow-definition",
          "evidence-memory-hook",
          "--json",
        ],
        // No runHook injected — the real evidence hook must fire.
        { dispatchRole: createDepositingDispatch(archive), now: () => FIXED_TIME },
      ),
    ).resolves.toBe(0);

    const runId = (await archive.listWorkflowRuns())[0]?.id ?? "";
    await expect(archive.loadWorkflowRun(runId)).resolves.toMatchObject({ status: "done" });

    // Evidence: one hook fired on the review state → one evidence record.
    const evidenceStore = createWorkflowRunEvidenceStore({ dataDir });
    const evidenceRecord = await evidenceStore.readEvidence({
      workflowRunId: runId,
      evidenceId: "notify-operator-review",
    });
    expect(evidenceRecord).toMatchObject({
      workflowRunId: runId,
      evidenceId: "notify-operator-review",
      kind: "hook_fired",
      source: "notify-operator",
      content: { hookId: "notify-operator", stateId: "review" },
      commitPolicy: "exclude",
      includeInCommittedOutput: false,
    });

    // Attempt memory: one record for this run, referencing the hook evidence.
    const memoryStore = createWorkflowRunMemoryStore({ dataDir });
    const memoryRecords = await memoryStore.readPriorAttemptMemory({
      workflowRunId: runId,
      beforeAttemptNumber: 2,
    });
    expect(memoryRecords).toHaveLength(1);
    expect(memoryRecords[0]).toMatchObject({
      workflowRunId: runId,
      attemptId: "attempt-1",
      attemptNumber: 1,
      summary: expect.stringContaining("done"),
      commitPolicy: "exclude",
      includeInCommittedOutput: false,
    });
    // The memory record references the hook evidence.
    expect(memoryRecords[0]?.evidenceRefs).toContainEqual(
      expect.objectContaining({ evidenceId: "notify-operator-review" }),
    );
  });

  it("writes attempt-memory with empty evidenceRefs when no hooks are defined", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const dataDir = await createTempDir("risoluto-ev-mem-nohook-data-");
    const workflowDir = await writeWorkflowFixture("evidence-memory-nohook", NO_HOOK_WORKFLOW);
    const archive = createWorkflowRunArchive({ dataDir });

    await expect(
      startAndDriveRunCommand(
        [
          "--title",
          "No-hook run",
          "--intent",
          "Attempt memory written even without hooks.",
          "--data-dir",
          dataDir,
          "--workflow-dir",
          workflowDir,
          "--workflow-definition",
          "evidence-memory-nohook",
          "--json",
        ],
        { dispatchRole: createDepositingDispatch(archive), now: () => FIXED_TIME },
      ),
    ).resolves.toBe(0);

    const runId = (await archive.listWorkflowRuns())[0]?.id ?? "";

    // No evidence files written (no hooks fired).
    const archiveRoot = path.join(dataDir, "archives");
    const evidenceDir = path.join(archiveRoot, "workflow-runs", runId, "evidence", "raw");
    const evidenceFiles = await readdir(evidenceDir).catch(() => []);
    expect(evidenceFiles).toHaveLength(0);

    // Attempt memory still written with empty evidenceRefs.
    const memoryStore = createWorkflowRunMemoryStore({ dataDir });
    const memoryRecords = await memoryStore.readPriorAttemptMemory({
      workflowRunId: runId,
      beforeAttemptNumber: 2,
    });
    expect(memoryRecords).toHaveLength(1);
    expect(memoryRecords[0]).toMatchObject({
      workflowRunId: runId,
      attemptId: "attempt-1",
      attemptNumber: 1,
      evidenceRefs: [],
    });
  });
});
