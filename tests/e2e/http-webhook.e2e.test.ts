/**
 * NIN-153 — HTTP webhook intake e2e (verification ladder).
 *
 * Drives the REAL HTTP server → real /webhooks/linear route → real signature
 * verification → real intake → real accepted-run engine through a signed POST.
 * Only the true external — the LLM agent session — is faked via a hermetic
 * dispatchRole that deposits contract-valid artifacts.
 *
 * Assertions target archived artifacts/events, not internal function calls,
 * so a broken intake-to-engine wiring path fails the test even when every unit
 * passes in isolation.
 */
import { createHmac } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { TypedEventBus } from "../../src/core/event-bus.js";
import type { RisolutoEventMap } from "../../src/core/risoluto-events.js";
import { HttpServer } from "../../src/http/server.js";
import type { VerifiedWebhookDelivery, VerifiedWebhookDeliveryStore } from "../../src/webhook/delivery-workflow.js";
import type { WebhookHandlerDeps } from "../../src/webhook/linear-handler.js";
import { createAcceptedRunDriver } from "../../src/cli/accepted-run-driver.js";
import { createWorkflowRunArchive } from "../../src/workflow-run/archive.js";
import { acceptLinearTriggeredWorkflowRun } from "../../src/workflow-run/linear-intake.js";
import {
  workflowRunArtifactIdForContract,
  type WorkflowRunRoleDispatch,
} from "../../src/workflow-run/run-role-runner.js";
import { buildSilentLogger, buildStubOrchestrator } from "../helpers/http-server-harness.js";
import { E2E_DEFAULT_WORKFLOW_ID, E2E_FIXED_TIME } from "./intake-harness.js";

const WEBHOOK_SECRET = "e2e-linear-webhook-secret-nin153";

// Identical structure to the harness workflow — the three-role plan/implement/review fixture.
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

function buildFakeInbox(): VerifiedWebhookDeliveryStore {
  const seen = new Set<string>();
  return {
    insertVerified: async (delivery: VerifiedWebhookDelivery) => {
      const key = delivery.bodyDigest ?? delivery.deliveryId;
      if (seen.has(key)) return { isNew: false };
      seen.add(key);
      return { isNew: true };
    },
    markApplied: async () => undefined,
    markForRetry: async () => undefined,
    discardVerified: async () => undefined,
  };
}

function signLinear(rawBody: string): string {
  return createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");
}

/**
 * Stand up the full HTTP webhook e2e stack: real HttpServer → real webhook
 * route → real intake → real accepted-run driver (hermetic dispatchRole).
 * Returns a `settled` Promise that resolves when the background drive completes.
 */
async function createHttpWebhookE2E(): Promise<{
  readonly archiveDir: string;
  readonly archive: ReturnType<typeof createWorkflowRunArchive>;
  readonly baseUrl: string;
  readonly settled: Promise<void>;
  readonly dispatchedRoleIds: () => readonly string[];
  readonly teardown: () => Promise<void>;
}> {
  const archiveDir = await makeTempDir("risoluto-e2e-hw-arc-");
  const workflowDir = await makeTempDir("risoluto-e2e-hw-wf-");
  await writeFile(path.join(workflowDir, `${E2E_DEFAULT_WORKFLOW_ID}.yaml`), E2E_WORKFLOW_YAML, "utf8");

  const archive = createWorkflowRunArchive({ archiveDir });
  const dispatched: string[] = [];
  const logger = buildSilentLogger();

  const dispatchRole: WorkflowRunRoleDispatch = async (input) => {
    dispatched.push(input.role.id);
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
    dispatchRole,
    now: () => E2E_FIXED_TIME,
    onSettled: () => resolveSettled?.(),
    logger,
  });

  // Wire the driver to the event bus — mirrors what Phase 8 in services.ts does in production.
  eventBus.on("workflow_run.accepted", (e) => {
    void driver.drive(e.workflowRunId).catch((err: unknown) => rejectSettled?.(err));
  });

  const webhookHandlerDeps: WebhookHandlerDeps = {
    getWebhookSecret: () => WEBHOOK_SECRET,
    getPreviousWebhookSecret: () => null,
    requestRefresh: () => undefined,
    requestTargetedRefresh: () => undefined,
    stopWorkerForIssue: () => undefined,
    recordVerifiedDelivery: () => undefined,
    acceptLinearTriggeredWorkflowRun: (input) =>
      acceptLinearTriggeredWorkflowRun({ ...input, archiveDir, workflowDefinitionId: E2E_DEFAULT_WORKFLOW_ID }),
    webhookInbox: buildFakeInbox(),
    eventBus,
    logger,
  };

  const server = new HttpServer({ orchestrator: buildStubOrchestrator(), logger, webhookHandlerDeps, archiveDir });
  const { port } = await server.start(0);
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    archiveDir,
    archive,
    baseUrl,
    settled,
    dispatchedRoleIds: () => [...dispatched],
    teardown: async () => {
      await server.stop();
      eventBus.destroy();
    },
  };
}

describe("HTTP webhook intake e2e (verification ladder NIN-153)", () => {
  it("valid signed POST to real server drives a run to an archived review.v1 (AC1, AC4)", async () => {
    const ctx = await createHttpWebhookE2E();
    try {
      const payload = JSON.stringify({
        action: "create",
        type: "Issue",
        data: { id: "e2e-lin-1", identifier: "E2E-1", title: "HTTP webhook e2e run" },
        webhookTimestamp: Date.now(),
      });

      const response = await fetch(`${ctx.baseUrl}/webhooks/linear`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "linear-signature": signLinear(payload),
          "linear-delivery": "delivery-nin153-001",
        },
        body: payload,
      });
      expect(response.status).toBe(200);

      // Wait for the background drive to finish (AC1: run created AND driven)
      await ctx.settled;

      const runs = await ctx.archive.listWorkflowRuns();
      expect(runs).toHaveLength(1);
      const runId = runs[0]!.id;

      // AC1: archived intent.v1 proves intake-to-server wiring is real
      await expect(
        ctx.archive.readWorkflowRunArtifact({ workflowRunId: runId, artifactId: "intent" }),
      ).resolves.toMatchObject({
        contractId: "intent.v1",
        data: expect.objectContaining({ source: "linear", title: expect.stringContaining("HTTP webhook e2e run") }),
      });

      // AC1: archived review.v1 proves the run was driven through the real engine
      await expect(
        ctx.archive.readWorkflowRunArtifact({ workflowRunId: runId, artifactId: "review" }),
      ).resolves.toMatchObject({
        contractId: "review.v1",
        data: expect.objectContaining({ verdict: "pass" }),
      });

      // AC1: run reached terminal done status
      await expect(ctx.archive.loadWorkflowRun(runId)).resolves.toMatchObject({ status: "done", source: "linear" });

      // AC4: assertions above target archived facts; role dispatch is a secondary check
      expect(ctx.dispatchedRoleIds()).toEqual(["planner", "implementer", "reviewer"]);
    } finally {
      await ctx.teardown();
    }
  }, 10_000);

  it("bites: intake without event-bus wiring archives intent.v1 but leaves review.v1 absent (AC2)", async () => {
    // This test proves AC2: the assertions in the positive test above are behavioral — they
    // would fail if the event-bus drive wiring were missing, catching the dead path.
    const archiveDir = await makeTempDir("risoluto-e2e-hw-bites-");
    const archive = createWorkflowRunArchive({ archiveDir });
    const logger = buildSilentLogger();

    // Resolve deterministically when intake completes (no timeout needed).
    let resolveIntakeSettled: (() => void) | undefined;
    const intakeSettled = new Promise<void>((resolve) => {
      resolveIntakeSettled = resolve;
    });

    const webhookHandlerDeps: WebhookHandlerDeps = {
      getWebhookSecret: () => WEBHOOK_SECRET,
      getPreviousWebhookSecret: () => null,
      requestRefresh: () => undefined,
      requestTargetedRefresh: () => undefined,
      stopWorkerForIssue: () => undefined,
      recordVerifiedDelivery: () => undefined,
      acceptLinearTriggeredWorkflowRun: async (input) => {
        const result = await acceptLinearTriggeredWorkflowRun({
          ...input,
          archiveDir,
          workflowDefinitionId: E2E_DEFAULT_WORKFLOW_ID,
        });
        resolveIntakeSettled?.();
        return result;
      },
      // eventBus intentionally absent — workflow_run.accepted is never emitted, driver never runs.
      webhookInbox: buildFakeInbox(),
      logger,
    };

    const server = new HttpServer({ orchestrator: buildStubOrchestrator(), logger, webhookHandlerDeps, archiveDir });
    const { port } = await server.start(0);
    try {
      const payload = JSON.stringify({
        action: "create",
        type: "Issue",
        data: { id: "e2e-bites-1", identifier: "E2E-B", title: "Bites: intake-only" },
        webhookTimestamp: Date.now(),
      });

      const response = await fetch(`http://127.0.0.1:${port}/webhooks/linear`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "linear-signature": signLinear(payload),
          "linear-delivery": "delivery-nin153-bites",
        },
        body: payload,
      });
      expect(response.status).toBe(200);

      // Wait for background intake to complete before asserting.
      await intakeSettled;

      const runs = await archive.listWorkflowRuns();
      expect(runs).toHaveLength(1);
      const runId = runs[0]!.id;

      // Intake ran for real — intent.v1 exists.
      await expect(
        archive.readWorkflowRunArtifact({ workflowRunId: runId, artifactId: "intent" }),
      ).resolves.toMatchObject({
        contractId: "intent.v1",
      });

      // Drive never ran (no event bus) — review.v1 is absent.
      // The positive test above would fail here, proving its assertions are behavioral.
      await expect(archive.readWorkflowRunArtifact({ workflowRunId: runId, artifactId: "review" })).rejects.toThrow();
    } finally {
      await server.stop();
    }
  }, 10_000);

  it("invalid signature is rejected and creates no run (AC3)", async () => {
    const ctx = await createHttpWebhookE2E();
    try {
      const payload = JSON.stringify({
        action: "create",
        type: "Issue",
        data: { id: "e2e-bad-1", identifier: "E2E-X", title: "Bad sig" },
        webhookTimestamp: Date.now(),
      });

      const response = await fetch(`${ctx.baseUrl}/webhooks/linear`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "linear-signature": "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
          "linear-delivery": "delivery-nin153-bad-sig",
        },
        body: payload,
      });

      // AC3: invalid signature → 401, no run created
      expect(response.status).toBe(401);
      await expect(ctx.archive.listWorkflowRuns()).resolves.toEqual([]);
    } finally {
      await ctx.teardown();
    }
  }, 10_000);
});
