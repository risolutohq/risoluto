import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  cancelRunAttemptCommand,
  completeRunAttemptCommand,
  failRunAttemptCommand,
  listRunAttemptsCommand,
  startRunAttemptCommand,
} from "./workflow-run-attempt-command.js";
import { listWorkflowRunsCommand } from "./workflow-run-list-command.js";
import { startWorkflowRunCommand } from "./workflow-run-start-command.js";
import {
  classifyWorkspaceRetentionCommand,
  recordWorkspaceCleanupCommand,
  recordWorkspaceLifecycleCommand,
} from "./workflow-run-workspace-command.js";
import { recordWorkerProcessCommand } from "./workflow-run-worker-process-command.js";
import { tryHandleDoctorCommand } from "./doctor-command.js";
import { tryHandleRunCommand } from "./run-command.js";
import { tryHandleWorkflowCommand } from "./workflow-command.js";
import {
  openWorkflowRun,
  readWorkflowRunEvents,
  toEventAppendedOutput,
  type WorkflowRunGateReference,
  type WorkflowRunHookReference,
} from "../workflow-run/artifacts.js";

interface WorkflowRunCommandHandler {
  expected: string;
  matches: (argv: string[]) => boolean;
  handle: (argv: string[]) => Promise<number>;
}

const workflowRunCommandHandlers: WorkflowRunCommandHandler[] = [
  {
    expected: "workflow-run start",
    matches: (argv) => argv[1] === "start",
    handle: (argv) => startWorkflowRunCommand(argv.slice(2)),
  },
  {
    expected: "workflow-run list",
    matches: (argv) => argv[1] === "list",
    handle: (argv) => listWorkflowRunsCommand(argv.slice(2)),
  },
  {
    expected: "workflow-run event append",
    matches: (argv) => argv[1] === "event" && argv[2] === "append",
    handle: (argv) => appendWorkflowRunEventCommand(argv.slice(3)),
  },
  {
    expected: "workflow-run events list",
    matches: (argv) => argv[1] === "events" && argv[2] === "list",
    handle: (argv) => listWorkflowRunEventsCommand(argv.slice(3)),
  },
  {
    expected: "workflow-run role-execution complete",
    matches: (argv) => argv[1] === "role-execution" && argv[2] === "complete",
    handle: (argv) => completeRoleExecutionCommand(argv.slice(3)),
  },
  {
    expected: "workflow-run run-attempt start",
    matches: (argv) => argv[1] === "run-attempt" && argv[2] === "start",
    handle: (argv) => startRunAttemptCommand(argv.slice(3)),
  },
  {
    expected: "workflow-run run-attempt complete",
    matches: (argv) => argv[1] === "run-attempt" && argv[2] === "complete",
    handle: (argv) => completeRunAttemptCommand(argv.slice(3)),
  },
  {
    expected: "workflow-run run-attempt fail",
    matches: (argv) => argv[1] === "run-attempt" && argv[2] === "fail",
    handle: (argv) => failRunAttemptCommand(argv.slice(3)),
  },
  {
    expected: "workflow-run run-attempt cancel",
    matches: (argv) => argv[1] === "run-attempt" && argv[2] === "cancel",
    handle: (argv) => cancelRunAttemptCommand(argv.slice(3)),
  },
  {
    expected: "workflow-run run-attempts list",
    matches: (argv) => argv[1] === "run-attempts" && argv[2] === "list",
    handle: (argv) => listRunAttemptsCommand(argv.slice(3)),
  },
  {
    expected: "workflow-run transition record",
    matches: (argv) => argv[1] === "transition" && argv[2] === "record",
    handle: (argv) => recordTransitionCommand(argv.slice(3)),
  },
  {
    expected: "workflow-run workspace record",
    matches: (argv) => argv[1] === "workspace" && argv[2] === "record",
    handle: (argv) => recordWorkspaceLifecycleCommand(argv.slice(3)),
  },
  {
    expected: "workflow-run workspace cleanup record",
    matches: (argv) => argv[1] === "workspace" && argv[2] === "cleanup" && argv[3] === "record",
    handle: (argv) => recordWorkspaceCleanupCommand(argv.slice(4)),
  },
  {
    expected: "workflow-run workspace retention",
    matches: (argv) => argv[1] === "workspace" && argv[2] === "retention",
    handle: (argv) => classifyWorkspaceRetentionCommand(argv.slice(3)),
  },
  {
    expected: "workflow-run worker-process record",
    matches: (argv) => argv[1] === "worker-process" && argv[2] === "record",
    handle: (argv) => recordWorkerProcessCommand(argv.slice(3)),
  },
];

export async function tryHandleWorkflowRunCommand(argv: string[]): Promise<number | null> {
  const doctorCommandExitCode = await tryHandleDoctorCommand(argv);
  if (doctorCommandExitCode !== null) {
    return doctorCommandExitCode;
  }

  const runCommandExitCode = await tryHandleRunCommand(argv);
  if (runCommandExitCode !== null) {
    return runCommandExitCode;
  }

  const workflowCommandExitCode = await tryHandleWorkflowCommand(argv);
  if (workflowCommandExitCode !== null) {
    return workflowCommandExitCode;
  }

  if (argv[0] !== "workflow-run") {
    return null;
  }

  const command = workflowRunCommandHandlers.find((handler) => handler.matches(argv));
  if (command) {
    return command.handle(argv);
  }

  throw new TypeError(`unsupported workflow-run command. Expected: ${formatExpectedWorkflowRunCommands()}`);
}

async function appendWorkflowRunEventCommand(argv: string[]): Promise<number> {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      "run-id": { type: "string" },
      "event-type": { type: "string" },
      message: { type: "string" },
      "data-dir": { type: "string" },
      json: { type: "boolean", default: false },
    },
  });

  const workflowRunId = requireNonEmpty(parsed.values["run-id"], "--run-id");
  const eventType = requireNonEmpty(parsed.values["event-type"], "--event-type");
  const run = await openWorkflowRun(
    { dataDir: resolveDataDir(parsed.values["data-dir"]) },
    { workflowRunId, source: "cli" },
  );
  const event = await run.appendEvent({ eventType, message: parsed.values.message?.trim() || undefined });

  if (parsed.values.json) {
    console.log(JSON.stringify(toEventAppendedOutput(event)));
  } else {
    console.log(`Appended Workflow Run event ${event.eventType} to ${event.workflowRunId}`);
  }
  return 0;
}

async function listWorkflowRunEventsCommand(argv: string[]): Promise<number> {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      "run-id": { type: "string" },
      "data-dir": { type: "string" },
      json: { type: "boolean", default: false },
    },
  });

  const listed = await readWorkflowRunEvents({
    dataDir: resolveDataDir(parsed.values["data-dir"]),
    workflowRunId: requireNonEmpty(parsed.values["run-id"], "--run-id"),
  });

  if (parsed.values.json) {
    console.log(JSON.stringify(listed));
  } else {
    console.log(`Listed ${listed.events.length} Workflow Run events for ${listed.workflowRun.id}`);
  }
  return 0;
}

async function completeRoleExecutionCommand(argv: string[]): Promise<number> {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      "run-id": { type: "string" },
      role: { type: "string" },
      "artifact-contract": { type: "string" },
      "artifact-json": { type: "string" },
      "data-dir": { type: "string" },
      json: { type: "boolean", default: false },
    },
  });

  const run = await openWorkflowRun(
    { dataDir: resolveDataDir(parsed.values["data-dir"]) },
    { workflowRunId: requireNonEmpty(parsed.values["run-id"], "--run-id"), source: "cli" },
  );
  const completed = await run.recordRoleExecution({
    role: requireNonEmpty(parsed.values.role, "--role"),
    artifactContractId: requireNonEmpty(parsed.values["artifact-contract"], "--artifact-contract"),
    artifactData: parseArtifactJson(requireNonEmpty(parsed.values["artifact-json"], "--artifact-json")),
  });

  if (parsed.values.json) {
    console.log(JSON.stringify(completed));
  } else {
    console.log(`Completed Role Execution ${completed.roleExecution.id} for ${completed.roleExecution.workflowRunId}`);
  }
  return 0;
}

async function recordTransitionCommand(argv: string[]): Promise<number> {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      "run-id": { type: "string" },
      "from-state": { type: "string" },
      "to-state": { type: "string" },
      gate: { type: "string" },
      "gate-status": { type: "string" },
      hook: { type: "string" },
      "hook-timing": { type: "string" },
      "data-dir": { type: "string" },
      json: { type: "boolean", default: false },
    },
  });

  const run = await openWorkflowRun(
    { dataDir: resolveDataDir(parsed.values["data-dir"]) },
    { workflowRunId: requireNonEmpty(parsed.values["run-id"], "--run-id"), source: "cli" },
  );
  const recorded = await run.recordTransition({
    fromState: requireNonEmpty(parsed.values["from-state"], "--from-state"),
    toState: requireNonEmpty(parsed.values["to-state"], "--to-state"),
    gate: {
      name: requireNonEmpty(parsed.values.gate, "--gate"),
      status: parseGateStatus(requireNonEmpty(parsed.values["gate-status"], "--gate-status")),
    },
    hook: {
      name: requireNonEmpty(parsed.values.hook, "--hook"),
      timing: parseHookTiming(requireNonEmpty(parsed.values["hook-timing"], "--hook-timing")),
    },
  });

  if (parsed.values.json) {
    console.log(JSON.stringify(recorded));
  } else {
    console.log(`Recorded transition ${recorded.transition.fromState} -> ${recorded.transition.toState}`);
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

function parseArtifactJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new TypeError(
      `--artifact-json must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function parseGateStatus(value: string): WorkflowRunGateReference["status"] {
  if (value === "passed" || value === "failed") {
    return value;
  }
  throw new TypeError("--gate-status must be passed or failed");
}

function parseHookTiming(value: string): WorkflowRunHookReference["timing"] {
  if (value === "state_entry" || value === "state_exit" || value === "dag_node") {
    return value;
  }
  throw new TypeError("--hook-timing must be state_entry, state_exit, or dag_node");
}

function formatExpectedWorkflowRunCommands(): string {
  return workflowRunCommandHandlers.map((handler) => handler.expected).join(", ");
}
