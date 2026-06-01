import { createHash, createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createWorkflowRunArchive } from "../../src/workflow-run/archive.js";
import { parseWorkflowRunArtifact } from "../../src/workflow-run/artifact-contracts.js";
import {
  acceptSlackModalWorkflowRun,
  decideUnansweredSlackClarification,
  handleSlackApprovalTap,
  recordSlackOperatorResponse,
} from "../../src/workflow-run/slack-interactions.js";
import type { WorkflowRunIntakeRule } from "../../src/workflow-run/intake-core.js";

const TEST_SECRET = "slack-signing-secret";
const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "risoluto-slack-interactions-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Slack workflow-run interactions", () => {
  it("creates a Workflow Run from a Slack modal through the shared intake pipeline", async () => {
    const dataDir = await createTempDir();

    const intake = await acceptSlackModalWorkflowRun({
      dataDir,
      modal: slackModal(),
      rules: [slackRule()],
      now: () => "2026-05-31T20:50:00.000Z",
      id: () => "wr_slack_modal",
    });

    expect(intake).toMatchObject({
      type: "workflow_run_intake.accepted",
      action: "created",
      workflowRun: {
        id: "wr_slack_modal",
        source: "slack",
        title: "Ship Slack intake",
        intent: "Wire the modal into the workflow run intake.",
      },
      intent: {
        workflowRunId: "wr_slack_modal",
        source: "slack",
        title: "Ship Slack intake",
        body: "Wire the modal into the workflow run intake.",
      },
    });
    await expect(createWorkflowRunArchive({ dataDir }).loadWorkflowRun("wr_slack_modal")).resolves.toMatchObject({
      source: "slack",
      workflowDefinitionId: "single-operator-afk-coder",
    });
  });

  it("does not apply a duplicate Slack approval tap with the same nonce twice", async () => {
    const dataDir = await createTempDir();
    const rawBody = Buffer.from("payload=approve");
    const first = approvalTap({ dataDir, rawBody });

    await expect(handleSlackApprovalTap(first)).resolves.toMatchObject({ type: "slack_approval.recorded" });
    await expect(handleSlackApprovalTap(first)).resolves.toEqual({
      type: "slack_approval.rejected",
      reason: "duplicate_nonce",
    });
  });

  it("retries unanswered clarification while budget remains and then blocks the run", () => {
    const retry = decideUnansweredSlackClarification({
      workflowRunId: "wr_question",
      questionId: "clarify-scope",
      attemptsUsed: 0,
      maxAttempts: 1,
      budgetRemaining: true,
    });
    const blocked = decideUnansweredSlackClarification({
      workflowRunId: "wr_question",
      questionId: "clarify-scope",
      attemptsUsed: 1,
      maxAttempts: 1,
      budgetRemaining: true,
    });

    expect(retry).toEqual({
      type: "slack_clarification.retry",
      workflowRunId: "wr_question",
      questionId: "clarify-scope",
      nextAttempt: 1,
    });
    expect(blocked).toEqual({
      type: "slack_clarification.block",
      workflowRunId: "wr_question",
      questionId: "clarify-scope",
      runStatus: "blocked",
      reason: "clarification_unanswered",
    });
  });

  it("records Slack clarification replies as operator_response.v1 artifacts", async () => {
    const dataDir = await createTempDir();

    const result = await recordSlackOperatorResponse({
      dataDir,
      workflowRunId: "wr_response",
      questionId: "clarify-scope",
      response: "Limit this run to the CLI entrypoint.",
      operator: { id: "operator-omer", slackUserId: "U_OK" },
      slack: { teamId: "T_OK", userId: "U_OK" },
      now: () => "2026-05-31T20:51:00.000Z",
    });

    expect(result.artifact).toMatchObject({
      artifactId: `operator-response-${createHash("sha256").update("clarify-scope").digest("hex").slice(0, 16)}`,
      contractId: "operator_response.v1",
    });
    expect(parseWorkflowRunArtifact({ contractId: "operator_response.v1", data: result.response })).toEqual(
      result.response,
    );
  });
});

function slackModal() {
  return {
    viewId: "V_MODAL_1",
    teamId: "T_OK",
    userId: "U_OK",
    title: "Ship Slack intake",
    body: "Wire the modal into the workflow run intake.",
    workflowDefinitionId: "single-operator-afk-coder",
    workspaceKey: "risoluto",
  };
}

function slackRule(): WorkflowRunIntakeRule {
  return {
    id: "slack-modal",
    provider: "slack",
    workflowDefinitionId: "single-operator-afk-coder",
    workspaceKey: "risoluto",
  };
}

function approvalTap(input: { readonly dataDir: string; readonly rawBody: Buffer }) {
  return {
    dataDir: input.dataDir,
    signingSecret: TEST_SECRET,
    signature: signSlack(input.rawBody, 1000),
    timestampEpochSeconds: 1000,
    receivedAtEpochSeconds: 1200,
    rawBody: input.rawBody,
    approval: {
      workflowRunId: "wr_slack_approval",
      actionId: "auto-merge-pr",
      nonce: "approve-once",
      permission: "approve_auto_merge" as const,
      slackUserId: "U_OK",
      slackTeamId: "T_OK",
    },
    operators: [{ id: "operator-omer", slackUserId: "U_OK", permissions: ["approve_auto_merge" as const] }],
    allowedSlackTeamIds: ["T_OK"],
    now: () => "2026-05-31T20:52:00.000Z",
  };
}

function signSlack(rawBody: Buffer, timestampEpochSeconds: number): string {
  const base = `v0:${timestampEpochSeconds}:${rawBody.toString("utf8")}`;
  return `v0=${createHmac("sha256", TEST_SECRET).update(base).digest("hex")}`;
}
