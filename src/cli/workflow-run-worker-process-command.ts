import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import { recordWorkflowRunWorkerProcess } from "../workflow-run/worker-process.js";
import type { WorkflowRunWorkerProcessReference } from "../workflow-run/artifacts.js";

export async function recordWorkerProcessCommand(argv: string[]): Promise<number> {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      "run-id": { type: "string" },
      "worker-id": { type: "string" },
      role: { type: "string" },
      harness: { type: "string" },
      status: { type: "string" },
      "exit-code": { type: "string" },
      "data-dir": { type: "string" },
      json: { type: "boolean", default: false },
    },
  });

  const recorded = await recordWorkflowRunWorkerProcess({
    dataDir: resolveDataDir(parsed.values["data-dir"]),
    workflowRunId: requireNonEmpty(parsed.values["run-id"], "--run-id"),
    source: "cli",
    workerId: requireNonEmpty(parsed.values["worker-id"], "--worker-id"),
    role: requireNonEmpty(parsed.values.role, "--role"),
    harness: requireNonEmpty(parsed.values.harness, "--harness"),
    status: parseWorkerProcessStatus(requireNonEmpty(parsed.values.status, "--status")),
    exitCode: parseExitCode(requireNonEmpty(parsed.values["exit-code"], "--exit-code")),
  });

  if (parsed.values.json) {
    console.log(JSON.stringify(recorded));
  } else {
    console.log(
      `Recorded worker process ${recorded.workerProcess.workerId} for ${recorded.workerProcess.workflowRunId}`,
    );
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

function parseWorkerProcessStatus(value: string): WorkflowRunWorkerProcessReference["status"] {
  if (value === "succeeded" || value === "failed") {
    return value;
  }
  throw new TypeError("--status must be succeeded or failed");
}

function parseExitCode(value: string): number {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed >= 0) {
    return parsed;
  }
  throw new TypeError("--exit-code must be a non-negative integer");
}
