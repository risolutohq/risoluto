import { describe, expect, it, vi } from "vitest";

import { parseWorkflowRunArtifact } from "../../src/workflow-run/artifact-contracts.js";
import { evaluateValidationResultGate, runValidationProfile } from "../../src/workflow-run/validation-profile.js";

const workflowRunId = "wr_validation_profile";
const createdAt = "2026-05-31T18:30:00.000Z";

describe("validation profiles", () => {
  it("halts a stop-on-first profile on the first failing command and captures output as validation evidence", async () => {
    const runCommand = vi.fn(async ({ command }: { readonly command: string }) => ({
      exitCode: command === "pnpm run build" ? 1 : 0,
      stdout: command === "pnpm run build" ? "build stdout" : "should not run",
      stderr: command === "pnpm run build" ? "build stderr" : "",
      durationMs: 12,
    }));

    const artifact = await runValidationProfile({
      profileId: "node-pnpm-standard",
      workflowRunId,
      createdAt,
      runCommand,
    });

    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(artifact).toMatchObject({
      version: 1,
      workflowRunId,
      createdAt,
      profileId: "node-pnpm-standard",
      failureHandling: "stop_on_first",
      status: "failed",
      checks: [
        {
          id: "build",
          command: "pnpm run build",
          status: "failed",
          exitCode: 1,
          stdout: "build stdout",
          stderr: "build stderr",
        },
      ],
    });
    expect(parseWorkflowRunArtifact({ contractId: "validation_result.v1", data: artifact })).toEqual(artifact);
  });

  it("runs every check for a collect-all profile and aggregates outputs", async () => {
    const runCommand = vi.fn(async ({ command }: { readonly command: string }) => ({
      exitCode: command === "pnpm test" ? 1 : 0,
      stdout: `${command} stdout`,
      stderr: `${command} stderr`,
      durationMs: 7,
    }));

    const artifact = await runValidationProfile({
      profileId: "offline-smoke",
      workflowRunId,
      createdAt,
      runCommand,
    });

    expect(runCommand).toHaveBeenCalledTimes(2);
    expect(artifact).toMatchObject({
      profileId: "offline-smoke",
      failureHandling: "collect_all",
      status: "failed",
      checks: [
        { id: "build", command: "pnpm run build", status: "passed", stdout: "pnpm run build stdout" },
        { id: "test", command: "pnpm test", status: "failed", stderr: "pnpm test stderr" },
      ],
    });
  });

  it("rejects passed validation evidence when any check failed", () => {
    const artifact = {
      version: 1,
      workflowRunId,
      createdAt,
      profileId: "offline-smoke",
      failureHandling: "collect_all",
      status: "passed",
      checks: [
        {
          id: "test",
          command: "pnpm test",
          status: "failed",
          exitCode: 1,
          stdout: "test stdout",
          stderr: "test stderr",
          durationMs: 9,
        },
      ],
    };

    expect(() => parseWorkflowRunArtifact({ contractId: "validation_result.v1", data: artifact })).toThrow(
      /status must be failed when any check failed/,
    );
    expect(() => evaluateValidationResultGate(artifact)).toThrow(/status must be failed when any check failed/);
  });
});
