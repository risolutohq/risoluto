import { describe, expect, it, vi } from "vitest";
import type { Request } from "express";

import {
  handleListNotifications,
  handleMarkAllNotificationsRead,
  handleMarkNotificationRead,
  handleTestSlackNotification,
} from "../../src/http/notifications-handler.js";
import { SlackWebhookChannel } from "../../src/notification/slack-webhook.js";
import type { ConfigStore } from "../../src/config/store.js";
import type { ServiceConfig } from "../../src/core/types.js";
import type { NotificationStorePort } from "../../src/notification/port.js";
import { createJsonResponse, createMockLogger, createTextResponse, makeMockResponse } from "../helpers.js";

function makeConfigStore(
  notifications: ServiceConfig["notifications"] extends infer _U ? unknown : never,
): ConfigStore {
  return {
    getConfig: () => ({ notifications }) as unknown as ServiceConfig,
  } as unknown as ConfigStore;
}

function slackChannel(webhookUrl: string, verbosity = "critical"): Record<string, unknown> {
  return { type: "slack", name: "slack", enabled: true, minSeverity: "info", webhookUrl, verbosity };
}

function emptyRequest(): Request {
  return {} as unknown as Request;
}

describe("handleTestSlackNotification", () => {
  it("returns 503 when config store is not available", async () => {
    const res = makeMockResponse();
    await handleTestSlackNotification({}, emptyRequest(), res);
    expect(res._status).toBe(503);
    expect((res._body as { error: { code: string } }).error.code).toBe("not_configured");
  });

  it("returns 400 when channels[] has no slack entry", async () => {
    const configStore = makeConfigStore({ channels: [] });
    const res = makeMockResponse();
    await handleTestSlackNotification({ configStore, logger: createMockLogger() }, emptyRequest(), res);
    expect(res._status).toBe(400);
    const body = res._body as { error: { code: string; message: string } };
    expect(body.error.code).toBe("slack_not_configured");
    expect(body.error.message).toContain("Save a Slack webhook URL");
  });

  it("returns 400 when the only slack channel has no webhookUrl", async () => {
    const configStore = makeConfigStore({
      channels: [
        { type: "slack", name: "slack", enabled: true, minSeverity: "info", webhookUrl: "", verbosity: "critical" },
      ],
    });
    const res = makeMockResponse();
    await handleTestSlackNotification({ configStore, logger: createMockLogger() }, emptyRequest(), res);
    expect(res._status).toBe(400);
    expect((res._body as { error: { code: string } }).error.code).toBe("slack_not_configured");
  });

  it("dispatches a test event and selects first enabled slack channel", async () => {
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse(200, { ok: true }));
    const configStore = makeConfigStore({
      channels: [slackChannel("https://hooks.slack.com/services/T000/B000/XXXX", "off")],
    });
    const logger = createMockLogger();

    const res = makeMockResponse();
    await handleTestSlackNotification(
      {
        configStore,
        logger,
        createSlackChannel: ({ webhookUrl }) =>
          new SlackWebhookChannel({
            name: "slack_webhook_test",
            webhookUrl,
            verbosity: "verbose",
            minSeverity: "info",
            fetchImpl: fetchMock as unknown as typeof fetch,
            logger,
          }),
      },
      emptyRequest(),
      res,
    );

    expect(res._status).toBe(200);
    const body = res._body as { ok: true; sentAt: string };
    expect(body.ok).toBe(true);
    expect(typeof body.sentAt).toBe("string");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://hooks.slack.com/services/T000/B000/XXXX");
    const payload = JSON.parse((init as { body: string }).body) as { text: string };
    expect(payload.text).toContain("RIS-TEST");
  });

  it("skips disabled channels and selects the first enabled slack channel", async () => {
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse(200, { ok: true }));
    const configStore = makeConfigStore({
      channels: [
        {
          type: "slack",
          name: "disabled-slack",
          enabled: false,
          minSeverity: "info",
          webhookUrl: "https://hooks.slack.com/services/OLD",
          verbosity: "critical",
        },
        slackChannel("https://hooks.slack.com/services/T000/B000/ACTIVE"),
      ],
    });
    const logger = createMockLogger();
    const res = makeMockResponse();

    await handleTestSlackNotification(
      {
        configStore,
        logger,
        createSlackChannel: ({ webhookUrl }) =>
          new SlackWebhookChannel({
            name: "slack_webhook_test",
            webhookUrl,
            verbosity: "verbose",
            minSeverity: "info",
            fetchImpl: fetchMock as unknown as typeof fetch,
            logger,
          }),
      },
      emptyRequest(),
      res,
    );

    expect(res._status).toBe(200);
    const [url] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://hooks.slack.com/services/T000/B000/ACTIVE");
  });

  it("maps Slack 404 response to webhook_invalid", async () => {
    const fetchMock = vi.fn().mockResolvedValue(createTextResponse(404, "invalid_webhook"));
    const configStore = makeConfigStore({
      channels: [slackChannel("https://hooks.slack.com/services/T/B/X")],
    });
    const res = makeMockResponse();
    await handleTestSlackNotification(
      {
        configStore,
        createSlackChannel: ({ webhookUrl }) =>
          new SlackWebhookChannel({
            webhookUrl,
            verbosity: "verbose",
            minSeverity: "info",
            fetchImpl: fetchMock as unknown as typeof fetch,
          }),
      },
      emptyRequest(),
      res,
    );

    expect(res._status).toBe(404);
    expect((res._body as { error: { code: string } }).error.code).toBe("webhook_invalid");
  });

  it("maps Slack 500 response to upstream_error 502", async () => {
    const fetchMock = vi.fn().mockResolvedValue(createTextResponse(500, "internal error"));
    const configStore = makeConfigStore({
      channels: [slackChannel("https://hooks.slack.com/services/T/B/X")],
    });
    const res = makeMockResponse();
    await handleTestSlackNotification(
      {
        configStore,
        createSlackChannel: ({ webhookUrl }) =>
          new SlackWebhookChannel({
            webhookUrl,
            verbosity: "verbose",
            minSeverity: "info",
            fetchImpl: fetchMock as unknown as typeof fetch,
          }),
      },
      emptyRequest(),
      res,
    );

    expect(res._status).toBe(502);
    expect((res._body as { error: { code: string } }).error.code).toBe("upstream_error");
  });

  it("maps AbortError to 504 timeout", async () => {
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    const fetchMock = vi.fn().mockRejectedValue(abortError);
    const configStore = makeConfigStore({
      channels: [slackChannel("https://hooks.slack.com/services/T/B/X")],
    });
    const res = makeMockResponse();
    await handleTestSlackNotification(
      {
        configStore,
        createSlackChannel: ({ webhookUrl }) =>
          new SlackWebhookChannel({
            webhookUrl,
            verbosity: "verbose",
            minSeverity: "info",
            fetchImpl: fetchMock as unknown as typeof fetch,
          }),
      },
      emptyRequest(),
      res,
    );

    expect(res._status).toBe(504);
    expect((res._body as { error: { code: string } }).error.code).toBe("timeout");
  });
});

describe("handleMarkNotificationRead", () => {
  it("returns 400 when notification_id is missing", async () => {
    const res = makeMockResponse();
    const req = { params: {} } as unknown as Request;

    await handleMarkNotificationRead(
      {
        notificationStore: { markRead: vi.fn() } as unknown as NotificationStorePort,
      },
      req,
      res,
    );

    expect(res._status).toBe(400);
    expect((res._body as { error: { code: string } }).error.code).toBe("validation_error");
  });

  it("returns 404 when markRead returns null", async () => {
    const res = makeMockResponse();
    const req = { params: { notification_id: "not-found" } } as unknown as Request;
    const store = { markRead: vi.fn().mockResolvedValue(null) } as unknown as NotificationStorePort;

    await handleMarkNotificationRead({ notificationStore: store }, req, res);

    expect(res._status).toBe(404);
  });
});

describe("handleMarkAllNotificationsRead", () => {
  it("returns 200 with updatedCount and unreadCount", async () => {
    const res = makeMockResponse();
    const store = {
      markAllRead: vi.fn().mockResolvedValue({ updatedCount: 3, unreadCount: 0 }),
    } as unknown as NotificationStorePort;

    await handleMarkAllNotificationsRead({ notificationStore: store }, {} as Request, res);

    expect(res._status).toBe(200);
    const body = res._body as { ok: true; updatedCount: number; unreadCount: number };
    expect(body.ok).toBe(true);
    expect(body.updatedCount).toBe(3);
    expect(body.unreadCount).toBe(0);
  });
});

describe("handleListNotifications", () => {
  it("resolves unread=1 as true", async () => {
    const res = makeMockResponse();
    const req = { query: { unread: "1" } } as unknown as Request;
    const store = {
      list: vi.fn().mockResolvedValue([]),
      countUnread: vi.fn().mockResolvedValue(0),
      countAll: vi.fn().mockResolvedValue(0),
    } as unknown as NotificationStorePort;

    await handleListNotifications({ notificationStore: store }, req, res);

    expect(res._status).toBe(200);
    expect(store.list).toHaveBeenCalledWith(expect.objectContaining({ unreadOnly: true }));
  });

  it("resolves unread=true as true", async () => {
    const res = makeMockResponse();
    const req = { query: { unread: "true" } } as unknown as Request;
    const store = {
      list: vi.fn().mockResolvedValue([]),
      countUnread: vi.fn().mockResolvedValue(0),
      countAll: vi.fn().mockResolvedValue(0),
    } as unknown as NotificationStorePort;

    await handleListNotifications({ notificationStore: store }, req, res);

    expect(res._status).toBe(200);
    expect(store.list).toHaveBeenCalledWith(expect.objectContaining({ unreadOnly: true }));
  });
});
