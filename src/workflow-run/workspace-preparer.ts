import {
  prepareWorkflowRunWorktree,
  renderWorkflowRunBranchName,
  type WorkspaceDirtyPolicy,
} from "./workspace-lifecycle.js";

/** Static workspace settings the create-worktree action resolves a branch + dirty policy from. */
export interface WorkflowRunWorkspaceConfig {
  readonly branchTemplate: string;
  readonly dirtyPolicy: WorkspaceDirtyPolicy;
  readonly checkoutPath: string;
  readonly branchMaxLength: number;
}

/** Git effect ports — the external boundary (real GitManager vs. test fake). */
export interface WorkflowRunWorkspaceGitPorts {
  readonly listExistingBranches: () => Promise<readonly string[]>;
  readonly hasUncommittedChanges: (checkoutPath: string) => Promise<boolean>;
  readonly createBranchWorktree: (branchName: string) => Promise<void>;
}

export interface WorkflowRunWorkspacePrepareInput {
  readonly workflowRunId: string;
  readonly workflowDefinitionId: string;
  readonly intent: string;
  readonly createdAt: string;
}

export interface WorkflowRunWorkspacePreparation {
  readonly branchName: string;
}

export type WorkflowRunWorkspacePreparer = (
  input: WorkflowRunWorkspacePrepareInput,
) => Promise<WorkflowRunWorkspacePreparation>;

/**
 * Production create-worktree effect: render a unique, sanitized branch name from the workspace template,
 * apply the dirty-workspace policy, then create the worktree on the chosen branch. The branch-naming and
 * dirty-policy logic is the real {@link renderWorkflowRunBranchName} / {@link prepareWorkflowRunWorktree};
 * only the git operations are injected, so production wires GitManager and tests inject a fake.
 */
export function createWorkflowRunWorkspacePreparer(
  config: WorkflowRunWorkspaceConfig,
  git: WorkflowRunWorkspaceGitPorts,
): WorkflowRunWorkspacePreparer {
  return async (input) => {
    const branchName = renderWorkflowRunBranchName({
      template: config.branchTemplate,
      workflowDefinitionId: input.workflowDefinitionId,
      workflowRunId: input.workflowRunId,
      createdAt: input.createdAt,
      intent: input.intent,
      existingBranches: await git.listExistingBranches(),
      maxLength: config.branchMaxLength,
    });
    await prepareWorkflowRunWorktree({
      dirtyPolicy: config.dirtyPolicy,
      existingCheckoutPath: config.checkoutPath,
      hasUncommittedChanges: git.hasUncommittedChanges,
      createWorktree: () => git.createBranchWorktree(branchName),
    });
    return { branchName };
  };
}
