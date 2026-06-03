import { isRecord } from "../utils/type-guards.js";
import { parseWorkflowRunArtifact, WorkflowRunArtifactContractError } from "./artifact-contracts.js";

export type ValidationProfileId = "node-pnpm-standard" | "offline-smoke";
export type ValidationFailureHandling = "collect_all" | "stop_on_first";
export type ValidationCheckStatus = "failed" | "passed";
export type ValidationResultStatus = "failed" | "passed";

export interface ValidationProfileCommand {
  readonly id: string;
  readonly command: string;
}

export interface ValidationProfileCommandInput extends ValidationProfileCommand {
  readonly profileId: ValidationProfileId;
}

export interface ValidationProfileCommandOutput {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

export interface RunValidationProfileInput {
  readonly profileId: ValidationProfileId;
  readonly workflowRunId: string;
  readonly createdAt: string;
  readonly runCommand: (input: ValidationProfileCommandInput) => Promise<ValidationProfileCommandOutput>;
}

export interface ValidationCheckResult extends ValidationProfileCommand, ValidationProfileCommandOutput {
  readonly status: ValidationCheckStatus;
}

export interface ValidationResultArtifact {
  readonly version: 1;
  readonly workflowRunId: string;
  readonly createdAt: string;
  readonly profileId: ValidationProfileId;
  readonly failureHandling: ValidationFailureHandling;
  readonly status: ValidationResultStatus;
  readonly checks: readonly ValidationCheckResult[];
}

export interface ValidationGateFailure {
  readonly status: "failed";
  readonly reason: string;
  readonly evidence: Readonly<Record<string, unknown>>;
}

export type ValidationGateOutcome = { readonly status: "passed" } | ValidationGateFailure;

interface BuiltInValidationProfile {
  readonly id: ValidationProfileId;
  readonly failureHandling: ValidationFailureHandling;
  readonly commands: readonly ValidationProfileCommand[];
}

export class ValidationProfileError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ValidationProfileError";
  }
}

const BUILT_IN_VALIDATION_PROFILES = [
  {
    id: "node-pnpm-standard",
    failureHandling: "stop_on_first",
    commands: [
      { id: "build", command: "pnpm run build" },
      { id: "lint", command: "pnpm run lint" },
      { id: "format", command: "pnpm run format:check" },
      { id: "test", command: "pnpm test" },
      { id: "typecheck", command: "pnpm run typecheck" },
      { id: "typecheck-coverage", command: "pnpm run typecheck:coverage" },
    ],
  },
  {
    id: "offline-smoke",
    failureHandling: "collect_all",
    commands: [
      { id: "build", command: "pnpm run build" },
      { id: "test", command: "pnpm test" },
    ],
  },
] as const satisfies readonly BuiltInValidationProfile[];

export async function runValidationProfile(input: RunValidationProfileInput): Promise<ValidationResultArtifact> {
  const profile = findBuiltInValidationProfile(input.profileId);
  const checks: ValidationCheckResult[] = [];

  for (const command of profile.commands) {
    const output = await input.runCommand({ profileId: profile.id, id: command.id, command: command.command });
    const check = {
      ...command,
      ...output,
      status: output.exitCode === 0 ? "passed" : "failed",
    } satisfies ValidationCheckResult;
    checks.push(check);
    if (profile.failureHandling === "stop_on_first" && check.status === "failed") {
      break;
    }
  }

  return parseValidationGateArtifact({
    version: 1,
    workflowRunId: input.workflowRunId,
    createdAt: input.createdAt,
    profileId: profile.id,
    failureHandling: profile.failureHandling,
    status: checks.every((check) => check.status === "passed") ? "passed" : "failed",
    checks,
  });
}

export function evaluateValidationResultGate(artifact: unknown): ValidationGateOutcome {
  const parsed = parseValidationGateArtifact(artifact);
  if (parsed.status === "passed") {
    return { status: "passed" };
  }
  return {
    status: "failed",
    reason: `validation profile ${parsed.profileId} failed`,
    evidence: { validationResult: parsed },
  };
}

function findBuiltInValidationProfile(profileId: ValidationProfileId): BuiltInValidationProfile {
  const profile = BUILT_IN_VALIDATION_PROFILES.find((candidate) => candidate.id === profileId);
  if (!profile) {
    throw new ValidationProfileError(`unknown validation profile id ${profileId}`);
  }
  return profile;
}

function parseValidationGateArtifact(artifact: unknown): ValidationResultArtifact {
  try {
    return parseValidationResultArtifact(
      parseWorkflowRunArtifact({ contractId: "validation_result.v1", data: artifact }),
    );
  } catch (error) {
    if (error instanceof WorkflowRunArtifactContractError) {
      throw new ValidationProfileError(error.message, { cause: error });
    }
    throw error;
  }
}

function parseValidationResultArtifact(artifact: unknown): ValidationResultArtifact {
  if (!isValidationResultArtifact(artifact)) {
    throw new ValidationProfileError("validation_result.v1 parsed to an unexpected shape");
  }
  return artifact;
}

function isValidationResultArtifact(artifact: unknown): artifact is ValidationResultArtifact {
  if (!isRecord(artifact) || artifact.version !== 1 || !Array.isArray(artifact.checks)) {
    return false;
  }
  const checks: readonly unknown[] = artifact.checks;
  return (
    typeof artifact.workflowRunId === "string" &&
    typeof artifact.createdAt === "string" &&
    isValidationProfileId(artifact.profileId) &&
    isValidationFailureHandling(artifact.failureHandling) &&
    isValidationResultStatus(artifact.status) &&
    checks.every(isValidationCheckResult)
  );
}

function isValidationCheckResult(check: unknown): check is ValidationCheckResult {
  return (
    isRecord(check) &&
    typeof check.id === "string" &&
    typeof check.command === "string" &&
    isValidationCheckStatus(check.status) &&
    typeof check.exitCode === "number" &&
    typeof check.stdout === "string" &&
    typeof check.stderr === "string" &&
    typeof check.durationMs === "number"
  );
}

export function isValidationProfileId(value: unknown): value is ValidationProfileId {
  return value === "node-pnpm-standard" || value === "offline-smoke";
}

function isValidationFailureHandling(value: unknown): value is ValidationFailureHandling {
  return value === "collect_all" || value === "stop_on_first";
}

function isValidationResultStatus(value: unknown): value is ValidationResultStatus {
  return value === "failed" || value === "passed";
}

function isValidationCheckStatus(value: unknown): value is ValidationCheckStatus {
  return value === "failed" || value === "passed";
}
