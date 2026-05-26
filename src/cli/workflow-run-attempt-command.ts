import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  cancelWorkflowRunAttempt,
  completeWorkflowRunAttempt,
  failWorkflowRunAttempt,
  startWorkflowRunAttempt,
} from "../workflow-run/run-attempts.js";
import type { WorkflowRunAttemptReference } from "../workflow-run/artifacts.js";
import { listWorkflowRunAttempts } from "../workflow-run/run-attempt-projection.js";

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

  const started = await startWorkflowRunAttempt({
    dataDir: resolveDataDir(parsed.values["data-dir"]),
    workflowRunId: requireNonEmpty(parsed.values["run-id"], "--run-id"),
    source: "cli",
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

  const completed = await completeWorkflowRunAttempt({
    dataDir: resolveDataDir(parsed.values["data-dir"]),
    workflowRunId: requireNonEmpty(parsed.values["run-id"], "--run-id"),
    source: "cli",
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

  const failed = await failWorkflowRunAttempt({
    dataDir: resolveDataDir(parsed.values["data-dir"]),
    workflowRunId: requireNonEmpty(parsed.values["run-id"], "--run-id"),
    source: "cli",
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

  const cancelled = await cancelWorkflowRunAttempt({
    dataDir: resolveDataDir(parsed.values["data-dir"]),
    workflowRunId: requireNonEmpty(parsed.values["run-id"], "--run-id"),
    source: "cli",
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
