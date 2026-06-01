import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import { createUnconfiguredAgentRoleDispatch } from "../workflow-run/agent-role-dispatch.js";
import { createWorkflowRunArchive } from "../workflow-run/archive.js";
import { DEFAULT_WORKFLOW_DEFINITION_ID } from "../workflow-run/artifacts.js";
import type { WorkflowBudgetPolicy } from "../workflow-run/budget-retry.js";
import { driveAcceptedWorkflowRun, type DriveAcceptedWorkflowRunResult } from "../workflow-run/drive-accepted-run.js";
import type { WorkflowGateRetryInput } from "../workflow-run/gate-retry-controller.js";
import {
  createWorkflowRunActionRunner,
  type WorkflowRunValidationCommandRunner,
} from "../workflow-run/run-action-runner.js";
import { createWorkflowRunRoleRunner, type WorkflowRunRoleDispatch } from "../workflow-run/run-role-runner.js";
import type { WorkflowRunStartRecord } from "../workflow-run/contracts.js";
import { resolveWorkflowRunIntake } from "./workflow-run-intake.js";

/**
 * Injection seam: production passes nothing, so `run start` drives the engine through the real agent
 * dispatch under the default budget. Tests inject hermetic external boundaries — `dispatchRole` (the LLM
 * session), `budget` (to force a hard-stop), `retryGate` (the gate-repair LLM) — while every other step
 * (arg parsing, intake, the executor, the gate/retry controller, the archive) runs for real.
 */
export interface RunStartCommandDeps {
  readonly dispatchRole?: WorkflowRunRoleDispatch;
  readonly retryGate?: (input: WorkflowGateRetryInput) => Promise<Readonly<Record<string, unknown>>>;
  readonly runValidationCommand?: WorkflowRunValidationCommandRunner;
  readonly budget?: WorkflowBudgetPolicy;
  readonly maxGateRetries?: number;
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
  const nowString = deps.now ?? (() => new Date().toISOString());
  const runRole = createWorkflowRunRoleRunner({
    dispatchRole: deps.dispatchRole ?? createUnconfiguredAgentRoleDispatch(),
    readArtifact: (input) => archive.readWorkflowRunArtifact(input),
  });
  const runAction = createWorkflowRunActionRunner({
    effects: { ...(deps.runValidationCommand ? { runValidationCommand: deps.runValidationCommand } : {}) },
    now: nowString,
    writeArtifact: (input) => archive.writeWorkflowRunArtifact(input),
  });
  const result = await driveAcceptedWorkflowRun({
    dataDir,
    definition: accepted.definition,
    workflowRun: accepted.workflowRun,
    intent: accepted.intent,
    runRole,
    runAction,
    budget: deps.budget ?? createDefaultWorkflowBudget(),
    ...(deps.retryGate ? { retryGate: deps.retryGate } : {}),
    ...(deps.maxGateRetries === undefined ? {} : { maxGateRetries: deps.maxGateRetries }),
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

// Default budget: enforce the PRD's 120-minute / $10 hard stops live (wall-clock from the clock, cost
// from token usage). A fresh CLI run is far under both, so this never stops a healthy run; it is the
// always-on guard the executor checks before every step. Token usage is empty until the agent harness
// reports it (NIN-222), so measured cost is 0 for now.
function createDefaultWorkflowBudget(): WorkflowBudgetPolicy {
  const startedAtMs = Date.now();
  return {
    startedAtMs,
    nowMs: () => Date.now(),
    usage: () => ({ usageByModelProfile: {}, modelProfilePrices: {} }),
  };
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
