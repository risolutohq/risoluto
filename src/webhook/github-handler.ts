import { createHash } from "node:crypto";

import type { Response } from "express";

import type { ConfigStore } from "../config/store.js";
import type { TypedEventBus } from "../core/event-bus.js";
import type { RisolutoEventMap } from "../core/risoluto-events.js";
import type { RisolutoLogger } from "../core/types.js";
import type { ApiErrorResponse } from "../http/service-errors.js";
import type { WebhookRequest } from "../http/webhook-types.js";
import { asRecord, asStringOrNull } from "../utils/type-guards.js";
import type { GitHubTriggeredWorkflowRunRequest } from "../workflow-run/tracker-intake.js";
import type { VerifiedWebhookDeliveryStore } from "./delivery-workflow.js";
import { WebhookDeliveryWorkflow } from "./delivery-workflow.js";
import { verifyGitHubSignature } from "./signature.js";

const SUPPORTED_GITHUB_ISSUE_ACTIONS = new Set(["opened", "edited", "reopened", "closed", "labeled", "unlabeled"]);

type ServiceConfig = ReturnType<ConfigStore["getConfig"]>;

export interface GitHubWebhookHandlerDeps {
  configStore?: ConfigStore;
  requestTargetedRefresh?: (issueId: string, issueIdentifier: string, reason: string) => void;
  stopWorkerForIssue?: (issueIdentifier: string, reason: string) => void;
  acceptGitHubTriggeredWorkflowRun?: (input: GitHubTriggeredWorkflowRunRequest) => Promise<unknown>;
  webhookInbox?: VerifiedWebhookDeliveryStore;
  eventBus?: Pick<TypedEventBus<RisolutoEventMap>, "emit">;
  logger: RisolutoLogger;
}

interface GitHubWebhookContext {
  action: string;
  bodyDigest: string;
  config: ServiceConfig | undefined;
  deliveryId: string;
  event: string;
  issueId: string | null;
  issueIdentifier: string | null;
  payload: Record<string, unknown>;
  repoFullName: string | null;
}

function sendError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } } satisfies ApiErrorResponse);
}

/**
 * SHA-256 digest of the verified raw body and signature. Replay protection dedupes on this rather
 * than the spoofable X-GitHub-Delivery header, so a captured signed body replayed under a fresh
 * delivery id is still recognized as a duplicate (NIN-262).
 */
function computeBodyDigest(rawBody: Buffer | string, signature: string): string {
  return createHash("sha256").update(rawBody).update("\n").update(signature).digest("hex");
}

function validateGitHubWebhookRequest(
  deps: GitHubWebhookHandlerDeps,
  req: WebhookRequest,
  res: Response,
): { config: ServiceConfig | undefined; event: string; bodyDigest: string } | null {
  const config = deps.configStore?.getConfig();
  const secret = config?.triggers?.githubSecret ?? null;
  if (!secret) {
    sendError(res, 503, "webhook_not_configured", "GitHub webhook signing secret is not configured");
    return null;
  }

  const signature = req.get("x-hub-signature-256");
  if (!signature) {
    sendError(res, 401, "signature_missing", "Missing X-Hub-Signature-256 header");
    return null;
  }

  if (!req.rawBody) {
    sendError(res, 401, "signature_invalid", "Unable to verify signature — raw body unavailable");
    return null;
  }

  if (!verifyGitHubSignature(req.rawBody, signature, secret)) {
    deps.logger.warn({ path: req.path, remoteAddress: req.socket.remoteAddress }, "github webhook signature invalid");
    sendError(res, 401, "signature_invalid", "Invalid GitHub webhook signature");
    return null;
  }

  const event = req.get("x-github-event");
  if (!event) {
    sendError(res, 400, "event_missing", "Missing X-GitHub-Event header");
    return null;
  }

  const deliveryId = req.get("x-github-delivery")?.trim();
  if (!deliveryId) {
    sendError(res, 400, "delivery_missing", "Missing X-GitHub-Delivery header");
    return null;
  }

  if (!deps.webhookInbox) {
    sendError(res, 503, "webhook_inbox_unavailable", "GitHub webhook inbox persistence is unavailable");
    return null;
  }

  return { config, event, bodyDigest: computeBodyDigest(req.rawBody, signature) };
}

function buildGitHubWebhookContext(
  req: WebhookRequest,
  validated: { config: ServiceConfig | undefined; event: string; bodyDigest: string },
): GitHubWebhookContext {
  const payload = asRecord(req.body);
  const action = asStringOrNull(payload.action) ?? "unknown";
  const issue = asRecord(payload.issue);
  const repository = asRecord(payload.repository);
  const repoFullName = asStringOrNull(repository.full_name);
  const issueNumber = typeof issue.number === "number" ? issue.number : null;

  const issueId = issueNumber === null ? null : String(issueNumber);
  const issueIdentifier = issueNumber === null || !repoFullName ? null : `${repoFullName}#${issueNumber}`;

  return {
    action,
    bodyDigest: validated.bodyDigest,
    config: validated.config,
    deliveryId: req.get("x-github-delivery")?.trim() ?? "",
    event: validated.event,
    issueId,
    issueIdentifier,
    payload,
    repoFullName,
  };
}

export function handleWebhookGitHub(deps: GitHubWebhookHandlerDeps, req: WebhookRequest, res: Response): void {
  const validated = validateGitHubWebhookRequest(deps, req, res);
  if (!validated) {
    return;
  }

  const context = buildGitHubWebhookContext(req, validated);
  const workflow = new WebhookDeliveryWorkflow(deps.logger, deps.webhookInbox, deps.eventBus);
  workflow.respondAccepted(res, {
    delivery: {
      deliveryId: context.deliveryId,
      bodyDigest: context.bodyDigest,
      type: context.event,
      action: context.action,
      entityId: context.issueId,
      issueId: context.issueId,
      issueIdentifier: context.issueIdentifier,
      webhookTimestamp: null,
      payloadJson: JSON.stringify(context.payload),
    },
    duplicateMessage: "duplicate github webhook delivery skipped",
    errorMessage: "github webhook processing failed",
    process: () =>
      processGitHubWebhook(
        deps,
        context.config,
        context.event,
        context.action,
        context.payload,
        context.deliveryId,
        context.repoFullName,
        context.issueId,
        context.issueIdentifier,
      ),
  });
}

async function processGitHubWebhook(
  deps: GitHubWebhookHandlerDeps,
  config: ServiceConfig | undefined,
  event: string,
  action: string,
  payload: Record<string, unknown>,
  deliveryId: string,
  repoFullName: string | null,
  issueId: string | null,
  issueIdentifier: string | null,
): Promise<void> {
  if (event !== "issues" || !SUPPORTED_GITHUB_ISSUE_ACTIONS.has(action)) {
    deps.logger.debug({ event, action }, "github webhook event ignored");
    return;
  }

  const configuredRepo =
    config?.tracker.kind === "github" && config.tracker.owner && config.tracker.repo
      ? `${config.tracker.owner}/${config.tracker.repo}`.toLowerCase()
      : null;
  if (!configuredRepo || !repoFullName || configuredRepo !== repoFullName.toLowerCase()) {
    deps.logger.debug({ event, action, repoFullName, configuredRepo }, "github webhook repo does not match tracker");
    return;
  }
  if (!issueId || !issueIdentifier) {
    deps.logger.debug({ event, action }, "github webhook missing issue identity");
    return;
  }

  await maybeAcceptGitHubTriggeredWorkflowRun(deps, action, payload, deliveryId, issueId, issueIdentifier);
  deps.requestTargetedRefresh?.(issueId, issueIdentifier, `github:${event}:${action}`);
  if (action === "closed") {
    deps.stopWorkerForIssue?.(issueIdentifier, "github webhook reported issue closed");
  }
}

async function maybeAcceptGitHubTriggeredWorkflowRun(
  deps: GitHubWebhookHandlerDeps,
  action: string,
  payload: Record<string, unknown>,
  deliveryId: string,
  issueId: string,
  issueIdentifier: string,
): Promise<void> {
  const issue = toGitHubTriggeredWorkflowRunIssue(payload, issueId, issueIdentifier);
  if (!deps.acceptGitHubTriggeredWorkflowRun || !issue) {
    return;
  }

  const result = await deps.acceptGitHubTriggeredWorkflowRun({
    deliveryKind: "webhook",
    deliveryId,
    action,
    issue,
  });
  emitGitHubWorkflowRunAccepted(deps, result);
}

function emitGitHubWorkflowRunAccepted(deps: GitHubWebhookHandlerDeps, result: unknown): void {
  if (!deps.eventBus || !isAcceptedWorkflowRunResult(result)) {
    return;
  }
  deps.eventBus.emit("workflow_run.accepted", {
    workflowRunId: result.workflowRun.id,
    source: result.workflowRun.source,
    title: result.workflowRun.title,
    workflowDefinitionId: result.workflowRun.workflowDefinitionId,
  });
}

function isAcceptedWorkflowRunResult(result: unknown): result is {
  workflowRun: {
    id: string;
    source: "api" | "cli" | "github" | "linear" | "slack";
    title: string;
    workflowDefinitionId: string;
  };
} {
  if (!result || typeof result !== "object") {
    return false;
  }
  const workflowRun = (result as { workflowRun?: unknown }).workflowRun;
  if (!workflowRun || typeof workflowRun !== "object") {
    return false;
  }
  const record = workflowRun as Record<string, unknown>;
  const validSources = new Set(["api", "cli", "github", "linear", "slack"]);
  return (
    typeof record.id === "string" &&
    typeof record.source === "string" &&
    validSources.has(record.source) &&
    typeof record.title === "string" &&
    typeof record.workflowDefinitionId === "string"
  );
}

function toGitHubTriggeredWorkflowRunIssue(
  payload: Record<string, unknown>,
  issueId: string,
  issueIdentifier: string,
): GitHubTriggeredWorkflowRunRequest["issue"] | null {
  const issue = asRecord(payload.issue);
  const title = asStringOrNull(issue.title);
  if (!title) {
    return null;
  }

  return {
    id: issueId,
    identifier: issueIdentifier,
    title,
    url: asStringOrNull(issue.html_url),
    description: asStringOrNull(issue.body),
    labels: extractGitHubLabelNames(issue),
    state: asStringOrNull(issue.state),
  };
}

function extractGitHubLabelNames(issue: Record<string, unknown>): readonly string[] {
  const labels = issue.labels;
  if (!Array.isArray(labels)) {
    return [];
  }
  return labels
    .map((label) => asStringOrNull(asRecord(label).name))
    .filter((label): label is string => typeof label === "string" && label.length > 0);
}

export { verifyGitHubSignature };
