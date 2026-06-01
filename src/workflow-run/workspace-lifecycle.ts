export type WorkspaceDirtyPolicy = "reject" | "auto_stash" | "require_approval";
export type WorktreeRetentionAction = "keep" | "remove";
export type WorktreeRetentionReason = "pull_request_open" | "retention_window_active" | "retention_expired";
export type WorktreePullRequestState = "none" | "open" | "merged" | "closed";
export type WorkflowRunWorkspaceTerminalStatus = "done" | "blocked" | "cancelled" | "failed";

export interface RenderWorkflowRunBranchNameInput {
  readonly template: string;
  readonly workflowDefinitionId: string;
  readonly workflowRunId: string;
  readonly createdAt: string;
  readonly intent: string;
  readonly existingBranches: readonly string[];
  readonly maxLength: number;
}

export interface PrepareWorkflowRunWorktreeInput {
  readonly dirtyPolicy: WorkspaceDirtyPolicy;
  readonly existingCheckoutPath: string;
  readonly hasUncommittedChanges: (checkoutPath: string) => Promise<boolean>;
  readonly createWorktree: () => Promise<void>;
}

export interface WorkflowRunWorktreeRetentionInput {
  readonly finishedAt: string;
  readonly now: string;
  readonly retentionDays: number;
  readonly pullRequestState: WorktreePullRequestState;
  readonly runStatus: WorkflowRunWorkspaceTerminalStatus;
}

export interface WorktreeRetentionDecision {
  readonly action: WorktreeRetentionAction;
  readonly reason: WorktreeRetentionReason;
}

const BRANCH_TOKEN_PATTERN = /\{([^{}]+)\}/g;
const BRANCH_CHAR_PATTERN = /^[a-z0-9./-]$/;
const DEFAULT_SHORT_INTENT_LENGTH = 32;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export class WorkflowRunBranchTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowRunBranchTemplateError";
  }
}

export class WorkflowRunDirtyWorkspaceError extends Error {
  constructor(readonly checkoutPath: string) {
    super(`dirty workspace policy rejected uncommitted changes in ${checkoutPath}`);
    this.name = "WorkflowRunDirtyWorkspaceError";
  }
}

export class WorkflowRunAutoStashNotImplementedError extends Error {
  constructor(readonly checkoutPath: string) {
    super(`auto_stash dirty workspace policy is not yet implemented for ${checkoutPath}`);
    this.name = "WorkflowRunAutoStashNotImplementedError";
  }
}

export function renderWorkflowRunBranchName(input: RenderWorkflowRunBranchNameInput): string {
  assertBranchLength(input.maxLength);
  assertTemplateIsWellFormed(input.template);
  const rendered = input.template.replace(BRANCH_TOKEN_PATTERN, (_match: string, token: string) =>
    renderBranchToken(token, input),
  );
  return withCollisionSuffix(sanitizeBranchText(rendered), input.existingBranches, input.maxLength);
}

export async function prepareWorkflowRunWorktree(input: PrepareWorkflowRunWorktreeInput): Promise<void> {
  const dirty = await input.hasUncommittedChanges(input.existingCheckoutPath);
  if (dirty && input.dirtyPolicy === "reject") {
    throw new WorkflowRunDirtyWorkspaceError(input.existingCheckoutPath);
  }
  if (dirty && input.dirtyPolicy === "require_approval") {
    throw new WorkflowRunDirtyWorkspaceError(input.existingCheckoutPath);
  }
  if (dirty && input.dirtyPolicy === "auto_stash") {
    throw new WorkflowRunAutoStashNotImplementedError(input.existingCheckoutPath);
  }
  await input.createWorktree();
}

export function classifyWorkflowRunWorktreeRetention(
  input: WorkflowRunWorktreeRetentionInput,
): WorktreeRetentionDecision {
  if (input.pullRequestState === "open") {
    return { action: "keep", reason: "pull_request_open" };
  }

  const ageMs = Date.parse(input.now) - Date.parse(input.finishedAt);
  const retentionMs = Math.max(0, input.retentionDays) * MS_PER_DAY;
  if (ageMs <= retentionMs) {
    return { action: "keep", reason: "retention_window_active" };
  }
  return { action: "remove", reason: "retention_expired" };
}

function renderBranchToken(token: string, input: RenderWorkflowRunBranchNameInput): string {
  switch (token) {
    case "workflow":
      return input.workflowDefinitionId;
    case "run-id":
      return input.workflowRunId;
    case "date":
      return input.createdAt.slice(0, 10).replaceAll("-", "");
    case "short-intent":
      return shortIntent(input.intent);
    default:
      throw new WorkflowRunBranchTemplateError(`unsupported branch template token: {${token}}`);
  }
}

function withCollisionSuffix(rawBranchName: string, existingBranches: readonly string[], maxLength: number): string {
  const existing = new Set(existingBranches);
  let suffixNumber = 1;
  let branchName = fitBranchName(rawBranchName, "", maxLength);
  while (existing.has(branchName)) {
    suffixNumber += 1;
    branchName = fitBranchName(rawBranchName, `-${suffixNumber}`, maxLength);
  }
  return branchName;
}

function fitBranchName(rawBranchName: string, suffix: string, maxLength: number): string {
  const baseLength = Math.max(1, maxLength - suffix.length);
  const base = trimBranchSeparators(rawBranchName.slice(0, baseLength));
  return `${base}${suffix}`;
}

function shortIntent(intent: string): string {
  return sanitizeBranchText(intent).slice(0, DEFAULT_SHORT_INTENT_LENGTH) || "intent";
}

function sanitizeBranchText(value: string): string {
  let output = "";
  let previousDash = false;
  for (const char of value.toLowerCase()) {
    const next = BRANCH_CHAR_PATTERN.test(char) ? char : "-";
    if (next === "-" && previousDash) {
      continue;
    }
    output += next;
    previousDash = next === "-";
  }
  return trimBranchSeparators(output).replaceAll("..", ".") || "workflow-run";
}

function trimBranchSeparators(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && isTrimmedBranchChar(value.charAt(start))) {
    start += 1;
  }
  while (end > start && isTrimmedBranchChar(value.charAt(end - 1))) {
    end -= 1;
  }
  return value.slice(start, end);
}

function isTrimmedBranchChar(value: string): boolean {
  return value === "/" || value === "." || value === "-";
}

function assertBranchLength(maxLength: number): void {
  if (!Number.isInteger(maxLength) || maxLength < 16) {
    throw new WorkflowRunBranchTemplateError(`branch maxLength must be an integer >= 16, got ${maxLength}`);
  }
}

function assertTemplateIsWellFormed(template: string): void {
  const stripped = template.replace(BRANCH_TOKEN_PATTERN, "");
  if (stripped.includes("{") || stripped.includes("}")) {
    throw new WorkflowRunBranchTemplateError(`malformed branch template: ${template}`);
  }
  for (const match of template.matchAll(BRANCH_TOKEN_PATTERN)) {
    renderBranchToken(match[1] ?? "", sampleBranchInput(template));
  }
}

function sampleBranchInput(template: string): RenderWorkflowRunBranchNameInput {
  return {
    template,
    workflowDefinitionId: "workflow",
    workflowRunId: "wr_sample",
    createdAt: "1970-01-01T00:00:00.000Z",
    intent: "sample",
    existingBranches: [],
    maxLength: 64,
  };
}
