import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/git/pr-summary-generator.js", () => ({
  generatePrSummary: vi.fn(),
}));

import { executeGitPostRun } from "../../src/orchestrator/git-post-run.js";
import type { Issue, Workspace } from "../../src/core/types.js";
import { generatePrSummary } from "../../src/git/pr-summary-generator.js";
import type { RepoMatch } from "../../src/git/repo-router.js";

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue-1",
    identifier: "MT-42",
    title: "Fix the bug",
    description: null,
    priority: 1,
    state: "In Progress",
    branchName: "mt-42-fix-the-bug",
    url: null,
    labels: [],
    blockedBy: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
    ...overrides,
  };
}

function makeWorkspace(): Workspace {
  return { path: "/tmp/ws/MT-42", workspaceKey: "ws-key", createdNow: true };
}

function makeRepoMatch(overrides: Partial<RepoMatch> = {}): RepoMatch {
  return {
    repoUrl: "https://github.com/org/repo",
    defaultBranch: "main",
    identifierPrefix: "MT",
    label: null,
    githubOwner: "org",
    githubRepo: "repo",
    githubTokenEnv: "GITHUB_TOKEN",
    ...overrides,
  };
}

function makeGitManager(overrides: { pushed?: boolean; prUrl?: string | null } = {}) {
  const { pushed = false, prUrl = null } = overrides;
  return {
    commitAndPush: vi.fn().mockResolvedValue({ pushed, branchName: "mt-42-fix-the-bug" }),
    createPullRequest: vi.fn().mockResolvedValue(prUrl ? { html_url: prUrl } : undefined),
    forcePushIfBranchExists: vi.fn(),
  };
}

describe("executeGitPostRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(generatePrSummary).mockResolvedValue(null);
  });

  it("returns null pullRequestUrl when nothing was pushed and skips summary generation", async () => {
    const gitManager = makeGitManager({ pushed: false });

    const result = await executeGitPostRun(gitManager, makeWorkspace(), makeIssue(), makeRepoMatch());

    expect(result).toEqual({ pullRequestUrl: null, summary: null });
    expect(gitManager.createPullRequest).not.toHaveBeenCalled();
    expect(generatePrSummary).not.toHaveBeenCalled();
  });

  it("passes the generated summary into createPullRequest and returns it", async () => {
    const workspace = makeWorkspace();
    const issue = makeIssue();
    const repoMatch = makeRepoMatch();
    const summary = "- updated the post-run pipeline";
    const gitManager = makeGitManager({ pushed: true, prUrl: "https://github.com/org/repo/pull/99" });
    vi.mocked(generatePrSummary).mockResolvedValue(summary);

    const result = await executeGitPostRun(gitManager, workspace, issue, repoMatch);

    expect(generatePrSummary).toHaveBeenCalledWith(workspace.path, repoMatch.defaultBranch);
    expect(gitManager.createPullRequest).toHaveBeenCalledWith(repoMatch, issue, "mt-42-fix-the-bug", summary, false);
    expect(result).toEqual({ pullRequestUrl: "https://github.com/org/repo/pull/99", summary });
  });

  it("creates the PR as a draft when draft=true", async () => {
    const workspace = makeWorkspace();
    const issue = makeIssue();
    const repoMatch = makeRepoMatch();
    const gitManager = makeGitManager({ pushed: true, prUrl: "https://github.com/org/repo/pull/99" });

    await executeGitPostRun(gitManager, workspace, issue, repoMatch, true);

    expect(gitManager.createPullRequest).toHaveBeenCalledWith(repoMatch, issue, "mt-42-fix-the-bug", null, true);
  });

  it("continues without a summary when summary generation fails", async () => {
    const gitManager = makeGitManager({ pushed: true, prUrl: "https://github.com/org/repo/pull/99" });
    vi.mocked(generatePrSummary).mockRejectedValue(new Error("codex unavailable"));

    const result = await executeGitPostRun(gitManager, makeWorkspace(), makeIssue(), makeRepoMatch());

    expect(gitManager.createPullRequest).toHaveBeenCalledWith(
      makeRepoMatch(),
      makeIssue(),
      "mt-42-fix-the-bug",
      null,
      false,
    );
    expect(result).toEqual({ pullRequestUrl: "https://github.com/org/repo/pull/99", summary: null });
  });

  it("returns null pullRequestUrl when PR response is undefined", async () => {
    const gitManager = makeGitManager({ pushed: true, prUrl: null });

    const result = await executeGitPostRun(gitManager, makeWorkspace(), makeIssue(), makeRepoMatch());

    expect(result).toEqual({ pullRequestUrl: null, summary: null });
  });

  it("passes the exact commit message and token to commitAndPush", async () => {
    const workspace = makeWorkspace();
    const issue = makeIssue();
    const repoMatch = makeRepoMatch();
    const gitManager = makeGitManager({ pushed: false });

    await executeGitPostRun(gitManager, workspace, issue, repoMatch);

    expect(gitManager.commitAndPush).toHaveBeenCalledWith(
      workspace.path,
      "MT-42: Fix the bug",
      undefined,
      "GITHUB_TOKEN",
    );
  });

  it("propagates errors from commitAndPush", async () => {
    const gitManager = makeGitManager();
    gitManager.commitAndPush.mockRejectedValue(new Error("git push failed"));

    await expect(executeGitPostRun(gitManager, makeWorkspace(), makeIssue(), makeRepoMatch())).rejects.toThrow(
      "git push failed",
    );
  });

  it("propagates errors from createPullRequest", async () => {
    const gitManager = makeGitManager({ pushed: true, prUrl: "https://github.com/org/repo/pull/99" });
    gitManager.createPullRequest.mockRejectedValue(new Error("GitHub API error"));

    await expect(executeGitPostRun(gitManager, makeWorkspace(), makeIssue(), makeRepoMatch())).rejects.toThrow(
      "GitHub API error",
    );
  });
});
