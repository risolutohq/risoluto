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
import {
  createWorkflowRunWorkspacePreparer,
  type WorkflowRunWorkspaceGitPorts,
} from "../../src/workflow-run/workspace-preparer.js";

const tempDirs: string[] = [];
const FIXED_TIME = "2026-06-01T12:00:00.000Z";

const WORKSPACE_WORKFLOW = `
version: 1
id: workspace-prep
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
actions: [create-worktree]
`;

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeWorkflowFixture(): Promise<string> {
  const workflowDir = await createTempDir("risoluto-workspace-workflows-");
  await mkdir(workflowDir, { recursive: true });
  await writeFile(path.join(workflowDir, "workspace-prep.yaml"), WORKSPACE_WORKFLOW.trimStart(), "utf8");
  return workflowDir;
}

function createDepositingDispatch(archive: WorkflowRunArchive): WorkflowRunRoleDispatch {
  return async (input) => {
    for (const contractId of input.role.produces) {
      await archive.writeWorkflowRunArtifact({
        workflowRunId: input.workflowRunId,
        contractId,
        artifactId: workflowRunArtifactIdForContract(contractId),
        data: {
          version: 1,
          workflowRunId: input.workflowRunId,
          createdAt: FIXED_TIME,
          summary: "Plan.",
          steps: [{ id: "s1", title: "Apply", status: "ready", dependsOn: [] }],
        },
        producer: { type: "role", id: input.role.id },
      });
    }
  };
}

function createFakeGit(options: { dirty: boolean; existingBranches: readonly string[] }): {
  ports: WorkflowRunWorkspaceGitPorts;
  createdBranches: string[];
} {
  const createdBranches: string[] = [];
  const ports: WorkflowRunWorkspaceGitPorts = {
    listExistingBranches: async () => options.existingBranches,
    hasUncommittedChanges: async () => options.dirty,
    createBranchWorktree: async (branchName) => {
      createdBranches.push(branchName);
    },
  };
  return { ports, createdBranches };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("workspace + worktree lifecycle reachable from the CLI (NIN-196)", () => {
  it("renders a sanitized, length-bounded branch with a uniqueness suffix on collision", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const dataDir = await createTempDir("risoluto-workspace-data-");
    const workflowDir = await writeWorkflowFixture();
    const archive = createWorkflowRunArchive({ dataDir });
    const { ports, createdBranches } = createFakeGit({
      dirty: false,
      existingBranches: ["risoluto/workspace-prep/prepare-a-workspace"],
    });
    const prepareWorkspace = createWorkflowRunWorkspacePreparer(
      {
        branchTemplate: "risoluto/{workflow}/{short-intent}",
        dirtyPolicy: "reject",
        checkoutPath: "/tmp/checkout",
        branchMaxLength: 64,
      },
      ports,
    );

    await expect(
      startAndDriveRunCommand(
        [
          "--title",
          "Prepare",
          "--intent",
          "Prepare A Workspace",
          "--data-dir",
          dataDir,
          "--workflow-dir",
          workflowDir,
          "--workflow-definition",
          "workspace-prep",
          "--json",
        ],
        { dispatchRole: createDepositingDispatch(archive), prepareWorkspace, now: () => FIXED_TIME },
      ),
    ).resolves.toBe(0);

    // Lowercased + dash-sanitized intent, and a -2 suffix because the base branch already exists.
    expect(createdBranches).toEqual(["risoluto/workspace-prep/prepare-a-workspace-2"]);
    const runId = (await archive.listWorkflowRuns())[0]?.id ?? "";
    await expect(archive.loadWorkflowRun(runId)).resolves.toMatchObject({ status: "done" });
  });

  it("aborts before creating a worktree when the dirty-workspace policy is reject", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const dataDir = await createTempDir("risoluto-workspace-data-");
    const workflowDir = await writeWorkflowFixture();
    const archive = createWorkflowRunArchive({ dataDir });
    const { ports, createdBranches } = createFakeGit({ dirty: true, existingBranches: [] });
    const prepareWorkspace = createWorkflowRunWorkspacePreparer(
      {
        branchTemplate: "risoluto/{workflow}/{short-intent}",
        dirtyPolicy: "reject",
        checkoutPath: "/tmp/checkout",
        branchMaxLength: 64,
      },
      ports,
    );

    await expect(
      startAndDriveRunCommand(
        [
          "--title",
          "Dirty",
          "--intent",
          "Reject dirty workspace",
          "--data-dir",
          dataDir,
          "--workflow-dir",
          workflowDir,
          "--workflow-definition",
          "workspace-prep",
          "--json",
        ],
        { dispatchRole: createDepositingDispatch(archive), prepareWorkspace, now: () => FIXED_TIME },
      ),
    ).resolves.toBe(0);

    // The reject policy aborts before worktree creation — no branch worktree was created.
    expect(createdBranches).toEqual([]);
    const runId = (await archive.listWorkflowRuns())[0]?.id ?? "";
    await expect(archive.loadWorkflowRun(runId)).resolves.toMatchObject({ status: "blocked" });
    const handoff = await archive.readWorkflowRunArtifact({ workflowRunId: runId, artifactId: "handoff" });
    const data = (handoff as { data: { blockers: Array<{ message: string }> } }).data;
    expect(data.blockers[0]?.message).toMatch(/dirty workspace policy rejected uncommitted changes/);
  });

  it("keeps a worktree with an open PR even after the retention window expires", async () => {
    const stdout: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => {
      stdout.push(line);
    });

    const { main } = await import("../../src/cli/index.js");

    await expect(
      main([
        "workflow-run",
        "workspace",
        "retention",
        "--finished-at",
        "2026-05-01T00:00:00.000Z",
        "--now",
        "2026-06-01T00:00:00.000Z",
        "--retention-days",
        "7",
        "--pr-state",
        "open",
        "--run-status",
        "done",
        "--json",
      ]),
    ).resolves.toBe(0);

    const result = JSON.parse(stdout[0] ?? "{}") as { type: string; decision: { action: string; reason: string } };
    expect(result).toMatchObject({
      type: "workflow_run.workspace_retention_classified",
      decision: { action: "keep", reason: "pull_request_open" },
    });
  });
});
