import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { isRecord } from "../utils/type-guards.js";
import type { WorkflowRunArchive, WorkflowRunArchiveLocation } from "./archive.js";
import {
  computeWorkflowCostUsd,
  DEFAULT_WORKFLOW_MAX_COST_USD,
  DEFAULT_WORKFLOW_MAX_WALL_CLOCK_MS,
  type WorkflowBudgetPolicy,
} from "./budget-retry.js";
import type { WorkflowExecutorResult } from "./executor.js";
import { renderHandoffMarkdown, type HandoffArtifact } from "./handoff-contract.js";
import type { WorkflowRunAttemptMemoryRecord } from "./memory-store.js";

interface EvidenceRef {
  readonly evidenceId: string;
  readonly path: string;
}

interface DoneHandoffInput {
  readonly workflowRunId: string;
  readonly createdAt: string;
  readonly budget?: WorkflowBudgetPolicy;
}

/**
 * Write a `handoff.v1` artifact for the DONE outcome. References (not copies)
 * the attempt-memory, validation result, and publish result artifacts.
 */
export async function writeDoneHandoff(
  archive: WorkflowRunArchive,
  handoffInput: DoneHandoffInput,
  location: WorkflowRunArchiveLocation,
  result: WorkflowExecutorResult,
  memoryRecord: WorkflowRunAttemptMemoryRecord,
  evidenceRefs: readonly EvidenceRef[],
  publishedPullRequestUrl?: string | null,
): Promise<{ artifactId: string }> {
  const { workflowRunId, createdAt } = handoffInput;

  const validationRef = buildValidationRef(location, workflowRunId, result.artifacts);
  const publishResult = extractPublishResult(result.artifacts);
  const artifactRefs = buildArtifactRefs(location, workflowRunId, result.artifacts);

  const attemptMemoryEntry = {
    attemptId: memoryRecord.attemptId,
    attemptNumber: memoryRecord.attemptNumber,
    summary: memoryRecord.summary,
    evidenceRefs: memoryRecord.evidenceRefs.map((ref) => ({ evidenceId: ref.evidenceId, path: ref.path })),
  };

  const evidenceLinks = evidenceRefs.map((ref) => ({ evidenceId: ref.evidenceId, path: ref.path, redactions: [] }));

  const handoff: HandoffArtifact = {
    version: 1,
    workflowRunId,
    createdAt,
    outcome: "done",
    summary: `Workflow Run ${workflowRunId} completed successfully.`,
    recommendedNextAction: "Review the published output and promote to production if ready.",
    suggestedSkills: ["risoluto-review-handoff"],
    budget: budgetFromPolicy(handoffInput.budget),
    validation: validationRef,
    attemptMemory: [attemptMemoryEntry],
    output: { branchName: null, pullRequestUrl: publishedPullRequestUrl ?? publishResult?.pullRequestUrl ?? null },
    blockers: [],
    artifacts: artifactRefs,
    evidence: evidenceLinks,
  };

  const record = await archive.writeWorkflowRunArtifact({
    workflowRunId,
    contractId: "handoff.v1",
    artifactId: "handoff",
    data: handoff,
    producer: { type: "action", id: "write-done-handoff" },
  });
  await writeHandoffMarkdown(location, workflowRunId, handoff);
  return record;
}

/**
 * Derive the handoff `budget` block from the run's budget policy: real elapsed wall-clock, measured cost
 * from token usage (0 until the usage accumulator is wired — never faked), and the effective hard limits.
 */
export function budgetFromPolicy(budget: WorkflowBudgetPolicy | undefined): HandoffArtifact["budget"] {
  if (!budget) {
    return null;
  }
  return {
    elapsedMs: Math.max(0, budget.nowMs() - budget.startedAtMs),
    costUsd: computeWorkflowCostUsd(budget.usage()),
    maxWallClockMs: budget.maxWallClockMs ?? DEFAULT_WORKFLOW_MAX_WALL_CLOCK_MS,
    maxCostUsd: budget.maxCostUsd ?? DEFAULT_WORKFLOW_MAX_COST_USD,
  };
}

/** Render the handoff to Markdown and persist it as `handoff.md` beside `handoff.json` (links, no raw logs). */
export async function writeHandoffMarkdown(
  location: WorkflowRunArchiveLocation,
  workflowRunId: string,
  handoff: HandoffArtifact,
): Promise<void> {
  const markdownPath = resolveArtifactPath(location, workflowRunId, "handoff").replace(/\.json$/, ".md");
  await mkdir(path.dirname(markdownPath), { recursive: true });
  await writeFile(markdownPath, renderHandoffMarkdown(handoff), "utf8");
}

function buildValidationRef(
  location: WorkflowRunArchiveLocation,
  workflowRunId: string,
  artifacts: Readonly<Record<string, unknown>>,
): HandoffArtifact["validation"] {
  if (!artifacts["validation_result.v1"]) {
    return { status: "not_run" };
  }
  const artifactPath = resolveArtifactPath(location, workflowRunId, "validation_result");
  const validationData = artifacts["validation_result.v1"];
  const status = isRecord(validationData) && validationData["status"] === "failed" ? "failed" : "passed";
  return {
    status,
    artifact: { artifactId: "validation_result", contractId: "validation_result.v1", path: artifactPath },
  };
}

function buildArtifactRefs(
  location: WorkflowRunArchiveLocation,
  workflowRunId: string,
  artifacts: Readonly<Record<string, unknown>>,
): HandoffArtifact["artifacts"] {
  const knownArtifacts: ReadonlyArray<{ contractId: string; artifactId: string }> = [
    { contractId: "publish_result.v1", artifactId: "publish_result" },
    { contractId: "validation_result.v1", artifactId: "validation_result" },
    { contractId: "verification.v1", artifactId: "verification" },
  ];
  return knownArtifacts
    .filter(({ contractId }) => artifacts[contractId] !== undefined)
    .map(({ contractId, artifactId }) => ({
      artifactId,
      contractId,
      path: resolveArtifactPath(location, workflowRunId, artifactId),
    }));
}

interface MinimalPublishResult {
  readonly pullRequestUrl: string | null;
}

function extractPublishResult(artifacts: Readonly<Record<string, unknown>>): MinimalPublishResult | null {
  const raw = artifacts["publish_result.v1"];
  if (!isRecord(raw)) {
    return null;
  }
  const pullRequestUrl = typeof raw["pullRequestUrl"] === "string" ? raw["pullRequestUrl"] : null;
  return { pullRequestUrl };
}

function resolveArtifactPath(location: WorkflowRunArchiveLocation, workflowRunId: string, artifactId: string): string {
  const archiveRoot = location.archiveDir ?? path.join(location.dataDir ?? "", "archives");
  return path.join(archiveRoot, "workflow-runs", workflowRunId, "artifacts", `${artifactId}.json`);
}
