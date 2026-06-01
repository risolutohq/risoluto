export interface IssueBlockerRef {
  id: string | null;
  identifier: string | null;
  state: string | null;
}

export interface Issue {
  id: string;
  identifier: string;
  /**
   * Risoluto-owned Workflow Run id (wr_UUID) this issue projection belongs to, when known. Used to isolate
   * per-run worktrees so a retry on the same issue gets its own workspace. Absent for legacy issue-keyed runs.
   */
  workflowRunId?: string;
  title: string;
  description: string | null;
  priority: number | null;
  state: string;
  branchName: string | null;
  url: string | null;
  labels: string[];
  blockedBy: IssueBlockerRef[];
  createdAt: string | null;
  updatedAt: string | null;
}
