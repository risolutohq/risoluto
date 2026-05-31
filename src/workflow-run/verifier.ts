export const VERIFIER_ALLOWED_ARTIFACT_IDS = [
  "intent.v1",
  "plan.v1",
  "change_summary.v1",
  "review.v1",
  "validation_result.v1",
  "publish_result.v1",
  "ci_result.v1",
] as const;

export type VerifierAllowedArtifactId = (typeof VERIFIER_ALLOWED_ARTIFACT_IDS)[number];
export type SingleVerifierDecision = "satisfied" | "not_satisfied" | "uncertain";
export type CouncilConsensusTag = "majority" | "split" | "unanimous";

export interface BuildSingleVerifierInput {
  readonly artifacts: Readonly<Record<string, unknown>>;
  readonly diff?: string;
  readonly evidenceLinks: readonly string[];
}

export interface SingleVerifierInput {
  readonly artifacts: Readonly<Partial<Record<VerifierAllowedArtifactId, unknown>>>;
  readonly diff?: string;
  readonly evidenceLinks: readonly string[];
}

export interface CouncilVerifier {
  readonly id: string;
  readonly modelProfile: string;
  readonly lens: string;
}

export type CouncilVerifierResult =
  | { readonly status: "completed"; readonly decision: SingleVerifierDecision; readonly summary: string }
  | { readonly status: "failed"; readonly error: string };

export interface CouncilVerifierRecord extends CouncilVerifier {
  readonly status: CouncilVerifierResult["status"];
  readonly decision?: SingleVerifierDecision;
  readonly summary?: string;
  readonly error?: string;
}

export interface CouncilSynthesizerInput {
  readonly input: SingleVerifierInput;
  readonly completedResults: readonly CouncilVerifierRecord[];
  readonly failedResults: readonly CouncilVerifierRecord[];
}

export interface CouncilSynthesizerResult {
  readonly decision: SingleVerifierDecision;
  readonly summary: string;
}

export interface RunCouncilVerifierInput {
  readonly workflowRunId: string;
  readonly createdAt: string;
  readonly input: SingleVerifierInput;
  readonly councillors: readonly CouncilVerifier[];
  readonly runCouncillor: (input: {
    readonly input: SingleVerifierInput;
    readonly councillor: CouncilVerifier;
  }) => Promise<CouncilVerifierResult>;
  readonly synthesize: (input: CouncilSynthesizerInput) => Promise<CouncilSynthesizerResult>;
}

export type RunCouncilVerifierResult =
  | {
      readonly status: "completed";
      readonly artifact: {
        readonly version: 1;
        readonly workflowRunId: string;
        readonly createdAt: string;
        readonly mode: "council";
        readonly decision: SingleVerifierDecision;
        readonly summary: string;
        readonly allowedInputs: readonly string[];
        readonly evidenceLinks: readonly string[];
        readonly consensus: CouncilConsensusTag;
        readonly councillors: readonly CouncilVerifierRecord[];
      };
    }
  | {
      readonly status: "blocked";
      readonly reason: "all_councillors_failed";
      readonly failedResults: readonly CouncilVerifierRecord[];
    };

export interface RouteSingleVerifierDecisionInput {
  readonly decision: SingleVerifierDecision;
  readonly retryBudgetRemaining: number;
}

export type SingleVerifierRoute =
  | { readonly action: "continue_to_publish"; readonly reason: "verifier_satisfied" }
  | { readonly action: "retry_implementation"; readonly reason: "verifier_not_satisfied" }
  | { readonly action: "wait_for_operator"; readonly reason: "verifier_uncertain" }
  | { readonly action: "block"; readonly reason: "retry_budget_exhausted" };

export interface AssertPublishAllowedByVerificationInput {
  readonly artifacts: Readonly<Record<string, unknown>>;
}

export class VerifierPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VerifierPolicyError";
  }
}

export function buildSingleVerifierInput(input: BuildSingleVerifierInput): SingleVerifierInput {
  const artifacts: Partial<Record<VerifierAllowedArtifactId, unknown>> = {};
  for (const artifactId of VERIFIER_ALLOWED_ARTIFACT_IDS) {
    const artifact = input.artifacts[artifactId];
    if (artifact !== undefined) {
      artifacts[artifactId] = artifact;
    }
  }
  return input.diff
    ? { artifacts, diff: input.diff, evidenceLinks: input.evidenceLinks }
    : { artifacts, evidenceLinks: input.evidenceLinks };
}

export function routeSingleVerifierDecision(input: RouteSingleVerifierDecisionInput): SingleVerifierRoute {
  if (input.decision === "satisfied") {
    return { action: "continue_to_publish", reason: "verifier_satisfied" };
  }
  if (input.decision === "not_satisfied" && input.retryBudgetRemaining > 0) {
    return { action: "retry_implementation", reason: "verifier_not_satisfied" };
  }
  if (input.decision === "uncertain") {
    return { action: "wait_for_operator", reason: "verifier_uncertain" };
  }
  return { action: "block", reason: "retry_budget_exhausted" };
}

export async function runCouncilVerifier(input: RunCouncilVerifierInput): Promise<RunCouncilVerifierResult> {
  const councillorResults = await Promise.all(
    input.councillors.map(async (councillor) =>
      recordCouncilResult(councillor, await input.runCouncillor({ input: input.input, councillor })),
    ),
  );
  const completedResults = councillorResults.filter(hasCouncilDecision);
  const failedResults = councillorResults.filter(isFailedCouncilRecord);
  if (completedResults.length === 0) {
    return { status: "blocked", reason: "all_councillors_failed", failedResults };
  }

  const synthesized = await input.synthesize({ input: input.input, completedResults, failedResults });
  return {
    status: "completed",
    artifact: {
      version: 1,
      workflowRunId: input.workflowRunId,
      createdAt: input.createdAt,
      mode: "council",
      decision: synthesized.decision,
      summary: synthesized.summary,
      allowedInputs: verifierAllowedInputsFor(input.input),
      evidenceLinks: input.input.evidenceLinks,
      consensus: councilConsensusFor(completedResults),
      councillors: councillorResults,
    },
  };
}

export function assertPublishAllowedByVerification(input: AssertPublishAllowedByVerificationInput): void {
  if (!isSatisfiedVerificationArtifact(input.artifacts["verification.v1"])) {
    throw new VerifierPolicyError("publish requires satisfied verification.v1");
  }
}

export function isSatisfiedVerificationArtifact(value: unknown): boolean {
  return isRecord(value) && value.decision === "satisfied";
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordCouncilResult(councillor: CouncilVerifier, result: CouncilVerifierResult): CouncilVerifierRecord {
  if (result.status === "failed") {
    return { ...councillor, status: "failed", error: result.error };
  }
  return { ...councillor, status: "completed", decision: result.decision, summary: result.summary };
}

function hasCouncilDecision(record: CouncilVerifierRecord): record is CouncilVerifierRecord & {
  readonly status: "completed";
  readonly decision: SingleVerifierDecision;
} {
  return record.status === "completed" && record.decision !== undefined;
}

function isFailedCouncilRecord(record: CouncilVerifierRecord): boolean {
  return record.status === "failed";
}

function verifierAllowedInputsFor(input: SingleVerifierInput): readonly string[] {
  const artifactInputs = VERIFIER_ALLOWED_ARTIFACT_IDS.filter(
    (artifactId) => input.artifacts[artifactId] !== undefined,
  );
  return [
    ...artifactInputs,
    ...(input.diff ? ["diff"] : []),
    ...(input.evidenceLinks.length > 0 ? ["evidence_links"] : []),
  ];
}

function councilConsensusFor(
  results: readonly (CouncilVerifierRecord & { readonly decision: SingleVerifierDecision })[],
): CouncilConsensusTag {
  const counts = new Map<SingleVerifierDecision, number>();
  for (const result of results) {
    counts.set(result.decision, (counts.get(result.decision) ?? 0) + 1);
  }
  if (counts.size === 1) {
    return "unanimous";
  }
  return [...counts.values()].some((count) => count > results.length / 2) ? "majority" : "split";
}
