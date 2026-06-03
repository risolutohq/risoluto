import { parseArgs } from "node:util";

import { listWorkflowRuns } from "../workflow-run/list-artifacts.js";
import { resolveDataDir } from "./cli-helpers.js";

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
