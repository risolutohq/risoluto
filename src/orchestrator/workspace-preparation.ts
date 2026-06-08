import { createLifecycleEvent, type RuntimeEventSink } from "../core/lifecycle-events.js";
import { toErrorString } from "../utils/type-guards.js";
import type { Issue, ServiceConfig, Workspace } from "../core/types.js";
import type { RepoMatch } from "../git/repo-router.js";
import { resolveWorkspacePath } from "../workspace/paths.js";

interface WorkspacePreparationContext {
  deps: {
    workspaceManager: {
      ensureWorkspace: (issueIdentifier: string, issue?: Issue) => Promise<Workspace>;
    };
    configStore: {
      getConfig: () => ServiceConfig;
    };
    repoRouter?: {
      matchIssue: (issue: Issue) => RepoMatch | null;
    };
    gitManager?: {
      cloneInto: (
        route: RepoMatch,
        workspaceDir: string,
        issue: Pick<Issue, "identifier" | "branchName">,
        branchPrefix?: string,
      ) => Promise<unknown>;
    };
  };
  releaseIssueClaim: (issueId: string) => void;
  pushEvent?: RuntimeEventSink;
}

export async function prepareWorkspaceForLaunch(ctx: WorkspacePreparationContext, issue: Issue): Promise<Workspace> {
  const config = ctx.deps.configStore.getConfig();
  const { workspacePath } = resolveWorkspacePath(config.workspace.root, issue.identifier);
  ctx.pushEvent?.(
    createLifecycleEvent({
      issue,
      event: "workspace_preparing",
      message: "Preparing issue workspace",
      metadata: {
        workspacePath,
        strategy: config.workspace.strategy,
      },
    }),
  );
  try {
    const workspace = await ctx.deps.workspaceManager.ensureWorkspace(issue.identifier, issue);
    if (config.workspace.strategy === "directory") {
      const repoMatch = ctx.deps.repoRouter?.matchIssue(issue) ?? null;
      if (repoMatch && workspace.createdNow && ctx.deps.gitManager) {
        await ctx.deps.gitManager.cloneInto(repoMatch, workspace.path, issue, config.workspace.branchPrefix);
      }
    }
    ctx.pushEvent?.(
      createLifecycleEvent({
        issue,
        event: "workspace_ready",
        message: "Workspace ready",
        metadata: {
          workspacePath: workspace.path,
          workspaceKey: workspace.workspaceKey,
          createdNow: workspace.createdNow,
          strategy: config.workspace.strategy,
        },
      }),
    );
    return workspace;
  } catch (error) {
    ctx.pushEvent?.(
      createLifecycleEvent({
        issue,
        event: "workspace_failed",
        message: "Workspace preparation failed",
        metadata: {
          workspacePath,
          strategy: config.workspace.strategy,
          error: toErrorString(error),
        },
      }),
    );
    // Claim release handled by launchWorker's catch (promiseHandedOff is false here)
    throw error;
  }
}
