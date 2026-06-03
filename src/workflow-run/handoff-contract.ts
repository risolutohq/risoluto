import { z } from "zod";

const artifactReferenceSchema = z
  .object({
    artifactId: z.string().min(1),
    contractId: z.string().min(1),
    path: z.string().min(1),
  })
  .strict();

const evidenceReferenceSchema = z
  .object({
    evidenceId: z.string().min(1),
    path: z.string().min(1),
  })
  .strict();

const evidenceRedactionSchema = z
  .object({
    path: z.array(z.string().min(1)).min(1),
    classification: z.enum(["cost", "freeform", "pii", "secret"]),
  })
  .strict();

const handoffEvidenceLinkSchema = evidenceReferenceSchema
  .extend({
    redactions: z.array(evidenceRedactionSchema),
  })
  .strict();

const handoffAttemptMemorySchema = z
  .object({
    attemptId: z.string().min(1),
    attemptNumber: z.number().int().positive(),
    summary: z.string().min(1),
    evidenceRefs: z.array(evidenceReferenceSchema),
  })
  .strict();

const handoffBudgetSchema = z
  .object({
    elapsedMs: z.number().nonnegative(),
    costUsd: z.number().nonnegative(),
    maxWallClockMs: z.number().nonnegative().optional(),
    maxCostUsd: z.number().nonnegative().optional(),
  })
  .strict();

const handoffValidationSchema = z
  .object({
    status: z.enum(["failed", "not_run", "passed"]),
    artifact: artifactReferenceSchema.optional(),
  })
  .strict();

const handoffOutputSchema = z
  .object({
    branchName: z.string().min(1).nullable(),
    pullRequestUrl: z.string().min(1).nullable(),
  })
  .strict();

const handoffBlockerSchema = z
  .object({
    kind: z.enum(["blocking_question", "failed_gate"]),
    message: z.string().min(1),
    evidence: z.string().min(1).optional(),
  })
  .strict();

export const handoffArtifactSchema = z
  .object({
    version: z.literal(1),
    workflowRunId: z.string().min(1),
    createdAt: z.string().min(1),
    outcome: z.enum(["blocked", "done"]),
    summary: z.string().min(1),
    recommendedNextAction: z.string().min(1),
    suggestedSkills: z.array(z.string().min(1)).min(1),
    budget: handoffBudgetSchema.nullable(),
    validation: handoffValidationSchema,
    attemptMemory: z.array(handoffAttemptMemorySchema),
    output: handoffOutputSchema,
    blockers: z.array(handoffBlockerSchema),
    artifacts: z.array(artifactReferenceSchema),
    evidence: z.array(handoffEvidenceLinkSchema),
  })
  .strict();

export type HandoffArtifact = z.infer<typeof handoffArtifactSchema>;

export function renderHandoffMarkdown(artifact: HandoffArtifact): string {
  const parsed = handoffArtifactSchema.parse(artifact);
  const lines = [
    "# Workflow Run Handoff",
    "",
    `Status: ${parsed.outcome}`,
    `Summary: ${parsed.summary}`,
    `Recommended next action: ${parsed.recommendedNextAction}`,
    `skills: ${parsed.suggestedSkills.join(", ")}`,
    `budget: ${formatBudget(parsed.budget)}`,
    `validation: ${formatValidation(parsed.validation)}`,
    ...formatOutput(parsed.output),
    "",
    "## Attempt Memory",
    ...formatAttemptMemory(parsed.attemptMemory),
    "",
    "## Artifacts",
    ...formatArtifacts(parsed.artifacts),
    "",
    "## Evidence",
    ...formatEvidence(parsed.evidence),
    "",
    "## Blockers",
    ...formatBlockers(parsed.blockers),
  ];
  return `${lines.join("\n")}\n`;
}

function formatBudget(budget: HandoffArtifact["budget"]): string {
  if (!budget) {
    return "unavailable";
  }
  const maxWallClock = budget.maxWallClockMs === undefined ? "unbounded" : `${budget.maxWallClockMs}ms`;
  const maxCost = budget.maxCostUsd === undefined ? "unbounded" : `$${budget.maxCostUsd.toFixed(4)}`;
  return `elapsed ${budget.elapsedMs}ms, cost $${budget.costUsd.toFixed(4)}, limits ${maxWallClock} / ${maxCost}`;
}

function formatValidation(validation: HandoffArtifact["validation"]): string {
  if (!validation.artifact) {
    return validation.status;
  }
  return `${validation.status} (${validation.artifact.path})`;
}

function formatOutput(output: HandoffArtifact["output"]): readonly string[] {
  return [
    output.branchName ? `branch: ${output.branchName}` : "branch: none",
    output.pullRequestUrl ? `PR: ${output.pullRequestUrl}` : "PR: none",
  ];
}

function formatAttemptMemory(attemptMemory: HandoffArtifact["attemptMemory"]): readonly string[] {
  if (attemptMemory.length === 0) {
    return ["- none"];
  }
  return attemptMemory.map((memory) => {
    const evidence = memory.evidenceRefs.map((reference) => reference.path).join(", ") || "none";
    return `- attempt ${memory.attemptNumber}: ${memory.summary} evidence: ${evidence}`;
  });
}

function formatArtifacts(artifacts: HandoffArtifact["artifacts"]): readonly string[] {
  if (artifacts.length === 0) {
    return ["- none"];
  }
  return artifacts.map((artifact) => `- ${artifact.contractId} ${artifact.artifactId}: ${artifact.path}`);
}

function formatEvidence(evidence: HandoffArtifact["evidence"]): readonly string[] {
  if (evidence.length === 0) {
    return ["- none"];
  }
  return evidence.map((link) => {
    const redactions = link.redactions.map((redaction) => `${redaction.path.join(".")} ${redaction.classification}`);
    return `- ${link.evidenceId}: ${link.path} redactions: ${redactions.join(", ") || "none"}`;
  });
}

function formatBlockers(blockers: HandoffArtifact["blockers"]): readonly string[] {
  if (blockers.length === 0) {
    return ["- none"];
  }
  return blockers.map((blocker) => {
    const evidence = blocker.evidence ? ` evidence: ${blocker.evidence}` : "";
    return `- ${blocker.kind}: ${blocker.message}${evidence}`;
  });
}
