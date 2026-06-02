/**
 * Slack intake config builder.
 *
 * Returns null when no signing secret is present so the /webhooks/slack
 * route is not registered for workspaces that don't use Slack inbound.
 */

import type { SlackIntakeConfig, SlackOperatorIdentityConfig } from "../core/types.js";
import { OPERATOR_PERMISSIONS } from "../workflow-run/operator-approval-contract.js";
import type { WorkflowRunIntakeRule } from "../workflow-run/intake-rules.js";
import { asRecord, asRecordArray, asString, asStringArray } from "./coercion.js";
import { resolveConfigString } from "./resolvers.js";

function toOperator(raw: Record<string, unknown>): SlackOperatorIdentityConfig | null {
  const id = asString(raw.id);
  const slackUserId = asString(raw.slack_user_id ?? raw.slackUserId);
  if (!id || !slackUserId) {
    return null;
  }
  const rawPerms = asStringArray(raw.permissions, []);
  const permissions = rawPerms.filter((p) => (OPERATOR_PERMISSIONS as readonly string[]).includes(p));
  return { id, slackUserId, permissions: permissions as SlackOperatorIdentityConfig["permissions"] };
}

function toRule(raw: Record<string, unknown>): WorkflowRunIntakeRule | null {
  const id = asString(raw.id);
  const workflowDefinitionId = asString(raw.workflow_definition_id ?? raw.workflowDefinitionId);
  const workspaceKey = asString(raw.workspace_key ?? raw.workspaceKey);
  if (!id || !workflowDefinitionId || !workspaceKey) {
    return null;
  }
  return { id, provider: "slack", workflowDefinitionId, workspaceKey };
}

export function deriveSlackIntakeConfig(
  slack: Record<string, unknown>,
  secretResolver?: (name: string) => string | undefined,
): SlackIntakeConfig | null {
  const signingSecret =
    resolveConfigString(asRecord(slack).signing_secret ?? asRecord(slack).signingSecret, secretResolver) ||
    secretResolver?.("SLACK_SIGNING_SECRET") ||
    null;
  if (!signingSecret) {
    return null;
  }
  return {
    signingSecret,
    operators: asRecordArray(slack.operators)
      .map(toOperator)
      .filter((o): o is SlackOperatorIdentityConfig => o !== null),
    allowedTeamIds: asStringArray(slack.allowed_team_ids ?? slack.allowedTeamIds, []),
    rules: asRecordArray(slack.rules)
      .map(toRule)
      .filter((r): r is WorkflowRunIntakeRule => r !== null),
  };
}
