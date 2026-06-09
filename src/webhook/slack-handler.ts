import type { Response } from "express";

import type { TypedEventBus } from "../core/event-bus.js";
import type { RisolutoEventMap } from "../core/risoluto-events.js";
import type { RisolutoLogger } from "../core/types.js";
import type { ApiErrorResponse } from "../http/service-errors.js";
import type { WebhookRequest } from "../http/webhook-types.js";
import { asRecord, asStringOrNull } from "../utils/type-guards.js";
import {
  acceptSlackModalWorkflowRun,
  handleSlackApprovalTap,
  type SlackModalSubmission,
} from "../workflow-run/slack-interactions.js";
import type { WorkflowRunIntakeRule } from "../workflow-run/intake-core.js";
import type { OperatorPermission } from "../workflow-run/operator-approval-contract.js";
import type { SlackOperatorIdentity } from "../workflow-run/slack-operator-approval.js";
import type { VerifiedWebhookDeliveryStore } from "./delivery-workflow.js";
import { computeWebhookBodyDigest, verifySlackSignature } from "./signature.js";

const SLACK_REPLAY_WINDOW_SECONDS = 300;

/**
 * Production deps for the inbound Slack HTTP surface. The route is registered only when these are supplied
 * (mirroring the conditional Linear/GitHub routes), so workspaces without Slack inbound configured are
 * unaffected. `operators` maps a Slack user to its Risoluto operator identity + granted permissions.
 */
export interface SlackWebhookHandlerDeps {
  signingSecret: string;
  operators: readonly SlackOperatorIdentity[];
  allowedSlackTeamIds: readonly string[];
  rules: readonly WorkflowRunIntakeRule[];
  dataDir?: string;
  archiveDir?: string;
  now: () => string;
  id: () => string;
  nowEpochSeconds: () => number;
  logger: RisolutoLogger;
  eventBus?: Pick<TypedEventBus<RisolutoEventMap>, "emit">;
  webhookInbox?: VerifiedWebhookDeliveryStore;
}

interface SlackInteractionPayload {
  readonly type: string;
  readonly team?: { readonly id?: string };
  readonly user?: { readonly id?: string };
  readonly view?: { readonly id?: string; readonly private_metadata?: string };
  readonly actions?: readonly { readonly value?: string }[];
}

/**
 * Inbound Slack interactive endpoint. Verifies the Slack signature + replay window, then dispatches:
 * - `view_submission` (modal submit) → start a Workflow Run through the shared intake pipeline.
 * - `block_actions` (button tap)     → record a single-use operator approval.
 * Always answers 200 within Slack's 3s window; unknown payloads are acknowledged without side effects.
 */
export async function handleWebhookSlack(
  deps: SlackWebhookHandlerDeps,
  req: WebhookRequest,
  res: Response,
): Promise<void> {
  const rawBody = req.rawBody;
  const signature = req.get("x-slack-signature");
  const timestamp = Number(req.get("x-slack-request-timestamp"));
  if (!rawBody || !signature || !Number.isFinite(timestamp)) {
    sendError(res, 400, "slack_request_invalid", "missing Slack signature headers or raw body");
    return;
  }
  if (Math.abs(deps.nowEpochSeconds() - timestamp) > SLACK_REPLAY_WINDOW_SECONDS) {
    sendError(res, 401, "slack_replay_rejected", "Slack request timestamp outside the replay window");
    return;
  }
  if (!verifySlackSignature(rawBody, signature, deps.signingSecret, timestamp)) {
    sendError(res, 401, "slack_signature_invalid", "Slack signature verification failed");
    return;
  }

  const payload = parseSlackInteractionPayload(rawBody);
  if (!payload) {
    sendError(res, 400, "slack_payload_invalid", "Slack interaction payload could not be parsed");
    return;
  }

  await dispatchSlackInteraction(deps, { payload, rawBody, signature, timestamp }, res);
}

interface VerifiedSlackRequest {
  readonly payload: SlackInteractionPayload;
  readonly rawBody: Buffer;
  readonly signature: string;
  readonly timestamp: number;
}

async function dispatchSlackInteraction(
  deps: SlackWebhookHandlerDeps,
  request: VerifiedSlackRequest,
  res: Response,
): Promise<void> {
  if (request.payload.type === "view_submission") {
    await dispatchModalSubmission(deps, request, res);
    return;
  }
  if (request.payload.type === "block_actions") {
    await dispatchApprovalTap(deps, request, res);
    return;
  }
  res.status(200).json({ ok: true });
}

async function dispatchModalSubmission(
  deps: SlackWebhookHandlerDeps,
  request: VerifiedSlackRequest,
  res: Response,
): Promise<void> {
  const modal = toSlackModalSubmission(request.payload);
  if (!modal) {
    sendError(res, 400, "slack_modal_invalid", "Slack modal submission is missing required metadata");
    return;
  }
  if (!deps.allowedSlackTeamIds.includes(modal.teamId)) {
    sendError(res, 403, "slack_team_not_allowed", "Slack team is not in the allowed list");
    return;
  }
  const dedupe = await deduplicateSlackModal(deps, request, modal);
  if (dedupe === "unavailable") {
    res.setHeader("Retry-After", "5");
    sendError(res, 503, "webhook_inbox_unavailable", "Slack webhook inbox persistence is unavailable");
    return;
  }
  if (dedupe === "duplicate") {
    res.status(200).json({ response_action: "clear" });
    return;
  }
  let intake: Awaited<ReturnType<typeof acceptSlackModalWorkflowRun>>;
  try {
    intake = await acceptSlackModalWorkflowRun({
      dataDir: deps.dataDir,
      archiveDir: deps.archiveDir,
      modal,
      rules: deps.rules,
      now: deps.now,
      id: deps.id,
    });
  } catch (error) {
    // Intake failed: drop the dedup row so Slack's at-least-once redelivery re-drives intake instead of
    // being swallowed as a duplicate tombstone. acceptSlackModalWorkflowRun is idempotent on the view id,
    // so a redelivery can't double-create the run. Discarding runs only on the intake-failure path —
    // marking the durable record applied happens after a successful intake and is best-effort, so a
    // markApplied storage error can't re-enter this catch and discard a run that actually started (RIS-263).
    deps.logger.error({ error: String(error) }, "slack modal intake failed");
    await discardSlackModal(deps, modal.viewId);
    sendError(res, 500, "slack_intake_failed", "Slack modal intake failed");
    return;
  }
  deps.eventBus?.emit("workflow_run.accepted", {
    workflowRunId: intake.workflowRun.id,
    source: intake.workflowRun.source,
    title: intake.workflowRun.title,
    workflowDefinitionId: intake.workflowRun.workflowDefinitionId,
  });
  await markSlackModalApplied(deps, modal.viewId);
  res.status(200).json({ response_action: "clear" });
}

// Dedupe a verified Slack modal on the body+signature digest so a replayed signed submission (even
// re-delivered under a fresh Slack view id) is recognized as a duplicate and never starts a second
// Workflow Run (RIS-263). Returns "new" when no inbox is configured so the dedupe stays opt-in.
async function deduplicateSlackModal(
  deps: SlackWebhookHandlerDeps,
  request: VerifiedSlackRequest,
  modal: SlackModalSubmission,
): Promise<"new" | "duplicate" | "unavailable"> {
  if (!deps.webhookInbox) {
    return "new";
  }
  try {
    const { isNew } = await deps.webhookInbox.insertVerified({
      deliveryId: slackModalDeliveryId(modal.viewId),
      bodyDigest: computeWebhookBodyDigest(request.rawBody, request.signature),
      type: "slack:view_submission",
      action: "view_submission",
      entityId: modal.viewId,
      issueId: null,
      issueIdentifier: null,
      webhookTimestamp: request.timestamp,
      payloadJson: null,
    });
    return isNew ? "new" : "duplicate";
  } catch (error) {
    deps.logger.error({ error: String(error) }, "slack webhook inbox insert failed");
    return "unavailable";
  }
}

// Mark the durable record applied after a successful intake. Best-effort: a storage failure here must
// not fail the request (the run already started), so it is logged, never thrown (RIS-263).
async function markSlackModalApplied(deps: SlackWebhookHandlerDeps, viewId: string): Promise<void> {
  try {
    await deps.webhookInbox?.markApplied?.(slackModalDeliveryId(viewId));
  } catch (error) {
    deps.logger.error({ error: String(error) }, "failed to mark slack modal applied");
  }
}

// A modal recorded before its intake ran is dropped from the inbox on failure so the durable record
// isn't stranded as a dedupe tombstone that would silently swallow Slack's own retry — the row is keyed
// on the view id, which Slack reuses on redelivery, so leaving it would dedupe the retry away (RIS-263).
// Wrapped so a storage failure while discarding can't escape the handler's catch unanswered.
async function discardSlackModal(deps: SlackWebhookHandlerDeps, viewId: string): Promise<void> {
  try {
    await deps.webhookInbox?.discardVerified?.(slackModalDeliveryId(viewId));
  } catch (discardError) {
    deps.logger.error({ error: String(discardError) }, "failed to discard slack modal inbox record");
  }
}

function slackModalDeliveryId(viewId: string): string {
  return `slack:${viewId}`;
}

async function dispatchApprovalTap(
  deps: SlackWebhookHandlerDeps,
  request: VerifiedSlackRequest,
  res: Response,
): Promise<void> {
  const approval = toSlackApproval(request.payload);
  if (!approval) {
    sendError(res, 400, "slack_action_invalid", "Slack block action is missing required approval metadata");
    return;
  }
  // recordSlackOperatorApproval (via handleSlackApprovalTap) self-verifies signature, replay, team, operator,
  // permission, and single-use nonce — so the route forwards the raw request and trusts its verdict.
  const result = await handleSlackApprovalTap({
    dataDir: deps.dataDir,
    archiveDir: deps.archiveDir,
    signingSecret: deps.signingSecret,
    signature: request.signature,
    timestampEpochSeconds: request.timestamp,
    receivedAtEpochSeconds: deps.nowEpochSeconds(),
    rawBody: request.rawBody,
    approval,
    operators: deps.operators,
    allowedSlackTeamIds: deps.allowedSlackTeamIds,
    now: deps.now,
  });
  if (result.type === "slack_approval.rejected") {
    sendError(res, 401, "slack_approval_rejected", result.reason);
    return;
  }
  res.status(200).json({ ok: true });
}

function parseSlackInteractionPayload(rawBody: Buffer): SlackInteractionPayload | null {
  try {
    const encoded = new URLSearchParams(rawBody.toString("utf8")).get("payload");
    if (!encoded) {
      return null;
    }
    const parsed = asRecord(JSON.parse(encoded));
    const type = asStringOrNull(parsed.type);
    return type ? (parsed as unknown as SlackInteractionPayload) : null;
  } catch {
    return null;
  }
}

function toSlackModalSubmission(payload: SlackInteractionPayload): SlackModalSubmission | null {
  const viewId = payload.view?.id;
  const teamId = payload.team?.id;
  const userId = payload.user?.id;
  const metadata = parseJsonRecord(payload.view?.private_metadata);
  if (!viewId || !teamId || !userId || !metadata) {
    return null;
  }
  const title = asStringOrNull(metadata.title);
  const body = asStringOrNull(metadata.body);
  const workflowDefinitionId = asStringOrNull(metadata.workflowDefinitionId);
  const workspaceKey = asStringOrNull(metadata.workspaceKey);
  if (!title || !body || !workflowDefinitionId || !workspaceKey) {
    return null;
  }
  return { viewId, teamId, userId, title, body, workflowDefinitionId, workspaceKey };
}

function toSlackApproval(payload: SlackInteractionPayload): {
  readonly workflowRunId: string;
  readonly actionId: string;
  readonly nonce: string;
  readonly permission: OperatorPermission;
  readonly slackUserId: string;
  readonly slackTeamId: string | null;
} | null {
  const value = parseJsonRecord(payload.actions?.[0]?.value);
  const slackUserId = payload.user?.id;
  if (!value || !slackUserId) {
    return null;
  }
  const workflowRunId = asStringOrNull(value.workflowRunId);
  const actionId = asStringOrNull(value.actionId);
  const nonce = asStringOrNull(value.nonce);
  const permission = asStringOrNull(value.permission);
  if (!workflowRunId || !actionId || !nonce || !permission) {
    return null;
  }
  return {
    workflowRunId,
    actionId,
    nonce,
    permission: permission as OperatorPermission,
    slackUserId,
    slackTeamId: payload.team?.id ?? null,
  };
}

function parseJsonRecord(value: string | undefined): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function sendError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } } satisfies ApiErrorResponse);
}
