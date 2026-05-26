import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  recordWorkflowRunWorkspaceCleanup,
  recordWorkflowRunWorkspaceLifecycle,
} from "../workflow-run/workspace-lifecycle.js";

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

  const recorded = await recordWorkflowRunWorkspaceLifecycle({
    dataDir: resolveDataDir(parsed.values["data-dir"]),
    workflowRunId: requireNonEmpty(parsed.values["run-id"], "--run-id"),
    source: "cli",
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

  const recorded = await recordWorkflowRunWorkspaceCleanup({
    dataDir: resolveDataDir(parsed.values["data-dir"]),
    workflowRunId: requireNonEmpty(parsed.values["run-id"], "--run-id"),
    source: "cli",
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

function resolveDataDir(value: string | undefined): string {
  return path.resolve(value ?? process.env.DATA_DIR ?? path.join(homedir(), ".risoluto"));
}

function requireNonEmpty(value: string | undefined, flag: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new TypeError(`${flag} is required`);
  }
  return trimmed;
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
