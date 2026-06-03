import { parseArgs } from "node:util";

import { openWorkflowRun, type WorkflowRunAttemptReference } from "../workflow-run/artifacts.js";
import { listWorkflowRunAttempts } from "../workflow-run/run-attempt-projection.js";
import { resolveDataDir, requireNonEmpty } from "./cli-helpers.js";

export async function startRunAttemptCommand(argv: string[]): Promise<number> {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      "run-id": { type: "string" },
      "attempt-id": { type: "string" },
      "attempt-number": { type: "string" },
      reason: { type: "string" },
      "data-dir": { type: "string" },
      json: { type: "boolean", default: false },
    },
  });

  const run = await openWorkflowRun(
    { dataDir: resolveDataDir(parsed.values["data-dir"]) },
    { workflowRunId: requireNonEmpty(parsed.values["run-id"], "--run-id"), source: "cli" },
  );
  const started = await run.startRunAttempt({
    attemptId: requireNonEmpty(parsed.values["attempt-id"], "--attempt-id"),
    attemptNumber: parseAttemptNumber(requireNonEmpty(parsed.values["attempt-number"], "--attempt-number")),
    reason: parseAttemptReason(requireNonEmpty(parsed.values.reason, "--reason")),
  });

  if (parsed.values.json) {
    console.log(JSON.stringify(started));
  } else {
    console.log(`Started Run Attempt ${started.runAttempt.id} for ${started.runAttempt.workflowRunId}`);
  }
  return 0;
}

export async function completeRunAttemptCommand(argv: string[]): Promise<number> {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      "run-id": { type: "string" },
      "attempt-id": { type: "string" },
      message: { type: "string" },
      "data-dir": { type: "string" },
      json: { type: "boolean", default: false },
    },
  });

  const run = await openWorkflowRun(
    { dataDir: resolveDataDir(parsed.values["data-dir"]) },
    { workflowRunId: requireNonEmpty(parsed.values["run-id"], "--run-id"), source: "cli" },
  );
  const completed = await run.completeRunAttempt({
    attemptId: requireNonEmpty(parsed.values["attempt-id"], "--attempt-id"),
    message: parsed.values.message?.trim() || undefined,
  });

  if (parsed.values.json) {
    console.log(JSON.stringify(completed));
  } else {
    console.log(`Completed Run Attempt ${completed.runAttempt.id} for ${completed.runAttempt.workflowRunId}`);
  }
  return 0;
}

export async function failRunAttemptCommand(argv: string[]): Promise<number> {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      "run-id": { type: "string" },
      "attempt-id": { type: "string" },
      message: { type: "string" },
      "data-dir": { type: "string" },
      json: { type: "boolean", default: false },
    },
  });

  const run = await openWorkflowRun(
    { dataDir: resolveDataDir(parsed.values["data-dir"]) },
    { workflowRunId: requireNonEmpty(parsed.values["run-id"], "--run-id"), source: "cli" },
  );
  const failed = await run.failRunAttempt({
    attemptId: requireNonEmpty(parsed.values["attempt-id"], "--attempt-id"),
    message: parsed.values.message?.trim() || undefined,
  });

  if (parsed.values.json) {
    console.log(JSON.stringify(failed));
  } else {
    console.log(`Failed Run Attempt ${failed.runAttempt.id} for ${failed.runAttempt.workflowRunId}`);
  }
  return 0;
}

export async function cancelRunAttemptCommand(argv: string[]): Promise<number> {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      "run-id": { type: "string" },
      "attempt-id": { type: "string" },
      message: { type: "string" },
      "data-dir": { type: "string" },
      json: { type: "boolean", default: false },
    },
  });

  const run = await openWorkflowRun(
    { dataDir: resolveDataDir(parsed.values["data-dir"]) },
    { workflowRunId: requireNonEmpty(parsed.values["run-id"], "--run-id"), source: "cli" },
  );
  const cancelled = await run.cancelRunAttempt({
    attemptId: requireNonEmpty(parsed.values["attempt-id"], "--attempt-id"),
    message: parsed.values.message?.trim() || undefined,
  });

  if (parsed.values.json) {
    console.log(JSON.stringify(cancelled));
  } else {
    console.log(`Cancelled Run Attempt ${cancelled.runAttempt.id} for ${cancelled.runAttempt.workflowRunId}`);
  }
  return 0;
}

export async function listRunAttemptsCommand(argv: string[]): Promise<number> {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      "run-id": { type: "string" },
      "data-dir": { type: "string" },
      json: { type: "boolean", default: false },
    },
  });

  const listed = await listWorkflowRunAttempts({
    dataDir: resolveDataDir(parsed.values["data-dir"]),
    workflowRunId: requireNonEmpty(parsed.values["run-id"], "--run-id"),
  });

  if (parsed.values.json) {
    console.log(JSON.stringify(listed));
  } else {
    console.log(`Listed ${listed.runAttempts.length} Run Attempts for ${listed.workflowRun.id}`);
  }
  return 0;
}

function parseAttemptNumber(value: string): number {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  throw new TypeError("--attempt-number must be a positive integer");
}

function parseAttemptReason(value: string): WorkflowRunAttemptReference["reason"] {
  if (value === "initial" || value === "retry" || value === "resume") {
    return value;
  }
  throw new TypeError("--reason must be initial, retry, or resume");
}
