import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createWorkflowRunArchive } from "../../src/workflow-run/archive.js";
import { parseWorkflowRunArtifact } from "../../src/workflow-run/artifact-contracts.js";
import { renderHandoffMarkdown, type HandoffArtifact } from "../../src/workflow-run/handoff-contract.js";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "risoluto-workflow-run-handoff-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("handoff.v1", () => {
  it("emits schema-valid JSON and rendered Markdown for done and blocked runs", async () => {
    const dataDir = await createTempDir();
    const archive = createWorkflowRunArchive({ dataDir });
    const workflowRun = archive.createWorkflowRunRecord({
      title: "Return from AFK",
      intent: "Produce a compact handoff.",
      source: "cli",
      id: () => "wr_handoff",
      now: () => "2026-05-31T22:00:00.000Z",
    });
    await archive.storeWorkflowRun(workflowRun);

    for (const outcome of ["done", "blocked"] as const) {
      const artifact = createHandoffFixture({ workflowRunId: workflowRun.id, outcome });
      const reference = await archive.writeWorkflowRunArtifact({
        workflowRunId: workflowRun.id,
        artifactId: `handoff-${outcome}`,
        contractId: "handoff.v1",
        data: artifact,
      });
      const markdown = renderHandoffMarkdown(artifact);

      expect(parseWorkflowRunArtifact({ contractId: "handoff.v1", data: artifact })).toEqual(artifact);
      expect(reference.contractId).toBe("handoff.v1");
      expect(markdown).toContain("# Workflow Run Handoff");
      expect(markdown).toContain("Recommended next action");
    }
  });

  it("renders artifact and evidence links without embedding raw logs or transcripts", () => {
    const rawLogText = "RAW TRANSCRIPT SHOULD NOT APPEAR";
    const artifact = createHandoffFixture({
      workflowRunId: "wr_handoff_links",
      evidencePath: "archives/workflow-runs/wr_handoff_links/evidence/raw/validation-log.json",
    });

    const markdown = renderHandoffMarkdown(artifact);

    expect(markdown).toContain("artifacts/validation-result.json");
    expect(markdown).toContain("evidence/raw/validation-log.json");
    expect(markdown).not.toContain(rawLogText);
  });

  it("includes skills, budget, validation, attempt memory, output links, and a next action", () => {
    const artifact = createHandoffFixture({ workflowRunId: "wr_handoff_actionable" });

    const markdown = renderHandoffMarkdown(artifact);

    expect(markdown).toContain("skills: risoluto-tdd, v1-check");
    expect(markdown).toContain("elapsed 120000ms, cost $1.2500");
    expect(markdown).toContain("validation: failed");
    expect(markdown).toContain("attempt 1: Build failed before lint.");
    expect(markdown).toContain("branch: feature/wr-handoff");
    expect(markdown).toContain("PR: https://github.com/risolutohq/risoluto/pull/123");
    expect(markdown).toContain("Recommended next action: rerun validation after the fix");
  });

  it("accepts a null budget when no budget policy was injected", () => {
    const artifact = createHandoffFixture({ workflowRunId: "wr_handoff_unbudgeted", budget: null });

    const parsed = parseWorkflowRunArtifact({ contractId: "handoff.v1", data: artifact });
    const markdown = renderHandoffMarkdown(artifact);

    expect(parsed).toEqual(artifact);
    expect(markdown).toContain("budget: unavailable");
  });
});

function createHandoffFixture(input: {
  readonly workflowRunId: string;
  readonly outcome?: "blocked" | "done";
  readonly evidencePath?: string;
  readonly budget?: HandoffArtifact["budget"];
}): HandoffArtifact {
  const validationPath = "archives/workflow-runs/wr_handoff/artifacts/validation-result.json";
  return {
    version: 1,
    workflowRunId: input.workflowRunId,
    createdAt: "2026-05-31T22:05:00.000Z",
    outcome: input.outcome ?? "blocked",
    summary: "Validation found one remaining failure.",
    recommendedNextAction: "rerun validation after the fix",
    suggestedSkills: ["risoluto-tdd", "v1-check"],
    budget:
      input.budget === undefined
        ? { elapsedMs: 120_000, costUsd: 1.25, maxWallClockMs: 7_200_000, maxCostUsd: 10 }
        : input.budget,
    validation: {
      status: "failed",
      artifact: { artifactId: "validation", contractId: "validation_result.v1", path: validationPath },
    },
    attemptMemory: [
      {
        attemptId: "attempt-1",
        attemptNumber: 1,
        summary: "Build failed before lint.",
        evidenceRefs: [{ evidenceId: "validation-log", path: input.evidencePath ?? "archives/evidence/raw/log.json" }],
      },
    ],
    output: { branchName: "feature/wr-handoff", pullRequestUrl: "https://github.com/risolutohq/risoluto/pull/123" },
    blockers: [{ kind: "failed_gate", message: "validation_result.v1 failed", evidence: "validation-log" }],
    artifacts: [
      { artifactId: "validation", contractId: "validation_result.v1", path: "artifacts/validation-result.json" },
    ],
    evidence: [
      {
        evidenceId: "validation-log",
        path: input.evidencePath ?? "archives/evidence/raw/log.json",
        redactions: [{ path: ["stdout"], classification: "secret" }],
      },
    ],
  };
}
