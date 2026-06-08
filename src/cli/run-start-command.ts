import path from "node:path";
import { parseArgs } from "node:util";

import type { ModelSelection, Workspace } from "../core/types.js";
import type { RunAttemptDispatcher } from "../dispatch/types.js";
import { createWorkflowRunArchive } from "../workflow-run/archive.js";
import { DEFAULT_WORKFLOW_DEFINITION_ID } from "../workflow-run/artifacts.js";
import type { WorkflowBudgetPolicy } from "../workflow-run/budget-retry.js";
import { driveAcceptedWorkflowRun, type DriveAcceptedWorkflowRunResult } from "../workflow-run/drive-accepted-run.js";
import type { WorkflowGateRetryInput } from "../workflow-run/gate-retry-controller.js";
import {
  createWorkflowRunActionRunner,
  type WorkflowRunCiPoller,
  type WorkflowRunValidationCommandRunner,
} from "../workflow-run/run-action-runner.js";
import type { PrPublishMode } from "../workflow-run/publish-policy.js";
import { createWorkflowRunRoleRunner, type WorkflowRunRoleDispatch } from "../workflow-run/run-role-runner.js";
import { createCouncilDispatch } from "../workflow-run/council-dispatch.js";
import type { WorkflowRunWorkspacePreparer } from "../workflow-run/workspace-preparer.js";
import type { WorkflowRunStartRecord } from "../workflow-run/contracts.js";
import { resolveWorkflowRunIntake, type ResolvedWorkflowRunIntake } from "./workflow-run-intake.js";
import { resolveDispatchRole } from "./run-start-dispatch.js";
import { composeLiveDispatch, type ComposedLiveDispatch } from "./run-start-live-dispatch.js";
import { LIVE_RUN_START_ENV } from "./constants.js";
import { resolveDataDir, requireNonEmpty } from "./cli-helpers.js";

/**
 * Injection seam: production passes nothing, so `run start` drives the engine through the real agent
 * dispatch under the default budget. Tests inject hermetic external boundaries — `dispatchRole` (the LLM
 * session), `budget` (to force a hard-stop), `retryGate` (the gate-repair LLM) — while every other step
 * (arg parsing, intake, the executor, the gate/retry controller, the archive) runs for real.
 *
 * When neither `dispatchRole` nor `dispatcher` is provided and `RISOLUTO_LIVE_RUN_START` is not set,
 * the run drives through the honest-block default ({@link createUnconfiguredAgentRoleDispatch}).
 */
export interface RunStartCommandDeps {
  /** Pre-built role-dispatch function (highest-priority override; keeps existing hermetic tests working). */
  readonly dispatchRole?: WorkflowRunRoleDispatch;
  /** Raw dispatcher boundary; used to compose {@link createWorkflowRunAgentDispatch} in tests and live. */
  readonly dispatcher?: RunAttemptDispatcher;
  /** Prepared workspace to pass to the agent sessions. Required when `dispatcher` is injected. */
  readonly workspace?: Workspace;
  /** Resolve a model-profile name to a ModelSelection. Defaults to env/codex config when omitted. */
  readonly modelForProfile?: (modelProfile: string) => ModelSelection;
  readonly retryGate?: (input: WorkflowGateRetryInput) => Promise<Readonly<Record<string, unknown>>>;
  readonly runValidationCommand?: WorkflowRunValidationCommandRunner;
  readonly prepareWorkspace?: WorkflowRunWorkspacePreparer;
  readonly pollCi?: WorkflowRunCiPoller;
  readonly budget?: WorkflowBudgetPolicy;
  readonly maxGateRetries?: number;
  readonly now?: () => string;
  /** Run-level abort signal threaded to the dispatch seam; the CLI binds it to SIGINT/SIGTERM. */
  readonly signal?: AbortSignal;
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
      "publish-mode": { type: "string" },
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

  const controller = new AbortController();
  const onSignal = (): void => controller.abort();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    const signalDeps: RunStartCommandDeps = { ...deps, signal: deps.signal ?? controller.signal };
    const result = await driveAcceptedRun(
      dataDir,
      accepted,
      signalDeps,
      parsePublishMode(parsed.values["publish-mode"]),
    );
    printRunOutcome(parsed.values.json, accepted.workflowRun, result);
    return 0;
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }
}

async function driveAcceptedRun(
  dataDir: string,
  accepted: ResolvedWorkflowRunIntake,
  deps: RunStartCommandDeps,
  publishMode: PrPublishMode | undefined,
): Promise<DriveAcceptedWorkflowRunResult> {
  const live = shouldComposeLiveDispatch(deps) ? await composeLiveForRun(dataDir, accepted, deps.signal) : undefined;
  const effectiveDeps: RunStartCommandDeps = live
    ? { ...deps, dispatcher: live.dispatcher, workspace: live.workspace, modelForProfile: live.modelForProfile }
    : deps;
  try {
    const result = await driveWithDeps(dataDir, accepted, effectiveDeps, publishMode, live);
    if (result.pullRequestUrl) {
      console.log(
        JSON.stringify({
          type: "workflow_run.published",
          workflowRunId: accepted.workflowRun.id,
          pullRequestUrl: result.pullRequestUrl,
        }),
      );
    }
    return result;
  } finally {
    await live?.dispose();
  }
}

function shouldComposeLiveDispatch(deps: RunStartCommandDeps): boolean {
  return process.env[LIVE_RUN_START_ENV] === "1" && deps.dispatcher === undefined && deps.dispatchRole === undefined;
}

function composeLiveForRun(
  dataDir: string,
  accepted: ResolvedWorkflowRunIntake,
  signal: AbortSignal | undefined,
): Promise<ComposedLiveDispatch> {
  return composeLiveDispatch({
    dataDir,
    workflowRunId: accepted.workflowRun.id,
    intentTitle: accepted.intent.title,
    intentBody: accepted.intent.body,
    signal: signal ?? new AbortController().signal,
  });
}

async function driveWithDeps(
  dataDir: string,
  accepted: ResolvedWorkflowRunIntake,
  deps: RunStartCommandDeps,
  publishMode: PrPublishMode | undefined,
  live: ComposedLiveDispatch | undefined,
): Promise<DriveAcceptedWorkflowRunResult> {
  const archive = createWorkflowRunArchive({ dataDir });
  const nowString = deps.now ?? (() => new Date().toISOString());
  const dispatchRole = resolveDispatchRole(deps, dataDir, deps.dispatchRole);
  const runRole = createWorkflowRunRoleRunner({
    dispatchRole,
    readArtifact: (input) => archive.readWorkflowRunArtifact(input),
  });
  const council = createCouncilDispatch({
    workflowRunId: accepted.workflowRun.id,
    dispatchRole,
    readArtifact: (input) => archive.readWorkflowRunArtifact(input),
  });
  const runAction = createWorkflowRunActionRunner({
    effects: {
      ...(deps.prepareWorkspace ? { prepareWorkspace: deps.prepareWorkspace } : {}),
      ...(deps.runValidationCommand ? { runValidationCommand: deps.runValidationCommand } : {}),
      ...(deps.pollCi ? { pollCi: deps.pollCi } : {}),
    },
    workflowDefinitionId: accepted.definition.id,
    now: nowString,
    writeArtifact: (input) => archive.writeWorkflowRunArtifact(input),
    ...(publishMode ? { publishMode } : {}),
  });
  return driveAcceptedWorkflowRun({
    dataDir,
    definition: accepted.definition,
    workflowRun: accepted.workflowRun,
    intent: accepted.intent,
    runRole,
    runAction,
    budget: deps.budget ?? createDefaultWorkflowBudget(),
    runCouncillor: council.runCouncillor,
    synthesizeCouncil: council.synthesizeCouncil,
    ...(deps.retryGate ? { retryGate: deps.retryGate } : {}),
    ...(deps.maxGateRetries === undefined ? {} : { maxGateRetries: deps.maxGateRetries }),
    ...(deps.now ? { now: deps.now, councilClock: deps.now } : {}),
    ...(live ? { publishOnDone: () => live.publishDraftPr().then((p) => ({ pullRequestUrl: p.pullRequestUrl })) } : {}),
  });
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
// always-on guard the executor checks before every step. The agent harness now runs (RIS-222), but its
// token-usage accumulator is not yet wired into usage(), so measured cost is 0 until that follow-on lands.
function createDefaultWorkflowBudget(): WorkflowBudgetPolicy {
  const startedAtMs = Date.now();
  return {
    startedAtMs,
    nowMs: () => Date.now(),
    usage: () => ({ usageByModelProfile: {}, modelProfilePrices: {} }),
  };
}

function resolveWorkflowDir(value: string | undefined): string {
  return value?.trim() ? path.resolve(value.trim()) : path.resolve(".risoluto", "workflows");
}

const PUBLISH_MODES = ["auto_merge", "draft", "incomplete_draft", "none", "ready"] as const;

function parsePublishMode(value: string | undefined): PrPublishMode | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (!(PUBLISH_MODES as readonly string[]).includes(trimmed)) {
    throw new TypeError(`--publish-mode must be one of ${PUBLISH_MODES.join(", ")}`);
  }
  return trimmed as PrPublishMode;
}
