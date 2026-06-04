import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createAcceptedRunDriver } from "../../src/cli/accepted-run-driver.js";
import { createWorkflowRunArchive, type WorkflowRunArchive } from "../../src/workflow-run/archive.js";
import { DEFAULT_WORKFLOW_DEFINITION_ID } from "../../src/workflow-run/contracts.js";
import { acceptWorkflowRunIntake } from "../../src/workflow-run/intake-core.js";
import type { WorkflowRunActionEffects } from "../../src/workflow-run/run-action-runner.js";
import {
  workflowRunArtifactIdForContract,
  type WorkflowRunRoleDispatch,
} from "../../src/workflow-run/run-role-runner.js";
import {
  createWorkflowRunWorkspacePreparer,
  type WorkflowRunWorkspaceGitPorts,
} from "../../src/workflow-run/workspace-preparer.js";
import { createMockLogger } from "../helpers.js";
import {
  changeSummaryArtifact,
  planArtifact,
  reviewArtifact,
  singleVerificationArtifact,
} from "../integration/workflow-first-afk-dogfood-artifacts.js";

const tempDirs: string[] = [];
const FIXED_TIME = "2026-06-02T12:00:00.000Z";

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

// Canned-but-schema-valid role artifacts. ci_result.v1 has no shared builder, so it is inline; the rest
// reuse the dogfood builders (verifier `satisfied`, review `pass`, plan steps `ready`).
function cannedRoleArtifact(contractId: string, workflowRunId: string): Record<string, unknown> {
  switch (contractId) {
    case "plan.v1":
      return planArtifact(workflowRunId);
    case "change_summary.v1":
      return changeSummaryArtifact(workflowRunId);
    case "review.v1":
      return reviewArtifact(workflowRunId);
    case "verification.v1":
      return singleVerificationArtifact(workflowRunId);
    case "ci_result.v1":
      return {
        version: 1,
        workflowRunId,
        createdAt: FIXED_TIME,
        provider: "github_actions",
        status: "passed",
        route: "continue",
        summary: "CI passed.",
        logSummary: null,
        checks: [],
        blockedEvidence: null,
      };
    default:
      throw new Error(`unexpected role artifact ${contractId}`);
  }
}

// Hermetic role boundary: deposit each role's produces artifact via the real D1 protocol the role runner
// reads back and validates — the only non-real seam in the whole drive.
function createScriptedDispatch(archive: WorkflowRunArchive): WorkflowRunRoleDispatch {
  return async (input) => {
    for (const contractId of input.role.produces) {
      await archive.writeWorkflowRunArtifact({
        workflowRunId: input.workflowRunId,
        contractId,
        artifactId: workflowRunArtifactIdForContract(contractId),
        data: cannedRoleArtifact(contractId, input.workflowRunId),
        producer: { type: "role", id: input.role.id },
      });
    }
  };
}

function createFakeGit(): { ports: WorkflowRunWorkspaceGitPorts; createdBranches: string[] } {
  const createdBranches: string[] = [];
  const ports: WorkflowRunWorkspaceGitPorts = {
    listExistingBranches: async () => [],
    hasUncommittedChanges: async () => false,
    createBranchWorktree: async (branchName) => {
      createdBranches.push(branchName);
    },
  };
  return { ports, createdBranches };
}

// Real action effects with hermetic leaves: the REAL workspace preparer (fake git ports), a validation
// command runner that succeeds, and a CI poller returning one passing check (an empty check list is now
// classified blocked, not passed — RIS-260).
function buildActionEffects(): { effects: WorkflowRunActionEffects; createdBranches: string[] } {
  const { ports, createdBranches } = createFakeGit();
  const effects: WorkflowRunActionEffects = {
    prepareWorkspace: createWorkflowRunWorkspacePreparer(
      {
        branchTemplate: "risoluto/{workflow}/{short-intent}",
        dirtyPolicy: "reject",
        checkoutPath: "/tmp/checkout",
        branchMaxLength: 64,
      },
      ports,
    ),
    runValidationCommand: async () => ({ exitCode: 0, stdout: "", stderr: "", durationMs: 1 }),
    pollCi: async () => ({
      checks: [{ id: "build", name: "build", status: "passed", classification: "unknown" }],
      retryBudgetRemaining: 1,
      rerunsAllowed: false,
    }),
  };
  return { effects, createdBranches };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

// Proves the REAL production driver composition — createAcceptedRunDriver -> createWorkflowRunRoleRunner
// (D1 deposit) -> createWorkflowRunActionRunner (real effects) -> driveAcceptedWorkflowRun — walks an
// accepted run through the REAL .risoluto/workflows/single-operator-afk-coder.yaml (plan -> implement ->
// review -> publish + create-worktree/run-validation-profile/publish-pr/poll-ci/write-handoff) to a real
// done handoff. The only fakes are the role dispatch and the effect leaves (git ports / validation /
// CI poll) — exactly the hermetic boundaries the reachability bar allows. Before the write-handoff no-op
// fix in run-action-runner.ts this lands `blocked` at the write-handoff action.
describe("createAcceptedRunDriver done handoff", () => {
  it("drives an accepted run to a real done handoff through the real workflow", async () => {
    const archiveDir = await createTempDir("risoluto-afk-done-");
    const workflowDir = path.resolve(".risoluto", "workflows");
    const archive = createWorkflowRunArchive({ archiveDir });

    const intake = await acceptWorkflowRunIntake({
      archiveDir,
      source: "api",
      mode: "start",
      title: "drive to done proof",
      body: "prove the real driver composition reaches a done handoff",
      externalObject: null,
      rules: [],
      workflowDefinitionId: DEFAULT_WORKFLOW_DEFINITION_ID,
      workspaceKey: "default",
    });
    const workflowRunId = intake.workflowRun.id;

    const { effects, createdBranches } = buildActionEffects();
    const result = await createAcceptedRunDriver({
      archiveDir,
      workflowDir,
      logger: createMockLogger(),
      dispatchRole: createScriptedDispatch(archive),
      actionEffects: effects,
      now: () => FIXED_TIME,
    }).drive(workflowRunId);

    expect(result.outcome).toBe("done");
    expect(result.roleExecutions).toEqual(
      expect.arrayContaining(["planner", "implementer", "reviewer", "verifier", "ci_babysitter"]),
    );
    expect(result.roleExecutions).toHaveLength(5);

    const run = await archive.loadWorkflowRun(workflowRunId);
    expect(run.status).toBe("done");

    const handoff = await archive.readWorkflowRunArtifact({ workflowRunId, artifactId: "handoff" });
    expect(handoff.data).toMatchObject({ version: 1, outcome: "done", blockers: [] });

    // The real run-validation-profile action ran through the injected command runner.
    const validation = await archive.readWorkflowRunArtifact({ workflowRunId, artifactId: "validation_result" });
    expect(validation.data).toMatchObject({ status: "passed", profileId: "node-pnpm-standard" });

    // The real createWorkflowRunWorkspacePreparer was invoked via the create-worktree action.
    expect(createdBranches.length).toBeGreaterThanOrEqual(1);
  }, 30000);
});
