import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createWorkflowRunEvidenceStore } from "../../src/workflow-run/evidence-store.js";
import { createWorkflowRunMemoryStore } from "../../src/workflow-run/memory-store.js";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "risoluto-workflow-run-memory-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Workflow Run memory store", () => {
  it("lets a retry attempt read prior attempt memory for the same Workflow Run", async () => {
    const dataDir = await createTempDir();
    const store = createWorkflowRunMemoryStore({ dataDir });

    await store.writeAttemptMemory({
      workflowRunId: "wr_memory",
      attemptId: "attempt-1",
      attemptNumber: 1,
      createdAt: "2026-05-31T21:00:00.000Z",
      summary: "Validation failed because lint found an unused import.",
      evidenceRefs: [{ evidenceId: "lint-log", path: "archives/workflow-runs/wr_memory/evidence/raw/lint-log.json" }],
    });
    await store.writeAttemptMemory({
      workflowRunId: "wr_memory",
      attemptId: "attempt-2",
      attemptNumber: 2,
      createdAt: "2026-05-31T21:05:00.000Z",
      summary: "Retry removed the unused import.",
      evidenceRefs: [],
    });
    await store.writeAttemptMemory({
      workflowRunId: "wr_other",
      attemptId: "attempt-1",
      attemptNumber: 1,
      createdAt: "2026-05-31T21:00:00.000Z",
      summary: "Other run memory must not leak.",
      evidenceRefs: [],
    });

    const prior = await store.readPriorAttemptMemory({ workflowRunId: "wr_memory", beforeAttemptNumber: 2 });

    expect(prior).toEqual([
      expect.objectContaining({
        workflowRunId: "wr_memory",
        attemptId: "attempt-1",
        attemptNumber: 1,
        summary: "Validation failed because lint found an unused import.",
      }),
    ]);
  });

  it("creates project-memory candidates with provenance pointing to source evidence", async () => {
    const dataDir = await createTempDir();
    const evidenceStore = createWorkflowRunEvidenceStore({ dataDir });
    const memoryStore = createWorkflowRunMemoryStore({ dataDir });
    const evidence = await evidenceStore.writeEvidence({
      workflowRunId: "wr_memory",
      evidenceId: "review-note",
      kind: "review",
      source: "reviewer",
      createdAt: "2026-05-31T21:10:00.000Z",
      content: "Prefer the CLI workflow-run surface for MVP changes.",
      classifiedFields: [],
    });

    const candidate = await memoryStore.writeProjectMemoryCandidate({
      workflowRunId: "wr_memory",
      candidateId: "cli-surface-guidance",
      createdAt: "2026-05-31T21:11:00.000Z",
      text: "Prefer the CLI workflow-run surface for MVP changes.",
      sourceEvidence: {
        evidenceId: evidence.evidenceId,
        path: evidence.path,
      },
      promotionMode: "propose_only",
    });

    expect(candidate).toMatchObject({
      workflowRunId: "wr_memory",
      candidateId: "cli-surface-guidance",
      visibility: "local_private",
      promotionMode: "propose_only",
      commitPolicy: "exclude",
      includeInCommittedOutput: false,
      provenance: [{ evidenceId: "review-note", path: evidence.path }],
    });
  });

  it("keeps propose-only project memory out of committed repo documentation", async () => {
    const dataDir = await createTempDir();
    const memoryStore = createWorkflowRunMemoryStore({ dataDir });

    const candidate = await memoryStore.writeProjectMemoryCandidate({
      workflowRunId: "wr_memory",
      candidateId: "private-memory",
      createdAt: "2026-05-31T21:12:00.000Z",
      text: "Do not commit this operational memory.",
      sourceEvidence: {
        evidenceId: "operator-note",
        path: "archives/workflow-runs/wr_memory/evidence/raw/operator-note.json",
      },
      promotionMode: "propose_only",
    });

    expect(candidate.path).toContain(`${path.sep}memory${path.sep}project-candidates${path.sep}`);
    expect(candidate.path).not.toContain(`${path.sep}docs${path.sep}`);
    expect(candidate.includeInCommittedOutput).toBe(false);
    await expect(readFile(candidate.path, "utf8")).resolves.toContain('"commitPolicy": "exclude"');
  });
});
