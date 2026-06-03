import type { LivePreflightConfig } from "../config/live-preflight-config.js";
import { asRecord, asStringOrNull, toErrorString } from "../utils/type-guards.js";
import type { LivePreflightCheck, LivePreflightDeps } from "./contracts.js";
import {
  createGitHubJwt,
  createInstallationToken,
  githubHeaders,
  splitRepo,
  type GitHubRepoRef,
} from "./github-app-auth.js";

export async function checkGitHubAppSandboxLifecycle(
  config: LivePreflightConfig,
  fetchImpl: typeof fetch,
  createJwt: LivePreflightDeps["createGitHubJwt"],
  generatedAt: string,
): Promise<LivePreflightCheck> {
  const token = await createInstallationToken(config, fetchImpl, createJwt ?? createGitHubJwt);
  const repo = splitRepo(config.githubSandboxRepo);
  if (!repo) {
    return failed("E2E_GITHUB_REPO must be owner/repo");
  }

  const branch = `risoluto-live-preflight-${Date.parse(generatedAt)}`;
  const resource: Record<string, string> = { repo: `${repo.owner}/${repo.name}`, branch };
  let branchCreated = false;
  let prCreated = false;
  let prNumber: number | null = null;
  let originalError: unknown = null;
  try {
    const defaultBranch = await fetchDefaultBranch(fetchImpl, token, repo);
    const baseSha = await fetchBranchSha(fetchImpl, token, repo, defaultBranch);
    await createBranch(fetchImpl, token, repo, branch, baseSha);
    branchCreated = true;
    const markerPath = await createMarkerFile(fetchImpl, token, repo, branch, generatedAt);
    resource.markerPath = markerPath;
    const pr = await createDraftPullRequest(fetchImpl, token, repo, branch, defaultBranch);
    prCreated = true;
    prNumber = pr.number;
    resource.prNumber = String(pr.number);
    resource.prUrl = pr.url;
    const comment = await createPullRequestComment(fetchImpl, token, repo, pr.number);
    resource.commentId = String(comment.id);
    return passed("sandbox PR lifecycle succeeded and cleaned up", resource);
  } catch (error) {
    originalError = error;
    return {
      name: "github_app_sandbox_lifecycle",
      status: "failed",
      detail: summarizeError(error),
      resource,
    };
  } finally {
    try {
      if (prCreated && prNumber !== null) {
        await closePullRequest(fetchImpl, token, repo, prNumber);
      }
      if (branchCreated) {
        await deleteBranch(fetchImpl, token, repo, branch);
      }
      resource.cleanup = originalError ? "cleaned_up_on_failure" : "closed_pr_deleted_branch";
    } catch {
      resource.cleanupError = "cleanup_failed";
      if (!originalError) {
        resource.cleanup = "cleanup_failed";
      }
    }
  }
}

async function fetchDefaultBranch(fetchImpl: typeof fetch, token: string, repo: GitHubRepoRef): Promise<string> {
  const response = await fetchImpl(`https://api.github.com/repos/${repo.owner}/${repo.name}`, {
    method: "GET",
    headers: githubHeaders(`Bearer ${token}`),
  });
  const payload = asRecord(await response.json());
  const defaultBranch = asStringOrNull(payload.default_branch);
  if (!response.ok || !defaultBranch) {
    throw new Error(`GitHub sandbox repo metadata returned HTTP ${response.status}`);
  }
  return defaultBranch;
}

async function fetchBranchSha(
  fetchImpl: typeof fetch,
  token: string,
  repo: GitHubRepoRef,
  branch: string,
): Promise<string> {
  const response = await fetchImpl(`https://api.github.com/repos/${repo.owner}/${repo.name}/git/ref/heads/${branch}`, {
    method: "GET",
    headers: githubHeaders(`Bearer ${token}`),
  });
  const payload = asRecord(await response.json());
  const sha = asStringOrNull(asRecord(payload.object).sha);
  if (!response.ok || !sha) {
    throw new Error(`GitHub sandbox base ref returned HTTP ${response.status}`);
  }
  return sha;
}

async function createBranch(
  fetchImpl: typeof fetch,
  token: string,
  repo: GitHubRepoRef,
  branch: string,
  sha: string,
): Promise<void> {
  const response = await fetchImpl(`https://api.github.com/repos/${repo.owner}/${repo.name}/git/refs`, {
    method: "POST",
    headers: githubHeaders(`Bearer ${token}`),
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
  });
  if (!response.ok) {
    throw new Error(`GitHub sandbox branch create returned HTTP ${response.status}`);
  }
}

async function createMarkerFile(
  fetchImpl: typeof fetch,
  token: string,
  repo: GitHubRepoRef,
  branch: string,
  generatedAt: string,
): Promise<string> {
  const runId = String(Date.parse(generatedAt));
  const markerPath = `risoluto-live-preflight/${runId}.txt`;
  const response = await fetchImpl(`https://api.github.com/repos/${repo.owner}/${repo.name}/contents/${markerPath}`, {
    method: "PUT",
    headers: githubHeaders(`Bearer ${token}`),
    body: JSON.stringify({
      branch,
      message: `[Risoluto] live preflight marker ${runId}`,
      content: Buffer.from(`Risoluto GitHub App live preflight ${generatedAt}\n`).toString("base64"),
    }),
  });
  if (!response.ok) {
    throw new Error(`GitHub sandbox marker commit returned HTTP ${response.status}`);
  }
  return markerPath;
}

async function createDraftPullRequest(
  fetchImpl: typeof fetch,
  token: string,
  repo: GitHubRepoRef,
  branch: string,
  defaultBranch: string,
): Promise<{ number: number; url: string }> {
  const response = await fetchImpl(`https://api.github.com/repos/${repo.owner}/${repo.name}/pulls`, {
    method: "POST",
    headers: githubHeaders(`Bearer ${token}`),
    body: JSON.stringify({
      title: "[Risoluto] Live preflight GitHub App sandbox PR",
      head: branch,
      base: defaultBranch,
      body: "Automated GitHub App sandbox lifecycle preflight. Safe to close.",
      draft: true,
    }),
  });
  const payload = asRecord(await response.json());
  const number = Number(payload.number);
  const url = asStringOrNull(payload.html_url);
  if (!response.ok || !Number.isFinite(number) || !url) {
    throw new Error(`GitHub sandbox PR create returned HTTP ${response.status}`);
  }
  return { number, url };
}

async function createPullRequestComment(
  fetchImpl: typeof fetch,
  token: string,
  repo: GitHubRepoRef,
  prNumber: number,
): Promise<{ id: number }> {
  const response = await fetchImpl(
    `https://api.github.com/repos/${repo.owner}/${repo.name}/issues/${prNumber}/comments`,
    {
      method: "POST",
      headers: githubHeaders(`Bearer ${token}`),
      body: JSON.stringify({ body: "Automated comment from Risoluto GitHub App live preflight." }),
    },
  );
  const payload = asRecord(await response.json());
  const id = Number(payload.id);
  if (!response.ok || !Number.isFinite(id)) {
    throw new Error(`GitHub sandbox PR comment returned HTTP ${response.status}`);
  }
  return { id };
}

async function closePullRequest(
  fetchImpl: typeof fetch,
  token: string,
  repo: GitHubRepoRef,
  prNumber: number,
): Promise<void> {
  const response = await fetchImpl(`https://api.github.com/repos/${repo.owner}/${repo.name}/pulls/${prNumber}`, {
    method: "PATCH",
    headers: githubHeaders(`Bearer ${token}`),
    body: JSON.stringify({ state: "closed" }),
  });
  if (!response.ok) {
    throw new Error(`GitHub sandbox PR cleanup returned HTTP ${response.status}`);
  }
}

async function deleteBranch(
  fetchImpl: typeof fetch,
  token: string,
  repo: GitHubRepoRef,
  branch: string,
): Promise<void> {
  const response = await fetchImpl(`https://api.github.com/repos/${repo.owner}/${repo.name}/git/refs/heads/${branch}`, {
    method: "DELETE",
    headers: githubHeaders(`Bearer ${token}`),
  });
  if (!response.ok && response.status !== 204) {
    throw new Error(`GitHub sandbox branch cleanup returned HTTP ${response.status}`);
  }
}

function passed(detail: string, resource: Record<string, string>): LivePreflightCheck {
  return {
    name: "github_app_sandbox_lifecycle",
    status: "passed",
    detail,
    resource,
  };
}

function failed(detail: string): LivePreflightCheck {
  return {
    name: "github_app_sandbox_lifecycle",
    status: "failed",
    detail,
  };
}

function summarizeError(error: unknown): string {
  const message = toErrorString(error);
  return message.replace(/\s+/gu, " ").slice(0, 240) || "unknown live preflight error";
}
