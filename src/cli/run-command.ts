import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import { createWorkflowRunArchive } from "../workflow-run/archive.js";
import { startAndDriveRunCommand } from "./run-start-command.js";

export async function tryHandleRunCommand(argv: string[]): Promise<number | null> {
  if (argv[0] !== "run") {
    return null;
  }
  if (argv[1] === "start") {
    return startAndDriveRunCommand(argv.slice(2));
  }
  if (argv[1] === "status") {
    return workflowRunStatusCommand(argv.slice(2));
  }
  throw new TypeError("unsupported run command. Expected: run start, run status <id>");
}

async function workflowRunStatusCommand(argv: string[]): Promise<number> {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "data-dir": { type: "string" },
      json: { type: "boolean", default: false },
    },
  });

  const workflowRunId = requireRunId(parsed.positionals[0]);
  const workflowRun = await createWorkflowRunArchive({
    dataDir: resolveDataDir(parsed.values["data-dir"]),
  }).loadWorkflowRun(workflowRunId);

  if (parsed.values.json) {
    console.log(
      JSON.stringify({ type: "workflow_run.status", workflowRun: { id: workflowRun.id, status: workflowRun.status } }),
    );
  } else {
    console.log(`Workflow Run ${workflowRun.id} status: ${workflowRun.status}`);
  }
  return 0;
}

function resolveDataDir(value: string | undefined): string {
  return path.resolve(value ?? process.env.DATA_DIR ?? path.join(homedir(), ".risoluto"));
}

function requireRunId(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new TypeError("run status requires a Workflow Run id");
  }
  return trimmed;
}
