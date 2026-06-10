/**
 * T-2 (audit) — HTTP API create-run e2e.
 *
 * Drives the REAL HTTP server → real POST /api/v1/workflow-runs route → real
 * intake → real accepted-run engine. The route forwards the accepted run onto
 * the top-level `eventBus`, so this test proves the API create path is wired to
 * the driver exactly the way the webhook path is.
 *
 * Assertions target archived artifacts/status, not internal calls. A "bites"
 * test omits the top-level eventBus and asserts the run is NOT driven, proving
 * the positive assertions are behavioral — they catch a regression that drops
 * the constructor-level bus (which the existing webhook e2e cannot, since it
 * never POSTs to this route).
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createAcceptedRunDriver } from "../../src/cli/accepted-run-driver.js";
import { TypedEventBus } from "../../src/core/event-bus.js";
import type { RisolutoEventMap } from "../../src/core/risoluto-events.js";
import { HttpServer } from "../../src/http/server.js";
import { createWorkflowRunArchive } from "../../src/workflow-run/archive.js";
import {
  workflowRunArtifactIdForContract,
  type WorkflowRunRoleDispatch,
} from "../../src/workflow-run/run-role-runner.js";
import { buildSilentLogger, buildStubOrchestrator } from "../helpers/http-server-harness.js";
import { E2E_DEFAULT_WORKFLOW_ID, E2E_FIXED_TIME } from "./intake-harness.js";

const E2E_WORKFLOW_YAML = `version: 1
id: ${E2E_DEFAULT_WORKFLOW_ID}
defaults: {}
states:
  - id: plan
    roles:
      - id: planner
        consumes: [intent.v1]
        produces: [plan.v1]
        dependsOn: []
    gates: []
    hooks: []
  - id: implement
    roles:
      - id: implementer
        consumes: [intent.v1, plan.v1]
        produces: [change_summary.v1]
        dependsOn: [planner]
    gates: []
    hooks: []
  - id: review
    roles:
      - id: reviewer
        consumes: [change_summary.v1]
        produces: [review.v1]
        dependsOn: [implementer]
    gates: []
    hooks: []
actions: []
`;

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function buildFakeRoleArtifact(contractId: string, workflowRunId: string): unknown {
  const base = { version: 1 as const, workflowRunId, createdAt: E2E_FIXED_TIME };
  if (contractId === "plan.v1") {
    return {
      ...base,
      summary: "Plan.",
      steps: [{ id: "s1", title: "Apply", status: "ready" as const, dependsOn: [] }],
    };
  }
  if (contractId === "change_summary.v1") {
    return {
      ...base,
      summary: "Implemented.",
      changedFiles: [{ path: "src/x.ts", changeType: "modified" as const, summary: "Patch." }],
    };
  }
  if (contractId === "review.v1") {
    return { ...base, verdict: "pass" as const, findings: [] };
  }
  throw new Error(`no fake artifact for contract ${contractId}`);
}

function buildDispatchRole(archive: ReturnType<typeof createWorkflowRunArchive>): WorkflowRunRoleDispatch {
  return async (input) => {
    for (const contractId of input.role.produces) {
      await archive.writeWorkflowRunArtifact({
        workflowRunId: input.workflowRunId,
        contractId,
        artifactId: workflowRunArtifactIdForContract(contractId),
        data: buildFakeRoleArtifact(contractId, input.workflowRunId),
        producer: { type: "role", id: input.role.id },
      });
    }
  };
}

async function writeWorkflowFixture(): Promise<string> {
  const workflowDir = await makeTempDir("risoluto-e2e-api-wf-");
  await writeFile(path.join(workflowDir, `${E2E_DEFAULT_WORKFLOW_ID}.yaml`), E2E_WORKFLOW_YAML, "utf8");
  return workflowDir;
}

function postCreateRun(baseUrl: string): Promise<globalThis.Response> {
  return fetch(`${baseUrl}/api/v1/workflow-runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "HTTP API e2e run",
      intent: "Drive the engine through the real API create route.",
      workflowDefinitionId: E2E_DEFAULT_WORKFLOW_ID,
    }),
  });
}

describe("HTTP API create-run e2e (audit T-2)", () => {
  it("POST /api/v1/workflow-runs drives a run to an archived review.v1 via the top-level event bus", async () => {
    const archiveDir = await makeTempDir("risoluto-e2e-api-arc-");
    const workflowDir = await writeWorkflowFixture();
    const archive = createWorkflowRunArchive({ archiveDir });
    const logger = buildSilentLogger();
    const eventBus = new TypedEventBus<RisolutoEventMap>();

    let resolveSettled: (() => void) | undefined;
    let rejectSettled: ((err: unknown) => void) | undefined;
    const settled = new Promise<void>((resolve, reject) => {
      resolveSettled = resolve;
      rejectSettled = reject;
    });

    const driver = createAcceptedRunDriver({
      archiveDir,
      workflowDir,
      dispatchRole: buildDispatchRole(archive),
      now: () => E2E_FIXED_TIME,
      onSettled: () => resolveSettled?.(),
      logger,
    });
    eventBus.on("workflow_run.accepted", (e) => {
      void driver.drive(e.workflowRunId).catch((err: unknown) => rejectSettled?.(err));
    });

    const server = new HttpServer({ orchestrator: buildStubOrchestrator(), logger, eventBus, archiveDir });
    const { port } = await server.start(0);
    try {
      const response = await postCreateRun(`http://127.0.0.1:${port}`);
      expect(response.status).toBe(201);

      await settled;

      const runs = await archive.listWorkflowRuns();
      expect(runs).toHaveLength(1);
      const runId = runs[0]!.id;

      // intent.v1 proves the API intake ran for real.
      await expect(
        archive.readWorkflowRunArtifact({ workflowRunId: runId, artifactId: "intent" }),
      ).resolves.toMatchObject({
        contractId: "intent.v1",
        data: expect.objectContaining({ source: "api", title: expect.stringContaining("HTTP API e2e run") }),
      });
      // review.v1 + done status prove the run was driven through the real engine via the event bus.
      await expect(
        archive.readWorkflowRunArtifact({ workflowRunId: runId, artifactId: "review" }),
      ).resolves.toMatchObject({ contractId: "review.v1", data: expect.objectContaining({ verdict: "pass" }) });
      await expect(archive.loadWorkflowRun(runId)).resolves.toMatchObject({ status: "done", source: "api" });
    } finally {
      await server.stop();
      eventBus.destroy();
    }
  }, 10_000);

  it("bites: an HttpServer with archiveDir but no top-level eventBus refuses to start (T-6 invariant)", async () => {
    // The run-create route emits workflow_run.accepted on the top-level eventBus; without it an
    // API-created run would strand in `accepted` forever. The dep validator now fails closed at
    // startup rather than letting that misconfiguration ship — a future mis-wiring can't pass CI.
    const archiveDir = await makeTempDir("risoluto-e2e-api-bites-");
    const logger = buildSilentLogger();
    expect(() => new HttpServer({ orchestrator: buildStubOrchestrator(), logger, archiveDir })).toThrow(
      /run-create routes active.*without an eventBus/,
    );
  }, 10_000);
});
