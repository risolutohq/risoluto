import { readFile } from "node:fs/promises";
import path from "node:path";

import YAML from "yaml";

import { deriveIntakeRulesConfig } from "../config/intake-rules-section.js";
import { asRecord } from "../config/coercion.js";
import {
  DEFAULT_WORKFLOW_RESOLUTION_DEFAULTS,
  loadWorkflowDefinitionRegistry,
  toWorkflowRunResolvedDefinitionConfig,
  type ResolvedWorkflowDefinition,
} from "../workflow-definition/registry.js";
import type { WorkflowRunStartRecord } from "../workflow-run/contracts.js";
import { acceptWorkflowRunIntake, type WorkflowRunIntentArtifact } from "../workflow-run/intake-core.js";
import type { WorkflowRunIntakeRule } from "../workflow-run/intake-rules.js";

export interface ResolveWorkflowRunIntakeInput {
  readonly dataDir: string;
  readonly title: string;
  readonly intent: string;
  readonly workflowDefinitionId: string;
  readonly workspaceKey: string;
  readonly workflowDir: string;
  /** Pre-loaded intake rules. When absent, rules are loaded from the overlay config at dataDir. */
  readonly rules?: readonly WorkflowRunIntakeRule[];
}

export interface ResolvedWorkflowRunIntake {
  readonly workflowRun: WorkflowRunStartRecord;
  readonly intent: WorkflowRunIntentArtifact;
  readonly definition: ResolvedWorkflowDefinition;
}

/**
 * Load intake rules from the overlay config at {dataDir}/archives/config/overlay.yaml.
 * Returns an empty array when the file does not exist (no rules configured).
 */
export async function loadCliIntakeRules(dataDir: string): Promise<readonly WorkflowRunIntakeRule[]> {
  const overlayPath = path.join(dataDir, "archives", "config", "overlay.yaml");
  let content: string;
  try {
    content = await readFile(overlayPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const overlay = YAML.parse(content) as unknown;
  const root = asRecord(overlay);
  return deriveIntakeRulesConfig(asRecord(root.intake_rules));
}

/**
 * Resolve the requested Workflow Definition from the workflow directory and accept a `start` intake,
 * returning the durable run record, its `intent.v1`, and the resolved definition. Shared by the
 * intake-only `workflow-run start` primitive and the engine-driving `run start` command.
 */
export async function resolveWorkflowRunIntake(
  input: ResolveWorkflowRunIntakeInput,
): Promise<ResolvedWorkflowRunIntake> {
  const rules = input.rules ?? (await loadCliIntakeRules(input.dataDir));
  const registry = await loadWorkflowDefinitionRegistry({
    workflowDir: input.workflowDir,
    globalDefaults: DEFAULT_WORKFLOW_RESOLUTION_DEFAULTS,
  });
  const definition = registry.resolve(input.workflowDefinitionId);
  const intake = await acceptWorkflowRunIntake({
    dataDir: input.dataDir,
    source: "cli",
    mode: "start",
    title: input.title,
    body: input.intent,
    externalObject: null,
    rules,
    workflowDefinitionId: definition.id,
    workspaceKey: input.workspaceKey,
    resolvedWorkflowDefinition: toWorkflowRunResolvedDefinitionConfig(definition),
  });
  return { workflowRun: intake.workflowRun, intent: intake.intent, definition };
}
