import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the workflow driver — this suite exercises only the memory wiring around the production
// driveAcceptedWorkflowRun path (NIN-104).
vi.mock("../../src/workflow-run/workflow-run-driver.js", () => ({
  driveWorkflowRun: vi.fn(),
}));

import { driveAcceptedWorkflowRun } from "../../src/workflow-run/drive-accepted-run.js";
import type { DriveAcceptedWorkflowRunInput } from "../../src/workflow-run/drive-accepted-run.js";
import { acceptWorkflowRunIntake } from "../../src/workflow-run/intake-core.js";
import { createWorkflowRunMemoryStore } from "../../src/workflow-run/memory-store.js";
import type { ResolvedWorkflowDefinition } from "../../src/workflow-definition/registry.js";
import type { WorkflowRunRoleExecutor } from "../../src/workflow-run/run-role-runner.js";
import { driveWorkflowRun } from "../../src/workflow-run/workflow-run-driver.js";

const FIXED_TIME = "2026-06-08T12:00:00.000Z";
const tempDirs: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "risoluto-mem-"));
  tempDirs.push(dir);
  return dir;
}

async function acceptedRun(archiveDir: string) {
  return acceptWorkflowRunIntake({
    archiveDir,
    source: "cli",
    mode: "start",
    title: "memory wiring test",
    body: "prove NIN-104 attempt-memory read + candidate wiring",
    externalObject: null,
    rules: [],
  });
}

function buildBaseInput(
  archiveDir: string,
  intake: Awaited<ReturnType<typeof acceptedRun>>,
): Omit<DriveAcceptedWorkflowRunInput, "attemptNumber" | "projectMemoryMode"> {
  return {
    archiveDir,
    definition: {} as ResolvedWorkflowDefinition,
    workflowRun: intake.workflowRun,
    intent: intake.intent,
    runRole: (async () => undefined) as unknown as WorkflowRunRoleExecutor,
    now: () => FIXED_TIME,
  };
}

// When archiveDir is the location key, that directory IS the archive root (no extra "archives/"
// subdirectory — that is only added when the dataDir key is used instead).
function candidatesDir(archiveDir: string, workflowRunId: string): string {
  return path.join(archiveDir, "workflow-runs", workflowRunId, "memory", "project-candidates");
}

describe("driveAcceptedWorkflowRun memory wiring (NIN-104)", () => {
  it("AC1: retry attempt receives prior attempt memory in initialArtifacts on the production run path", async () => {
    const archiveDir = await createTempDir();
    const intake = await acceptedRun(archiveDir);
    const base = buildBaseInput(archiveDir, intake);

    // Attempt 1: capture the initialArtifacts the driver was called with.
    let attempt1InitialArtifacts: Record<string, unknown> = {};
    vi.mocked(driveWorkflowRun).mockImplementationOnce(async (driveInput) => {
      attempt1InitialArtifacts = driveInput.initialArtifacts as Record<string, unknown>;
      await driveInput.recordStatus?.({ workflowRunId: driveInput.workflowRunId, status: "running" });
      await driveInput.recordStatus?.({ workflowRunId: driveInput.workflowRunId, status: "done" });
      return { status: "done", events: [], roleExecutions: ["planner"], artifacts: {} };
    });
    await driveAcceptedWorkflowRun({ ...base, attemptNumber: 1 });

    // Verify attempt-1 memory landed in the archive before the retry reads it.
    const memoryStore = createWorkflowRunMemoryStore({ archiveDir });
    const storedAfterAttempt1 = await memoryStore.readPriorAttemptMemory({
      workflowRunId: intake.workflowRun.id,
      beforeAttemptNumber: 2,
    });
    expect(storedAfterAttempt1).toHaveLength(1);
    expect(storedAfterAttempt1[0]).toMatchObject({ attemptId: "attempt-1", attemptNumber: 1 });

    // Attempt 2: capture initialArtifacts and verify prior memory is present.
    // The archive run is already "done" (terminal), but the memory store and driver are independent
    // of run status — the read and capture still exercise the production wiring.
    let attempt2InitialArtifacts: Record<string, unknown> = {};
    vi.mocked(driveWorkflowRun).mockImplementationOnce(async (driveInput) => {
      attempt2InitialArtifacts = driveInput.initialArtifacts as Record<string, unknown>;
      return { status: "done", events: [], roleExecutions: ["planner"], artifacts: {} };
    });
    await driveAcceptedWorkflowRun({ ...base, attemptNumber: 2 });

    // Attempt 1 should not receive prior memory (it was the first attempt).
    expect(attempt1InitialArtifacts["prior_attempt_memory.v1"]).toBeUndefined();

    // Attempt 2 MUST receive the memory from attempt 1 via the production path.
    const priorMemory = attempt2InitialArtifacts["prior_attempt_memory.v1"] as unknown[];
    expect(Array.isArray(priorMemory)).toBe(true);
    expect(priorMemory).toHaveLength(1);
    expect(priorMemory[0]).toMatchObject({
      workflowRunId: intake.workflowRun.id,
      attemptId: "attempt-1",
      attemptNumber: 1,
    });
  });

  it("AC2: project-memory candidate is written with provenance after the production run", async () => {
    const archiveDir = await createTempDir();
    const intake = await acceptedRun(archiveDir);
    const base = buildBaseInput(archiveDir, intake);

    // Mock calls the real evidence-capturing runHook to produce a non-empty evidenceRefs,
    // which triggers the candidate write on the production code path.
    vi.mocked(driveWorkflowRun).mockImplementationOnce(async (driveInput) => {
      await driveInput.runHook!({
        workflowRunId: driveInput.workflowRunId,
        hookId: "test-hook",
        state: { id: "plan", gates: [], hooks: [] },
        artifacts: {},
      });
      await driveInput.recordStatus?.({ workflowRunId: driveInput.workflowRunId, status: "running" });
      await driveInput.recordStatus?.({ workflowRunId: driveInput.workflowRunId, status: "done" });
      return { status: "done", events: [], roleExecutions: ["planner"], artifacts: {} };
    });

    await driveAcceptedWorkflowRun({ ...base, attemptNumber: 1 });

    // The attempt memory record must exist (the production path wrote it).
    const memoryStore = createWorkflowRunMemoryStore({ archiveDir });
    const priorMemory = await memoryStore.readPriorAttemptMemory({
      workflowRunId: intake.workflowRun.id,
      beforeAttemptNumber: 2,
    });
    expect(priorMemory).toHaveLength(1);
    expect(priorMemory[0]).toMatchObject({ workflowRunId: intake.workflowRun.id, attemptId: "attempt-1" });

    // A project-memory candidate file must exist because evidenceRefs were non-empty.
    const dir = candidatesDir(archiveDir, intake.workflowRun.id);
    const files = await readdir(dir);
    expect(files.length).toBeGreaterThan(0);

    // Read the candidate and verify provenance fields are set.
    const fs = await import("node:fs/promises");
    const raw = await fs.readFile(path.join(dir, files[0]!), "utf8");
    const candidate = JSON.parse(raw) as Record<string, unknown>;
    expect(candidate["workflowRunId"]).toBe(intake.workflowRun.id);
    const provenance = candidate["provenance"] as unknown[];
    expect(Array.isArray(provenance)).toBe(true);
    expect(provenance.length).toBeGreaterThan(0);
    expect((provenance[0] as Record<string, unknown>)["evidenceId"]).toContain("test-hook");
  });

  it("AC3: propose-only candidate is excluded from committed output and written outside docs/", async () => {
    const archiveDir = await createTempDir();
    const intake = await acceptedRun(archiveDir);
    const base = buildBaseInput(archiveDir, intake);

    // Fire a hook to ensure evidenceRefs are non-empty, so the candidate is written.
    vi.mocked(driveWorkflowRun).mockImplementationOnce(async (driveInput) => {
      await driveInput.runHook!({
        workflowRunId: driveInput.workflowRunId,
        hookId: "test-hook",
        state: { id: "plan", gates: [], hooks: [] },
        artifacts: {},
      });
      await driveInput.recordStatus?.({ workflowRunId: driveInput.workflowRunId, status: "running" });
      await driveInput.recordStatus?.({ workflowRunId: driveInput.workflowRunId, status: "done" });
      return { status: "done", events: [], roleExecutions: [], artifacts: {} };
    });

    await driveAcceptedWorkflowRun({ ...base, attemptNumber: 1, projectMemoryMode: "propose_only" });

    const dir = candidatesDir(archiveDir, intake.workflowRun.id);
    const files = await readdir(dir);
    expect(files.length).toBeGreaterThan(0);

    const fs = await import("node:fs/promises");
    const raw = await fs.readFile(path.join(dir, files[0]!), "utf8");
    const candidate = JSON.parse(raw) as Record<string, unknown>;

    // Propose-only candidate must carry the correct exclusion flags.
    expect(candidate["promotionMode"]).toBe("propose_only");
    expect(candidate["commitPolicy"]).toBe("exclude");
    expect(candidate["includeInCommittedOutput"]).toBe(false);

    // Candidate path must be inside memory/project-candidates/, NOT docs/.
    const candidatePath = candidate["path"] as string;
    expect(candidatePath).toContain(path.join("memory", "project-candidates"));
    expect(candidatePath).not.toContain(path.sep + "docs" + path.sep);

    // No docs directory should have been created.
    const docsDir = path.join(archiveDir, "workflow-runs", intake.workflowRun.id, "docs");
    const docsFiles = await readdir(docsDir).catch(() => []);
    expect(docsFiles).toHaveLength(0);
  });
});
