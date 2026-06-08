/**
 * NIN-151 — Slack intake e2e (verification ladder).
 *
 * Drives the REAL HTTP server → real /webhooks/slack route → real Slack
 * signature verification → real intake → real accepted-run engine through a
 * signed application/x-www-form-urlencoded POST.
 * Only the true external — the LLM agent session — is faked via a hermetic
 * dispatchRole that deposits contract-valid artifacts.
 *
 * Assertions target archived artifacts/events, not internal function calls,
 * so a broken intake-to-engine wiring path fails the test even when every unit
 * passes in isolation.
 */
import { createHmac, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { TypedEventBus } from "../../src/core/event-bus.js";
import type { RisolutoEventMap } from "../../src/core/risoluto-events.js";
import { HttpServer } from "../../src/http/server.js";
import type { VerifiedWebhookDelivery, VerifiedWebhookDeliveryStore } from "../../src/webhook/delivery-workflow.js";
import type { SlackWebhookHandlerDeps } from "../../src/webhook/slack-handler.js";
import { createAcceptedRunDriver } from "../../src/cli/accepted-run-driver.js";
import { createWorkflowRunArchive } from "../../src/workflow-run/archive.js";
import {
  workflowRunArtifactIdForContract,
  type WorkflowRunRoleDispatch,
} from "../../src/workflow-run/run-role-runner.js";
import { buildSilentLogger, buildStubOrchestrator } from "../helpers/http-server-harness.js";
import { E2E_DEFAULT_WORKFLOW_ID, E2E_FIXED_TIME } from "./intake-harness.js";

const SLACK_SIGNING_SECRET = "e2e-slack-signing-secret-nin151";

// Same three-role fixture used across the e2e tier.
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
  const keyByDeliveryId = new Map<string, string>();
  return {
    insertVerified: async (delivery: VerifiedWebhookDelivery) => {
      const key = delivery.bodyDigest ?? delivery.deliveryId;
      if (seen.has(key)) return { isNew: false };
      seen.add(key);
      keyByDeliveryId.set(delivery.deliveryId, key);
      return { isNew: true };
    },
    markApplied: async () => undefined,
    markForRetry: async () => undefined,
    discardVerified: async (deliveryId: string) => {
      const key = keyByDeliveryId.get(deliveryId);
      if (key !== undefined) {
        seen.delete(key);
        keyByDeliveryId.delete(deliveryId);
      }
    },
  };
}

/**
 * Build a Slack interaction body (application/x-www-form-urlencoded).
 * Returns both the body string and the correctly computed v0= signature.
 */
function buildSlackRequest(
  payload: Record<string, unknown>,
  timestampEpochSeconds: number,
): { body: string; signature: string } {
  const body = `payload=${encodeURIComponent(JSON.stringify(payload))}`;
  const base = `v0:${timestampEpochSeconds}:${body}`;
  const signature = `v0=${createHmac("sha256", SLACK_SIGNING_SECRET).update(base).digest("hex")}`;
  return { body, signature };
}

/**
 * Stand up the full Slack intake e2e stack: real HttpServer → real Slack
 * route → real intake → real accepted-run driver (hermetic dispatchRole).
 */
async function createSlackIntakeE2E(): Promise<{
  readonly archiveDir: string;
  readonly archive: ReturnType<typeof createWorkflowRunArchive>;
  readonly baseUrl: string;
  readonly settled: Promise<void>;
  readonly dispatchedRoleIds: () => readonly string[];
  readonly teardown: () => Promise<void>;
}> {
  const archiveDir = await makeTempDir("risoluto-e2e-slack-arc-");
  const workflowDir = await makeTempDir("risoluto-e2e-slack-wf-");
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

  // Wire the driver to the event bus — mirrors Phase 8 in services.ts.
  eventBus.on("workflow_run.accepted", (e) => {
    void driver.drive(e.workflowRunId).catch((err: unknown) => rejectSettled?.(err));
  });

  const nowEpochSeconds = (): number => Math.floor(Date.now() / 1000);

  const slackWebhookDeps: SlackWebhookHandlerDeps = {
    signingSecret: SLACK_SIGNING_SECRET,
    operators: [],
    allowedSlackTeamIds: ["T_E2E_TEAM"],
    rules: [],
    archiveDir,
    now: () => E2E_FIXED_TIME,
    id: () => `wr_${randomUUID()}`,
    nowEpochSeconds,
    eventBus,
    webhookInbox: buildFakeInbox(),
    logger,
  };

  const server = new HttpServer({
    orchestrator: buildStubOrchestrator(),
    logger,
    slackWebhookDeps,
    archiveDir,
  });
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

describe("Slack intake e2e (verification ladder NIN-151)", () => {
  it("correctly signed view_submission through the real Slack route archives intent.v1 and drives a run to review.v1 (AC1, AC3)", async () => {
    const ctx = await createSlackIntakeE2E();
    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const { body, signature } = buildSlackRequest(
        {
          type: "view_submission",
          team: { id: "T_E2E_TEAM" },
          user: { id: "U_E2E_USER" },
          view: {
            id: "V_E2E_VIEW",
            private_metadata: JSON.stringify({
              title: "Slack intake e2e run",
              body: "Drive the engine through the real Slack route.",
              workflowDefinitionId: E2E_DEFAULT_WORKFLOW_ID,
              workspaceKey: "default",
            }),
          },
        },
        timestamp,
      );

      const response = await fetch(`${ctx.baseUrl}/webhooks/slack`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-slack-signature": signature,
          "x-slack-request-timestamp": String(timestamp),
        },
        body,
      });
      // Slack route always returns 200 with response_action on success.
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json).toMatchObject({ response_action: "clear" });

      // Wait for the background drive to complete (AC1: modal effect via archived artifacts).
      await ctx.settled;

      const runs = await ctx.archive.listWorkflowRuns();
      expect(runs).toHaveLength(1);
      const runId = runs[0]!.id;

      // AC1: archived intent.v1 proves the Slack route is wired to real intake.
      await expect(
        ctx.archive.readWorkflowRunArtifact({ workflowRunId: runId, artifactId: "intent" }),
      ).resolves.toMatchObject({
        contractId: "intent.v1",
        data: expect.objectContaining({ source: "slack", title: "Slack intake e2e run" }),
      });

      // AC1: archived review.v1 proves the accepted-run driver ran through the real engine.
      await expect(
        ctx.archive.readWorkflowRunArtifact({ workflowRunId: runId, artifactId: "review" }),
      ).resolves.toMatchObject({
        contractId: "review.v1",
        data: expect.objectContaining({ verdict: "pass" }),
      });

      // AC1: run reached terminal done status.
      await expect(ctx.archive.loadWorkflowRun(runId)).resolves.toMatchObject({ status: "done", source: "slack" });

      // AC3: assertions above target archived facts; role dispatch is a secondary check.
      expect(ctx.dispatchedRoleIds()).toEqual(["planner", "implementer", "reviewer"]);
    } finally {
      await ctx.teardown();
    }
  }, 10_000);

  it("invalid Slack signature is rejected and produces no archived effect (AC2)", async () => {
    const ctx = await createSlackIntakeE2E();
    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const body = `payload=${encodeURIComponent(
        JSON.stringify({
          type: "view_submission",
          team: { id: "T_E2E_TEAM" },
          user: { id: "U_E2E_USER" },
          view: {
            id: "V_BAD_SIG",
            private_metadata: JSON.stringify({
              title: "Should not run",
              body: "bad sig",
              workflowDefinitionId: E2E_DEFAULT_WORKFLOW_ID,
              workspaceKey: "default",
            }),
          },
        }),
      )}`;

      const response = await fetch(`${ctx.baseUrl}/webhooks/slack`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          // Deliberately wrong signature.
          "x-slack-signature": "v0=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
          "x-slack-request-timestamp": String(timestamp),
        },
        body,
      });

      // AC2: invalid signature → 401, no run created.
      expect(response.status).toBe(401);
      await expect(ctx.archive.listWorkflowRuns()).resolves.toEqual([]);
    } finally {
      await ctx.teardown();
    }
  }, 10_000);

  it("replayed signed Slack request is deduplicated and produces no second archived run (AC2)", async () => {
    const ctx = await createSlackIntakeE2E();
    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const { body, signature } = buildSlackRequest(
        {
          type: "view_submission",
          team: { id: "T_E2E_TEAM" },
          user: { id: "U_E2E_USER" },
          view: {
            id: "V_REPLAY_VIEW",
            private_metadata: JSON.stringify({
              title: "Replay dedupe test",
              body: "First submission — should create exactly one run.",
              workflowDefinitionId: E2E_DEFAULT_WORKFLOW_ID,
              workspaceKey: "default",
            }),
          },
        },
        timestamp,
      );

      const headers = {
        "content-type": "application/x-www-form-urlencoded",
        "x-slack-signature": signature,
        "x-slack-request-timestamp": String(timestamp),
      };

      // First submission — creates a run and drives it.
      const first = await fetch(`${ctx.baseUrl}/webhooks/slack`, { method: "POST", headers, body });
      expect(first.status).toBe(200);

      // Wait for first drive to complete before replaying.
      await ctx.settled;

      // Replay — same body + signature → deduplicated on body/signature digest.
      const second = await fetch(`${ctx.baseUrl}/webhooks/slack`, { method: "POST", headers, body });
      expect(second.status).toBe(200);
      const secondJson = await second.json();
      // Dedup response is clear without starting a second run.
      expect(secondJson).toMatchObject({ response_action: "clear" });

      // AC2: exactly one run was created despite two identical signed deliveries.
      await expect(ctx.archive.listWorkflowRuns()).resolves.toHaveLength(1);
    } finally {
      await ctx.teardown();
    }
  }, 10_000);
});
