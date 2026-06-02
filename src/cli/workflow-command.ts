import path from "node:path";
import { parseArgs } from "node:util";

import {
  DEFAULT_WORKFLOW_RESOLUTION_DEFAULTS,
  loadWorkflowDefinitionRegistry,
} from "../workflow-definition/registry.js";

export async function tryHandleWorkflowCommand(argv: string[]): Promise<number | null> {
  if (argv[0] !== "workflow") {
    return null;
  }
  if (argv[1] === "validate") {
    return validateWorkflowCommand(argv.slice(2));
  }
  throw new TypeError("unsupported workflow command. Expected: workflow validate");
}

async function validateWorkflowCommand(argv: string[]): Promise<number> {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      "workflow-dir": { type: "string" },
      json: { type: "boolean", default: false },
    },
  });

  const workflowDir = path.resolve(parsed.values["workflow-dir"] ?? path.join(".risoluto", "workflows"));
  await loadWorkflowDefinitionRegistry({
    workflowDir,
    globalDefaults: DEFAULT_WORKFLOW_RESOLUTION_DEFAULTS,
  });

  if (parsed.values.json) {
    console.log(JSON.stringify({ type: "workflow_definitions.validated", workflowDir }));
  } else {
    console.log(`Validated Workflow Definitions in ${workflowDir}`);
  }
  return 0;
}
