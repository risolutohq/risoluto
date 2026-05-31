import { afterEach, describe, expect, it, vi } from "vitest";

import { executeWorkflowDefinition } from "../../src/workflow-run/executor.js";
import { projectWorkflowRunStatus } from "../../src/workflow-run/status-projection.js";
import {
  cleanupDogfoodContext,
  createDogfoodContext,
  startCliWorkflowRun,
  startSlackWorkflowRun,
  startTrackerWorkflowRun,
  type DogfoodContext,
} from "./workflow-first-afk-dogfood-fixture.js";
import {
  evaluateDraftPublish,
  executeDogfoodEngine,
  loadBundledWorkflowDefinition,
  readIntentArtifact,
  readWorkflowRunOverHttp,
  requestAutoMergeWithoutApproval,
  runDogfoodDoctor,
  writeBlockedHandoff,
  writeCouncilVerification,
  writeRedactedDogfoodEvidence,
} from "./workflow-first-afk-dogfood-runtime.js";
import { dogfoodBudget, planArtifact } from "./workflow-first-afk-dogfood-artifacts.js";

const WORKFLOW_ID = "single-operator-afk-coder";
const tempContexts: DogfoodContext[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempContexts.splice(0).map(cleanupDogfoodContext));
});

describe("workflow-first AFK dogfood capstone", () => {
  it("proves the MVP surfaces compose into one dogfood acceptance path", async () => {
    const context = await createTrackedDogfoodContext();
    const cliRun = await startCliWorkflowRun(context);
    const slackRun = await startSlackWorkflowRun(context);
    const trackerRun = await startTrackerWorkflowRun(context);
    const engine = await executeDogfoodEngine(context, cliRun);
    const httpStatus = await readWorkflowRunOverHttp(context, cliRun.id);
    const evidence = await writeRedactedDogfoodEvidence(context, cliRun.id);
    const verification = await writeCouncilVerification(context, cliRun.id);
    const publish = evaluateDraftPublish(cliRun.id);
    const autoMerge = await requestAutoMergeWithoutApproval(cliRun.id);
    const handoff = await writeBlockedHandoff(context, cliRun.id, evidence.path);
    const doctor = await runDogfoodDoctor(context, cliRun.id);

    expect([cliRun.workflowDefinitionId, slackRun.workflowDefinitionId, trackerRun.workflowDefinitionId]).toEqual([
      WORKFLOW_ID,
      WORKFLOW_ID,
      WORKFLOW_ID,
    ]);
    expect(engine).toMatchObject({ status: "done", workflowStatesVisited: ["plan", "implement", "review", "publish"] });
    expect(httpStatus.workflowRun).toMatchObject({ id: cliRun.id, status: cliRun.status });
    expect(projectCanonicalStatus(cliRun)).toMatchObject({ runStatus: cliRun.status, externalStatus: "In Progress" });
    expect(verification).toMatchObject({ mode: "council", decision: "satisfied", consensus: "majority" });
    expect(publish).toMatchObject({ mode: "draft", status: "published", draft: true });
    expect(autoMerge).toEqual({ status: "blocked", reason: "operator_approval_required" });
    expect(handoff).toContain("Status: blocked");
    expect(doctor.status).toBe("passed");
  });

  it("hard-stops a workflow mid-run when the configured budget is exceeded", async () => {
    const context = await createTrackedDogfoodContext();
    const cliRun = await startCliWorkflowRun(context);
    const definition = await loadBundledWorkflowDefinition(context.workflowDir);

    const result = await executeWorkflowDefinition({
      definition,
      workflowRunId: cliRun.id,
      initialArtifacts: { "intent.v1": await readIntentArtifact(context, cliRun.id) },
      budget: dogfoodBudget([0, 20_000]),
      runRole: async () => ({ "plan.v1": planArtifact(cliRun.id) }),
    });

    expect(result).toMatchObject({ status: "blocked", roleExecutions: ["planner"] });
    expect(result.events).toContainEqual(
      expect.objectContaining({ eventType: "workflow_budget.checked", status: "failed" }),
    );
  });
});

async function createTrackedDogfoodContext(): Promise<DogfoodContext> {
  const context = await createDogfoodContext();
  tempContexts.push(context);
  return context;
}

function projectCanonicalStatus(workflowRun: {
  readonly id: string;
  readonly workflowDefinitionId: string;
  readonly status: "accepted";
}) {
  return projectWorkflowRunStatus({
    workflowRunId: workflowRun.id,
    workflowDefinitionId: workflowRun.workflowDefinitionId,
    provider: "linear",
    runStatus: workflowRun.status,
    workspaceMapping: { accepted: "In Progress", blocked: "Blocked", done: "Done" },
  });
}
