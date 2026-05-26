import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import { listWorkflowRuns } from "../workflow-run/list-artifacts.js";

export async function listWorkflowRunsCommand(argv: string[]): Promise<number> {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      "data-dir": { type: "string" },
      json: { type: "boolean", default: false },
    },
  });

  const listed = await listWorkflowRuns({ dataDir: resolveDataDir(parsed.values["data-dir"]) });

  if (parsed.values.json) {
    console.log(JSON.stringify(listed));
  } else {
    console.log(`Listed ${listed.workflowRuns.length} Workflow Runs`);
  }
  return 0;
}

function resolveDataDir(value: string | undefined): string {
  return path.resolve(value ?? process.env.DATA_DIR ?? path.join(homedir(), ".risoluto"));
}
