import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { useTempDirs } from "../helpers.js";
import { createWorkflowRunArchive } from "../../src/workflow-run/archive.js";
import { recordSlackOperatorApproval } from "../../src/workflow-run/slack-operator-approval.js";

const TEST_SECRET = "slack-signing-secret";
const createTempDir = useTempDirs("risoluto-slack-operator-approval-");

describe("recordSlackOperatorApproval", () => {
  it("rejects a Slack approval outside the replay window before writing an artifact", async () => {
    const dataDir = await createTempDir();
    const rawBody = Buffer.from("payload=old");

    const result = await recordSlackOperatorApproval({
      dataDir,
      signingSecret: TEST_SECRET,
      signature: signSlack(rawBody, 1000),
      timestampEpochSeconds: 1000,
      receivedAtEpochSeconds: 1401,
      rawBody,
      approval: approvalInput({ workflowRunId: "wr_slack_old", nonce: "old-nonce" }),
      operators: [operator()],
      allowedSlackTeamIds: ["T_OK"],
      now: () => "2026-05-31T20:25:00.000Z",
    });

    expect(result).toEqual({ type: "slack_approval.rejected", reason: "replay_window" });
    await expect(
      createWorkflowRunArchive({ dataDir }).readWorkflowRunArtifact({
        workflowRunId: "wr_slack_old",
        artifactId: approvalArtifactId("old-nonce"),
      }),
    ).rejects.toThrow();
  });

  it("rejects an invalid Slack signature before mapping an operator", async () => {
    const dataDir = await createTempDir();
    const rawBody = Buffer.from("payload=tampered");

    const result = await recordSlackOperatorApproval({
      dataDir,
      signingSecret: TEST_SECRET,
      signature: "v0=deadbeef",
      timestampEpochSeconds: 1000,
      receivedAtEpochSeconds: 1200,
      rawBody,
      approval: approvalInput({}),
      operators: [operator()],
      allowedSlackTeamIds: ["T_OK"],
      now: () => "2026-05-31T20:25:30.000Z",
    });

    expect(result).toEqual({ type: "slack_approval.rejected", reason: "signature_invalid" });
  });

  it("rejects a Slack approval from a disallowed team", async () => {
    const dataDir = await createTempDir();
    const rawBody = Buffer.from("payload=wrong-team");

    const result = await recordSlackOperatorApproval({
      dataDir,
      signingSecret: TEST_SECRET,
      signature: signSlack(rawBody, 1000),
      timestampEpochSeconds: 1000,
      receivedAtEpochSeconds: 1200,
      rawBody,
      approval: approvalInput({ slackTeamId: "T_OTHER" }),
      operators: [operator()],
      allowedSlackTeamIds: ["T_OK"],
      now: () => "2026-05-31T20:25:45.000Z",
    });

    expect(result).toEqual({ type: "slack_approval.rejected", reason: "team_not_allowed" });
  });

  it("rejects risky approval from an unmapped Slack user", async () => {
    const dataDir = await createTempDir();
    const rawBody = Buffer.from("payload=unknown-user");

    const result = await recordSlackOperatorApproval({
      dataDir,
      signingSecret: TEST_SECRET,
      signature: signSlack(rawBody, 1000),
      timestampEpochSeconds: 1000,
      receivedAtEpochSeconds: 1200,
      rawBody,
      approval: approvalInput({ slackUserId: "U_UNKNOWN" }),
      operators: [operator()],
      allowedSlackTeamIds: ["T_OK"],
      now: () => "2026-05-31T20:26:00.000Z",
    });

    expect(result).toEqual({ type: "slack_approval.rejected", reason: "operator_unmapped" });
  });

  it("rejects a mapped operator without the requested approval permission", async () => {
    const dataDir = await createTempDir();
    const rawBody = Buffer.from("payload=permission-denied");

    const result = await recordSlackOperatorApproval({
      dataDir,
      signingSecret: TEST_SECRET,
      signature: signSlack(rawBody, 1000),
      timestampEpochSeconds: 1000,
      receivedAtEpochSeconds: 1200,
      rawBody,
      approval: approvalInput({}),
      operators: [{ ...operator(), permissions: ["start_run"] }],
      allowedSlackTeamIds: ["T_OK"],
      now: () => "2026-05-31T20:26:30.000Z",
    });

    expect(result).toEqual({ type: "slack_approval.rejected", reason: "permission_denied" });
  });

  it("records operator identity, permission, run id, action id, and nonce for a valid approval", async () => {
    const dataDir = await createTempDir();
    const rawBody = Buffer.from("payload=approve");

    const result = await recordSlackOperatorApproval({
      dataDir,
      signingSecret: TEST_SECRET,
      signature: signSlack(rawBody, 1000),
      timestampEpochSeconds: 1000,
      receivedAtEpochSeconds: 1200,
      rawBody,
      approval: approvalInput({ nonce: "approve-nonce" }),
      operators: [operator()],
      allowedSlackTeamIds: ["T_OK"],
      now: () => "2026-05-31T20:27:00.000Z",
    });

    expect(result).toMatchObject({
      type: "slack_approval.recorded",
      approval: {
        workflowRunId: "wr_slack_approval",
        operator: { id: "operator-omer", slackUserId: "U_OK" },
        permission: "approve_auto_merge",
        actionId: "auto-merge-pr",
        nonce: "approve-nonce",
      },
      artifact: {
        artifactId: approvalArtifactId("approve-nonce"),
        contractId: "operator_approval.v1",
      },
    });
    await expect(
      createWorkflowRunArchive({ dataDir }).readWorkflowRunArtifact({
        workflowRunId: "wr_slack_approval",
        artifactId: approvalArtifactId("approve-nonce"),
      }),
    ).resolves.toMatchObject({
      contractId: "operator_approval.v1",
      data: {
        workflowRunId: "wr_slack_approval",
        permission: "approve_auto_merge",
        actionId: "auto-merge-pr",
        nonce: "approve-nonce",
      },
    });
  });

  it("rejects a duplicate approval nonce without replacing the stored approval", async () => {
    const dataDir = await createTempDir();
    const rawBody = Buffer.from("payload=duplicate");
    const firstInput = {
      dataDir,
      signingSecret: TEST_SECRET,
      signature: signSlack(rawBody, 1000),
      timestampEpochSeconds: 1000,
      receivedAtEpochSeconds: 1200,
      rawBody,
      approval: approvalInput({ nonce: "duplicate-nonce" }),
      operators: [operator()],
      allowedSlackTeamIds: ["T_OK"],
      now: () => "2026-05-31T20:28:00.000Z",
    };

    await expect(recordSlackOperatorApproval(firstInput)).resolves.toMatchObject({ type: "slack_approval.recorded" });

    const result = await recordSlackOperatorApproval({
      ...firstInput,
      now: () => "2026-05-31T20:29:00.000Z",
    });

    expect(result).toEqual({ type: "slack_approval.rejected", reason: "duplicate_nonce" });
    await expect(
      createWorkflowRunArchive({ dataDir }).readWorkflowRunArtifact({
        workflowRunId: "wr_slack_approval",
        artifactId: approvalArtifactId("duplicate-nonce"),
      }),
    ).resolves.toMatchObject({
      data: {
        createdAt: "2026-05-31T20:28:00.000Z",
        nonce: "duplicate-nonce",
      },
    });
  });

  it("rejects concurrent duplicate approval nonces atomically", async () => {
    const dataDir = await createTempDir();
    const rawBody = Buffer.from("payload=concurrent-duplicate");
    const input = {
      dataDir,
      signingSecret: TEST_SECRET,
      signature: signSlack(rawBody, 1000),
      timestampEpochSeconds: 1000,
      receivedAtEpochSeconds: 1200,
      rawBody,
      approval: approvalInput({ nonce: "concurrent-nonce" }),
      operators: [operator()],
      allowedSlackTeamIds: ["T_OK"],
      now: () => "2026-05-31T20:30:00.000Z",
    };

    const results = await Promise.all([recordSlackOperatorApproval(input), recordSlackOperatorApproval(input)]);

    expect(results.filter((result) => result.type === "slack_approval.recorded")).toHaveLength(1);
    expect(results.filter((result) => result.type === "slack_approval.rejected")).toEqual([
      { type: "slack_approval.rejected", reason: "duplicate_nonce" },
    ]);
  });
});

function approvalInput(overrides: {
  readonly workflowRunId?: string;
  readonly slackUserId?: string;
  readonly slackTeamId?: string | null;
  readonly nonce?: string;
}) {
  return {
    workflowRunId: overrides.workflowRunId ?? "wr_slack_approval",
    actionId: "auto-merge-pr",
    nonce: overrides.nonce ?? "nonce-1",
    permission: "approve_auto_merge" as const,
    slackUserId: overrides.slackUserId ?? "U_OK",
    slackTeamId: overrides.slackTeamId ?? "T_OK",
  };
}

function operator() {
  return {
    id: "operator-omer",
    slackUserId: "U_OK",
    permissions: ["approve_auto_merge" as const],
  };
}

function signSlack(rawBody: Buffer, timestampEpochSeconds: number): string {
  const base = `v0:${timestampEpochSeconds}:${rawBody.toString("utf8")}`;
  return `v0=${createHmac("sha256", TEST_SECRET).update(base).digest("hex")}`;
}

// Mirrors the production id derivation in slack-operator-approval.ts so the assertions verify the id is
// derived from the nonce rather than depending on a magic hex string.
function approvalArtifactId(nonce: string): string {
  return `operator-approval-${createHash("sha256").update(nonce).digest("hex").slice(0, 16)}`;
}

describe("approvalArtifactId (N2 collision resistance)", () => {
  it("derives distinct artifact ids for nonces sharing a 64-char prefix", () => {
    const prefix = "n".repeat(64);
    expect(approvalArtifactId(`${prefix}a`)).not.toEqual(approvalArtifactId(`${prefix}b`));
  });
});
