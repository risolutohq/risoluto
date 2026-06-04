import type { RisolutoLogger } from "../core/types.js";
import {
  type NotificationChannel,
  type NotificationEvent,
  type NotificationSeverity,
  type NotificationVerbosity,
  shouldDeliverByMinSeverity,
  shouldDeliverByVerbosity,
} from "./channel.js";
import { deliverWebhookJson } from "./webhook-delivery.js";

const DEFAULT_TIMEOUT_MS = 10_000;

function metadataLines(metadata: Record<string, unknown> | undefined): string[] {
  if (!metadata) {
    return [];
  }
  return Object.entries(metadata)
    .slice(0, 8)
    .map(([key, value]) => {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return `${key}: ${String(value)}`;
      }
      return `${key}: ${JSON.stringify(value)}`;
    });
}

// Slack mrkdwn treats &, <, > as control characters; escape them in issue/operator-derived text so a
// title or message can't break the message layout or forge link/markup syntax (NIN-266).
function escapeSlackMrkdwn(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

// A Slack link target lives inside `<url|label>`; percent-encode the characters that would otherwise
// close the link (`>`), split off the label (`|`), or open a nested link (`<`) so an attacker-controlled
// issue URL cannot break out and inject markup. `&` is left intact so query strings stay valid (NIN-266).
function escapeSlackLinkUrl(url: string): string {
  return url.replaceAll("<", "%3C").replaceAll(">", "%3E").replaceAll("|", "%7C");
}

// Slack offers no escaping inside a ``` code fence, so a value containing a backtick run could close the
// fence and inject markup after it; neutralize backticks before fencing attacker-influenced metadata.
function neutralizeCodeFence(text: string): string {
  return text.replaceAll("`", "'");
}

function slackColorForSeverity(severity: NotificationEvent["severity"]): string {
  return severity === "critical" ? "#d32f2f" : "#1d4ed8";
}

function slackSeverityTag(severity: NotificationEvent["severity"]): string {
  return severity === "critical" ? "CRITICAL" : "INFO";
}

function buildSlackPayload(event: NotificationEvent): Record<string, unknown> {
  const details = [
    `Issue: ${escapeSlackMrkdwn(event.issue.identifier)}`,
    `Attempt: ${event.attempt ?? "n/a"}`,
    `Type: ${event.type}`,
    `Severity: ${slackSeverityTag(event.severity)}`,
    `At: ${event.timestamp}`,
  ];
  if (event.issue.state) {
    details.push(`State: ${escapeSlackMrkdwn(event.issue.state)}`);
  }
  const metadata = metadataLines(event.metadata);
  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: event.title ?? `Risoluto ${slackSeverityTag(event.severity)} ${event.type}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${escapeSlackMrkdwn(event.issue.identifier)}* - ${escapeSlackMrkdwn(event.issue.title)}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: escapeSlackMrkdwn(event.message),
      },
    },
    {
      type: "context",
      elements: details.map((line) => ({ type: "mrkdwn", text: line })),
    },
  ];

  if (event.issue.url) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `<${escapeSlackLinkUrl(event.issue.url)}|Open issue>`,
      },
    });
  }
  if (metadata.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `\`\`\`${neutralizeCodeFence(metadata.join("\n"))}\`\`\``,
      },
    });
  }

  return {
    text: `[Risoluto ${slackSeverityTag(event.severity)}] ${escapeSlackMrkdwn(event.issue.identifier)}: ${escapeSlackMrkdwn(event.message)}`,
    attachments: [
      {
        color: slackColorForSeverity(event.severity),
        blocks,
      },
    ],
  };
}

interface SlackWebhookChannelOptions {
  name?: string;
  webhookUrl: string;
  verbosity: NotificationVerbosity;
  minSeverity?: NotificationSeverity;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  logger?: RisolutoLogger;
}

export class SlackWebhookChannel implements NotificationChannel {
  readonly name: string;

  private readonly timeoutMs: number;

  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: SlackWebhookChannelOptions) {
    this.name = options.name ?? "slack_webhook";
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async notify(event: NotificationEvent): Promise<void> {
    if (!shouldDeliverByVerbosity(event, this.options.verbosity)) {
      return;
    }
    if (!shouldDeliverByMinSeverity(event.severity, this.options.minSeverity ?? "info")) {
      return;
    }

    await deliverWebhookJson({
      channelName: this.name,
      url: this.options.webhookUrl,
      payload: buildSlackPayload(event),
      failureLabel: "slack webhook",
      event,
      timeoutMs: this.timeoutMs,
      fetchImpl: this.fetchImpl,
      logger: this.options.logger,
    });
  }
}
