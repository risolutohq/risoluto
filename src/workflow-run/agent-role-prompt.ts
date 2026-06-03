import type { ResolvedWorkflowRole } from "../workflow-definition/registry.js";
import { workflowRunArtifactIdForContract } from "./run-role-runner.js";

export interface BuildAgentRolePromptInput {
  readonly role: ResolvedWorkflowRole;
  readonly workflowRunId: string;
  /** Archive root mounted read-write into the agent container (where D1 artifacts are deposited). */
  readonly archiveRoot: string;
  readonly intentTitle: string;
  readonly intentBody: string;
}

// Concrete JSON shapes the agent must emit for each role-produced contract (the <DATA> half of the file).
const CONTRACT_DATA_SHAPES: ReadonlyMap<string, string> = new Map([
  [
    "plan.v1",
    '{ "version": 1, "workflowRunId": "<run-id>", "createdAt": "<ISO-8601>", "summary": "<one paragraph>", ' +
      '"steps": [ { "id": "s1", "title": "<step>", "status": "ready", "dependsOn": [] } ] }',
  ],
  [
    "change_summary.v1",
    '{ "version": 1, "workflowRunId": "<run-id>", "createdAt": "<ISO-8601>", "summary": "<what changed>", ' +
      '"changedFiles": [ { "path": "<repo-relative>", "changeType": "added|deleted|modified", "summary": "<why>" } ] }',
  ],
  [
    "review.v1",
    '{ "version": 1, "workflowRunId": "<run-id>", "createdAt": "<ISO-8601>", "verdict": "pass|fail|needs_operator", ' +
      '"findings": [ { "severity": "high|medium|low", "summary": "<finding>", "file": "<optional path>" } ] }',
  ],
  [
    "verification.v1",
    '{ "version": 1, "workflowRunId": "<run-id>", "createdAt": "<ISO-8601>", "mode": "single", ' +
      '"decision": "satisfied|not_satisfied|uncertain", "summary": "<judgement>", "allowedInputs": [], "evidenceLinks": [] }',
  ],
]);

const ROLE_GUIDANCE: ReadonlyMap<string, string> = new Map([
  ["planner", "Read the intent and produce an ordered, dependency-aware plan of implementation steps."],
  ["implementer", "Apply the plan by editing files in the workspace, then summarize the diff you produced."],
  ["reviewer", "Review the implemented change against the plan and intent; record findings and an overall verdict."],
  [
    "verifier",
    "Judge whether the change satisfies the intent using only the allowed artifacts; never read the implementer transcript.",
  ],
  ["ci_babysitter", "Watch the remote CI run and classify any failures."],
]);

const PROMPT_INJECTION_PREFIXES = ["System:", "IGNORE", "Assistant:", "USER:", "HUMAN:"];
const MAX_INTENT_TITLE_LENGTH = 200;
const MAX_INTENT_BODY_LENGTH = 2000;

function sanitizeIntentField(value: string, maxLength: number): string {
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed
    .split("\n")
    .filter((line) => !PROMPT_INJECTION_PREFIXES.some((prefix) => line.trimStart().startsWith(prefix)))
    .join("\n");
}

/**
 * Build the prompt that drives one agent role session and instructs the agent to deposit each
 * `role.produces` artifact per the D1 protocol: a JSON file at the canonical archive path whose contents are
 * `{ "contractId": "<id>", "data": <contract data> }`. The archive root is mounted read-write into the
 * container, so files the agent writes there are visible to the host and read back by the role runner.
 */
export function buildAgentRolePrompt(input: BuildAgentRolePromptInput): string {
  const sanitizedTitle = sanitizeIntentField(input.intentTitle, MAX_INTENT_TITLE_LENGTH);
  const sanitizedBody = sanitizeIntentField(input.intentBody, MAX_INTENT_BODY_LENGTH);
  const lines: string[] = [
    `You are the "${input.role.id}" role in an autonomous software workflow run.`,
    ROLE_GUIDANCE.get(input.role.id) ?? `Perform the ${input.role.id} role.`,
    "",
    `Workflow Run id: ${input.workflowRunId}`,
    "--- USER INTENT (untrusted) ---",
    `Title: ${sanitizedTitle}`,
    sanitizedBody,
    "--- END USER INTENT ---",
    "",
    "When your work is complete, deposit each required artifact as a JSON file at EXACTLY the given path.",
    'Each file MUST contain: { "contractId": "<id>", "data": <DATA> }',
  ];
  for (const contractId of input.role.produces) {
    const artifactId = workflowRunArtifactIdForContract(contractId);
    lines.push(
      "",
      `- ${contractId} -> ${input.archiveRoot}/workflow-runs/${input.workflowRunId}/artifacts/${artifactId}.json`,
      `  <DATA> shape: ${CONTRACT_DATA_SHAPES.get(contractId) ?? `match the ${contractId} contract`}`,
    );
  }
  lines.push(
    "",
    "Emit valid JSON only, with every required field present. The run fails if any artifact is missing or malformed.",
  );
  return lines.join("\n");
}
