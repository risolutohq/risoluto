import path from "node:path";
import { parseArgs } from "node:util";

import { openWorkflowRun } from "../workflow-run/artifacts.js";
import {
  classifyWorkflowRunWorktreeRetention,
  type WorkflowRunWorkspaceTerminalStatus,
  type WorktreePullRequestState,
} from "../workflow-run/workspace-lifecycle.js";
import { resolveDataDir, requireNonEmpty } from "./cli-helpers.js";

export async function recordWorkspaceLifecycleCommand(argv: string[]): Promise<number> {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      "run-id": { type: "string" },
      "workspace-path": { type: "string" },
      "workspace-key": { type: "string" },
      "repo-url": { type: "string" },
      branch: { type: "string" },
      "data-dir": { type: "string" },
      json: { type: "boolean", default: false },
    },
  });

  const run = await openWorkflowRun(
    { dataDir: resolveDataDir(parsed.values["data-dir"]) },
    { workflowRunId: requireNonEmpty(parsed.values["run-id"], "--run-id"), source: "cli" },
  );
  const recorded = await run.recordWorkspaceLifecycle({
    workspacePath: path.resolve(requireNonEmpty(parsed.values["workspace-path"], "--workspace-path")),
    workspaceKey: requireNonEmpty(parsed.values["workspace-key"], "--workspace-key"),
    repoUrl: requireNonEmpty(parsed.values["repo-url"], "--repo-url"),
    branch: requireNonEmpty(parsed.values.branch, "--branch"),
  });

  if (parsed.values.json) {
    console.log(JSON.stringify(recorded));
  } else {
    console.log(`Recorded workspace lifecycle for ${recorded.lifecycle.workflowRunId}`);
  }
  return 0;
}

export async function recordWorkspaceCleanupCommand(argv: string[]): Promise<number> {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      "run-id": { type: "string" },
      "workspace-path": { type: "string" },
      "workspace-key": { type: "string" },
      result: { type: "string" },
      reason: { type: "string" },
      "data-dir": { type: "string" },
      json: { type: "boolean", default: false },
    },
  });

  const run = await openWorkflowRun(
    { dataDir: resolveDataDir(parsed.values["data-dir"]) },
    { workflowRunId: requireNonEmpty(parsed.values["run-id"], "--run-id"), source: "cli" },
  );
  const recorded = await run.recordWorkspaceCleanup({
    workspacePath: path.resolve(requireNonEmpty(parsed.values["workspace-path"], "--workspace-path")),
    workspaceKey: requireNonEmpty(parsed.values["workspace-key"], "--workspace-key"),
    result: parseWorkspaceCleanupResult(requireNonEmpty(parsed.values.result, "--result")),
    reason: parseWorkspaceCleanupReason(requireNonEmpty(parsed.values.reason, "--reason")),
  });

  if (parsed.values.json) {
    console.log(JSON.stringify(recorded));
  } else {
    console.log(`Recorded workspace cleanup for ${recorded.cleanup.workflowRunId}`);
  }
  return 0;
}

export async function classifyWorkspaceRetentionCommand(argv: string[]): Promise<number> {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      "finished-at": { type: "string" },
      now: { type: "string" },
      "retention-days": { type: "string" },
      "pr-state": { type: "string" },
      "run-status": { type: "string" },
      json: { type: "boolean", default: false },
    },
  });

  const decision = classifyWorkflowRunWorktreeRetention({
    finishedAt: requireNonEmpty(parsed.values["finished-at"], "--finished-at"),
    now: requireNonEmpty(parsed.values.now, "--now"),
    retentionDays: parseRetentionDays(parsed.values["retention-days"]),
    pullRequestState: parsePullRequestState(requireNonEmpty(parsed.values["pr-state"], "--pr-state")),
    runStatus: parseRunStatus(requireNonEmpty(parsed.values["run-status"], "--run-status")),
  });

  if (parsed.values.json) {
    console.log(JSON.stringify({ type: "workflow_run.workspace_retention_classified", decision }));
  } else {
    console.log(`Worktree retention: ${decision.action} (${decision.reason})`);
  }
  return 0;
}

function parseRetentionDays(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return 7;
  }
  const days = Number(value.trim());
  if (!Number.isInteger(days) || days < 0) {
    throw new TypeError("--retention-days must be a non-negative integer");
  }
  return days;
}

function parsePullRequestState(value: string): WorktreePullRequestState {
  if (value === "none" || value === "open" || value === "merged" || value === "closed") {
    return value;
  }
  throw new TypeError("--pr-state must be none, open, merged, or closed");
}

function parseRunStatus(value: string): WorkflowRunWorkspaceTerminalStatus {
  if (value === "done" || value === "blocked" || value === "cancelled" || value === "failed") {
    return value;
  }
  throw new TypeError("--run-status must be done, blocked, cancelled, or failed");
}

function parseWorkspaceCleanupResult(value: string): "removed" | "kept" {
  if (value === "removed" || value === "kept") {
    return value;
  }
  throw new TypeError("--result must be removed or kept");
}

function parseWorkspaceCleanupReason(value: string): "workflow_succeeded" | "workflow_failed" {
  if (value === "workflow_succeeded" || value === "workflow_failed") {
    return value;
  }
  throw new TypeError("--reason must be workflow_succeeded or workflow_failed");
}
