import { DEFAULT_WORKFLOW_DEFINITION_ID, type WorkflowRunSource } from "./contracts.js";

export interface WorkflowRunIntakeRule {
  readonly id: string;
  readonly provider: WorkflowRunSource;
  readonly requiredLabels?: readonly string[];
  readonly states?: readonly string[];
  readonly workflowDefinitionId?: string | null;
  readonly workspaceKey?: string | null;
  readonly workflowLabels?: Readonly<Record<string, string>>;
  readonly workspaceLabels?: Readonly<Record<string, string>>;
}

export interface WorkflowRunRuleResolutionInput {
  readonly source: WorkflowRunSource;
  readonly labels?: readonly string[];
  readonly state?: string | null;
  readonly rules?: readonly WorkflowRunIntakeRule[];
  readonly workflowDefinitionId?: string;
}

export interface ResolvedWorkflowRunIntake {
  readonly rule: WorkflowRunIntakeRule | null;
  readonly workflowDefinitionId: string;
}

export class AmbiguousWorkflowRunIntakeError extends Error {
  constructor(readonly ruleIds: readonly string[]) {
    super(`ambiguous intake rules matched: ${ruleIds.join(", ")}`);
    this.name = "AmbiguousWorkflowRunIntakeError";
  }
}

export class InvalidWorkflowRunIntakeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidWorkflowRunIntakeError";
  }
}

export function resolveWorkflowRunIntake(input: WorkflowRunRuleResolutionInput): ResolvedWorkflowRunIntake {
  const rules = input.rules ?? [];
  if (rules.length === 0) {
    return { rule: null, workflowDefinitionId: input.workflowDefinitionId ?? DEFAULT_WORKFLOW_DEFINITION_ID };
  }

  const labels = normalizeLabels(input.labels ?? []);
  const matches = rules.filter((rule) => ruleMatches(rule, input, labels));
  if (matches.length > 1) {
    throw new AmbiguousWorkflowRunIntakeError(matches.map((rule) => rule.id));
  }
  const rule = matches[0];
  if (!rule) {
    throw new InvalidWorkflowRunIntakeError(`no intake rule matched ${input.source} intake`);
  }

  const workflowDefinitionId = resolveFromLabels(labels, rule.workflowLabels, rule.workflowDefinitionId, "workflow");
  const workspaceKey = resolveFromLabels(labels, rule.workspaceLabels, rule.workspaceKey, "workspace");
  if (!workflowDefinitionId || !workspaceKey) {
    throw new InvalidWorkflowRunIntakeError(`intake rule ${rule.id} did not resolve workflow and workspace`);
  }
  return { rule, workflowDefinitionId };
}

function ruleMatches(
  rule: WorkflowRunIntakeRule,
  input: WorkflowRunRuleResolutionInput,
  normalizedLabels: ReadonlySet<string>,
): boolean {
  const requiredLabels = normalizeLabels(rule.requiredLabels ?? []);
  const states = normalizeLabels(rule.states ?? []);
  const state = input.state?.trim().toLowerCase() ?? "";
  return (
    rule.provider === input.source &&
    [...requiredLabels].every((label) => normalizedLabels.has(label)) &&
    (states.size === 0 || states.has(state))
  );
}

function resolveFromLabels(
  labels: ReadonlySet<string>,
  candidates: Readonly<Record<string, string>> | undefined,
  fallback: string | null | undefined,
  kind: string,
): string | null | undefined {
  const matches = Object.entries(candidates ?? {}).filter(([label]) => labels.has(label.toLowerCase()));
  if (matches.length > 1) {
    throw new InvalidWorkflowRunIntakeError(`ambiguous ${kind} labels matched: ${matches.map(([label]) => label)}`);
  }
  return matches[0]?.[1] ?? fallback;
}

function normalizeLabels(labels: readonly string[]): ReadonlySet<string> {
  return new Set(labels.map((label) => label.trim().toLowerCase()).filter(Boolean));
}
