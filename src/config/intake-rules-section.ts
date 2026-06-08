/**
 * Intake rules config builder.
 *
 * Derives WorkflowRunIntakeRule[] from the `intake_rules` config section.
 * Consumed by the daemon (via ServiceConfig / ConfigStore) and the
 * lightweight CLI overlay-reader in workflow-run-intake.ts.
 */

import type { WorkflowRunSource } from "../workflow-run/contracts.js";
import type { WorkflowRunIntakeRule } from "../workflow-run/intake-rules.js";
import { asRecordArray, asString, asStringArray, asStringMap } from "./coercion.js";

const VALID_PROVIDERS: ReadonlySet<string> = new Set<WorkflowRunSource>(["api", "cli", "slack", "linear", "github"]);

function toRule(raw: Record<string, unknown>): WorkflowRunIntakeRule | null {
  const id = asString(raw.id);
  const provider = asString(raw.provider);
  if (!id || !VALID_PROVIDERS.has(provider)) {
    return null;
  }
  const workflowDefinitionId = asString(raw.workflow_definition_id ?? raw.workflowDefinitionId) || null;
  const workspaceKey = asString(raw.workspace_key ?? raw.workspaceKey) || null;
  const requiredLabels = asStringArray(raw.required_labels ?? raw.requiredLabels, []);
  const states = asStringArray(raw.states, []);
  const workflowLabels = asStringMap(raw.workflow_labels ?? raw.workflowLabels);
  const workspaceLabels = asStringMap(raw.workspace_labels ?? raw.workspaceLabels);
  return {
    id,
    provider: provider as WorkflowRunSource,
    requiredLabels,
    states,
    workflowDefinitionId,
    workspaceKey,
    ...(Object.keys(workflowLabels).length > 0 ? { workflowLabels } : {}),
    ...(Object.keys(workspaceLabels).length > 0 ? { workspaceLabels } : {}),
  };
}

/** Derive an ordered list of intake rules from the raw `intake_rules` config section. */
export function deriveIntakeRulesConfig(raw: Record<string, unknown>): readonly WorkflowRunIntakeRule[] {
  return asRecordArray(raw.rules)
    .map(toRule)
    .filter((r): r is WorkflowRunIntakeRule => r !== null);
}
