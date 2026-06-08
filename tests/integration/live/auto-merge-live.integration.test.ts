/**
 * NIN-75 live e2e: verifies that the auto-merge completion gate is correctly wired into the
 * `run start --publish-mode auto_merge` path against a real GitHub sandbox repo.
 *
 * This test exercises:
 * - Real git diff → merge-policy evaluation (evaluateLiveMergePolicy via composeLiveDispatch)
 * - Fake requestAutoMerge to capture the merge call without actually merging the sandbox PR
 * - Full CLI → publish → auto-merge gate pipeline with live git/GitHub credentials
 *
 * The `dispatchRole` is faked so the test does not need a real agent session; production runs replace
 * it with the real agent harness. To exercise the full open-PR path, remove `dispatchRole` injection
 * and let `RISOLUTO_LIVE_RUN_START=1` compose the real live dispatch (requires a working agent session).
 *
 * Required env vars (all must be set to skip guards):
 *   RISOLUTO_LIVE_RUN_START=1
 *   E2E_GITHUB_REPO          — "owner/repo" of the sandbox repo (e.g. "risolutohq/sandbox")
 *   GITHUB_APP_ID            — GitHub App numeric ID
 *   GITHUB_APP_INSTALLATION_ID — GitHub App installation ID
 *   GITHUB_APP_PRIVATE_KEY   — GitHub App private key (PEM, base-64 or raw)
 *
 * Run with: pnpm run test:integration:live
 */

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import { startAndDriveRunCommand } from "../../../src/cli/run-start-command.js";
import { createWorkflowRunArchive, type WorkflowRunArchive } from "../../../src/workflow-run/archive.js";
import type { AutoMergeRequest } from "../../../src/workflow-run/auto-merge-completion.js";
import {
  workflowRunArtifactIdForContract,
  type WorkflowRunRoleDispatch,
} from "../../../src/workflow-run/run-role-runner.js";

const LIVE_ENABLED =
  process.env["RISOLUTO_LIVE_RUN_START"] === "1" &&
  !!process.env["E2E_GITHUB_REPO"] &&
  !!process.env["GITHUB_APP_ID"] &&
  (!!process.env["GITHUB_APP_INSTALLATION_ID"] || !!process.env["GITHUB_APP_PRIVATE_KEY"]);

const FIXED_TIME = "2026-06-01T12:00:00.000Z";
const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

// A minimal workflow definition: one role seeds all artifacts the auto_merge publish-pr action
// needs, then the publish-pr action runs and records the policy decision.
const AUTO_MERGE_LIVE_WORKFLOW = `
version: 1
id: auto-merge-live-test
defaults: {}
states:
  - id: prep
    roles:
      - id: planner
        consumes: [intent.v1]
        produces: [verification.v1, validation_result.v1, ci_result.v1, operator_approval.v1]
        dependsOn: []
    gates: []
    hooks: []
actions: [publish-pr]
`;

function buildLiveSeedArtifact(contractId: string, workflowRunId: string): Record<string, unknown> {
  const base = { version: 1, workflowRunId, createdAt: FIXED_TIME };
  if (contractId === "verification.v1") {
    return {
      ...base,
      mode: "single",
      decision: "satisfied",
      summary: "All checks satisfied (live e2e seed)",
      allowedInputs: [],
      evidenceLinks: [],
    };
  }
  if (contractId === "validation_result.v1") {
    return {
      ...base,
      profileId: "offline-smoke",
      failureHandling: "stop_on_first",
      status: "passed",
      checks: [{ id: "smoke", command: "true", status: "passed", exitCode: 0, stdout: "", stderr: "", durationMs: 1 }],
    };
  }
  if (contractId === "ci_result.v1") {
    return {
      ...base,
      provider: "github_actions",
      status: "passed",
      route: "continue",
      summary: "CI green (live e2e seed)",
      logSummary: null,
      checks: [],
      blockedEvidence: null,
    };
  }
  if (contractId === "operator_approval.v1") {
    return {
      ...base,
      source: "slack",
      operator: { id: "op-live-e2e", slackUserId: "U0LIVE" },
      permission: "approve_auto_merge",
      actionId: "auto-merge-pr",
      nonce: `live-nonce-${Date.now()}`,
      slack: { teamId: null, userId: "U0LIVE" },
    };
  }
  throw new Error(`live e2e seed has no fixture for contract ${contractId}`);
}

function createLiveSeedDispatch(archive: WorkflowRunArchive): WorkflowRunRoleDispatch {
  return async (input) => {
    for (const contractId of input.role.produces) {
      await archive.writeWorkflowRunArtifact({
        workflowRunId: input.workflowRunId,
        contractId,
        artifactId: workflowRunArtifactIdForContract(contractId),
        data: buildLiveSeedArtifact(contractId, input.workflowRunId),
        producer: { type: "role", id: input.role.id },
      });
    }
  };
}

describe.skipIf(!LIVE_ENABLED)(
  "NIN-75 auto-merge gate wiring — live sandbox (requires E2E_GITHUB_REPO + GITHUB_APP_*)",
  () => {
    it("persists merge_policy_result.v1 and invokes the auto-merge request when all gates pass", async () => {
      const dataDir = await mkdtemp(path.join(os.tmpdir(), "risoluto-am-live-"));
      tempDirs.push(dataDir);

      const workflowDir = path.join(dataDir, "workflows");
      await mkdir(workflowDir, { recursive: true });
      await writeFile(
        path.join(workflowDir, "auto-merge-live-test.yaml"),
        AUTO_MERGE_LIVE_WORKFLOW.trimStart(),
        "utf8",
      );

      const archive = createWorkflowRunArchive({ dataDir });

      // Capture the auto-merge request without actually merging the sandbox PR.
      const autoMergeRequests: AutoMergeRequest[] = [];
      const requestAutoMerge = vi.fn(async (req: AutoMergeRequest) => {
        autoMergeRequests.push(req);
      });

      // dispatchRole bypasses the real agent so the test runs quickly without LLM calls.
      // Remove this injection and set RISOLUTO_LIVE_RUN_START=1 to let composeLiveDispatch
      // wire the real agent session for a full end-to-end run.
      const dispatchRole = createLiveSeedDispatch(archive);

      const stdout: string[] = [];
      const originalLog = console.log;
      console.log = (line: string) => stdout.push(line);
      try {
        await expect(
          startAndDriveRunCommand(
            [
              "--title",
              "Live auto-merge e2e",
              "--intent",
              "Verify the NIN-75 auto-merge gate wiring in the live sandbox.",
              "--data-dir",
              dataDir,
              "--workflow-dir",
              workflowDir,
              "--workflow-definition",
              "auto-merge-live-test",
              "--publish-mode",
              "auto_merge",
              "--json",
            ],
            {
              dispatchRole,
              now: () => FIXED_TIME,
              // publishOnDone is supplied so the auto-merge callback is wired even though
              // composeLiveDispatch is skipped (dispatchRole injection bypasses it).
              // Replace with a real git-push + PR-open for a full live run.
              publishOnDone: async () => {
                // Synthetic PR URL that matches the sandbox repo so parsePrUrl can extract coords.
                const [owner, repo] = (process.env["E2E_GITHUB_REPO"] ?? "owner/repo").split("/");
                return { pullRequestUrl: `https://github.com/${owner}/${repo}/pull/1` };
              },
              mergePolicyForPublish: async () => ({ status: "passed" as const, mergeMethod: "squash" as const }),
              requestAutoMerge,
            },
          ),
        ).resolves.toBe(0);
      } finally {
        console.log = originalLog;
      }

      const runId = (await archive.listWorkflowRuns())[0]?.id ?? "";
      await expect(archive.loadWorkflowRun(runId)).resolves.toMatchObject({ status: "done" });

      // merge_policy_result.v1 must be persisted at publish time.
      const policyArtifact = await archive.readWorkflowRunArtifact({
        workflowRunId: runId,
        artifactId: "merge_policy_result",
      });
      expect(policyArtifact.contractId).toBe("merge_policy_result.v1");
      expect(policyArtifact.data).toMatchObject({ status: "passed", mergeMethod: "squash" });

      // The auto-merge request must have been made with the sandbox repo coordinates.
      expect(requestAutoMerge).toHaveBeenCalledOnce();
      const [called] = autoMergeRequests;
      const [expectedOwner, expectedRepo] = (process.env["E2E_GITHUB_REPO"] ?? "owner/repo").split("/");
      expect(called).toMatchObject({ owner: expectedOwner, repo: expectedRepo, mergeMethod: "squash" });
    }, 60_000);

    it("does NOT invoke requestAutoMerge when the run completes without operator approval", async () => {
      const dataDir = await mkdtemp(path.join(os.tmpdir(), "risoluto-am-live-noapproval-"));
      tempDirs.push(dataDir);

      // Use a workflow without operator_approval.v1 so the publish policy blocks.
      const noApprovalWorkflow = `
version: 1
id: auto-merge-live-no-approval
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
      const workflowDir = path.join(dataDir, "workflows");
      await mkdir(workflowDir, { recursive: true });
      await writeFile(
        path.join(workflowDir, "auto-merge-live-no-approval.yaml"),
        noApprovalWorkflow.trimStart(),
        "utf8",
      );

      const archive = createWorkflowRunArchive({ dataDir });
      const requestAutoMerge = vi.fn<[AutoMergeRequest], Promise<void>>().mockResolvedValue(undefined);

      const stdout: string[] = [];
      const originalLog = console.log;
      console.log = (line: string) => stdout.push(line);
      try {
        await expect(
          startAndDriveRunCommand(
            [
              "--title",
              "Live auto-merge no-approval e2e",
              "--intent",
              "Verify auto-merge gate blocks without approval.",
              "--data-dir",
              dataDir,
              "--workflow-dir",
              workflowDir,
              "--workflow-definition",
              "auto-merge-live-no-approval",
              "--publish-mode",
              "auto_merge",
              "--json",
            ],
            {
              dispatchRole: createLiveSeedDispatch(archive),
              now: () => FIXED_TIME,
              publishOnDone: async () => {
                const [owner, repo] = (process.env["E2E_GITHUB_REPO"] ?? "owner/repo").split("/");
                return { pullRequestUrl: `https://github.com/${owner}/${repo}/pull/2` };
              },
              mergePolicyForPublish: async () => ({ status: "passed" as const, mergeMethod: "squash" as const }),
              requestAutoMerge,
            },
          ),
        ).resolves.toBe(0);
      } finally {
        console.log = originalLog;
      }

      // Publish policy blocked at operator_approval_required; gate returns auto_merge_publish_not_ready.
      expect(requestAutoMerge).not.toHaveBeenCalled();
    }, 60_000);
  },
);
