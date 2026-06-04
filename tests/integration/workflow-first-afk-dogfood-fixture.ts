import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expect, vi } from "vitest";

import { createWorkflowRunArchive } from "../../src/workflow-run/archive.js";
import type { WorkflowRunStartRecord } from "../../src/workflow-run/contracts.js";
import type { WorkflowRunIntakeRule } from "../../src/workflow-run/intake-core.js";
import { acceptSlackModalWorkflowRun } from "../../src/workflow-run/slack-interactions.js";
import { acceptTrackerIssueWorkflowRun } from "../../src/workflow-run/tracker-intake.js";

const WORKFLOW_ID = "single-operator-afk-coder";
const CREATED_AT = "2026-05-31T22:20:00.000Z";

export interface DogfoodContext {
  readonly dataDir: string;
  readonly archiveDir: string;
  readonly workflowDir: string;
}

export async function createDogfoodContext(): Promise<DogfoodContext> {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "risoluto-dogfood-capstone-"));
  return {
    dataDir,
    archiveDir: path.join(dataDir, "archives"),
    workflowDir: path.resolve(".risoluto", "workflows"),
  };
}

export async function cleanupDogfoodContext(context: DogfoodContext): Promise<void> {
  await rm(context.dataDir, { recursive: true, force: true });
}

export async function startCliWorkflowRun(context: DogfoodContext): Promise<WorkflowRunStartRecord> {
  const output = await captureCliJson([
    "workflow-run",
    "start",
    "--title",
    "Dogfood capstone from CLI",
    "--intent",
    "Prove the workflow-first AFK MVP path.",
    "--data-dir",
    context.dataDir,
    "--json",
  ]);
  return output.workflowRun;
}

export async function startSlackWorkflowRun(context: DogfoodContext): Promise<WorkflowRunStartRecord> {
  const intake = await acceptSlackModalWorkflowRun({
    dataDir: context.dataDir,
    modal: {
      viewId: "slack-view-dogfood",
      teamId: "T_RISOLUTO",
      userId: "U_OMER",
      title: "Dogfood capstone from Slack",
      body: "Start the same AFK workflow from Slack.",
      workflowDefinitionId: WORKFLOW_ID,
      workspaceKey: "risoluto",
    },
    rules: [intakeRule("slack")],
    now: () => CREATED_AT,
    id: () => "wr_dogfood_slack",
  });
  return intake.workflowRun;
}

export async function startTrackerWorkflowRun(context: DogfoodContext): Promise<WorkflowRunStartRecord> {
  const rules = [intakeRule("linear")];
  const webhook = await acceptTrackerIssueWorkflowRun({
    dataDir: context.dataDir,
    provider: "linear",
    deliveryKind: "webhook",
    deliveryId: "linear-dogfood-webhook",
    action: "create",
    issue: trackerIssue(),
    rules,
    now: () => CREATED_AT,
    id: () => "wr_dogfood_tracker",
  });
  const polling = await acceptTrackerIssueWorkflowRun({
    dataDir: context.dataDir,
    provider: "linear",
    deliveryKind: "polling",
    action: "reconcile",
    issue: trackerIssue(),
    rules,
    now: () => CREATED_AT,
    id: () => "wr_dogfood_duplicate",
  });
  expect(polling).toMatchObject({ action: "deduplicated", workflowRun: { id: webhook.workflowRun.id } });
  await expect(createWorkflowRunArchive({ dataDir: context.dataDir }).listWorkflowRuns()).resolves.toHaveLength(3);
  return webhook.workflowRun;
}

async function captureCliJson(argv: readonly string[]): Promise<{ readonly workflowRun: WorkflowRunStartRecord }> {
  const stdout: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((line: string) => {
    stdout.push(line);
  });
  try {
    const { main } = await import("../../src/cli/index.js");
    await expect(main([...argv])).resolves.toBe(0);
  } finally {
    spy.mockRestore();
  }
  return JSON.parse(stdout[0] ?? "") as { readonly workflowRun: WorkflowRunStartRecord };
}

function intakeRule(provider: "linear" | "slack"): WorkflowRunIntakeRule {
  return {
    id: `${provider}-dogfood`,
    provider,
    requiredLabels: provider === "linear" ? ["risoluto"] : [],
    states: provider === "linear" ? ["ready"] : ["submitted"],
    workflowDefinitionId: WORKFLOW_ID,
    workspaceKey: "risoluto",
  };
}

function trackerIssue() {
  return {
    id: "lin_dogfood_218",
    identifier: "RIS-218",
    title: "End-to-end dogfood capstone",
    url: "https://linear.app/ninetech/issue/RIS-218",
    description: "Prove the dogfood capstone.",
    labels: ["risoluto"],
    state: "Ready",
  };
}
