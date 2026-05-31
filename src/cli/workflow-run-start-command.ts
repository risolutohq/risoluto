import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  DEFAULT_WORKFLOW_RESOLUTION_DEFAULTS,
  loadWorkflowDefinitionRegistry,
  toWorkflowRunResolvedDefinitionConfig,
} from "../workflow-definition/registry.js";
import { DEFAULT_WORKFLOW_DEFINITION_ID, toStartedOutput } from "../workflow-run/artifacts.js";
import { acceptWorkflowRunIntake } from "../workflow-run/intake-core.js";

export async function startWorkflowRunCommand(argv: string[]): Promise<number> {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      title: { type: "string" },
      intent: { type: "string" },
      "workflow-definition": { type: "string" },
      "data-dir": { type: "string" },
      json: { type: "boolean", default: false },
    },
  });

  const title = requireNonEmpty(parsed.values.title, "--title");
  const intent = requireNonEmpty(parsed.values.intent, "--intent");
  const workflowDefinitionId = parsed.values["workflow-definition"]?.trim() || DEFAULT_WORKFLOW_DEFINITION_ID;
  const workflowRegistry = await loadWorkflowDefinitionRegistry({
    workflowDir: path.resolve(".risoluto", "workflows"),
    globalDefaults: DEFAULT_WORKFLOW_RESOLUTION_DEFAULTS,
  });
  const workflowDefinition = workflowRegistry.resolve(workflowDefinitionId);
  const intake = await acceptWorkflowRunIntake({
    dataDir: resolveDataDir(parsed.values["data-dir"]),
    source: "cli",
    mode: "start",
    title,
    body: intent,
    externalObject: null,
    rules: [],
    workflowDefinitionId: workflowDefinition.id,
    resolvedWorkflowDefinition: toWorkflowRunResolvedDefinitionConfig(workflowDefinition),
  });
  const workflowRun = intake.workflowRun;

  if (parsed.values.json) {
    console.log(JSON.stringify(toStartedOutput(workflowRun)));
  } else {
    console.log(`Started Workflow Run ${workflowRun.id}: ${workflowRun.title}`);
  }
  return 0;
}

function resolveDataDir(value: string | undefined): string {
  return path.resolve(value ?? process.env.DATA_DIR ?? path.join(homedir(), ".risoluto"));
}

function requireNonEmpty(value: string | undefined, flag: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new TypeError(`${flag} is required`);
  }
  return trimmed;
}
