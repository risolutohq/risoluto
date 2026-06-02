import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createWorkflowRunArchive } from "../../src/workflow-run/archive.js";
import type { WorkflowRunIntakeRule } from "../../src/workflow-run/intake-core.js";
import type { WebhookRequest } from "../../src/http/webhook-types.js";
import { handleWebhookSlack, type SlackWebhookHandlerDeps } from "../../src/webhook/slack-handler.js";

const TEST_SECRET = "slack-signing-secret";
const TIMESTAMP = 1000;
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "risoluto-slack-handler-"));
  tempDirs.push(dir);
  return dir;
}

describe("handleWebhookSlack", () => {
  it("starts a Workflow Run from a signed Slack modal submission", async () => {
    const dataDir = await createTempDir();
    const rawBody = slackInteractionBody({
      type: "view_submission",
      team: { id: "T_OK" },
      user: { id: "U_OK" },
      view: {
        id: "V_MODAL",
        private_metadata: JSON.stringify({
          title: "Ship Slack intake",
          body: "Wire the inbound route.",
          workflowDefinitionId: "single-operator-afk-coder",
          workspaceKey: "risoluto",
        }),
      },
    });
    const { req, res, capture } = makeReqRes(rawBody, signSlack(rawBody));

    await handleWebhookSlack(deps({ dataDir }), req, res);

    expect(capture.status).toBe(200);
    await expect(createWorkflowRunArchive({ dataDir }).loadWorkflowRun("wr_slack_route")).resolves.toMatchObject({
      source: "slack",
      title: "Ship Slack intake",
    });
  });

  it("rejects a Slack modal submission with an invalid signature", async () => {
    const dataDir = await createTempDir();
    const rawBody = slackInteractionBody({
      type: "view_submission",
      team: { id: "T_OK" },
      user: { id: "U_OK" },
      view: { id: "V_MODAL", private_metadata: "{}" },
    });
    const { req, res, capture } = makeReqRes(rawBody, "v0=deadbeef");

    await handleWebhookSlack(deps({ dataDir }), req, res);

    expect(capture.status).toBe(401);
    await expect(createWorkflowRunArchive({ dataDir }).listWorkflowRuns()).resolves.toEqual([]);
  });

  it("acknowledges an unknown interaction type without side effects", async () => {
    const dataDir = await createTempDir();
    const rawBody = slackInteractionBody({ type: "shortcut" });
    const { req, res, capture } = makeReqRes(rawBody, signSlack(rawBody));

    await handleWebhookSlack(deps({ dataDir }), req, res);

    expect(capture.status).toBe(200);
    await expect(createWorkflowRunArchive({ dataDir }).listWorkflowRuns()).resolves.toEqual([]);
  });

  it("rejects a request whose timestamp is outside the replay window", async () => {
    const dataDir = await createTempDir();
    const rawBody = slackInteractionBody({ type: "view_submission" });
    const { req, res, capture } = makeReqRes(rawBody, signSlack(rawBody));

    await handleWebhookSlack(deps({ dataDir, nowEpochSeconds: () => TIMESTAMP + 9999 }), req, res);

    expect(capture.status).toBe(401);
  });
});

function deps(overrides: { dataDir: string; nowEpochSeconds?: () => number }): SlackWebhookHandlerDeps {
  const rules: WorkflowRunIntakeRule[] = [
    {
      id: "slack-modal",
      provider: "slack",
      workflowDefinitionId: "single-operator-afk-coder",
      workspaceKey: "risoluto",
    },
  ];
  return {
    signingSecret: TEST_SECRET,
    operators: [],
    allowedSlackTeamIds: ["T_OK"],
    rules,
    dataDir: overrides.dataDir,
    now: () => "2026-05-31T21:00:00.000Z",
    id: () => "wr_slack_route",
    nowEpochSeconds: overrides.nowEpochSeconds ?? (() => TIMESTAMP),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis() } as never,
  };
}

function slackInteractionBody(payload: Record<string, unknown>): Buffer {
  return Buffer.from(`payload=${encodeURIComponent(JSON.stringify(payload))}`, "utf8");
}

function signSlack(rawBody: Buffer): string {
  const base = `v0:${TIMESTAMP}:${rawBody.toString("utf8")}`;
  return `v0=${createHmac("sha256", TEST_SECRET).update(base).digest("hex")}`;
}

function makeReqRes(
  rawBody: Buffer,
  signature: string,
): { req: WebhookRequest; res: Response; capture: { status: number; body: unknown } } {
  const headers: Record<string, string> = {
    "x-slack-signature": signature,
    "x-slack-request-timestamp": String(TIMESTAMP),
  };
  const req = { rawBody, get: (name: string) => headers[name.toLowerCase()] } as unknown as WebhookRequest;
  const capture = { status: 0, body: undefined as unknown };
  const res = {
    headersSent: false,
    status(code: number) {
      capture.status = code;
      return this;
    },
    json(value: unknown) {
      capture.body = value;
      return this;
    },
  } as unknown as Response;
  return { req, res, capture };
}
