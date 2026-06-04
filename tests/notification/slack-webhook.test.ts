import { describe, expect, it, vi } from "vitest";

import type { NotificationEvent } from "../../src/notification/channel.js";
import { SlackWebhookChannel } from "../../src/notification/slack-webhook.js";

function baseEvent(overrides?: Partial<NotificationEvent>): NotificationEvent {
  return {
    type: "worker_failed",
    severity: "critical",
    timestamp: "2026-03-17T02:00:00.000Z",
    message: "worker crashed while applying patch",
    issue: {
      id: "issue-1",
      identifier: "MT-42",
      title: "Fix flaky test",
      state: "In Progress",
      url: "https://linear.app/example/issue/MT-42",
    },
    attempt: 3,
    metadata: {
      errorCode: "turn_failed",
      runId: "run-123",
    },
    ...overrides,
  };
}

describe("SlackWebhookChannel", () => {
  it("skips all messages when verbosity is off", async () => {
    const fetchMock = vi.fn();
    const channel = new SlackWebhookChannel({
      webhookUrl: "https://hooks.slack.test/one",
      verbosity: "off",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await channel.notify(baseEvent());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips non-critical messages when verbosity is critical", async () => {
    const fetchMock = vi.fn();
    const channel = new SlackWebhookChannel({
      webhookUrl: "https://hooks.slack.test/one",
      verbosity: "critical",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await channel.notify(baseEvent({ severity: "info", type: "worker_retry" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("escapes Slack mrkdwn special characters in issue title and message (NIN-266)", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => "ok" }));
    const channel = new SlackWebhookChannel({
      webhookUrl: "https://hooks.slack.test/one",
      verbosity: "critical",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await channel.notify(
      baseEvent({
        issue: {
          id: "issue-1",
          identifier: "MT-42",
          title: "fix <script> & <b>",
          state: "In Progress",
          url: "https://linear.app/example/issue/MT-42",
        },
        message: "a < b && c > d",
      }),
    );

    const body = (fetchMock.mock.calls[0]?.[1] as { body: string }).body;
    expect(body).toContain("fix &lt;script&gt; &amp; &lt;b&gt;");
    expect(body).toContain("a &lt; b &amp;&amp; c &gt; d");
    // The raw, unescaped user markup never reaches a mrkdwn field.
    expect(body).not.toContain("<script>");
  });

  it("escapes the context-block identifier/state, the issue URL, and the metadata code fence (NIN-266)", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => "ok" }));
    const channel = new SlackWebhookChannel({
      webhookUrl: "https://hooks.slack.test/one",
      verbosity: "critical",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await channel.notify(
      baseEvent({
        issue: {
          id: "issue-1",
          identifier: "<http://evil.test|MT-42>",
          title: "ok",
          state: "<b>danger</b>",
          url: "https://linear.app/x>injected*bold*",
        },
        metadata: { note: "```\ninjected-after-fence" },
      }),
    );

    const payload = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as { body: string }).body)) as {
      attachments: Array<{
        blocks: Array<{ type: string; elements?: Array<{ text: string }>; text?: { text: string } }>;
      }>;
    };
    const blocks = payload.attachments[0]?.blocks ?? [];
    // Context block (index 3) escapes the issue identifier and state.
    const contextText = (blocks[3]?.elements ?? []).map((element) => element.text).join("\n");
    expect(contextText).toContain("Issue: &lt;http://evil.test|MT-42&gt;");
    expect(contextText).toContain("State: &lt;b&gt;danger&lt;/b&gt;");
    // URL block (index 4): the link target can't terminate its <url|label> anchor.
    expect(blocks[4]?.text?.text).toBe("<https://linear.app/x%3Einjected*bold*|Open issue>");
    // Metadata block (index 5): backticks neutralized so the value can't close the ``` fence.
    expect(blocks[5]?.text?.text).not.toContain("```\ninjected");
    expect(blocks[5]?.text?.text).toContain("note: '''");
  });

  it("posts a block payload for critical events", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "ok",
    }));
    const channel = new SlackWebhookChannel({
      webhookUrl: "https://hooks.slack.test/one",
      verbosity: "critical",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await channel.notify(baseEvent());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://hooks.slack.test/one",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "content-type": "application/json; charset=utf-8",
        }),
      }),
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.text).toContain("MT-42");
    expect(body.attachments[0].blocks[0].type).toBe("header");
    expect(body.attachments[0].blocks[2].text.text).toContain("worker crashed");
  });

  it("throws on non-success webhook responses", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 503,
      text: async () => "temporary upstream outage",
    }));
    const channel = new SlackWebhookChannel({
      webhookUrl: "https://hooks.slack.test/one",
      verbosity: "verbose",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(channel.notify(baseEvent())).rejects.toThrow("status 503");
  });
});
