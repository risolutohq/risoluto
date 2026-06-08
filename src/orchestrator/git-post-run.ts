import type { GitPostRunPort } from "../git/port.js";
import type { RepoMatch } from "../git/repo-router.js";
import type { Issue, Workspace } from "../core/types.js";
import { generatePrSummary } from "../git/pr-summary-generator.js";

/**
 * Commit + push the agent's workspace and open a PR.
 *
 * Auto-merge is NOT performed here. The legacy policy-only escape hatch (which requested a merge from the
 * merge policy alone, without operator approval, green CI, the post-publish verifier, or single-use approval
 * nonces) was removed in NIN-272. Auto-merge now flows exclusively through `completeAutoMerge`
 * (src/workflow-run/auto-merge-completion.ts) on the post-run completion path.
 */
export async function executeGitPostRun(
  gitManager: GitPostRunPort,
  workspace: Workspace,
  issue: Issue,
  repoMatch: RepoMatch,
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
  return { pullRequestUrl: pullRequest?.html_url ?? null, summary };
}
