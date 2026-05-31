import http from "node:http";
import path from "node:path";

import express from "express";
import { expect } from "vitest";

import {
  DEFAULT_WORKFLOW_RESOLUTION_DEFAULTS,
  loadWorkflowDefinitionRegistry,
} from "../../src/workflow-definition/registry.js";
import { registerWorkflowRunRoutes } from "../../src/http/routes/workflow-runs.js";
import { createWorkflowRunArchive } from "../../src/workflow-run/archive.js";
import { completeAutoMerge } from "../../src/workflow-run/auto-merge-completion.js";
import type { WorkflowRunStartRecord } from "../../src/workflow-run/contracts.js";
import {
  createWorkflowRunEvidenceStore,
  type WorkflowRunEvidenceRecord,
} from "../../src/workflow-run/evidence-store.js";
import { executeWorkflowDefinition } from "../../src/workflow-run/executor.js";
import { renderHandoffMarkdown } from "../../src/workflow-run/handoff-contract.js";
import { evaluatePrPublishPolicy, type PublishResultArtifact } from "../../src/workflow-run/publish-policy.js";
import { runDoctor } from "../../src/workflow-run/doctor.js";
import { runCouncilVerifier } from "../../src/workflow-run/verifier.js";
import { createMockLogger } from "../helpers.js";
import {
  changeSummaryArtifact,
  handoffArtifact,
  planArtifact,
  reviewArtifact,
  satisfiedPostPublishReconfirm,
  singleVerificationArtifact,
  validationArtifact,
} from "./workflow-first-afk-dogfood-artifacts.js";
import type { DogfoodContext } from "./workflow-first-afk-dogfood-fixture.js";

const WORKFLOW_ID = "single-operator-afk-coder";
const CREATED_AT = "2026-05-31T22:20:00.000Z";

export async function executeDogfoodEngine(context: DogfoodContext, workflowRun: WorkflowRunStartRecord) {
  const definition = await loadBundledWorkflowDefinition(context.workflowDir);
  return executeWorkflowDefinition({
    definition,
    workflowRunId: workflowRun.id,
    initialArtifacts: {
      "intent.v1": await readIntentArtifact(context, workflowRun.id),
      "validation_result.v1": validationArtifact(workflowRun.id),
    },
    runHook: async ({ hookId }) => ({ evidence: { hookId } }),
    runRole: async ({ role }) => roleOutput(role.id, workflowRun.id),
  });
}

export async function readWorkflowRunOverHttp(context: DogfoodContext, workflowRunId: string) {
  const app = express();
  registerWorkflowRunRoutes(app, { archiveDir: context.archiveDir, logger: createMockLogger() } as never);
  const { server, baseUrl } = await startApp(app);
  try {
    const response = await fetch(`${baseUrl}/api/v1/workflow-runs/${workflowRunId}`);
    expect(response.status).toBe(200);
    return (await response.json()) as { readonly workflowRun: WorkflowRunStartRecord };
  } finally {
    await stopServer(server);
  }
}

export async function writeRedactedDogfoodEvidence(
  context: DogfoodContext,
  workflowRunId: string,
): Promise<WorkflowRunEvidenceRecord> {
  const store = createWorkflowRunEvidenceStore({ dataDir: context.dataDir });
  const record = await store.writeEvidence({
    workflowRunId,
    evidenceId: "dogfood-raw",
    kind: "provider_response",
    source: "github_actions",
    createdAt: CREATED_AT,
    content: { token: "ghp_1234567890abcdefghijklmnopqrstuvwxyz123456", status: "blocked" },
    classifiedFields: [{ path: ["token"], classification: "secret" }],
  });
  const display = await store.readEvidenceForDisplay({ workflowRunId, evidenceId: record.evidenceId });
  expect(display).toMatchObject({ commitPolicy: "exclude", includeInCommittedOutput: false });
  expect(display.content).toMatchObject({ token: "[REDACTED]", status: "blocked" });
  return record;
}

export async function writeCouncilVerification(context: DogfoodContext, workflowRunId: string) {
  const result = await runCouncilVerifier({
    workflowRunId,
    createdAt: CREATED_AT,
    input: {
      artifacts: { "intent.v1": await readIntentArtifact(context, workflowRunId) },
      evidenceLinks: ["dogfood-raw"],
    },
    councillors: [
      { id: "correctness", modelProfile: "verifier", lens: "acceptance criteria" },
      { id: "safety", modelProfile: "strong", lens: "operator safety" },
      { id: "skeptic", modelProfile: "balanced", lens: "failure modes" },
    ],
    runCouncillor: async ({ councillor }) => ({
      status: "completed",
      decision: councillor.id === "skeptic" ? "uncertain" : "satisfied",
      summary: `${councillor.id} recorded dogfood evidence`,
    }),
    synthesize: async () => ({ decision: "satisfied", summary: "capstone evidence satisfies the MVP path" }),
  });
  if (result.status !== "completed") {
    throw new Error("dogfood council unexpectedly blocked");
  }
  await createWorkflowRunArchive({ dataDir: context.dataDir }).writeWorkflowRunArtifact({
    workflowRunId,
    artifactId: "council-verification",
    contractId: "verification.v1",
    data: result.artifact,
  });
  return result.artifact;
}

export async function writeBlockedHandoff(
  context: DogfoodContext,
  workflowRunId: string,
  evidencePath: string,
): Promise<string> {
  const artifact = handoffArtifact(workflowRunId, evidencePath);
  await createWorkflowRunArchive({ dataDir: context.dataDir }).writeWorkflowRunArtifact({
    workflowRunId,
    artifactId: "blocked-handoff",
    contractId: "handoff.v1",
    data: artifact,
  });
  return renderHandoffMarkdown(artifact);
}

export async function runDogfoodDoctor(context: DogfoodContext, workflowRunId: string) {
  return runDoctor({
    workflowDir: context.workflowDir,
    evidenceDir: path.join(context.archiveDir, "workflow-runs", workflowRunId, "evidence"),
    livePreflight: {
      generatedAt: CREATED_AT,
      overall: "passed",
      checks: [
        { name: "config", status: "passed", detail: "required live env is present" },
        { name: "linear", status: "passed", detail: "viewer authenticated" },
        { name: "github_app_sandbox_lifecycle", status: "passed", detail: "sandbox write completed" },
      ],
    },
  });
}

export async function loadBundledWorkflowDefinition(workflowDir: string) {
  const registry = await loadWorkflowDefinitionRegistry({
    workflowDir,
    globalDefaults: DEFAULT_WORKFLOW_RESOLUTION_DEFAULTS,
  });
  return registry.resolve(WORKFLOW_ID);
}

export async function readIntentArtifact(context: DogfoodContext, workflowRunId: string): Promise<unknown> {
  return (
    await createWorkflowRunArchive({ dataDir: context.dataDir }).readWorkflowRunArtifact({
      workflowRunId,
      artifactId: "intent",
    })
  ).data;
}

export function evaluateDraftPublish(workflowRunId: string): PublishResultArtifact {
  return evaluatePrPublishPolicy({
    workflowRunId,
    createdAt: CREATED_AT,
    requestedMode: "draft",
    validation: { status: "passed" },
    verification: { decision: "satisfied" },
    ci: { status: "passed" },
    operatorApproval: null,
    mergePolicy: null,
  });
}

export async function requestAutoMergeWithoutApproval(workflowRunId: string) {
  return completeAutoMerge({
    workflowRunId,
    pullRequest: { owner: "risolutohq", repo: "risoluto", pullNumber: 218 },
    mergeMethod: "squash",
    publish: autoMergePublishArtifact(workflowRunId),
    ci: { status: "passed" },
    postPublishVerification: { decision: "satisfied", postPublishReconfirm: satisfiedPostPublishReconfirm() },
    mergePolicy: { status: "passed" },
    operatorApproval: null,
    consumedApprovalNonces: [],
    requestAutoMerge: async () => {
      throw new Error("auto-merge must not be requested without operator approval");
    },
  });
}

async function startApp(app: express.Express): Promise<{ readonly server: http.Server; readonly baseUrl: string }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const address = server.address() as { port: number };
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

async function stopServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function roleOutput(roleId: string, workflowRunId: string): Readonly<Record<string, unknown>> {
  switch (roleId) {
    case "planner":
      return { "plan.v1": planArtifact(workflowRunId) };
    case "implementer":
      return { "change_summary.v1": changeSummaryArtifact(workflowRunId) };
    case "reviewer":
    case "ci_babysitter":
      return { "review.v1": reviewArtifact(workflowRunId) };
    case "verifier":
      return { "verification.v1": singleVerificationArtifact(workflowRunId) };
    default:
      throw new Error(`unexpected dogfood role ${roleId}`);
  }
}

function autoMergePublishArtifact(workflowRunId: string): PublishResultArtifact {
  return {
    ...evaluateDraftPublish(workflowRunId),
    mode: "auto_merge",
    draft: false,
    autoMerge: true,
    pullRequestUrl: "https://github.com/risolutohq/risoluto/pull/218",
  };
}
