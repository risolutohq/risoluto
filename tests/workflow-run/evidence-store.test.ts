import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createWorkflowRunArchive } from "../../src/workflow-run/archive.js";
import { createWorkflowRunEvidenceStore } from "../../src/workflow-run/evidence-store.js";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "risoluto-workflow-run-evidence-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Workflow Run evidence store", () => {
  it("keeps raw secret-classified evidence available while redacting display output", async () => {
    const dataDir = await createTempDir();
    const store = createWorkflowRunEvidenceStore({ dataDir });

    const written = await store.writeEvidence({
      workflowRunId: "wr_evidence_redaction",
      evidenceId: "codex-session",
      kind: "role_transcript",
      source: "codex",
      createdAt: "2026-05-31T20:00:00.000Z",
      content: {
        transcript: "Agent used token=raw-secret-value while debugging.",
        provider: { apiKey: "raw-provider-key" },
      },
      classifiedFields: [{ path: ["provider", "apiKey"], classification: "secret" }],
    });

    const raw = await store.readEvidence({
      workflowRunId: written.workflowRunId,
      evidenceId: written.evidenceId,
    });
    const display = await store.readEvidenceForDisplay({
      workflowRunId: written.workflowRunId,
      evidenceId: written.evidenceId,
    });

    expect(raw.content).toEqual({
      transcript: "Agent used token=raw-secret-value while debugging.",
      provider: { apiKey: "raw-provider-key" },
    });
    expect(display.content).toEqual({
      transcript: "Agent used token=[REDACTED] while debugging.",
      provider: { apiKey: "[REDACTED]" },
    });
    expect(display.redactions).toEqual([{ path: ["provider", "apiKey"], classification: "secret" }]);
    await expect(readFile(written.path, "utf8")).resolves.toContain("raw-provider-key");
  });

  it("stores raw evidence and structured artifacts in separate archive namespaces", async () => {
    const dataDir = await createTempDir();
    const archive = createWorkflowRunArchive({ dataDir });
    const store = createWorkflowRunEvidenceStore({ dataDir });
    const workflowRun = archive.createWorkflowRunRecord({
      title: "Separate evidence from artifacts",
      intent: "Keep typed artifacts and raw evidence in separate namespaces.",
      source: "cli",
      id: () => "wr_evidence_namespace",
      now: () => "2026-05-31T20:05:00.000Z",
    });
    await archive.storeWorkflowRun(workflowRun);

    const artifact = await archive.writeWorkflowRunArtifact({
      workflowRunId: workflowRun.id,
      artifactId: "plan",
      contractId: "plan.v1",
      data: {
        version: 1,
        workflowRunId: workflowRun.id,
        createdAt: "2026-05-31T20:06:00.000Z",
        summary: "Use separate namespaces.",
        steps: [{ id: "step-1", title: "Write evidence", status: "ready", dependsOn: [] }],
      },
    });
    const evidence = await store.writeEvidence({
      workflowRunId: workflowRun.id,
      evidenceId: "validation-log",
      kind: "validation_log",
      source: "pnpm",
      createdAt: "2026-05-31T20:07:00.000Z",
      content: "pnpm test passed",
      classifiedFields: [],
    });

    expect(artifact.path).toContain(`${path.sep}artifacts${path.sep}`);
    expect(evidence.path).toContain(`${path.sep}evidence${path.sep}raw${path.sep}`);
    expect(evidence.path).not.toBe(artifact.path);
  });

  it("marks raw evidence as excluded from committed output by default", async () => {
    const dataDir = await createTempDir();
    const store = createWorkflowRunEvidenceStore({ dataDir });

    const evidence = await store.writeEvidence({
      workflowRunId: "wr_evidence_commit_policy",
      evidenceId: "ci-log",
      kind: "ci_log",
      source: "github_actions",
      createdAt: "2026-05-31T20:10:00.000Z",
      content: "raw CI log with environment details",
      classifiedFields: [],
    });

    expect(evidence.commitPolicy).toBe("exclude");
    expect(evidence.includeInCommittedOutput).toBe(false);
  });
});
