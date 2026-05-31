import type { HandoffArtifact } from "../../src/workflow-run/handoff-contract.js";

const CREATED_AT = "2026-05-31T22:20:00.000Z";

export function planArtifact(workflowRunId: string) {
  return {
    version: 1,
    workflowRunId,
    createdAt: CREATED_AT,
    summary: "Dogfood the workflow-first AFK MVP.",
    steps: [{ id: "capstone", title: "Run the capstone path", status: "ready", dependsOn: [] }],
  };
}

export function changeSummaryArtifact(workflowRunId: string) {
  return {
    version: 1,
    workflowRunId,
    createdAt: CREATED_AT,
    summary: "Prepared a reviewable dogfood change.",
    changedFiles: [{ path: "src/workflow-run/dogfood.ts", changeType: "modified", summary: "Dogfood evidence wired." }],
  };
}

export function reviewArtifact(workflowRunId: string) {
  return { version: 1, workflowRunId, createdAt: CREATED_AT, verdict: "pass", findings: [] };
}

export function validationArtifact(workflowRunId: string) {
  return {
    version: 1,
    workflowRunId,
    createdAt: CREATED_AT,
    profileId: "node-pnpm-standard",
    failureHandling: "stop_on_first",
    status: "passed",
    checks: [
      { id: "test", command: "pnpm test", status: "passed", exitCode: 0, stdout: "", stderr: "", durationMs: 1 },
    ],
  };
}

export function singleVerificationArtifact(workflowRunId: string) {
  return {
    version: 1,
    workflowRunId,
    createdAt: CREATED_AT,
    mode: "single",
    decision: "satisfied",
    summary: "Verifier accepts the dogfood path.",
    allowedInputs: ["intent.v1", "plan.v1", "change_summary.v1", "review.v1", "validation_result.v1"],
    evidenceLinks: ["dogfood-raw"],
  };
}

export function satisfiedPostPublishReconfirm() {
  return {
    required: true,
    prePublishDecision: "satisfied",
    decision: "satisfied",
    summary: "post-publish reconfirmed",
    checkedInputs: ["publish_result.v1", "ci_result.v1", "handoff.v1"],
    contradictedBy: [],
  } as const;
}

export function handoffArtifact(workflowRunId: string, evidencePath: string): HandoffArtifact {
  return {
    version: 1,
    workflowRunId,
    createdAt: CREATED_AT,
    outcome: "blocked",
    summary: "Dogfood run blocked honestly on external provider execution in deterministic test.",
    recommendedNextAction: "Run the live provider dogfood outside deterministic CI.",
    suggestedSkills: ["risoluto-review-handoff"],
    budget: { elapsedMs: 120_001, costUsd: 0.01, maxWallClockMs: 120_000, maxCostUsd: 10 },
    validation: { status: "passed" },
    attemptMemory: [],
    output: { branchName: "dogfood/wr_dogfood_cli", pullRequestUrl: null },
    blockers: [{ kind: "failed_gate", message: "live provider execution not run in deterministic capstone" }],
    artifacts: [],
    evidence: [
      {
        evidenceId: "dogfood-raw",
        path: evidencePath,
        redactions: [{ path: ["token"], classification: "secret" }],
      },
    ],
  };
}

export function dogfoodBudget(nowValues: readonly number[]) {
  let index = 0;
  return {
    startedAtMs: 0,
    maxWallClockMs: 10_000,
    nowMs: () => nowValues[index++] ?? 20_000,
    usage: () => ({
      usageByModelProfile: { balanced: { inputTokens: 1, outputTokens: 1 } },
      modelProfilePrices: { balanced: { inputUsd: 1, outputUsd: 1, cacheReadUsd: 0, cacheWriteUsd: 0 } },
    }),
  };
}
