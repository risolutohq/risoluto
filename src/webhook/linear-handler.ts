import type { Response } from "express";

import type { TypedEventBus } from "../core/event-bus.js";
import type { RisolutoEventMap } from "../core/risoluto-events.js";
import type { RisolutoLogger } from "../core/types.js";
import type { VerifiedWebhookDeliveryStore } from "./delivery-workflow.js";
import { WebhookDeliveryWorkflow } from "./delivery-workflow.js";
import { computeWebhookBodyDigest, verifyLinearSignature } from "./signature.js";
import type { ApiErrorResponse } from "../http/service-errors.js";
import type { LinearWebhookPayload, WebhookRequest } from "../http/webhook-types.js";
import {
  COMMENT_ACTIONS,
  ISSUE_ACTIONS,
  SUPPORTED_WEBHOOK_TYPES,
  validateWebhookPayload,
} from "../http/webhook-types.js";
import type { LinearTriggeredWorkflowRunRequest } from "../workflow-run/linear-intake.js";
import type { GitHubTriggeredWorkflowRunRequest } from "../workflow-run/tracker-intake.js";

const REPLAY_WINDOW_MS = 60_000;

interface WorkflowRunAcceptedResult {
  workflowRun: {
    id: string;
    source: "api" | "cli" | "github" | "linear" | "slack";
    title: string;
    workflowDefinitionId: string;
  };
}

export interface WebhookHandlerDeps {
  getWebhookSecret: () => string | null;
  getPreviousWebhookSecret?: () => string | null;
  requestRefresh: (reason: string) => void;
  requestTargetedRefresh?: (issueId: string, issueIdentifier: string, reason: string) => void;
  stopWorkerForIssue?: (issueIdentifier: string, reason: string) => void;
  /**
   * Record an inbound external (tracker board) status change as an observation (NIN-270). Read-only:
   * it must NOT mutate canonical Workflow Run truth. The composition wires this to the inbound twin of
   * `projectWorkflowRunStatus` — `observeExternalStatusChange` — keyed on the run's current canonical status.
   */
  observeExternalStatusChange?: (input: { issueId: string; issueIdentifier: string; externalStatus: string }) => void;
  recordVerifiedDelivery: (eventType: string) => void;
  acceptLinearTriggeredWorkflowRun?: (input: LinearTriggeredWorkflowRunRequest) => Promise<unknown>;
  acceptGitHubTriggeredWorkflowRun?: (input: GitHubTriggeredWorkflowRunRequest) => Promise<unknown>;
  webhookInbox?: VerifiedWebhookDeliveryStore;
  eventBus?: Pick<TypedEventBus<RisolutoEventMap>, "emit">;
  logger: RisolutoLogger;
}

function sendError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } } satisfies ApiErrorResponse);
}

function extractDeliveryId(req: WebhookRequest): string | null {
  const header = req.get("linear-delivery");
  if (!header) return null;
  return header.trim();
}

function extractIssueInfo(
  data: Record<string, unknown>,
  type: string,
): { issueId: string | null; issueIdentifier: string | null } {
  if (type === "Issue") {
    const issueId = typeof data.id === "string" ? data.id : null;
    const issueIdentifier = typeof data.identifier === "string" ? data.identifier : null;
    return { issueId, issueIdentifier };
  }
  const issue = data.issue as Record<string, unknown> | undefined;
  if (issue && typeof issue === "object") {
    const issueId = typeof issue.id === "string" ? issue.id : null;
    const issueIdentifier = typeof issue.identifier === "string" ? issue.identifier : null;
    return { issueId, issueIdentifier };
  }
  return { issueId: null, issueIdentifier: null };
}

export function handleWebhookLinear(deps: WebhookHandlerDeps, req: WebhookRequest, res: Response): void {
  const secret = deps.getWebhookSecret();
  if (!secret) {
    res.setHeader("Retry-After", "5");
    sendError(res, 503, "webhook_not_configured", "Webhook signing secret is not configured");
    return;
  }

  const signature = req.get("linear-signature");
  if (!signature) {
    sendError(res, 401, "signature_missing", "Missing Linear-Signature header");
    return;
  }

  const rawBody = req.rawBody;
  if (!rawBody) {
    sendError(res, 401, "signature_invalid", "Unable to verify signature — raw body unavailable");
    return;
  }

  let signatureValid = verifyLinearSignature(rawBody, signature, secret);
  let usedPreviousSecret = false;
  if (!signatureValid) {
    const previousSecret = deps.getPreviousWebhookSecret?.();
    if (previousSecret) {
      signatureValid = verifyLinearSignature(rawBody, signature, previousSecret);
      usedPreviousSecret = signatureValid;
    }
  }
  if (!signatureValid) {
    deps.logger.warn(
      { path: req.path, remoteAddress: req.socket.remoteAddress },
      "webhook signature verification failed — possible tampering or misconfigured secret",
    );
    sendError(res, 401, "signature_invalid", "Invalid webhook signature");
    return;
  }

  const body = req.body as LinearWebhookPayload;
  const validationError = validateWebhookPayload(body);
  if (validationError) {
    sendError(res, 400, "invalid_payload", validationError);
    return;
  }

  const timestamp = body.webhookTimestamp;
  if (Math.abs(Date.now() - timestamp) > REPLAY_WINDOW_MS) {
    sendError(res, 401, "replay_rejected", "Webhook timestamp outside acceptable window");
    return;
  }

  const deliveryId = extractDeliveryId(req);
  if (!deliveryId) {
    sendError(res, 400, "delivery_missing", "Missing Linear delivery header");
    return;
  }

  // Require durable inbox persistence before accepting a verified delivery — without it there is no
  // durable idempotency, so a replayed signed body would re-trigger side effects (RIS-263).
  if (!deps.webhookInbox) {
    res.setHeader("Retry-After", "5");
    sendError(res, 503, "webhook_inbox_unavailable", "Webhook inbox persistence is unavailable");
    return;
  }

  const action = body.action;
  const type = body.type;
  const eventType = `${type}:${action}`;
  const { issueId, issueIdentifier } = extractIssueInfo(body.data, type);
  const workflow = new WebhookDeliveryWorkflow(deps.logger, deps.webhookInbox, deps.eventBus);

  workflow.respondAccepted(res, {
    delivery: {
      deliveryId,
      // Dedupe on the verified body+signature digest so replaying the same signed payload under a
      // fresh Linear-Delivery id is still recognized as a duplicate (RIS-263).
      bodyDigest: computeWebhookBodyDigest(rawBody, signature),
      type,
      action,
      entityId: typeof body.data.id === "string" ? body.data.id : null,
      issueId,
      issueIdentifier,
      webhookTimestamp: timestamp,
      payloadJson: JSON.stringify(body),
    },
    eventType,
    recordVerifiedDelivery: deps.recordVerifiedDelivery,
    duplicateMessage: "duplicate webhook delivery — skipped",
    errorMessage: "unhandled error in webhook side-effect processing",
    process: () =>
      processWebhookEvent(deps, type, action, body, deliveryId, issueId, issueIdentifier, usedPreviousSecret),
  });
}

async function processWebhookEvent(
  deps: WebhookHandlerDeps,
  type: string,
  action: string,
  body: LinearWebhookPayload,
  deliveryId: string,
  issueId: string | null,
  issueIdentifier: string | null,
  usedPreviousSecret: boolean,
): Promise<void> {
  const logCtx = { type, action, issueId, issueIdentifier, usedPreviousSecret };

  if (!SUPPORTED_WEBHOOK_TYPES.has(type)) {
    deps.logger.debug(logCtx, "unsupported webhook type — ignored");
    return;
  }

  if (type === "Issue" && ISSUE_ACTIONS.has(action)) {
    await handleIssueEvent(deps, action, body, deliveryId, issueId, issueIdentifier);
    return;
  }

  if (type === "Comment" && COMMENT_ACTIONS.has(action)) {
    await maybeAcceptLinearRetryComment(deps, body, deliveryId);
    handleCommentEvent(deps, action, issueId, issueIdentifier);
    return;
  }

  deps.logger.debug(logCtx, "supported type but unsupported action — ignored");
}

async function handleIssueEvent(
  deps: WebhookHandlerDeps,
  action: string,
  body: LinearWebhookPayload,
  deliveryId: string,
  issueId: string | null,
  issueIdentifier: string | null,
): Promise<void> {
  if (action === "create" || action === "update") {
    await maybeAcceptLinearTriggeredWorkflowRun(deps, action, body, deliveryId, issueId, issueIdentifier);
  }

  if (issueId && issueIdentifier && deps.requestTargetedRefresh) {
    deps.requestTargetedRefresh(issueId, issueIdentifier, `webhook:issue:${action}`);
    maybeObserveExternalStatus(deps, action, body, issueId, issueIdentifier);
    maybeStopWorker(deps, action, body, issueIdentifier);
    return;
  }

  deps.requestRefresh(`webhook:issue:${action}`);
}

async function maybeAcceptLinearTriggeredWorkflowRun(
  deps: WebhookHandlerDeps,
  action: string,
  body: LinearWebhookPayload,
  deliveryId: string,
  issueId: string | null,
  issueIdentifier: string | null,
): Promise<void> {
  if (!deps.acceptLinearTriggeredWorkflowRun || !issueId || !issueIdentifier) {
    return;
  }

  const data = body.data;
  const title = typeof data.title === "string" ? data.title : null;
  if (!title) {
    return;
  }

  const result = await deps.acceptLinearTriggeredWorkflowRun({
    action,
    deliveryId,
    issue: {
      id: issueId,
      identifier: issueIdentifier,
      title,
      url: typeof data.url === "string" ? data.url : (body.url ?? null),
      description: typeof data.description === "string" ? data.description : null,
      labels: extractLinearLabelNames(data),
    },
  });
  emitWorkflowRunAccepted(deps, result);
}

interface LinearCommentIssue {
  readonly issueId: string;
  readonly issueIdentifier: string;
  readonly title: string;
  readonly url: string | null;
  readonly description: string | null;
}

/** Extract the associated issue from a Linear Comment webhook data payload. Returns null if required fields are missing. */
function extractLinearCommentIssue(data: Record<string, unknown>): LinearCommentIssue | null {
  const issueData = data.issue as Record<string, unknown> | undefined;
  if (!issueData || typeof issueData !== "object") return null;
  const issueId = typeof issueData.id === "string" ? issueData.id : null;
  const issueIdentifier = typeof issueData.identifier === "string" ? issueData.identifier : null;
  const title = typeof issueData.title === "string" ? issueData.title : null;
  if (!issueId || !issueIdentifier || !title) return null;
  return {
    issueId,
    issueIdentifier,
    title,
    url: typeof issueData.url === "string" ? issueData.url : null,
    description: typeof issueData.description === "string" ? issueData.description : null,
  };
}

/**
 * If the Comment event body is a retry command, drive it through the Linear intake so the
 * idempotency store records a new attempt on the existing Workflow Run (NIN-106).
 */
async function maybeAcceptLinearRetryComment(
  deps: WebhookHandlerDeps,
  body: LinearWebhookPayload,
  deliveryId: string,
): Promise<void> {
  if (!deps.acceptLinearTriggeredWorkflowRun) return;
  const data = body.data;
  const commentBody = typeof data.body === "string" ? data.body : null;
  if (!commentBody) return;
  const normalized = commentBody.trim().toLowerCase();
  if (normalized !== "/risoluto retry" && normalized !== "risoluto retry") return;
  const issue = extractLinearCommentIssue(data);
  if (!issue) return;
  const result = await deps.acceptLinearTriggeredWorkflowRun({
    action: "comment",
    deliveryId,
    issue: {
      id: issue.issueId,
      identifier: issue.issueIdentifier,
      title: issue.title,
      url: issue.url,
      description: issue.description,
      comments: [commentBody],
    },
  });
  emitWorkflowRunAccepted(deps, result);
}

function extractLinearLabelNames(data: Record<string, unknown>): readonly string[] {
  const rawLabels = data.labels;
  if (!Array.isArray(rawLabels)) return [];
  return rawLabels
    .map((label) => {
      if (typeof label === "object" && label !== null) {
        const name = (label as Record<string, unknown>).name;
        return typeof name === "string" ? name : null;
      }
      return null;
    })
    .filter((name): name is string => name !== null && name.length > 0);
}

function emitWorkflowRunAccepted(deps: WebhookHandlerDeps, result: unknown): void {
  if (!isWorkflowRunAcceptedResult(result)) {
    return;
  }

  deps.eventBus?.emit("workflow_run.accepted", {
    workflowRunId: result.workflowRun.id,
    source: result.workflowRun.source,
    title: result.workflowRun.title,
    workflowDefinitionId: result.workflowRun.workflowDefinitionId,
  });
}

function isWorkflowRunAcceptedResult(result: unknown): result is WorkflowRunAcceptedResult {
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

function handleCommentEvent(
  deps: WebhookHandlerDeps,
  action: string,
  issueId: string | null,
  issueIdentifier: string | null,
): void {
  if (issueId && issueIdentifier && deps.requestTargetedRefresh) {
    deps.requestTargetedRefresh(issueId, issueIdentifier, `webhook:comment:${action}`);
    return;
  }

  deps.requestRefresh(`webhook:comment:${action}`);
}

/**
 * Forward an inbound external status change (the board's new `state.name` on an Issue update) to the
 * read-only observation seam. The handler only knows the external status and issue identity here — the
 * composition resolves the canonical run status and records the observation without mutating it (NIN-270).
 */
function maybeObserveExternalStatus(
  deps: WebhookHandlerDeps,
  action: string,
  body: LinearWebhookPayload,
  issueId: string,
  issueIdentifier: string,
): void {
  if (action !== "update" || !deps.observeExternalStatusChange) {
    return;
  }

  const data = body.data as Record<string, unknown>;
  const state = data.state as Record<string, unknown> | undefined;
  const externalStatus = typeof state?.name === "string" ? state.name : null;
  if (!externalStatus) {
    return;
  }

  deps.observeExternalStatusChange({ issueId, issueIdentifier, externalStatus });
}

function maybeStopWorker(
  deps: WebhookHandlerDeps,
  action: string,
  body: LinearWebhookPayload,
  issueIdentifier: string,
): void {
  if (action !== "update") {
    return;
  }

  const data = body.data as Record<string, unknown>;
  const state = data.state as Record<string, unknown> | undefined;
  const stateName = typeof state?.name === "string" ? state.name : null;
  if (!stateName) {
    return;
  }

  if (["done", "cancelled", "canceled", "archived", "closed"].includes(stateName.toLowerCase())) {
    deps.stopWorkerForIssue?.(issueIdentifier, `webhook:issue:update:state=${stateName}`);
  }
}

export { verifyLinearSignature } from "./signature.js";
