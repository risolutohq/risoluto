import path from "node:path";

import type { ServiceConfig, WorkspaceDirtyPolicy } from "../core/types.js";
import { asNumber, asString } from "./coercion.js";
import { resolvePathConfigString } from "./resolvers.js";

const DEFAULT_BRANCH_TEMPLATE = "risoluto/{workflow}/{date}-{short-intent}-{run-id}";

export function deriveWorkspaceConfig(
  workspace: Record<string, unknown>,
  hooks: Record<string, unknown>,
  secretResolver?: (name: string) => string | undefined,
): ServiceConfig["workspace"] {
  const containerRoot = process.env.RISOLUTO_CONTAINER_WORKSPACE_ROOT;
  const defaultWorkspaceRoot = containerRoot || "../risoluto-workspaces";
  const workspaceRoot = resolvePathConfigString(asString(workspace.root, defaultWorkspaceRoot), secretResolver);
  const rawHookTimeoutMs = asNumber(hooks.timeout_ms, 60000);
  const hookTimeoutMs = rawHookTimeoutMs > 0 ? rawHookTimeoutMs : 60000;

  return {
    root: path.resolve(workspaceRoot),
    hooks: {
      afterCreate: asString(hooks.after_create) || null,
      beforeRun: asString(hooks.before_run) || null,
      afterRun: asString(hooks.after_run) || null,
      beforeRemove: asString(hooks.before_remove) || null,
      timeoutMs: hookTimeoutMs,
    },
    strategy: deriveWorkspaceStrategy(workspace.strategy),
    branchPrefix: asString(workspace.branch_prefix, "risoluto/"),
    branchTemplate: asString(workspace.branch_template, DEFAULT_BRANCH_TEMPLATE),
    dirtyPolicy: deriveDirtyPolicy(workspace.dirty_policy),
    worktreeRetentionDays: deriveRetentionDays(workspace.worktree_retention_days),
  };
}

function deriveWorkspaceStrategy(value: unknown): ServiceConfig["workspace"]["strategy"] {
  return asString(value, "directory") === "worktree" ? "worktree" : "directory";
}

function deriveDirtyPolicy(value: unknown): WorkspaceDirtyPolicy {
  const policy = asString(value, "reject");
  if (policy === "auto_stash" || policy === "require_approval") {
    return policy;
  }
  return "reject";
}

function deriveRetentionDays(value: unknown): number {
  const retentionDays = asNumber(value, 7);
  return Number.isInteger(retentionDays) && retentionDays > 0 ? retentionDays : 7;
}
