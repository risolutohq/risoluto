import { describe, expect, it, vi } from "vitest";

import { executeWorkflowDefinition, WorkflowExecutorError } from "../../src/workflow-run/executor.js";
import type { ResolvedWorkflowDefinition } from "../../src/workflow-definition/registry.js";

const workflowRunId = "wr_executor";
const createdAt = "2026-05-31T16:00:00.000Z";

function createDefinition(): ResolvedWorkflowDefinition {
  return {
    id: "single-operator-afk-coder",
    validationProfile: "node-pnpm-standard",
    states: [
      { id: "plan", gates: [], hooks: [] },
      { id: "implement", gates: [], hooks: [] },
      { id: "review", gates: [], hooks: [] },
    ],
    roles: [
      {
        id: "planner",
        stateId: "plan",
        modelProfile: "balanced",
        consumes: ["intent.v1"],
        produces: ["plan.v1"],
        dependsOn: [],
      },
      {
        id: "implementer",
        stateId: "implement",
        modelProfile: "balanced",
        consumes: ["intent.v1", "plan.v1"],
        produces: ["change_summary.v1"],
        dependsOn: ["planner"],
      },
      {
        id: "reviewer",
        stateId: "review",
        modelProfile: "balanced",
        consumes: ["change_summary.v1"],
        produces: ["review.v1"],
        dependsOn: ["implementer"],
      },
    ],
    actions: [],
  };
}

function createPlannerOnlyDefinition(states: ResolvedWorkflowDefinition["states"]): ResolvedWorkflowDefinition {
  const definition = createDefinition();
  const planner = definition.roles.find((role) => role.id === "planner");
  if (!planner) {
    throw new Error("planner fixture role is missing");
  }
  return { ...definition, states, roles: [planner] };
}

function intentArtifact() {
  return {
    version: 1,
    workflowRunId,
    createdAt,
    source: "cli",
    title: "Fix cache",
    body: "Fix the cache invalidation bug.",
    externalReferences: [],
  };
}

// planner → implementer → reviewer → verifier (verifier in its own `verify` state, produces verification.v1).
function createVerifierDefinition(): ResolvedWorkflowDefinition {
  const base = createDefinition();
  return {
    ...base,
    states: [...base.states, { id: "verify", gates: [], hooks: [] }],
    roles: [
      ...base.roles,
      {
        id: "verifier",
        stateId: "verify",
        modelProfile: "verifier",
        consumes: ["change_summary.v1", "review.v1"],
        produces: ["verification.v1"],
        dependsOn: ["reviewer"],
      },
    ],
  };
}

// Council variant: the verifier role runs in council mode with two councillors (NIN-271).
function createCouncilVerifierDefinition(): ResolvedWorkflowDefinition {
  const base = createVerifierDefinition();
  return {
    ...base,
    roles: base.roles.map((role) =>
      role.id === "verifier"
        ? {
            ...role,
            verifierMode: "council" as const,
            councillors: [
              { id: "council-correctness", modelProfile: "verifier", lens: "correctness" },
              { id: "council-security", modelProfile: "strong", lens: "security" },
            ],
          }
        : role,
    ),
  };
}

function verificationArtifact(decision: string): Readonly<Record<string, unknown>> {
  return {
    version: 1,
    workflowRunId,
    createdAt,
    mode: "single",
    decision,
    summary: "judgement",
    allowedInputs: [],
    evidenceLinks: [],
  };
}

function passingValidationResult(): Readonly<Record<string, unknown>> {
  return {
    version: 1,
    workflowRunId,
    createdAt,
    profileId: "node-pnpm-standard",
    failureHandling: "stop_on_first",
    status: "passed",
    checks: [
      { id: "test", command: "pnpm test", status: "passed", exitCode: 0, stdout: "", stderr: "", durationMs: 1 },
    ],
  };
}

describe("executeWorkflowDefinition", () => {
  it("executes planner, implementer, and reviewer in DAG order over typed artifacts", async () => {
    const roleOrder: string[] = [];

    const result = await executeWorkflowDefinition({
      definition: createDefinition(),
      workflowRunId,
      initialArtifacts: { "intent.v1": intentArtifact() },
      runRole: async ({ role, artifacts }) => {
        roleOrder.push(role.id);
        if (role.id === "planner") {
          expect(artifacts["intent.v1"]).toMatchObject({ title: "Fix cache" });
          return { "plan.v1": { version: 1, workflowRunId, createdAt, summary: "Patch cache", steps: [] } };
        }
        if (role.id === "implementer") {
          expect(artifacts["plan.v1"]).toMatchObject({ summary: "Patch cache" });
          return {
            "change_summary.v1": {
              version: 1,
              workflowRunId,
              createdAt,
              summary: "Changed cache invalidation.",
              changedFiles: [{ path: "src/cache.ts", changeType: "modified", summary: "Invalidate correctly." }],
            },
          };
        }
        return {
          "review.v1": { version: 1, workflowRunId, createdAt, verdict: "pass", findings: [] },
        };
      },
    });

    expect(roleOrder).toEqual(["planner", "implementer", "reviewer"]);
    expect(result.status).toBe("done");
    expect(result.workflowStatesVisited).toEqual(["plan", "implement", "review"]);
  });

  it("executes configured actions and stores their typed artifacts", async () => {
    const actionOrder: string[] = [];
    const definition = { ...createDefinition(), actions: ["run-validation-profile"] };

    const result = await executeWorkflowDefinition({
      definition,
      workflowRunId,
      initialArtifacts: { "intent.v1": intentArtifact() },
      runRole: async ({ role }) => roleOutput(role.id),
      runAction: async ({ actionId }) => {
        actionOrder.push(actionId);
        return {
          "validation_result.v1": {
            version: 1,
            workflowRunId,
            createdAt,
            profileId: "node-pnpm-standard",
            failureHandling: "stop_on_first",
            status: "passed",
            checks: [
              {
                id: "test",
                command: "pnpm test",
                status: "passed",
                exitCode: 0,
                stdout: "",
                stderr: "",
                durationMs: 1,
              },
            ],
          },
        };
      },
    });

    expect(actionOrder).toEqual(["run-validation-profile"]);
    expect(result.actionExecutions).toEqual(["run-validation-profile"]);
    expect(result.artifacts["validation_result.v1"]).toMatchObject({ status: "passed" });
  });

  it("reports running and terminal Run Status through the optional status recorder", async () => {
    const recordedStatuses: string[] = [];

    const result = await executeWorkflowDefinition({
      definition: createDefinition(),
      workflowRunId,
      initialArtifacts: { "intent.v1": intentArtifact() },
      runRole: async ({ role }) => roleOutput(role.id),
      recordStatus: async ({ status }) => {
        recordedStatuses.push(status);
      },
    });

    expect(result.status).toBe("done");
    expect(recordedStatuses).toEqual(["running", "done"]);
  });

  it("blocks after planner triage when the plan artifact has only blocked steps", async () => {
    const runRole = vi.fn(async () => ({
      "plan.v1": {
        version: 1,
        workflowRunId,
        createdAt,
        summary: "Intent is too large.",
        steps: [{ id: "scope", title: "Narrow scope", status: "blocked", dependsOn: [] }],
      },
    }));

    const result = await executeWorkflowDefinition({
      definition: createDefinition(),
      workflowRunId,
      initialArtifacts: { "intent.v1": intentArtifact() },
      runRole,
    });

    expect(result.status).toBe("blocked");
    expect(runRole).toHaveBeenCalledOnce();
  });

  it("fails with dependency attribution when a required input artifact is missing", async () => {
    const definition = createDefinition();
    const runRole = vi.fn(async () => ({}));

    await expect(
      executeWorkflowDefinition({
        definition,
        workflowRunId,
        initialArtifacts: {},
        runRole,
      }),
    ).rejects.toThrow(/planner is missing required artifact intent\.v1 from intake/);
    expect(runRole).not.toHaveBeenCalled();
    expect(() => {
      throw new WorkflowExecutorError("example");
    }).toThrow(WorkflowExecutorError);
  });

  it("blocks when a configured gate fails after a role claims success", async () => {
    const definition = createPlannerOnlyDefinition([{ id: "plan", gates: ["validation-passed"], hooks: [] }]);

    const result = await executeWorkflowDefinition({
      definition,
      workflowRunId,
      initialArtifacts: { "intent.v1": intentArtifact() },
      runRole: async () => ({
        "plan.v1": { version: 1, workflowRunId, createdAt, summary: "Patch cache", steps: [] },
      }),
    });

    expect(result.status).toBe("blocked");
    expect(result.events).toContainEqual(
      expect.objectContaining({
        eventType: "validation_gate.evaluated",
        gateId: "validation-passed",
        status: "failed",
        reason: "missing required artifact validation_result.v1",
      }),
    );
  });

  it("fires state-entry hooks as evidence without changing the gate outcome", async () => {
    const calls: string[] = [];
    const definition = createPlannerOnlyDefinition([
      { id: "plan", gates: ["artifacts-valid"], hooks: ["collect-evidence"] },
    ]);

    const result = await executeWorkflowDefinition({
      definition,
      workflowRunId,
      initialArtifacts: { "intent.v1": intentArtifact() },
      runHook: async ({ hookId }) => {
        calls.push(`hook:${hookId}`);
        return { evidence: { archivePath: "runs/wr_executor/evidence/collect-evidence.json" } };
      },
      runRole: async ({ role }) => {
        calls.push(`role:${role.id}`);
        return { "plan.v1": { version: 1, workflowRunId, createdAt, summary: "Patch cache", steps: [] } };
      },
    });

    expect(result.status).toBe("done");
    expect(calls).toEqual(["hook:collect-evidence", "role:planner"]);
    expect(result.events).toEqual([
      expect.objectContaining({
        eventType: "workflow_hook.fired",
        hookId: "collect-evidence",
        evidence: { archivePath: "runs/wr_executor/evidence/collect-evidence.json" },
      }),
      expect.objectContaining({ eventType: "validation_gate.evaluated", gateId: "artifacts-valid", status: "passed" }),
    ]);
  });

  it("hard-stops before the next workflow step when the wall-clock budget is exceeded", async () => {
    const runRole = vi.fn(async () => {
      currentTimeMs = 1_201;
      return { "plan.v1": { version: 1, workflowRunId, createdAt, summary: "Patch cache", steps: [] } };
    });
    let currentTimeMs = 0;

    const result = await executeWorkflowDefinition({
      definition: createDefinition(),
      workflowRunId,
      initialArtifacts: { "intent.v1": intentArtifact() },
      budget: {
        startedAtMs: 0,
        maxWallClockMs: 1_200,
        maxCostUsd: 10,
        nowMs: () => currentTimeMs,
        usage: () => ({ usageByModelProfile: {}, modelProfilePrices: {} }),
      },
      runRole,
    });

    expect(result.status).toBe("blocked");
    expect(runRole).toHaveBeenCalledOnce();
    expect(result.roleExecutions).toEqual(["planner"]);
    expect(result.events).toContainEqual(
      expect.objectContaining({
        eventType: "workflow_budget.checked",
        status: "failed",
        reason: "wall-clock budget exceeded before role implementer",
      }),
    );
  });

  it("hard-stops before the next workflow step when the measured cost budget is exceeded", async () => {
    let usageByModelProfile = {};
    const runRole = vi.fn(async () => {
      usageByModelProfile = {
        balanced: { inputTokens: 900_000, outputTokens: 200_000, totalTokens: 1_100_000 },
      };
      return { "plan.v1": { version: 1, workflowRunId, createdAt, summary: "Patch cache", steps: [] } };
    });

    const result = await executeWorkflowDefinition({
      definition: createDefinition(),
      workflowRunId,
      initialArtifacts: { "intent.v1": intentArtifact() },
      budget: {
        startedAtMs: 0,
        maxWallClockMs: 120_000,
        maxCostUsd: 1,
        nowMs: () => 0,
        usage: () => ({
          usageByModelProfile,
          modelProfilePrices: { balanced: { inputUsd: 1, outputUsd: 1, cacheReadUsd: 1, cacheWriteUsd: 1 } },
        }),
      },
      runRole,
    });

    expect(result.status).toBe("blocked");
    expect(runRole).toHaveBeenCalledOnce();
    expect(result.events).toContainEqual(
      expect.objectContaining({
        eventType: "workflow_budget.checked",
        status: "failed",
        reason: "cost budget exceeded before role implementer",
        evidence: expect.objectContaining({
          costUsd: 1.1,
          maxCostUsd: 1,
        }),
      }),
    );
  });

  it("retries the first failed gate once with the exact failure evidence including cache token usage", async () => {
    const definition = createPlannerOnlyDefinition([{ id: "plan", gates: ["validation-passed"], hooks: [] }]);
    const gateUsage = {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      cacheReadTokens: 25,
      cacheWriteTokens: 5,
    };
    const retryGate = vi.fn(async () => ({
      "validation_result.v1": {
        version: 1,
        workflowRunId,
        createdAt,
        profileId: "node-pnpm-standard",
        failureHandling: "stop_on_first",
        status: "passed",
        checks: [
          {
            id: "build",
            command: "pnpm test",
            status: "passed",
            exitCode: 0,
            stdout: "tests passed",
            stderr: "",
            durationMs: 12,
          },
        ],
      },
    }));

    const result = await executeWorkflowDefinition({
      definition,
      workflowRunId,
      initialArtifacts: { "intent.v1": intentArtifact() },
      evaluateGate: async ({ artifacts }) => {
        if (artifacts["validation_result.v1"]) {
          return { status: "passed" };
        }
        return {
          status: "failed",
          reason: "pnpm test failed",
          evidence: { command: "pnpm test", exitCode: 1 },
          tokenUsage: gateUsage,
        };
      },
      retryGate,
      runRole: async () => ({
        "plan.v1": { version: 1, workflowRunId, createdAt, summary: "Patch cache", steps: [] },
      }),
    });

    expect(result.status).toBe("done");
    expect(retryGate).toHaveBeenCalledOnce();
    expect(retryGate).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptNumber: 1,
        failureEvidence: expect.objectContaining({
          eventType: "validation_gate.evaluated",
          gateId: "validation-passed",
          reason: "pnpm test failed",
          evidence: { command: "pnpm test", exitCode: 1 },
          tokenUsage: gateUsage,
        }),
      }),
    );
  });

  it("does not start a gate retry after the cost budget is exhausted", async () => {
    const definition = createPlannerOnlyDefinition([{ id: "plan", gates: ["validation-passed"], hooks: [] }]);
    let usageByModelProfile = {};
    const retryGate = vi.fn(async () => ({
      "validation_result.v1": { status: "passed", command: "pnpm test" },
    }));

    const result = await executeWorkflowDefinition({
      definition,
      workflowRunId,
      initialArtifacts: { "intent.v1": intentArtifact() },
      budget: {
        startedAtMs: 0,
        maxWallClockMs: 120_000,
        maxCostUsd: 1,
        nowMs: () => 0,
        usage: () => ({
          usageByModelProfile,
          modelProfilePrices: { balanced: { inputUsd: 1, outputUsd: 1, cacheReadUsd: 1, cacheWriteUsd: 1 } },
        }),
      },
      evaluateGate: async () => {
        usageByModelProfile = {
          balanced: { inputTokens: 900_000, outputTokens: 200_000, totalTokens: 1_100_000 },
        };
        return {
          status: "failed",
          reason: "validation failed",
          evidence: { command: "pnpm test", exitCode: 1 },
        };
      },
      retryGate,
      runRole: async () => ({
        "plan.v1": { version: 1, workflowRunId, createdAt, summary: "Patch cache", steps: [] },
      }),
    });

    expect(result.status).toBe("blocked");
    expect(retryGate).not.toHaveBeenCalled();
    expect(result.events).toContainEqual(
      expect.objectContaining({
        eventType: "workflow_budget.checked",
        status: "failed",
        reason: "cost budget exceeded before gate retry validation-passed",
      }),
    );
  });

  it("retries the implementer state on a not_satisfied verdict until the verifier is satisfied (NIN-201)", async () => {
    const roleRuns: string[] = [];
    let verifyCount = 0;

    const result = await executeWorkflowDefinition({
      definition: createVerifierDefinition(),
      workflowRunId,
      initialArtifacts: { "intent.v1": intentArtifact() },
      runRole: async ({ role }) => {
        roleRuns.push(role.id);
        if (role.id === "verifier") {
          verifyCount += 1;
          return { "verification.v1": verificationArtifact(verifyCount >= 2 ? "satisfied" : "not_satisfied") };
        }
        return roleOutput(role.id);
      },
    });

    expect(result.status).toBe("done");
    // not_satisfied loops back to the implement state: implement → review → verify re-run, then satisfied.
    expect(roleRuns).toEqual(["planner", "implementer", "reviewer", "verifier", "implementer", "reviewer", "verifier"]);
  });

  it("re-runs run-validation-profile on a verifier-driven retry instead of reusing stale validation (NIN-261)", async () => {
    let validationRuns = 0;
    let verifyCount = 0;
    const base = createVerifierDefinition();
    const definition: ResolvedWorkflowDefinition = {
      ...base,
      actions: ["run-validation-profile"],
      // The implement state's boundary runs validation; gating on validation-passed makes the action
      // fire in the before_state_gates phase that a verifier retry re-enters.
      states: base.states.map((state) =>
        state.id === "implement" ? { ...state, gates: ["validation-passed"] } : state,
      ),
    };

    const result = await executeWorkflowDefinition({
      definition,
      workflowRunId,
      initialArtifacts: { "intent.v1": intentArtifact() },
      runRole: async ({ role }) => {
        if (role.id === "verifier") {
          verifyCount += 1;
          return { "verification.v1": verificationArtifact(verifyCount >= 2 ? "satisfied" : "not_satisfied") };
        }
        return roleOutput(role.id);
      },
      runAction: async () => {
        validationRuns += 1;
        return { "validation_result.v1": passingValidationResult() };
      },
    });

    expect(result.status).toBe("done");
    // Global actionId dedupe ran validation exactly once; scoping by attempt re-runs it after the retry.
    expect(validationRuns).toBeGreaterThanOrEqual(2);
  });

  it("creates the worktree exactly once even across a verifier-driven retry (NIN-261)", async () => {
    let worktreeRuns = 0;
    let verifyCount = 0;
    const definition: ResolvedWorkflowDefinition = {
      ...createVerifierDefinition(),
      actions: ["create-worktree"],
    };

    const result = await executeWorkflowDefinition({
      definition,
      workflowRunId,
      initialArtifacts: { "intent.v1": intentArtifact() },
      runRole: async ({ role }) => {
        if (role.id === "verifier") {
          verifyCount += 1;
          return { "verification.v1": verificationArtifact(verifyCount >= 2 ? "satisfied" : "not_satisfied") };
        }
        return roleOutput(role.id);
      },
      runAction: async ({ actionId }) => {
        if (actionId === "create-worktree") {
          worktreeRuns += 1;
        }
        return {};
      },
    });

    expect(result.status).toBe("done");
    // create-worktree is a before_roles setup action. A verifier retry must not re-create it — the
    // after_roles phase (which keys by the retry attempt) previously re-ran it because its
    // before_roles dedupe key used attempt 0.
    expect(worktreeRuns).toBe(1);
  });

  it("blocks once the verifier retry budget is exhausted (default one retry) (NIN-201)", async () => {
    const roleRuns: string[] = [];

    const result = await executeWorkflowDefinition({
      definition: createVerifierDefinition(),
      workflowRunId,
      initialArtifacts: { "intent.v1": intentArtifact() },
      runRole: async ({ role }) => {
        roleRuns.push(role.id);
        if (role.id === "verifier") {
          return { "verification.v1": verificationArtifact("not_satisfied") };
        }
        return roleOutput(role.id);
      },
    });

    expect(result.status).toBe("blocked");
    // Default budget is one retry: verify (retry) → re-run implement→review→verify → verify (budget 0) → block.
    expect(roleRuns.filter((id) => id === "verifier")).toHaveLength(2);
    expect(roleRuns.filter((id) => id === "implementer")).toHaveLength(2);
  });

  it("routes a council-configured verifier through runCouncilVerifier and records councillor evidence (NIN-271)", async () => {
    const councillorRuns: string[] = [];

    const result = await executeWorkflowDefinition({
      definition: createCouncilVerifierDefinition(),
      workflowRunId,
      initialArtifacts: { "intent.v1": intentArtifact() },
      councilClock: () => createdAt,
      runCouncillor: async ({ councillor }) => {
        councillorRuns.push(councillor.id);
        return { status: "completed", decision: "satisfied", summary: `${councillor.lens} ok` };
      },
      synthesizeCouncil: async ({ completedResults }) => ({
        decision: "satisfied",
        summary: `synthesized from ${completedResults.length} councillors`,
      }),
      runRole: async ({ role }) => {
        if (role.id === "verifier") {
          throw new Error("council verifier must route through runCouncilVerifier, not runRole");
        }
        return roleOutput(role.id);
      },
    });

    expect(result.status).toBe("done");
    // Both councillors ran and the synthesizer decided — reached from the executor on a real run.
    expect(councillorRuns).toEqual(["council-correctness", "council-security"]);
    const verification = result.artifacts["verification.v1"] as Record<string, unknown>;
    expect(verification.mode).toBe("council");
    expect(verification.decision).toBe("satisfied");
    expect(verification.consensus).toBe("unanimous");
    expect(verification.summary).toBe("synthesized from 2 councillors");
    expect(verification.councillors).toHaveLength(2);
  });

  it("blocks a council verifier run when every councillor fails (NIN-271)", async () => {
    const synthesize = vi.fn(async () => ({ decision: "satisfied" as const, summary: "should not run" }));

    const result = await executeWorkflowDefinition({
      definition: createCouncilVerifierDefinition(),
      workflowRunId,
      initialArtifacts: { "intent.v1": intentArtifact() },
      councilClock: () => createdAt,
      runCouncillor: async () => ({ status: "failed", error: "councillor crashed" }),
      synthesizeCouncil: synthesize,
      runRole: async ({ role }) => (role.id === "verifier" ? {} : roleOutput(role.id)),
    });

    expect(result.status).toBe("blocked");
    // No completed councillor means no synthesized decision — the synthesizer must not be consulted.
    expect(synthesize).not.toHaveBeenCalled();
    expect(result.artifacts["verification.v1"]).toBeUndefined();
  });
});

function roleOutput(roleId: string): Readonly<Record<string, unknown>> {
  switch (roleId) {
    case "planner":
      return { "plan.v1": { version: 1, workflowRunId, createdAt, summary: "Patch cache", steps: [] } };
    case "implementer":
      return {
        "change_summary.v1": {
          version: 1,
          workflowRunId,
          createdAt,
          summary: "Changed cache invalidation.",
          changedFiles: [{ path: "src/cache.ts", changeType: "modified", summary: "Invalidate correctly." }],
        },
      };
    case "reviewer":
      return { "review.v1": { version: 1, workflowRunId, createdAt, verdict: "pass", findings: [] } };
    default:
      throw new Error(`unexpected role ${roleId}`);
  }
}
