import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import { createUnconfiguredAgentRoleDispatch } from "../workflow-run/agent-role-dispatch.js";
import { createWorkflowRunArchive } from "../workflow-run/archive.js";
import { DEFAULT_WORKFLOW_DEFINITION_ID } from "../workflow-run/artifacts.js";
import { driveAcceptedWorkflowRun, type DriveAcceptedWorkflowRunResult } from "../workflow-run/drive-accepted-run.js";
import { createWorkflowRunRoleRunner, type WorkflowRunRoleDispatch } from "../workflow-run/run-role-runner.js";
import type { WorkflowRunStartRecord } from "../workflow-run/contracts.js";
import { resolveWorkflowRunIntake } from "./workflow-run-intake.js";

/**
 * Injection seam: production passes nothing, so `run start` drives the engine through the real agent
 * dispatch. Tests inject a hermetic `dispatchRole` (the external LLM boundary) while every other step —
 * arg parsing, intake, the executor, the archive — runs for real, proving operator reachability.
 */
export interface RunStartCommandDeps {
  readonly dispatchRole?: WorkflowRunRoleDispatch;
  readonly now?: () => string;
}

export async function startAndDriveRunCommand(argv: string[], deps: RunStartCommandDeps = {}): Promise<number> {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      title: { type: "string" },
      intent: { type: "string" },
      "workflow-definition": { type: "string" },
      "workspace-key": { type: "string" },
      "data-dir": { type: "string" },
      "workflow-dir": { type: "string" },
      json: { type: "boolean", default: false },
    },
  });

  const dataDir = resolveDataDir(parsed.values["data-dir"]);
  const accepted = await resolveWorkflowRunIntake({
    dataDir,
    title: requireNonEmpty(parsed.values.title, "--title"),
    intent: requireNonEmpty(parsed.values.intent, "--intent"),
    workflowDefinitionId: parsed.values["workflow-definition"]?.trim() || DEFAULT_WORKFLOW_DEFINITION_ID,
    workspaceKey: parsed.values["workspace-key"]?.trim() || "default",
    workflowDir: resolveWorkflowDir(parsed.values["workflow-dir"]),
  });

  const archive = createWorkflowRunArchive({ dataDir });
  const runRole = createWorkflowRunRoleRunner({
    dispatchRole: deps.dispatchRole ?? createUnconfiguredAgentRoleDispatch(),
    readArtifact: (input) => archive.readWorkflowRunArtifact(input),
  });
  const result = await driveAcceptedWorkflowRun({
    dataDir,
    definition: accepted.definition,
    workflowRun: accepted.workflowRun,
    intent: accepted.intent,
    runRole,
    ...(deps.now ? { now: deps.now } : {}),
  });

  printRunOutcome(parsed.values.json, accepted.workflowRun, result);
  return 0;
}

function printRunOutcome(
  json: boolean,
  workflowRun: WorkflowRunStartRecord,
  result: DriveAcceptedWorkflowRunResult,
): void {
  if (json) {
    console.log(
      JSON.stringify({
        type: "workflow_run.driven",
        workflowRun: { id: workflowRun.id, title: workflowRun.title, source: workflowRun.source },
        outcome: result.outcome,
        roleExecutions: result.roleExecutions,
        ...(result.reason ? { reason: result.reason } : {}),
      }),
    );
    return;
  }
  console.log(`Started Workflow Run ${workflowRun.id}: ${workflowRun.title}`);
  console.log(`Run outcome: ${result.outcome}${result.reason ? ` (${result.reason})` : ""}`);
}

function resolveDataDir(value: string | undefined): string {
  return path.resolve(value ?? process.env.DATA_DIR ?? path.join(homedir(), ".risoluto"));
}

function resolveWorkflowDir(value: string | undefined): string {
  return value?.trim() ? path.resolve(value.trim()) : path.resolve(".risoluto", "workflows");
}

function requireNonEmpty(value: string | undefined, flag: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new TypeError(`${flag} is required`);
  }
  return trimmed;
}
