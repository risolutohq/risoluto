import { isRecord, toErrorString } from "../utils/type-guards.js";
import type { WorkflowRunArtifactPayload } from "./archive.js";
import { WorkflowRunRoleDispatchError, type WorkflowRunRoleDispatch } from "./run-role-runner.js";
import type {
  CouncilSynthesizerInput,
  CouncilSynthesizerResult,
  CouncilVerifier,
  CouncilVerifierResult,
  SingleVerifierDecision,
  SingleVerifierInput,
} from "./verifier.js";

/**
 * Dependencies for the council dispatch layer (NIN-76). Binds the generic `dispatchRole` boundary
 * (the same seam every other role session uses) to the council verifier callbacks that
 * `executeWorkflowDefinition` calls when a role has `verifierMode: "council"`.
 *
 * Each councillor runs as a distinct agent session that deposits `council_verifier_decision.v1`
 * into the run archive; the synthesizer deposits `council_synthesizer_decision.v1`. Both are
 * read back and typed before being returned.
 */
export interface CouncilDispatchDeps {
  readonly workflowRunId: string;
  readonly dispatchRole: WorkflowRunRoleDispatch;
  readonly readArtifact: (input: {
    readonly workflowRunId: string;
    readonly artifactId: string;
  }) => Promise<WorkflowRunArtifactPayload>;
}

export interface CouncilDispatch {
  readonly runCouncillor: (input: {
    readonly input: SingleVerifierInput;
    readonly councillor: CouncilVerifier;
  }) => Promise<CouncilVerifierResult>;
  readonly synthesizeCouncil: (input: CouncilSynthesizerInput) => Promise<CouncilSynthesizerResult>;
}

/**
 * Build `runCouncillor` and `synthesizeCouncil` callbacks backed by the production `dispatchRole`
 * boundary. Inject `deps.dispatchRole` with a fake in hermetic tests; production passes the real
 * agent dispatch assembled in `driveWithDeps` / `driveRun`.
 */
export function createCouncilDispatch(deps: CouncilDispatchDeps): CouncilDispatch {
  return {
    runCouncillor: ({ input, councillor }) => runCouncillorSession(deps, input, councillor),
    synthesizeCouncil: (input) => runSynthesizerSession(deps, input),
  };
}

/**
 * Artifact id for a councillor decision: uses the role id (which encodes the councillor id) so
 * multiple councillors running in the same Workflow Run write to distinct archive paths.
 */
function councillorArtifactId(councillorId: string): string {
  return `council-decision-${councillorId}`;
}

/**
 * Dispatch one councillor agent session via `dispatchRole`. The session deposits
 * `council_verifier_decision.v1` at `council-decision-{councillor.id}` in the run archive;
 * this function reads and parses it. On any failure, returns a `failed` result so the council
 * can continue with the remaining councillors rather than aborting the run.
 */
async function runCouncillorSession(
  deps: CouncilDispatchDeps,
  input: SingleVerifierInput,
  councillor: CouncilVerifier,
): Promise<CouncilVerifierResult> {
  const artifactId = councillorArtifactId(councillor.id);
  try {
    await deps.dispatchRole({
      workflowRunId: deps.workflowRunId,
      role: {
        id: artifactId,
        stateId: "council-verification",
        modelProfile: councillor.modelProfile,
        consumes: [],
        produces: ["council_verifier_decision.v1"],
        dependsOn: [],
      },
      artifacts: flattenSingleVerifierInput(input),
    });
    const payload = await deps.readArtifact({ workflowRunId: deps.workflowRunId, artifactId });
    return parseCouncilVerifierDecision(payload.data);
  } catch (error) {
    return { status: "failed", error: toErrorString(error) };
  }
}

/**
 * Dispatch the council synthesizer agent session via `dispatchRole`. The session deposits
 * `council_synthesizer_decision.v1` at `council-synthesis` in the run archive. Failures
 * propagate as `WorkflowRunRoleDispatchError` so `driveAcceptedWorkflowRun` records an
 * honest blocked handoff.
 */
async function runSynthesizerSession(
  deps: CouncilDispatchDeps,
  input: CouncilSynthesizerInput,
): Promise<CouncilSynthesizerResult> {
  const artifactId = "council-synthesis";
  try {
    await deps.dispatchRole({
      workflowRunId: deps.workflowRunId,
      role: {
        id: artifactId,
        stateId: "council-verification",
        modelProfile: "verifier",
        consumes: [],
        produces: ["council_synthesizer_decision.v1"],
        dependsOn: [],
      },
      artifacts: synthesizerArtifacts(input),
    });
    const payload = await deps.readArtifact({ workflowRunId: deps.workflowRunId, artifactId });
    return parseSynthesizerDecision(payload.data);
  } catch (error) {
    throw new WorkflowRunRoleDispatchError(
      `council synthesizer session failed for run ${deps.workflowRunId}: ${toErrorString(error)}`,
      { cause: error },
    );
  }
}

function flattenSingleVerifierInput(input: SingleVerifierInput): Record<string, unknown> {
  const result: Record<string, unknown> = { ...input.artifacts };
  if (input.diff !== undefined) {
    result["diff"] = input.diff;
  }
  if (input.evidenceLinks.length > 0) {
    result["evidenceLinks"] = input.evidenceLinks;
  }
  return result;
}

function synthesizerArtifacts(input: CouncilSynthesizerInput): Record<string, unknown> {
  return {
    ...flattenSingleVerifierInput(input.input),
    completedResults: input.completedResults,
    failedResults: input.failedResults,
  };
}

function parseCouncilVerifierDecision(data: unknown): CouncilVerifierResult {
  if (!isRecord(data)) {
    return { status: "failed", error: "council_verifier_decision.v1: not an object" };
  }
  if (
    data["status"] === "completed" &&
    typeof data["decision"] === "string" &&
    typeof data["summary"] === "string" &&
    isVerifierDecision(data["decision"])
  ) {
    return { status: "completed", decision: data["decision"] as SingleVerifierDecision, summary: data["summary"] };
  }
  if (data["status"] === "failed" && typeof data["error"] === "string") {
    return { status: "failed", error: data["error"] };
  }
  return { status: "failed", error: "council_verifier_decision.v1: unexpected shape" };
}

function parseSynthesizerDecision(data: unknown): CouncilSynthesizerResult {
  if (
    isRecord(data) &&
    typeof data["decision"] === "string" &&
    typeof data["summary"] === "string" &&
    isVerifierDecision(data["decision"])
  ) {
    return { decision: data["decision"] as SingleVerifierDecision, summary: data["summary"] };
  }
  throw new Error("council_synthesizer_decision.v1: unexpected shape");
}

const VERIFIER_DECISIONS: ReadonlySet<string> = new Set(["satisfied", "not_satisfied", "uncertain"]);

function isVerifierDecision(value: string): value is SingleVerifierDecision {
  return VERIFIER_DECISIONS.has(value);
}
