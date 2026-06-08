import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

// The real engine needs a resolved definition + role harness; this suite exercises only the
// done-path publish handling, so the driver is stubbed to report a clean "done" run (RIS-260).
vi.mock("../../src/workflow-run/workflow-run-driver.js", () => ({
  driveWorkflowRun: vi.fn(),
}));

import { createWorkflowRunArchive } from "../../src/workflow-run/archive.js";
import { DEFAULT_WORKFLOW_DEFINITION_ID } from "../../src/workflow-run/contracts.js";
import { driveAcceptedWorkflowRun } from "../../src/workflow-run/drive-accepted-run.js";
import { acceptWorkflowRunIntake, type WorkflowRunIntentArtifact } from "../../src/workflow-run/intake-core.js";
import type { ResolvedWorkflowDefinition } from "../../src/workflow-definition/registry.js";
import type { WorkflowRunRoleExecutor } from "../../src/workflow-run/run-role-runner.js";
import { driveWorkflowRun } from "../../src/workflow-run/workflow-run-driver.js";

const VERIFICATION_FIXTURE = {
  version: 1 as const,
  createdAt: "2026-06-08T12:00:00.000Z",
  mode: "single" as const,
  decision: "satisfied" as const,
  summary: "Pre-publish verifier accepted the change.",
  allowedInputs: [] as string[],
  evidenceLinks: [] as string[],
};

const FIXED_TIME = "2026-06-03T12:00:00.000Z";
const tempDirs: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function acceptedRun(): Promise<{
  archiveDir: string;
  workflowRunId: string;
  input: Awaited<ReturnType<typeof buildInput>>;
}> {
  const archiveDir = await mkdtemp(path.join(os.tmpdir(), "risoluto-publish-"));
  tempDirs.push(archiveDir);
  const intake = await acceptWorkflowRunIntake({
    archiveDir,
    source: "api",
    mode: "start",
    title: "publish-before-done proof",
    body: "prove publish ordering",
    externalObject: null,
    rules: [],
    workflowDefinitionId: DEFAULT_WORKFLOW_DEFINITION_ID,
    workspaceKey: "default",
  });
  const input = await buildInput(archiveDir, intake.workflowRun);
  return { archiveDir, workflowRunId: intake.workflowRun.id, input };
}

async function buildInput(
  archiveDir: string,
  workflowRun: Awaited<ReturnType<typeof acceptWorkflowRunIntake>>["workflowRun"],
) {
  return {
    archiveDir,
    definition: {} as ResolvedWorkflowDefinition,
    workflowRun,
    intent: {} as WorkflowRunIntentArtifact,
    runRole: (async () => undefined) as unknown as WorkflowRunRoleExecutor,
    now: () => FIXED_TIME,
  };
}

describe("driveAcceptedWorkflowRun publish-before-done", () => {
  it("moves the run to blocked with a handoff when publishOnDone fails (RIS-260)", async () => {
    const { archiveDir, workflowRunId, input } = await acceptedRun();
    // Reproduce the production executor: it persists "running" then the terminal "done" through the
    // recordStatus the driver wires to the archive. Earlier this suite stubbed driveWorkflowRun with
    // mockResolvedValue, so recordStatus never ran and the archive never reached "done" — which is
    // exactly why the terminal-guard regression slipped through. Drive recordStatus for real here.
    vi.mocked(driveWorkflowRun).mockImplementation(async (driveInput) => {
      await driveInput.recordStatus?.({ workflowRunId: driveInput.workflowRunId, status: "running" });
      await driveInput.recordStatus?.({ workflowRunId: driveInput.workflowRunId, status: "done" });
      return { status: "done", events: [], roleExecutions: ["planner"], artifacts: {} };
    });

    const result = await driveAcceptedWorkflowRun({
      ...input,
      publishOnDone: async () => {
        throw new Error("git push rejected");
      },
    });

    // A publish failure must not leave a terminal "done" run with no PR.
    expect(result.outcome).toBe("blocked");
    expect(result.reason).toContain("PR publish failed");
    expect(result.reason).toContain("git push rejected");

    const archive = createWorkflowRunArchive({ archiveDir });
    const run = await archive.loadWorkflowRun(workflowRunId);
    expect(run.status).toBe("blocked");

    const handoff = await archive.readWorkflowRunArtifact({ workflowRunId, artifactId: "handoff" });
    expect(handoff.data).toMatchObject({ outcome: "blocked" });
  });

  it("marks the run done and threads the PR url when publishOnDone succeeds", async () => {
    const { archiveDir, workflowRunId, input } = await acceptedRun();
    vi.mocked(driveWorkflowRun).mockImplementation(async (driveInput) => {
      await driveInput.recordStatus?.({ workflowRunId: driveInput.workflowRunId, status: "running" });
      await driveInput.recordStatus?.({ workflowRunId: driveInput.workflowRunId, status: "done" });
      return { status: "done", events: [], roleExecutions: ["planner"], artifacts: {} };
    });

    const result = await driveAcceptedWorkflowRun({
      ...input,
      publishOnDone: async () => ({ pullRequestUrl: "https://example.test/pr/7" }),
    });

    expect(result.outcome).toBe("done");
    expect(result.pullRequestUrl).toBe("https://example.test/pr/7");

    // The deferred terminal write still lands: a successful publish finalizes the run as done.
    const archive = createWorkflowRunArchive({ archiveDir });
    const run = await archive.loadWorkflowRun(workflowRunId);
    expect(run.status).toBe("done");
  });

  it("runs the auto-merge completion gate on the done path with the published PR url (NIN-272)", async () => {
    const { input } = await acceptedRun();
    vi.mocked(driveWorkflowRun).mockImplementation(async (driveInput) => {
      await driveInput.recordStatus?.({ workflowRunId: driveInput.workflowRunId, status: "running" });
      await driveInput.recordStatus?.({ workflowRunId: driveInput.workflowRunId, status: "done" });
      return { status: "done", events: [], roleExecutions: ["planner"], artifacts: {} };
    });
    const completeAutoMergeOnDone = vi.fn(async () => {});

    const result = await driveAcceptedWorkflowRun({
      ...input,
      publishOnDone: async () => ({ pullRequestUrl: "https://example.test/pr/7" }),
      completeAutoMergeOnDone,
    });

    expect(result.outcome).toBe("done");
    expect(completeAutoMergeOnDone).toHaveBeenCalledWith({ pullRequestUrl: "https://example.test/pr/7" });
  });

  it("skips the auto-merge completion gate when no PR was published (NIN-272)", async () => {
    const { input } = await acceptedRun();
    vi.mocked(driveWorkflowRun).mockImplementation(async (driveInput) => {
      await driveInput.recordStatus?.({ workflowRunId: driveInput.workflowRunId, status: "running" });
      await driveInput.recordStatus?.({ workflowRunId: driveInput.workflowRunId, status: "done" });
      return { status: "done", events: [], roleExecutions: ["planner"], artifacts: {} };
    });
    const completeAutoMergeOnDone = vi.fn(async () => {});

    await driveAcceptedWorkflowRun({
      ...input,
      publishOnDone: async () => ({ pullRequestUrl: null }),
      completeAutoMergeOnDone,
    });

    expect(completeAutoMergeOnDone).not.toHaveBeenCalled();
  });

  it("completes the run as done with a handoff even when the auto-merge completion gate throws (NIN-272)", async () => {
    const { archiveDir, workflowRunId, input } = await acceptedRun();
    vi.mocked(driveWorkflowRun).mockImplementation(async (driveInput) => {
      await driveInput.recordStatus?.({ workflowRunId: driveInput.workflowRunId, status: "running" });
      await driveInput.recordStatus?.({ workflowRunId: driveInput.workflowRunId, status: "done" });
      return { status: "done", events: [], roleExecutions: ["planner"], artifacts: {} };
    });
    const completeAutoMergeOnDone = vi.fn(async () => {
      throw new Error("auto-merge timed out");
    });

    const result = await driveAcceptedWorkflowRun({
      ...input,
      publishOnDone: async () => ({ pullRequestUrl: "https://example.test/pr/7" }),
      completeAutoMergeOnDone,
    });

    expect(result.outcome).toBe("done");
    expect(completeAutoMergeOnDone).toHaveBeenCalledWith({ pullRequestUrl: "https://example.test/pr/7" });

    const archive = createWorkflowRunArchive({ archiveDir });
    const run = await archive.loadWorkflowRun(workflowRunId);
    expect(run.status).toBe("done");

    const handoff = await archive.readWorkflowRunArtifact({ workflowRunId, artifactId: "handoff" });
    expect(handoff.data).toMatchObject({ outcome: "done" });
  });
});

describe("driveAcceptedWorkflowRun post-publish verifier reconfirm (NIN-103)", () => {
  function buildVerification(workflowRunId: string) {
    return { ...VERIFICATION_FIXTURE, workflowRunId };
  }

  it("AC1: reconfirm runs for ready mode and writes postPublishReconfirm into archived verification", async () => {
    const { archiveDir, workflowRunId, input } = await acceptedRun();
    const archive = createWorkflowRunArchive({ archiveDir });

    vi.mocked(driveWorkflowRun).mockImplementation(async (driveInput) => {
      await driveInput.recordStatus?.({ workflowRunId: driveInput.workflowRunId, status: "running" });
      await driveInput.recordStatus?.({ workflowRunId: driveInput.workflowRunId, status: "done" });
      return {
        status: "done",
        events: [],
        roleExecutions: ["planner"],
        artifacts: {
          "verification.v1": buildVerification(driveInput.workflowRunId),
          "publish_result.v1": { mode: "ready" },
        },
      };
    });

    await driveAcceptedWorkflowRun({
      ...input,
      publishOnDone: async () => ({ pullRequestUrl: "https://example.test/pr/101" }),
    });

    // The archived verification must have been updated with postPublishReconfirm, proving the
    // reconfirm ran on the production path. The specific decision (satisfied vs not_satisfied)
    // is asserted per-scenario in AC2 and AC3; here we only prove the field is present.
    const payload = await archive.readWorkflowRunArtifact({ workflowRunId, artifactId: "verification" });
    expect(payload.data).toMatchObject({
      postPublishReconfirm: {
        required: true,
        prePublishDecision: "satisfied",
      },
    });
  });

  it("AC2: post-publish contradiction is detected — absent CI flips decision to not_satisfied", async () => {
    const { archiveDir, workflowRunId, input } = await acceptedRun();
    const archive = createWorkflowRunArchive({ archiveDir });

    vi.mocked(driveWorkflowRun).mockImplementation(async (driveInput) => {
      await driveInput.recordStatus?.({ workflowRunId: driveInput.workflowRunId, status: "running" });
      await driveInput.recordStatus?.({ workflowRunId: driveInput.workflowRunId, status: "done" });
      return {
        status: "done",
        events: [],
        roleExecutions: ["planner"],
        artifacts: {
          "verification.v1": buildVerification(driveInput.workflowRunId),
          "publish_result.v1": { mode: "ready" },
          // No ci_result.v1 → contradiction
        },
      };
    });

    await driveAcceptedWorkflowRun({
      ...input,
      publishOnDone: async () => ({ pullRequestUrl: "https://example.test/pr/102" }),
    });

    const payload = await archive.readWorkflowRunArtifact({ workflowRunId, artifactId: "verification" });
    expect(payload.data).toMatchObject({
      decision: "not_satisfied",
      postPublishReconfirm: {
        required: true,
        prePublishDecision: "satisfied",
        decision: "not_satisfied",
        contradictedBy: expect.arrayContaining(["ci_result.v1"]),
      },
    });
  });

  it("AC3: clean reconfirm (CI passed) keeps decision satisfied and the run completes as done", async () => {
    const { archiveDir, workflowRunId, input } = await acceptedRun();
    const archive = createWorkflowRunArchive({ archiveDir });

    vi.mocked(driveWorkflowRun).mockImplementation(async (driveInput) => {
      await driveInput.recordStatus?.({ workflowRunId: driveInput.workflowRunId, status: "running" });
      await driveInput.recordStatus?.({ workflowRunId: driveInput.workflowRunId, status: "done" });
      return {
        status: "done",
        events: [],
        roleExecutions: ["planner"],
        artifacts: {
          "verification.v1": buildVerification(driveInput.workflowRunId),
          "publish_result.v1": { mode: "ready" },
          "ci_result.v1": { status: "passed" },
        },
      };
    });

    const result = await driveAcceptedWorkflowRun({
      ...input,
      publishOnDone: async () => ({ pullRequestUrl: "https://example.test/pr/103" }),
    });

    // The run must complete as done when reconfirm finds no contradictions.
    expect(result.outcome).toBe("done");

    const payload = await archive.readWorkflowRunArtifact({ workflowRunId, artifactId: "verification" });
    expect(payload.data).toMatchObject({
      decision: "satisfied",
      postPublishReconfirm: {
        required: true,
        prePublishDecision: "satisfied",
        decision: "satisfied",
        contradictedBy: [],
      },
    });
  });
});
