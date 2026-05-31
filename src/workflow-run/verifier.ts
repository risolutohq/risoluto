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
