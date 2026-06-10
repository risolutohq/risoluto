import { describe, expect, it } from "vitest";

import { useTempDirs } from "../helpers.js";
import { createWorkflowRunArchive } from "../../src/workflow-run/archive.js";
import { acceptTrackerIssueWorkflowRun } from "../../src/workflow-run/tracker-intake.js";
import type { WorkflowRunIntakeRule } from "../../src/workflow-run/intake-core.js";

const createTempDir = useTempDirs("risoluto-tracker-intake-");

describe("tracker workflow-run intake adapters", () => {
  it("reconciles webhook delivery and polling for the same Linear issue into one Workflow Run", async () => {
    const dataDir = await createTempDir();
    const rules = [trackerRule({ provider: "linear" })];

    const webhook = await acceptTrackerIssueWorkflowRun({
      dataDir,
      provider: "linear",
      deliveryKind: "webhook",
      deliveryId: "linear-delivery-1",
      action: "create",
      issue: linearIssue(),
      rules,
      now: () => "2026-05-31T20:10:00.000Z",
      id: () => "wr_tracker_linear",
    });
    const polling = await acceptTrackerIssueWorkflowRun({
      dataDir,
      provider: "linear",
      deliveryKind: "polling",
      action: "reconcile",
      issue: linearIssue(),
      rules,
      now: () => "2026-05-31T20:11:00.000Z",
      id: () => "wr_duplicate_should_not_exist",
    });

    expect(webhook.action).toBe("created");
    expect(polling.action).toBe("deduplicated");
    expect(polling.workflowRun.id).toBe("wr_tracker_linear");
    await expect(createWorkflowRunArchive({ dataDir }).listWorkflowRuns()).resolves.toHaveLength(1);
  });

  it("creates a retry attempt for an existing GitHub Workflow Run from retry labels and comments", async () => {
    const dataDir = await createTempDir();
    const rules = [trackerRule({ provider: "github" })];

    await acceptTrackerIssueWorkflowRun({
      dataDir,
      provider: "github",
      deliveryKind: "webhook",
      deliveryId: "github-delivery-1",
      action: "opened",
      issue: githubIssue({ labels: ["risoluto"] }),
      rules,
      id: () => "wr_tracker_github",
    });
    const labelRetry = await acceptTrackerIssueWorkflowRun({
      dataDir,
      provider: "github",
      deliveryKind: "webhook",
      deliveryId: "github-delivery-2",
      action: "labeled",
      issue: githubIssue({ labels: ["risoluto", "risoluto:retry"] }),
      rules,
      attemptId: () => "attempt_retry_label",
      id: () => "wr_retry_label_should_not_exist",
    });
    const commentRetry = await acceptTrackerIssueWorkflowRun({
      dataDir,
      provider: "github",
      deliveryKind: "polling",
      action: "comment",
      issue: githubIssue({ labels: ["risoluto"], comments: ["/risoluto retry"] }),
      rules,
      attemptId: () => "attempt_retry_comment",
      id: () => "wr_retry_comment_should_not_exist",
    });

    expect(labelRetry.action).toBe("retried");
    expect(labelRetry.runAttempt).toMatchObject({
      id: "attempt_retry_label",
      workflowRunId: "wr_tracker_github",
      attemptNumber: 1,
      reason: "retry",
    });
    expect(commentRetry.action).toBe("retried");
    expect(commentRetry.runAttempt).toMatchObject({
      id: "attempt_retry_comment",
      workflowRunId: "wr_tracker_github",
      attemptNumber: 2,
      reason: "retry",
    });
  });
});

function trackerRule(input: { readonly provider: "github" | "linear" }): WorkflowRunIntakeRule {
  return {
    id: `${input.provider}-risoluto`,
    provider: input.provider,
    requiredLabels: ["risoluto"],
    states: ["ready"],
    workflowDefinitionId: "single-operator-afk-coder",
    workspaceKey: "risoluto",
  };
}

function linearIssue() {
  return {
    id: "lin_issue_208",
    identifier: "RIS-208",
    title: "Linear tracker intake",
    url: "https://linear.app/ninetech/issue/RIS-208",
    description: "Start this workflow from Linear.",
    labels: ["risoluto"],
    state: "Ready",
  };
}

function githubIssue(input: { readonly labels: readonly string[]; readonly comments?: readonly string[] }) {
  return {
    id: "208",
    identifier: "risolutohq/risoluto#208",
    title: "GitHub tracker intake",
    url: "https://github.com/risolutohq/risoluto/issues/208",
    description: "Start this workflow from GitHub.",
    labels: input.labels,
    state: "ready",
    comments: input.comments ?? [],
  };
}
