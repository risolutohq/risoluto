import { describe, expect, it, afterEach } from "vitest";
import express from "express";
import http, { type IncomingMessage } from "node:http";

import type { WebhookRequest } from "../../src/http/webhook-types.js";

/** Mirrors the `express.json({ verify })` setup from `server.ts`. */
function startApp(): Promise<{ port: number; server: http.Server }> {
  const app = express();
  const captureWebhookRawBody = (req: IncomingMessage, _res: unknown, buf: Buffer): void => {
    if (req.url?.startsWith("/webhooks/")) {
      (req as unknown as WebhookRequest).rawBody = buf;
    }
  };
  app.use(express.json({ verify: captureWebhookRawBody }));
  app.use(express.urlencoded({ extended: false, verify: captureWebhookRawBody }));

  app.post("/webhooks/linear", (req, res) => {
    const webhookReq = req as WebhookRequest;
    res.json({
      hasRawBody: Buffer.isBuffer(webhookReq.rawBody),
      rawBodyLength: webhookReq.rawBody?.length ?? null,
    });
  });

  app.post("/webhooks/slack", (req, res) => {
    const webhookReq = req as WebhookRequest;
    const raw = webhookReq.rawBody?.toString("utf8") ?? "";
    res.json({
      hasRawBody: Buffer.isBuffer(webhookReq.rawBody),
      decodedPayload: new URLSearchParams(raw).get("payload"),
    });
  });

  app.post("/api/v1/refresh", (req, res) => {
    const webhookReq = req as WebhookRequest;
    res.json({
      hasRawBody: Buffer.isBuffer(webhookReq.rawBody),
      rawBodyLength: webhookReq.rawBody?.length ?? null,
    });
  });

  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        resolve({ port: address.port, server });
      }
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe("raw body capture for webhook paths", () => {
  let server: http.Server | null = null;

  afterEach(async () => {
    if (server) {
      await closeServer(server);
      server = null;
    }
  });

  it("populates rawBody as a Buffer for POST /webhooks/linear", async () => {
    const { port, server: s } = await startApp();
    server = s;

    const payload = JSON.stringify({ action: "update", type: "Issue" });
    const response = await fetch(`http://127.0.0.1:${port}/webhooks/linear`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as { hasRawBody: boolean; rawBodyLength: number | null };
    expect(body.hasRawBody).toBe(true);
    expect(body.rawBodyLength).toBe(Buffer.byteLength(payload));
  });

  it("captures rawBody for an application/x-www-form-urlencoded Slack request (NIN-250)", async () => {
    const { port, server: s } = await startApp();
    server = s;

    const interaction = JSON.stringify({ type: "block_actions", user: { id: "U1" } });
    const formBody = new URLSearchParams({ payload: interaction }).toString();
    const response = await fetch(`http://127.0.0.1:${port}/webhooks/slack`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody,
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as { hasRawBody: boolean; decodedPayload: string | null };
    expect(body.hasRawBody).toBe(true);
    // The raw buffer is the exact urlencoded bytes, so signature verification can recompute
    // the HMAC and the handler can decode the Slack `payload` field.
    expect(body.decodedPayload).toBe(interaction);
  });

  it("does NOT populate rawBody for POST to non-webhook path", async () => {
    const { port, server: s } = await startApp();
    server = s;

    const response = await fetch(`http://127.0.0.1:${port}/api/v1/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "manual" }),
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as { hasRawBody: boolean; rawBodyLength: number | null };
    expect(body.hasRawBody).toBe(false);
    expect(body.rawBodyLength).toBeNull();
  });
});
