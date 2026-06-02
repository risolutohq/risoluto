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
import { verifySlackSignature } from "./signature.js";

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
  try {
    const intake = await acceptSlackModalWorkflowRun({
      dataDir: deps.dataDir,
      archiveDir: deps.archiveDir,
      modal,
      rules: deps.rules,
      now: deps.now,
      id: deps.id,
    });
    deps.eventBus?.emit("workflow_run.accepted", {
      workflowRunId: intake.workflowRun.id,
      source: intake.workflowRun.source,
      title: intake.workflowRun.title,
      workflowDefinitionId: intake.workflowRun.workflowDefinitionId,
    });
    res.status(200).json({ response_action: "clear" });
  } catch (error) {
    deps.logger.error({ error: String(error) }, "slack modal intake failed");
    sendError(res, 500, "slack_intake_failed", "Slack modal intake failed");
  }
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
