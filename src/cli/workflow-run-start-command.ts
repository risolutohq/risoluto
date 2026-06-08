import path from "node:path";
import { parseArgs } from "node:util";

import {
  DEFAULT_WORKFLOW_RESOLUTION_DEFAULTS,
  loadWorkflowDefinitionRegistry,
  toWorkflowRunResolvedDefinitionConfig,
} from "../workflow-definition/registry.js";
import { DEFAULT_WORKFLOW_DEFINITION_ID, toStartedOutput } from "../workflow-run/artifacts.js";
import { acceptWorkflowRunIntake } from "../workflow-run/intake-core.js";
import { resolveDataDir, requireNonEmpty } from "./cli-helpers.js";
import { loadCliIntakeRules } from "./workflow-run-intake.js";

export async function startWorkflowRunCommand(argv: string[]): Promise<number> {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      title: { type: "string" },
      intent: { type: "string" },
      "workflow-definition": { type: "string" },
      "workspace-key": { type: "string" },
      "data-dir": { type: "string" },
      json: { type: "boolean", default: false },
    },
  });

  const title = requireNonEmpty(parsed.values.title, "--title");
  const intent = requireNonEmpty(parsed.values.intent, "--intent");
  const workflowDefinitionId = parsed.values["workflow-definition"]?.trim() || DEFAULT_WORKFLOW_DEFINITION_ID;
  const dataDir = resolveDataDir(parsed.values["data-dir"]);
  const dataDirWorkflowDir = path.resolve(dataDir, ".risoluto", "workflows");
  const cwdWorkflowDir = path.resolve(".risoluto", "workflows");
  const [rules, dataDirRegistry] = await Promise.all([
    loadCliIntakeRules(dataDir),
    loadWorkflowDefinitionRegistry({
      workflowDir: dataDirWorkflowDir,
      globalDefaults: DEFAULT_WORKFLOW_RESOLUTION_DEFAULTS,
    }),
  ]);
  let workflowRegistry = dataDirRegistry;
  if (dataDirWorkflowDir !== cwdWorkflowDir) {
    try {
      dataDirRegistry.resolve(workflowDefinitionId);
    } catch {
      workflowRegistry = await loadWorkflowDefinitionRegistry({
        workflowDir: cwdWorkflowDir,
        globalDefaults: DEFAULT_WORKFLOW_RESOLUTION_DEFAULTS,
      });
    }
  }
  const workflowDefinition = workflowRegistry.resolve(workflowDefinitionId);
  const intake = await acceptWorkflowRunIntake({
    dataDir,
    source: "cli",
    mode: "start",
    title,
    body: intent,
    externalObject: null,
    rules,
    workflowDefinitionId: workflowDefinition.id,
    workspaceKey: parsed.values["workspace-key"]?.trim() || "default",
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
