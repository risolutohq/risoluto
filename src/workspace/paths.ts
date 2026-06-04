import path from "node:path";

const SAFE_PATH_DIRS = new Set(["/usr/local/bin", "/usr/bin", "/bin", "/usr/local/sbin", "/usr/sbin", "/sbin"]);

export function buildSafePath(): string {
  const current = process.env.PATH;
  if (!current) {
    return "/usr/local/bin:/usr/bin:/bin";
  }
  const filtered = current.split(":").filter((dir) => SAFE_PATH_DIRS.has(dir));
  return filtered.length > 0 ? filtered.join(":") : "/usr/local/bin:/usr/bin:/bin";
}

export function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  if (path.isAbsolute(relative)) return false;
  return !relative.split(path.sep).some((segment) => segment === "..");
}

export function sanitizeIdentifier(identifier: string): string {
  const sanitized = identifier.replaceAll(/[^A-Za-z0-9._-]/g, "_");
  // "." and ".." are valid characters but unsafe as standalone path segments.
  return sanitized === "." || sanitized === ".." ? sanitized.replaceAll(".", "_") : sanitized;
}

export interface ResolvedWorkspacePath {
  workspaceKey: string;
  workspacePath: string;
}

export function resolveWorkspacePath(
  workspaceRoot: string,
  issueIdentifier: string,
  workflowRunId?: string,
): ResolvedWorkspacePath {
  const baseKey = sanitizeIdentifier(issueIdentifier);
  // When a Workflow Run id is supplied, key the workspace on it so retries of the same issue get isolated
  // worktrees instead of reusing the prior one. Without it, fall back to the legacy issue-keyed behavior.
  const workspaceKey = workflowRunId ? `${baseKey}_${sanitizeIdentifier(workflowRunId)}` : baseKey;
  // An empty key resolves to the workspace root itself, so a later removal would
  // target the whole root. Reject it (RIS-243).
  if (workspaceKey.length === 0) {
    throw new Error(`workspace key resolved to empty for issue identifier: ${JSON.stringify(issueIdentifier)}`);
  }
  const workspacePath = path.resolve(workspaceRoot, workspaceKey);
  if (workspacePath === path.resolve(workspaceRoot)) {
    throw new Error(`workspace path resolves to the workspace root and was refused: ${workspacePath}`);
  }
  if (!isWithinRoot(workspaceRoot, workspacePath)) {
    throw new Error(`workspace path escaped root: ${workspacePath}`);
  }
  return { workspaceKey, workspacePath };
}
