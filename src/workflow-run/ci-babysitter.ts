import { z } from "zod";

const ciProviderSchema = z.enum(["github_actions"]);
const ciCheckStatusSchema = z.enum(["failed", "passed", "pending", "timed_out", "unavailable"]);
const ciFailureClassificationSchema = z.enum(["code_failure", "flaky", "provider_unavailable", "timeout", "unknown"]);
const ciResultStatusSchema = z.enum(["blocked", "failed", "passed", "pending", "rerun_requested"]);
const ciRouteSchema = z.enum(["block_operator", "continue", "rerun_ci", "retry_implementation", "wait_for_ci"]);

const ciCheckResultSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    status: ciCheckStatusSchema,
    classification: ciFailureClassificationSchema,
    logEvidence: z.string().min(1).optional(),
  })
  .strict();

const ciBlockedEvidenceSchema = z
  .object({
    kind: z.enum(["provider_unavailable", "timeout"]),
    checkId: z.string().min(1),
    summary: z.string().min(1),
  })
  .strict();

export const ciResultArtifactSchema = z
  .object({
    version: z.literal(1),
    workflowRunId: z.string().min(1),
    createdAt: z.string().min(1),
    provider: ciProviderSchema,
    status: ciResultStatusSchema,
    route: ciRouteSchema,
    summary: z.string().min(1),
    logSummary: z.string().min(1).nullable(),
    checks: z.array(ciCheckResultSchema),
    blockedEvidence: ciBlockedEvidenceSchema.nullable(),
  })
  .strict();

export type CiResultArtifact = z.infer<typeof ciResultArtifactSchema>;
export type CiCheckResult = z.infer<typeof ciCheckResultSchema>;

export interface EvaluateCiBabysitterInput {
  readonly workflowRunId: string;
  readonly createdAt: string;
  readonly provider: "github_actions";
  readonly retryBudgetRemaining: number;
  readonly rerunsAllowed: boolean;
  readonly checks: readonly CiCheckResult[];
}

export function evaluateCiBabysitter(input: EvaluateCiBabysitterInput): CiResultArtifact {
  // An empty check list must never be read as success — a misconfigured or unavailable CI
  // poller would otherwise fabricate "all CI checks passed". Surface it as blocked with
  // explicit "no checks observed" evidence so an operator investigates (NIN-260).
  if (input.checks.length === 0) {
    return ciResultArtifactSchema.parse(noChecksObservedResult(input));
  }
  const blockingCheck = input.checks.find(isBlockingProviderCheck);
  if (blockingCheck) {
    return ciResultArtifactSchema.parse(blockedCiResult(input, blockingCheck));
  }
  const flakyCheck = input.checks.find((check) => check.status === "failed" && check.classification === "flaky");
  if (flakyCheck && input.rerunsAllowed) {
    return ciResultArtifactSchema.parse(rerunCiResult(input, flakyCheck));
  }
  const codeFailure = input.checks.find(
    (check) => check.status === "failed" && check.classification === "code_failure",
  );
  if (codeFailure) {
    return ciResultArtifactSchema.parse(codeFailureResult(input, codeFailure));
  }
  const failedCheck = input.checks.find((check) => check.status === "failed");
  if (failedCheck) {
    return ciResultArtifactSchema.parse(failedCiResult(input, failedCheck));
  }
  const pendingCheck = input.checks.find((check) => check.status === "pending");
  if (pendingCheck) {
    return ciResultArtifactSchema.parse(pendingCiResult(input, pendingCheck));
  }
  return ciResultArtifactSchema.parse(passedCiResult(input));
}

function blockedCiResult(input: EvaluateCiBabysitterInput, check: CiCheckResult): CiResultArtifact {
  const kind = check.classification === "provider_unavailable" ? "provider_unavailable" : "timeout";
  return {
    version: 1,
    workflowRunId: input.workflowRunId,
    createdAt: input.createdAt,
    provider: input.provider,
    status: "blocked",
    route: "block_operator",
    summary: `${check.name} blocked CI because ${kind}`,
    logSummary: summarizeLogEvidence(check),
    checks: [...input.checks],
    blockedEvidence: { kind, checkId: check.id, summary: check.logEvidence ?? `${check.name} did not complete` },
  };
}

function rerunCiResult(input: EvaluateCiBabysitterInput, check: CiCheckResult): CiResultArtifact {
  return {
    version: 1,
    workflowRunId: input.workflowRunId,
    createdAt: input.createdAt,
    provider: input.provider,
    status: "rerun_requested",
    route: "rerun_ci",
    summary: `${check.name} looks flaky; rerun requested`,
    logSummary: summarizeLogEvidence(check),
    checks: [...input.checks],
    blockedEvidence: null,
  };
}

function codeFailureResult(input: EvaluateCiBabysitterInput, check: CiCheckResult): CiResultArtifact {
  return {
    version: 1,
    workflowRunId: input.workflowRunId,
    createdAt: input.createdAt,
    provider: input.provider,
    status: "failed",
    route: input.retryBudgetRemaining > 0 ? "retry_implementation" : "block_operator",
    summary: `${check.name} failed because code changed behavior`,
    logSummary: summarizeLogEvidence(check),
    checks: [...input.checks],
    blockedEvidence: null,
  };
}

function failedCiResult(input: EvaluateCiBabysitterInput, check: CiCheckResult): CiResultArtifact {
  return {
    version: 1,
    workflowRunId: input.workflowRunId,
    createdAt: input.createdAt,
    provider: input.provider,
    status: "failed",
    route: "block_operator",
    summary: `${check.name} failed with ${check.classification} classification`,
    logSummary: summarizeLogEvidence(check),
    checks: [...input.checks],
    blockedEvidence: null,
  };
}

function pendingCiResult(input: EvaluateCiBabysitterInput, check: CiCheckResult): CiResultArtifact {
  return {
    version: 1,
    workflowRunId: input.workflowRunId,
    createdAt: input.createdAt,
    provider: input.provider,
    status: "pending",
    route: "wait_for_ci",
    summary: `${check.name} is still pending`,
    logSummary: null,
    checks: [...input.checks],
    blockedEvidence: null,
  };
}

function noChecksObservedResult(input: EvaluateCiBabysitterInput): CiResultArtifact {
  return {
    version: 1,
    workflowRunId: input.workflowRunId,
    createdAt: input.createdAt,
    provider: input.provider,
    status: "blocked",
    route: "block_operator",
    summary: "no CI checks were observed",
    logSummary: null,
    checks: [],
    blockedEvidence: {
      kind: "provider_unavailable",
      checkId: "no-checks-observed",
      summary: "no CI checks were observed; the CI provider may be misconfigured or unavailable",
    },
  };
}

function passedCiResult(input: EvaluateCiBabysitterInput): CiResultArtifact {
  return {
    version: 1,
    workflowRunId: input.workflowRunId,
    createdAt: input.createdAt,
    provider: input.provider,
    status: "passed",
    route: "continue",
    summary: "all CI checks passed",
    logSummary: null,
    checks: [...input.checks],
    blockedEvidence: null,
  };
}

function summarizeLogEvidence(check: CiCheckResult): string {
  return check.logEvidence ?? `${check.name} was classified as ${check.classification}`;
}

function isBlockingProviderCheck(check: CiCheckResult): boolean {
  return check.status === "timed_out" || check.status === "unavailable";
}
