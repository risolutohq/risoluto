import path from "node:path";

import { createLogger } from "../core/logger.js";
import type { Issue, ModelSelection, RisolutoLogger, ServiceConfig, Workspace } from "../core/types.js";
import { createDispatcher } from "../dispatch/factory.js";
import type { RunAttemptDispatcher } from "../dispatch/types.js";
import { GitHubPrClient } from "../git/github-pr-client.js";
import type { GitIntegrationPort } from "../git/port.js";
import { executeGitPostRun } from "../orchestrator/git-post-run.js";
import { NullTrackerToolProvider } from "../tracker/tool-provider.js";
import { PathRegistry } from "../workspace/path-registry.js";
import { WorkspaceManager, type WorkspaceManagerWorktreeDeps } from "../workspace/manager.js";
import type { AutoMergeRequest } from "../workflow-run/auto-merge-completion.js";
import type { MergePolicyEvaluation } from "../workflow-run/run-action-runner.js";
import { createGitHubToolProvider, createRepoRouterProvider } from "./runtime-providers.js";
import {
  buildLiveServiceConfig,
  fetchSandboxDefaultBranch,
  LIVE_GITHUB_TOKEN_ENV,
  LIVE_REPO_LABEL,
  loadLiveDispatchEnv,
  mintGithubInstallationToken,
} from "./run-start-live-config.js";
import { createRunStartTracker } from "./run-start-live-tracker.js";
import { toErrorString } from "../utils/type-guards.js";

/** Inputs the `run start` path supplies to compose a real dispatcher for the live sandbox run. */
export interface ComposeLiveDispatchInput {
  readonly dataDir: string;
  readonly workflowRunId: string;
  readonly intentTitle: string;
  readonly intentBody: string;
  readonly signal: AbortSignal;
  readonly logger?: RisolutoLogger;
}

/** Result of composing the live dispatcher: the pieces `resolveDispatchRole` injects, plus publish + cleanup. */
export interface ComposedLiveDispatch {
  readonly dispatcher: RunAttemptDispatcher;
  readonly workspace: Workspace;
  readonly modelForProfile: (modelProfile: string) => ModelSelection;
  /** Commit + push the agent's worktree and open a DRAFT PR on the sandbox. Run on the done path. */
  readonly publishDraftPr: () => Promise<{ pullRequestUrl: string | null; summary: string | null }>;
  /** Request auto-merge on the published PR via the GitHub GraphQL API (NIN-75). */
  readonly requestAutoMerge: (request: AutoMergeRequest) => Promise<void>;
  /** Evaluate the merge policy against the live workspace diff at publish time (NIN-75). */
  readonly evaluateMergePolicy: (workflowRunId: string) => Promise<MergePolicyEvaluation | null>;
  readonly dispose: () => Promise<void>;
}

/**
 * Compose a real {@link RunAttemptDispatcher} for a live `run start`: synthesize a sandbox-routed config,
 * mint a GitHub App push token, build the agent-runner over a prepared sandbox worktree, and return the
 * pieces the dispatch seam injects. The Workflow Run is synthetic, so a {@link createRunStartTracker} shim
 * keeps the turn loop alive and a {@link NullTrackerToolProvider} gives the agent no tracker tools.
 */
export async function composeLiveDispatch(input: ComposeLiveDispatchInput): Promise<ComposedLiveDispatch> {
  const logger = input.logger ?? createLogger().child({ component: "run-start-live" });
  const env = await loadLiveDispatchEnv();
  const token = await mintGithubInstallationToken(env);
  const defaultBranch = await fetchSandboxDefaultBranch(env, token);
  const liveEnv: NodeJS.ProcessEnv = { ...env, [LIVE_GITHUB_TOKEN_ENV]: token };

  const config = buildLiveServiceConfig(env, input.dataDir, defaultBranch);
  const getConfig = (): ServiceConfig => config;
  const archiveDir = path.join(input.dataDir, "archives");

  const repoRouter = createRepoRouterProvider(getConfig);
  const gitManager = createGitHubToolProvider(getConfig, { env: liveEnv });
  const workspaceManager = new WorkspaceManager(
    getConfig,
    logger.child({ component: "workspace" }),
    buildWorktreeDeps(gitManager, repoRouter),
  );
  const tracker = createRunStartTracker(config.tracker.activeStates[0] ?? "in_progress");
  const dispatcher = createDispatcher(getConfig, {
    tracker,
    trackerToolProvider: new NullTrackerToolProvider(),
    workspaceManager,
    archiveDir,
    pathRegistry: PathRegistry.fromEnv(),
    githubToolClient: gitManager,
    logger: logger.child({ component: "agent-runner" }),
  });

  const prepIssue = buildPrepIssue(input, config.tracker.activeStates[0] ?? "in_progress");
  const workspace = await workspaceManager.ensureWorkspace(input.workflowRunId, prepIssue);
  const repoMatch = repoRouter.matchIssue(prepIssue);
  if (!repoMatch) {
    throw new Error(`no repo route matched the live run issue (label ${LIVE_REPO_LABEL}); check E2E_GITHUB_REPO`);
  }

  const prClient = new GitHubPrClient({ env: liveEnv });

  return {
    dispatcher,
    workspace,
    modelForProfile: () => modelFromConfig(config),
    publishDraftPr: async () => {
      liveEnv[LIVE_GITHUB_TOKEN_ENV] = await mintGithubInstallationToken(env);
      return executeGitPostRun(gitManager, workspace, prepIssue, repoMatch, true);
    },
    requestAutoMerge: (request: AutoMergeRequest) =>
      prClient.requestAutoMerge(
        request.owner,
        request.repo,
        request.pullNumber,
        request.mergeMethod,
        LIVE_GITHUB_TOKEN_ENV,
      ),
    evaluateMergePolicy: (_workflowRunId: string) =>
      evaluateLiveMergePolicy(config, gitManager, workspace.path, repoMatch.defaultBranch),
    dispose: () => removeWorktree(gitManager, workspace, logger),
  };
}

function modelFromConfig(config: ServiceConfig): ModelSelection {
  return { model: config.codex.model, reasoningEffort: config.codex.reasoningEffort, source: "default" };
}

function buildPrepIssue(input: ComposeLiveDispatchInput, activeState: string): Issue {
  return {
    id: input.workflowRunId,
    identifier: input.workflowRunId,
    workflowRunId: input.workflowRunId,
    title: input.intentTitle,
    description: input.intentBody,
    priority: null,
    state: activeState,
    branchName: null,
    url: null,
    labels: [LIVE_REPO_LABEL],
    blockedBy: [],
    createdAt: null,
    updatedAt: null,
  };
}

function buildWorktreeDeps(
  gitManager: GitIntegrationPort,
  repoRouter: ReturnType<typeof createRepoRouterProvider>,
): WorkspaceManagerWorktreeDeps {
  return {
    gitManager: {
      hasUncommittedChanges: (workspaceDir) => gitManager.hasUncommittedChanges(workspaceDir),
      autoCommit: (workspaceDir, message, options) => gitManager.autoCommit(workspaceDir, message, options),
      setupWorktree: (route, baseCloneDir, worktreePath, issue, branchPrefix) =>
        gitManager.setupWorktree(route, baseCloneDir, worktreePath, issue, branchPrefix),
      removeWorktree: (baseCloneDir, worktreePath, force) =>
        gitManager.removeWorktree(baseCloneDir, worktreePath, force),
      pruneWorktrees: (baseCloneDir) => gitManager.pruneWorktrees(baseCloneDir),
      deriveBaseCloneDir: (workspaceRoot, repoUrl) => gitManager.deriveBaseCloneDir(workspaceRoot, repoUrl),
    },
    repoRouter: { matchIssue: (issue) => repoRouter.matchIssue(issue) },
  };
}

async function removeWorktree(
  gitManager: GitIntegrationPort,
  workspace: Workspace,
  logger: RisolutoLogger,
): Promise<void> {
  if (!workspace.gitBaseDir) {
    return;
  }
  try {
    await gitManager.removeWorktree(workspace.gitBaseDir, workspace.path, true);
  } catch (error) {
    logger.warn({ error: toErrorString(error) }, "live worktree cleanup failed");
  }
}

/**
 * Evaluate the merge policy for the live workspace at publish time (NIN-75). Reads the configured
 * `agent.autoMerge` policy, diffs the workspace against the default branch, and returns the verdict.
 * Returns null when the diff is unavailable so the publish policy falls through to the safe default
 * (blocked at merge_policy_not_satisfied) rather than silently promoting a non-compliant change.
 */
async function evaluateLiveMergePolicy(
  config: ServiceConfig,
  gitManager: GitIntegrationPort,
  workspacePath: string,
  defaultBranch: string,
): Promise<MergePolicyEvaluation | null> {
  const { evaluateMergePolicy } = await import("../git/merge-policy.js");
  const policy = config.agent.autoMerge;
  const [changedFiles, diffStats] = await Promise.all([
    gitManager.diffNameOnly(workspacePath, defaultBranch).catch(() => null),
    gitManager.diffShortStat(workspacePath, defaultBranch).catch(() => null),
  ]);
  if (!changedFiles || !diffStats) {
    return null;
  }
  const result = evaluateMergePolicy(policy, changedFiles, diffStats, []);
  return { status: result.allowed ? "passed" : "failed", mergeMethod: policy.mergeMethod };
}
