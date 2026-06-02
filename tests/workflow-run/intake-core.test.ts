import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createWorkflowRunArchive } from "../../src/workflow-run/archive.js";
import {
  acceptWorkflowRunIntake,
  AmbiguousWorkflowRunIntakeError,
  InvalidWorkflowRunIntakeError,
  normalizeWorkflowRunIntent,
  type WorkflowRunIntakeRule,
  type WorkflowRunIntakeSource,
} from "../../src/workflow-run/intake-core.js";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "risoluto-intake-core-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("workflow-run intake core", () => {
  it("rejects ambiguous matching rules before creating a Workflow Run", async () => {
    const dataDir = await createTempDir();
    const rules: WorkflowRunIntakeRule[] = [
      trackerRule({ id: "bugfix", requiredLabels: ["afk"] }),
      trackerRule({ id: "maintenance", requiredLabels: ["afk"] }),
    ];

    await expect(acceptLinearIssue({ dataDir, rules, id: () => "wr_ambiguous" })).rejects.toThrow(
      AmbiguousWorkflowRunIntakeError,
    );
    await expect(createWorkflowRunArchive({ dataDir }).listWorkflowRuns()).resolves.toEqual([]);
  });

  it("rejects missing workflow or workspace resolution before creating a Workflow Run", async () => {
    const dataDir = await createTempDir();
    const rules: WorkflowRunIntakeRule[] = [trackerRule({ id: "missing-workspace", workspaceKey: null })];

    await expect(acceptLinearIssue({ dataDir, rules, id: () => "wr_invalid" })).rejects.toThrow(
      InvalidWorkflowRunIntakeError,
    );
    await expect(createWorkflowRunArchive({ dataDir }).listWorkflowRuns()).resolves.toEqual([]);
  });

  it("persists the resolved workspace key on the accepted Workflow Run", async () => {
    const dataDir = await createTempDir();
    const rules: WorkflowRunIntakeRule[] = [trackerRule({ id: "workspace-routed", workspaceKey: "risoluto" })];

    const accepted = await acceptLinearIssue({ dataDir, rules, id: () => "wr_workspace_routed" });

    expect(accepted.workflowRun.workspaceKey).toBe("risoluto");
    await expect(createWorkflowRunArchive({ dataDir }).loadWorkflowRun("wr_workspace_routed")).resolves.toMatchObject({
      workspaceKey: "risoluto",
    });
  });

  it("maps duplicate external objects to the existing Workflow Run", async () => {
    const dataDir = await createTempDir();
    const rules: WorkflowRunIntakeRule[] = [trackerRule({ id: "afk" })];

    const first = await acceptLinearIssue({ dataDir, rules, deliveryId: "delivery-1", id: () => "wr_fresh_run" });
    const duplicate = await acceptLinearIssue({
      dataDir,
      rules,
      deliveryId: "delivery-2",
      id: () => "linear-issue-42",
    });

    expect(first.action).toBe("created");
    expect(duplicate.action).toBe("deduplicated");
    expect(duplicate.workflowRun.id).toBe("wr_fresh_run");
    await expect(createWorkflowRunArchive({ dataDir }).listWorkflowRuns()).resolves.toHaveLength(1);
  });

  it("normalizes every intake source to the same intent.v1 shape", () => {
    const common = {
      workflowRunId: "wr_shape",
      createdAt: "2026-05-31T19:00:00.000Z",
      title: "Fix flaky CI",
      body: "Repair the deployment workflow.",
    };
    const sources: WorkflowRunIntakeSource[] = ["cli", "slack", "linear", "github", "api"];

    const intents = sources.map((source) =>
      normalizeWorkflowRunIntent({
        ...common,
        source,
        externalObject:
          source === "linear" ? { provider: "linear", id: "lin_issue_1", url: "https://linear.example/RIS-1" } : null,
      }),
    );

    expect(intents.map((intent) => Object.keys(intent).sort())).toEqual(
      intents.map(() => ["body", "createdAt", "externalReferences", "source", "title", "version", "workflowRunId"]),
    );
    expect(intents.map((intent) => intent.source)).toEqual(sources);
    expect(intents[2]?.externalReferences).toEqual([
      { provider: "linear", id: "lin_issue_1", url: "https://linear.example/RIS-1" },
    ]);
  });

  it("claims logical run mapping before side effects and never uses the tracker issue id as the run id", async () => {
    const dataDir = await createTempDir();
    const rules: WorkflowRunIntakeRule[] = [trackerRule({ id: "afk" })];

    const intake = await acceptLinearIssue({
      dataDir,
      rules,
      externalObjectId: "linear-issue-42",
      id: () => "wr_risoluto_owned",
    });

    expect(intake.workflowRun.id).toBe("wr_risoluto_owned");
    expect(intake.workflowRun.id).not.toBe("linear-issue-42");
    await expect(createWorkflowRunArchive({ dataDir }).loadWorkflowRun("linear-issue-42")).rejects.toThrow();
  });

  it("claims concurrent duplicate external objects as one Workflow Run", async () => {
    const dataDir = await createTempDir();
    const rules: WorkflowRunIntakeRule[] = [trackerRule({ id: "afk" })];

    const [first, second] = await Promise.all([
      acceptLinearIssue({ dataDir, rules, deliveryId: "delivery-a", id: () => "wr_concurrent_a" }),
      acceptLinearIssue({ dataDir, rules, deliveryId: "delivery-b", id: () => "wr_concurrent_b" }),
    ]);

    expect(new Set([first.workflowRun.id, second.workflowRun.id]).size).toBe(1);
    await expect(createWorkflowRunArchive({ dataDir }).listWorkflowRuns()).resolves.toHaveLength(1);
  });

  it("deduplicates an edit that turns labels ambiguous on an already-mapped issue instead of throwing", async () => {
    const dataDir = await createTempDir();

    const first = await acceptLinearIssue({
      dataDir,
      rules: [trackerRule({ id: "afk" })],
      deliveryId: "delivery-initial",
      id: () => "wr_mapped_issue",
    });
    const editedToAmbiguous = await acceptLinearIssue({
      dataDir,
      rules: [trackerRule({ id: "bugfix" }), trackerRule({ id: "maintenance" })],
      deliveryId: "delivery-edit",
      id: () => "wr_should_not_be_used",
    });

    expect(first.action).toBe("created");
    expect(editedToAmbiguous.action).toBe("deduplicated");
    expect(editedToAmbiguous.workflowRun.id).toBe("wr_mapped_issue");
    await expect(createWorkflowRunArchive({ dataDir }).listWorkflowRuns()).resolves.toHaveLength(1);
  });

  it("starts a retry attempt under an existing mapped Workflow Run", async () => {
    const dataDir = await createTempDir();
    const rules: WorkflowRunIntakeRule[] = [trackerRule({ id: "afk" })];

    const first = await acceptLinearIssue({ dataDir, rules, id: () => "wr_retry_target" });
    const retry = await acceptLinearIssue({
      dataDir,
      rules,
      deliveryId: "delivery-retry",
      mode: "retry",
      attemptId: () => "attempt-retry-1",
      id: () => "wr_should_not_be_used",
    });

    expect(first.action).toBe("created");
    expect(retry.action).toBe("retried");
    expect(retry.workflowRun.id).toBe("wr_retry_target");
    expect(retry.runAttempt).toMatchObject({
      id: "attempt-retry-1",
      workflowRunId: "wr_retry_target",
      attemptNumber: 1,
      reason: "retry",
    });
  });
});

function trackerRule(input: {
  readonly id: string;
  readonly requiredLabels?: readonly string[];
  readonly workspaceKey?: string | null;
}): WorkflowRunIntakeRule {
  return {
    id: input.id,
    provider: "linear",
    requiredLabels: input.requiredLabels ?? ["afk"],
    states: ["Todo"],
    workflowDefinitionId: "single-operator-afk-coder",
    workspaceKey: input.workspaceKey === undefined ? "risoluto" : input.workspaceKey,
  };
}

function acceptLinearIssue(input: {
  readonly dataDir: string;
  readonly rules: readonly WorkflowRunIntakeRule[];
  readonly deliveryId?: string;
  readonly externalObjectId?: string;
  readonly mode?: "start" | "retry";
  readonly attemptId?: () => string;
  readonly id: () => string;
}) {
  return acceptWorkflowRunIntake({
    dataDir: input.dataDir,
    source: "linear",
    mode: input.mode ?? "start",
    deliveryId: input.deliveryId ?? "delivery-1",
    externalObject: {
      provider: "linear",
      id: input.externalObjectId ?? "lin_issue_1",
      url: "https://linear.example/RIS-1",
    },
    labels: ["afk"],
    state: "Todo",
    title: "RIS-1: Fix flaky CI",
    body: "Repair the deployment workflow.",
    rules: input.rules,
    now: () => "2026-05-31T19:00:00.000Z",
    id: input.id,
    attemptId: input.attemptId,
  });
}
