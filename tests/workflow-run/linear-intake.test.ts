import { describe, expect, it } from "vitest";

import { useTempDirs } from "../helpers.js";
import { createWorkflowRunArchive } from "../../src/workflow-run/archive.js";
import { acceptLinearTriggeredWorkflowRun } from "../../src/workflow-run/linear-intake.js";

const createTempDir = useTempDirs("risoluto-linear-workflow-run-");

describe("acceptLinearTriggeredWorkflowRun", () => {
  it("persists a Workflow Run artifact from a Linear issue trigger", async () => {
    const dataDir = await createTempDir();

    const output = await acceptLinearTriggeredWorkflowRun({
      dataDir,
      action: "create",
      deliveryId: "linear-delivery-1",
      issue: {
        id: "lin_issue_1",
        identifier: "RIS-42",
        title: "Ship the durable workflow run",
        url: "https://linear.app/risoluto/issue/RIS-42",
        description: "Operator-approved work.",
      },
      now: () => "2026-05-25T11:00:00.000Z",
      id: () => "wr_linear_1",
    });

    expect(output.type).toBe("workflow_run.started");
    expect(output.workflowRun).toMatchObject({
      id: "wr_linear_1",
      source: "linear",
      status: "accepted",
      title: "RIS-42: Ship the durable workflow run",
      intent: "Operator-approved work.",
      workflowDefinitionId: "single-operator-afk-coder",
      trigger: {
        type: "linear_issue",
        issueId: "lin_issue_1",
        issueIdentifier: "RIS-42",
        issueUrl: "https://linear.app/risoluto/issue/RIS-42",
        action: "create",
        deliveryId: "linear-delivery-1",
      },
    });

    const archive = createWorkflowRunArchive({ dataDir });
    await expect(archive.loadWorkflowRun(output.workflowRun.id)).resolves.toEqual(output.workflowRun);
    await expect(archive.readWorkflowRunEvents(output.workflowRun.id)).resolves.toEqual([
      {
        at: "2026-05-25T11:00:00.000Z",
        sequence: 1,
        eventType: "workflow_run.accepted",
        workflowRunId: "wr_linear_1",
        source: "linear",
        workflowDefinitionId: "single-operator-afk-coder",
        trigger: {
          type: "linear_issue",
          issueId: "lin_issue_1",
          issueIdentifier: "RIS-42",
          issueUrl: "https://linear.app/risoluto/issue/RIS-42",
          action: "create",
          deliveryId: "linear-delivery-1",
        },
      },
    ]);
  });
});
