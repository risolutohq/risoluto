/**
 * Git worktree primitives for isolated per-issue worktrees.
 *
 * All functions are stateless — they receive a WorktreeContext
 * with the GitRunner and environment. GitManager delegates to
 * these functions for worktree strategy operations.
 */

import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import path from "node:path";

import type { GitRunner } from "./git-types.js";
import type { RisolutoLogger } from "../core/types.js";
import { assertAllowedRepoUrl } from "./git-validation.js";

export interface WorktreeContext {
  runGit: GitRunner;
  env: NodeJS.ProcessEnv;
  logger: RisolutoLogger;
}

export interface WorktreeEntry {
  path: string;
  branch: string | null;
  bare: boolean;
}

/** Derive a stable filesystem-safe key from a repo URL. */
function sanitizeChar(ch: string): string {
  if (/[\w.-]/.test(ch)) return ch;
  return "-";
}

export function deriveRepoKey(repoUrl: string): string {
  let key = repoUrl.trim();
  if (key.endsWith(".git")) {
    key = key.slice(0, -4);
  }
  let result = "";
  let prevDash = false;
  for (const ch of key) {
    const s = sanitizeChar(ch);
    if (s === "-") {
      if (!prevDash) {
        result += "-";
        prevDash = true;
      }
    } else {
      result += s;
      prevDash = false;
    }
  }
  let start = 0;
  while (start < result.length && result.charAt(start) === "-") {
    start++;
  }
  let end = result.length;
  while (end > start && result.charAt(end - 1) === "-") {
    end--;
  }
  result = result.slice(start, end);
  return result || "repo";
}

/**
 * Per-baseDir lock so concurrent setups of the same repo do not race the clone.
 * Shared across all callers in the process (mirrors the workspace lock pattern).
 */
const baseCloneLocks = new Map<string, Promise<void>>();

async function withBaseCloneLock<T>(baseDir: string, task: () => Promise<T>): Promise<T> {
  const previous = baseCloneLocks.get(baseDir) ?? Promise.resolve();
  let release: (() => void) | undefined;
  const lock = new Promise<void>((resolve) => {
    release = resolve;
  });
  baseCloneLocks.set(baseDir, lock);
  try {
    await previous.catch(() => undefined);
    return await task();
  } finally {
    release?.();
    if (baseCloneLocks.get(baseDir) === lock) {
      baseCloneLocks.delete(baseDir);
    }
  }
}

/**
 * Ensure a bare clone exists at baseDir. Fetches if already present. Concurrent
 * setups of the same repo are serialized by a per-baseDir lock, and a fresh
 * clone is finalized via atomic rename so a half-cloned baseDir is never
 * observed by another worker.
 */
export async function ensureBaseClone(ctx: WorktreeContext, repoUrl: string, baseDir: string): Promise<void> {
  await withBaseCloneLock(baseDir, async () => {
    const { stdout } = await ctx.runGit(["rev-parse", "--git-dir"], { cwd: baseDir, env: ctx.env }).catch(() => ({
      stdout: "",
    }));
    if (stdout.trim().length > 0) {
      // Already a git dir — fetch latest refs.
      await ctx.runGit(["fetch", "origin", "--prune"], { cwd: baseDir, env: ctx.env });
      return;
    }
    assertAllowedRepoUrl(repoUrl);
    // Clone into a temp dir on the same parent, then atomically rename, so a
    // concurrent observer never sees a partially-cloned baseDir.
    const parent = path.dirname(baseDir);
    await mkdir(parent, { recursive: true });
    const tempDir = await mkdtemp(path.join(parent, ".clone-"));
    try {
      await ctx.runGit(["clone", "--bare", "--", repoUrl, tempDir], { cwd: ".", env: ctx.env });
      // Atomic rename replaces the destination directly without a preceding rm,
      // so a concurrent observer never sees a missing baseDir.  On Linux rename(2)
      // atomically replaces an empty directory; if the destination is non-empty the
      // rename fails with ENOTEMPTY, which is caught below and treated as
      // "already cloned by another process".
      await rename(tempDir, baseDir);
    } catch (error) {
      await rm(tempDir, { recursive: true, force: true });
      // If rename failed because another process already cloned the base dir,
      // the rev-parse check on the next invocation will pick it up — treat this
      // as non-fatal.
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOTEMPTY") {
        ctx.logger.warn({ baseDir }, "base clone already populated by another process");
        return;
      }
      throw error;
    }
  });
}

/** Fetch latest refs into the bare clone. Never mutates worktrees. */
export async function syncBaseClone(ctx: WorktreeContext, baseDir: string): Promise<void> {
  await ctx.runGit(["fetch", "origin", "--prune"], { cwd: baseDir, env: ctx.env });
}

/** Create a new worktree with a new branch off startPoint. */
export async function addWorktree(
  ctx: WorktreeContext,
  baseDir: string,
  worktreePath: string,
  branchName: string,
  startPoint: string,
): Promise<void> {
  await ctx.runGit(["worktree", "add", "-b", branchName, worktreePath, startPoint], { cwd: baseDir, env: ctx.env });
}

/** Attach an existing branch to a new worktree (branch already exists in base). */
export async function attachWorktree(
  ctx: WorktreeContext,
  baseDir: string,
  worktreePath: string,
  branchName: string,
): Promise<void> {
  await ctx.runGit(["worktree", "add", worktreePath, branchName], { cwd: baseDir, env: ctx.env });
}

/** Remove a worktree and prune stale metadata. */
export async function removeWorktree(
  ctx: WorktreeContext,
  baseDir: string,
  worktreePath: string,
  force = false,
): Promise<void> {
  const args = ["worktree", "remove"];
  if (force) {
    args.push("--force");
  }
  args.push(worktreePath);
  await ctx.runGit(args, { cwd: baseDir, env: ctx.env });
  await ctx.runGit(["worktree", "prune"], { cwd: baseDir, env: ctx.env });
}

/** Prune stale worktree registrations from a bare clone. */
export async function pruneWorktrees(ctx: WorktreeContext, baseDir: string): Promise<void> {
  await ctx.runGit(["worktree", "prune"], { cwd: baseDir, env: ctx.env });
}

/** List worktrees from a bare clone. */
export async function listWorktrees(ctx: WorktreeContext, baseDir: string): Promise<WorktreeEntry[]> {
  const { stdout } = await ctx.runGit(["worktree", "list", "--porcelain"], { cwd: baseDir, env: ctx.env });
  return parseWorktreeList(stdout);
}

/** Check if a worktree has uncommitted changes. */
export async function isWorktreeClean(ctx: WorktreeContext, worktreePath: string): Promise<boolean> {
  const { stdout } = await ctx.runGit(["status", "--porcelain"], { cwd: worktreePath, env: ctx.env });
  return stdout.trim().length === 0;
}

/**
 * Check if a branch exists in the base clone — locally or as a remote-tracking
 * ref. Checking `refs/remotes/origin/<branch>` makes worktree setup aware of an
 * existing remote PR branch instead of forking a fresh branch from default.
 */
export async function branchExists(ctx: WorktreeContext, baseDir: string, branchName: string): Promise<boolean> {
  for (const ref of [`refs/heads/${branchName}`, `refs/remotes/origin/${branchName}`]) {
    try {
      await ctx.runGit(["rev-parse", "--verify", ref], { cwd: baseDir, env: ctx.env });
      return true;
    } catch {
      // Ref not found under this namespace — try the next one.
    }
  }
  return false;
}

/** Parse `git worktree list --porcelain` output into structured entries. */
function parseWorktreeList(output: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  let current: Partial<WorktreeEntry> = {};

  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current.path) {
        entries.push({ path: current.path, branch: current.branch ?? null, bare: current.bare ?? false });
      }
      current = { path: line.slice("worktree ".length) };
    } else if (line.startsWith("HEAD ")) {
      // skip
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length);
    } else if (line === "bare") {
      current.bare = true;
    } else if (line === "detached") {
      current.branch = null;
    }
  }
  if (current.path) {
    entries.push({ path: current.path, branch: current.branch ?? null, bare: current.bare ?? false });
  }
  return entries;
}
