import type { GitDiffPort, GitPostRunPort } from "../git/port.js";
import type { RepoMatch } from "../git/repo-router.js";
import type { Issue, MergePolicy, RisolutoLogger, Workspace } from "../core/types.js";
import { generatePrSummary } from "../git/pr-summary-generator.js";
import { evaluateMergePolicy } from "../git/merge-policy.js";

/**
 * Minimal interface for the auto-merge client dependency.
 * Keeps `executeGitPostRun` decoupled from the concrete `GitHubPrClient`.
 */
interface AutoMergeClient {
  requestAutoMerge(
    owner: string,
    repo: string,
    pullNumber: number,
    mergeMethod: "squash" | "merge" | "rebase",
    tokenEnvName?: string,
  ): Promise<void>;
}

/**
 * Optional context for the LEGACY auto-merge policy evaluation step.
 *
 * @deprecated This legacy path requests a merge from the merge policy ALONE — it does not enforce operator
 * approval, green CI, the post-publish verifier, or single-use approval nonces that
 * `completeAutoMerge` (src/workflow-run/auto-merge-completion.ts) requires. It is gated off by default and
 * only runs when `RISOLUTO_LEGACY_AUTO_MERGE=enabled`. New callers must route auto-merge through
 * `completeAutoMerge` instead.
 */
export interface AutoMergeContext {
  policy: MergePolicy;
  client: AutoMergeClient;
  logger: RisolutoLogger;
}

/**
 * Extracts the numeric PR number from a GitHub PR HTML URL.
 * Returns `null` when the URL does not contain a `/pull/<number>` segment.
 * Uses plain string operations to avoid sonar slow-regex warnings.
 */
function parsePullNumber(htmlUrl: string): number | null {
  const pullSegment = "/pull/";
  const idx = htmlUrl.lastIndexOf(pullSegment);
  if (idx === -1) return null;
  const tail = htmlUrl.slice(idx + pullSegment.length);
  const parsed = parseInt(tail, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Attempts to request auto-merge for a newly created PR when policy allows it.
 * All failures are logged at warn level and never propagate — auto-merge is best-effort.
 */
async function tryRequestAutoMerge(
  gitManager: GitDiffPort,
  autoMerge: AutoMergeContext,
  pullRequestUrl: string,
  issueIdentifier: string,
  issueLabels: string[],
  workspacePath: string,
  repoMatch: RepoMatch,
): Promise<void> {
  const { policy, client, logger } = autoMerge;

  const [changedFiles, diffStats] = await Promise.all([
    gitManager.diffNameOnly(workspacePath, repoMatch.defaultBranch),
    gitManager.diffShortStat(workspacePath, repoMatch.defaultBranch),
  ]);

  const result = evaluateMergePolicy(policy, changedFiles, diffStats, issueLabels);

  if (!result.allowed) {
    logger.info(
      {
        issue_identifier: issueIdentifier,
        pull_request_url: pullRequestUrl,
        reason: result.reason,
        blocked_files: result.blockedFiles,
      },
      "auto-merge blocked by policy",
    );
    return;
  }

  const pullNumber = parsePullNumber(pullRequestUrl);
  const owner = repoMatch.githubOwner ?? null;
  const repo = repoMatch.githubRepo ?? null;
  if (pullNumber === null || !owner || !repo) return;

  try {
    await client.requestAutoMerge(owner, repo, pullNumber, policy.mergeMethod, repoMatch.githubTokenEnv ?? undefined);
    logger.info(
      { issue_identifier: issueIdentifier, pull_request_url: pullRequestUrl, merge_method: policy.mergeMethod },
      "auto-merge requested",
    );
  } catch (mergeError) {
    logger.warn(
      {
        issue_identifier: issueIdentifier,
        pull_request_url: pullRequestUrl,
        error: mergeError instanceof Error ? mergeError.message : String(mergeError),
      },
      "requestAutoMerge failed (non-fatal — repo may not support auto-merge)",
    );
  }
}

export async function executeGitPostRun(
  gitManager: GitPostRunPort & GitDiffPort,
  workspace: Workspace,
  issue: Issue,
  repoMatch: RepoMatch,
  autoMerge?: AutoMergeContext,
  draft = false,
): Promise<{ pullRequestUrl: string | null; summary: string | null }> {
  const commitResult = await gitManager.commitAndPush(
    workspace.path,
    `${issue.identifier}: ${issue.title}`,
    undefined,
    repoMatch.githubTokenEnv,
  );
  if (!commitResult.pushed) {
    return { pullRequestUrl: null, summary: null };
  }

  // Generate agent-authored summary after commit, before PR creation.
  // Failure is non-fatal — PR creation continues without summary.
  let summary: string | null = null;
  try {
    summary = await generatePrSummary(workspace.path, repoMatch.defaultBranch);
  } catch {
    // Intentionally swallowed — summary is best-effort
  }

  const pullRequest = await gitManager.createPullRequest(repoMatch, issue, commitResult.branchName, summary, draft);
  const pullRequestUrl = pullRequest?.html_url ?? null;

  // ── Auto-merge policy evaluation (LEGACY, gated off — see CR-02) ─────────
  // Only runs when an AutoMergeContext is provided AND the legacy override flag is set. Disabled by default
  // so no caller can reach client.requestAutoMerge without the completeAutoMerge preconditions.
  if (autoMerge && pullRequestUrl) {
    await runGatedLegacyAutoMerge(gitManager, autoMerge, pullRequestUrl, issue, workspace.path, repoMatch);
  }

  return { pullRequestUrl, summary };
}

async function runGatedLegacyAutoMerge(
  gitManager: GitDiffPort,
  autoMerge: AutoMergeContext,
  pullRequestUrl: string,
  issue: Issue,
  workspacePath: string,
  repoMatch: RepoMatch,
): Promise<void> {
  if (process.env.RISOLUTO_LEGACY_AUTO_MERGE !== "enabled") {
    autoMerge.logger.warn(
      { issue_identifier: issue.identifier, pull_request_url: pullRequestUrl },
      "legacy auto-merge is gated off — route through completeAutoMerge (set RISOLUTO_LEGACY_AUTO_MERGE=enabled to override)",
    );
    return;
  }
  try {
    await tryRequestAutoMerge(
      gitManager,
      autoMerge,
      pullRequestUrl,
      issue.identifier,
      issue.labels,
      workspacePath,
      repoMatch,
    );
  } catch (policyError) {
    autoMerge.logger.warn(
      {
        issue_identifier: issue.identifier,
        error: policyError instanceof Error ? policyError.message : String(policyError),
      },
      "auto-merge policy evaluation failed (non-fatal)",
    );
  }
}
