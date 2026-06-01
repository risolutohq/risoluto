import {
  DEFAULT_WORKFLOW_RESOLUTION_DEFAULTS,
  loadWorkflowDefinitionRegistry,
  toWorkflowRunResolvedDefinitionConfig,
  type ResolvedWorkflowDefinition,
} from "../workflow-definition/registry.js";
import type { WorkflowRunStartRecord } from "../workflow-run/contracts.js";
import { acceptWorkflowRunIntake, type WorkflowRunIntentArtifact } from "../workflow-run/intake-core.js";

export interface ResolveWorkflowRunIntakeInput {
  readonly dataDir: string;
  readonly title: string;
  readonly intent: string;
  readonly workflowDefinitionId: string;
  readonly workspaceKey: string;
  readonly workflowDir: string;
}

export interface ResolvedWorkflowRunIntake {
  readonly workflowRun: WorkflowRunStartRecord;
  readonly intent: WorkflowRunIntentArtifact;
  readonly definition: ResolvedWorkflowDefinition;
}

/**
 * Resolve the requested Workflow Definition from the workflow directory and accept a `start` intake,
 * returning the durable run record, its `intent.v1`, and the resolved definition. Shared by the
 * intake-only `workflow-run start` primitive and the engine-driving `run start` command.
 */
export async function resolveWorkflowRunIntake(
  input: ResolveWorkflowRunIntakeInput,
): Promise<ResolvedWorkflowRunIntake> {
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
    rules: [],
    workflowDefinitionId: definition.id,
    workspaceKey: input.workspaceKey,
    resolvedWorkflowDefinition: toWorkflowRunResolvedDefinitionConfig(definition),
  });
  return { workflowRun: intake.workflowRun, intent: intake.intent, definition };
}
