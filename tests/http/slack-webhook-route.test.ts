/**
 * Integration test for the /webhooks/slack route.
 *
 * Verifies that when slackWebhookDeps is constructed from config-derived values
 * and passed into HttpRouteDeps, the route reaches handleWebhookSlack:
 *   - correctly-signed request → 200 (or 400 for bad payload shape, not 401/404)
 *   - invalid signature → 401
 *   - replayed request (stale timestamp) → 401
 *   - route absent when slackWebhookDeps is undefined → 404
 */

import { createHmac } from "node:crypto";

import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerWebhookRoutes } from "../../src/http/routes/webhooks.js";
import type { SlackWebhookHandlerDeps } from "../../src/webhook/slack-handler.js";
import type { WebhookRequest } from "../../src/http/webhook-types.js";

const TEST_SECRET = "test-slack-signing-secret";
const EPOCH = 1700000000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSlackDeps(overrides: Partial<SlackWebhookHandlerDeps> = {}): SlackWebhookHandlerDeps {
  return {
    signingSecret: TEST_SECRET,
    operators: [],
    allowedSlackTeamIds: ["T_TEST"],
    rules: [],
    now: () => new Date().toISOString(),
    id: () => "wr_test",
    nowEpochSeconds: () => EPOCH,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis() } as never,
    ...overrides,
  };
}

function buildApp(slackWebhookDeps?: SlackWebhookHandlerDeps) {
  const app = express();
  app.use(
    express.urlencoded({
      extended: false,
      verify: (req, _res, buf) => {
        (req as WebhookRequest).rawBody = buf;
      },
    }),
  );
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as WebhookRequest).rawBody = buf;
      },
    }),
  );
  const deps = {
    orchestrator: { requestTargetedRefresh: vi.fn(), stopWorkerForIssue: vi.fn() },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis() } as never,
    configStore: { getConfig: vi.fn().mockReturnValue({ triggers: { rateLimitPerMinute: 30 } }) },
    slackWebhookDeps,
  };
  registerWebhookRoutes(app, deps as never);
  return app;
}

async function startServer(slackWebhookDeps?: SlackWebhookHandlerDeps) {
  const app = buildApp(slackWebhookDeps);
  return new Promise<{ server: ReturnType<typeof app.listen>; baseUrl: string }>((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function slackBody(payload: Record<string, unknown>): string {
  return `payload=${encodeURIComponent(JSON.stringify(payload))}`;
}

function sign(body: string, timestamp: number): string {
  const base = `v0:${timestamp}:${body}`;
  return `v0=${createHmac("sha256", TEST_SECRET).update(base).digest("hex")}`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("/webhooks/slack route wiring", () => {
  const servers: Array<ReturnType<typeof express.application.listen>> = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (s) =>
          new Promise<void>((resolve, reject) => {
            s.close((e) => (e ? reject(e) : resolve()));
          }),
      ),
    );
  });

  it("returns 404 when slackWebhookDeps is not configured", async () => {
    const { server, baseUrl } = await startServer(undefined);
    servers.push(server);

    const res = await fetch(`${baseUrl}/webhooks/slack`, { method: "POST" });

    expect(res.status).toBe(404);
  });

  it("reaches handleWebhookSlack and acknowledges an unknown interaction type", async () => {
    const { server, baseUrl } = await startServer(makeSlackDeps());
    servers.push(server);

    const body = slackBody({ type: "shortcut" });
    const res = await fetch(`${baseUrl}/webhooks/slack`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-slack-signature": sign(body, EPOCH),
        "x-slack-request-timestamp": String(EPOCH),
      },
      body,
    });

    // Handler is reached: unknown type is acked with 200
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).toMatchObject({ ok: true });
  });

  it("rejects a request with an invalid Slack signature", async () => {
    const { server, baseUrl } = await startServer(makeSlackDeps());
    servers.push(server);

    const body = slackBody({ type: "view_submission" });
    const res = await fetch(`${baseUrl}/webhooks/slack`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-slack-signature": "v0=deadbeef",
        "x-slack-request-timestamp": String(EPOCH),
      },
      body,
    });

    expect(res.status).toBe(401);
  });

  it("rejects a replayed request whose timestamp is outside the replay window", async () => {
    const { server, baseUrl } = await startServer(makeSlackDeps({ nowEpochSeconds: () => EPOCH + 9999 }));
    servers.push(server);

    const body = slackBody({ type: "view_submission" });
    const res = await fetch(`${baseUrl}/webhooks/slack`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-slack-signature": sign(body, EPOCH),
        "x-slack-request-timestamp": String(EPOCH),
      },
      body,
    });

    expect(res.status).toBe(401);
  });

  it("enforces POST-only on the Slack route", async () => {
    const { server, baseUrl } = await startServer(makeSlackDeps());
    servers.push(server);

    const res = await fetch(`${baseUrl}/webhooks/slack`);
    expect(res.status).toBe(405);
  });
});
