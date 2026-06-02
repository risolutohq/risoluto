import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_WORKFLOW_RESOLUTION_DEFAULTS,
  loadWorkflowDefinitionRegistry,
  toWorkflowRunResolvedDefinitionConfig,
} from "../../src/workflow-definition/registry.js";

const tempDirs: string[] = [];

async function createWorkflowDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "risoluto-workflow-definitions-"));
  tempDirs.push(dir);
  const workflowDir = path.join(dir, ".risoluto", "workflows");
  await mkdir(workflowDir, { recursive: true });
  return workflowDir;
}

async function writeWorkflowDefinition(workflowDir: string, filename: string, body: string): Promise<void> {
  await writeFile(path.join(workflowDir, filename), body, "utf8");
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Workflow Definition registry", () => {
  it("loads the bundled single-operator-afk-coder workflow through the registry", async () => {
    const registry = await loadWorkflowDefinitionRegistry({
      workflowDir: path.resolve(".risoluto/workflows"),
      globalDefaults: { modelProfile: "fast", validationProfile: "offline-smoke" },
    });

    const resolved = registry.resolve("single-operator-afk-coder");

    expect(resolved.states).toContainEqual({
      id: "plan",
      gates: ["artifacts-valid"],
      hooks: ["collect-evidence"],
    });
    expect(toWorkflowRunResolvedDefinitionConfig(resolved)).toEqual({
      workflowDefinitionId: "single-operator-afk-coder",
      validationProfile: "node-pnpm-standard",
      modelProfiles: {
        planner: "balanced",
        implementer: "balanced",
        reviewer: "balanced",
        verifier: "verifier",
        ci_babysitter: "fast",
      },
    });
  });

  it("rejects unknown built-in references before a run can start", async () => {
    const workflowDir = await createWorkflowDir();
    await writeWorkflowDefinition(
      workflowDir,
      "bad.yaml",
      `
version: 1
id: bad
defaults:
  modelProfile: balanced
  validationProfile: node-pnpm-standard
states:
  - id: plan
    roles:
      - id: ghost
        consumes: [intent.v1]
        produces: [plan.v1]
        dependsOn: []
    gates: [artifacts-valid]
    hooks: []
actions: [create-worktree]
`.trimStart(),
    );

    await expect(
      loadWorkflowDefinitionRegistry({ workflowDir, globalDefaults: DEFAULT_WORKFLOW_RESOLUTION_DEFAULTS }),
    ).rejects.toThrow(/unknown role id ghost/);
  });

  it("rejects behavior-shaped YAML fields such as command", async () => {
    const workflowDir = await createWorkflowDir();
    await writeWorkflowDefinition(
      workflowDir,
      "command.yaml",
      `
version: 1
id: command
defaults:
  modelProfile: balanced
  validationProfile: node-pnpm-standard
states:
  - id: plan
    roles:
      - id: planner
        command: echo unsafe
        consumes: [intent.v1]
        produces: [plan.v1]
        dependsOn: []
    gates: [artifacts-valid]
    hooks: []
actions: [create-worktree]
`.trimStart(),
    );

    await expect(
      loadWorkflowDefinitionRegistry({ workflowDir, globalDefaults: DEFAULT_WORKFLOW_RESOLUTION_DEFAULTS }),
    ).rejects.toThrow(/unsupported workflow definition field command/);
  });

  it("rejects role DAG dependencies that do not reference a declared role", async () => {
    const workflowDir = await createWorkflowDir();
    await writeWorkflowDefinition(
      workflowDir,
      "bad-dependency.yaml",
      `
version: 1
id: bad-dependency
defaults:
  modelProfile: balanced
  validationProfile: node-pnpm-standard
states:
  - id: plan
    roles:
      - id: planner
        consumes: [intent.v1]
        produces: [plan.v1]
        dependsOn: [ghost]
    gates: []
    hooks: []
actions: []
`.trimStart(),
    );

    await expect(
      loadWorkflowDefinitionRegistry({ workflowDir, globalDefaults: DEFAULT_WORKFLOW_RESOLUTION_DEFAULTS }),
    ).rejects.toThrow(/unknown role dependency ghost/);
  });

  it("rejects duplicate role IDs before resolving the workflow", async () => {
    const workflowDir = await createWorkflowDir();
    await writeWorkflowDefinition(
      workflowDir,
      "duplicate-role.yaml",
      `
version: 1
id: duplicate-role
defaults:
  modelProfile: balanced
  validationProfile: node-pnpm-standard
states:
  - id: plan
    roles:
      - id: planner
        consumes: [intent.v1]
        produces: [plan.v1]
        dependsOn: []
      - id: planner
        consumes: [intent.v1]
        produces: [plan.v1]
        dependsOn: []
    gates: []
    hooks: []
actions: []
`.trimStart(),
    );

    await expect(
      loadWorkflowDefinitionRegistry({ workflowDir, globalDefaults: DEFAULT_WORKFLOW_RESOLUTION_DEFAULTS }),
    ).rejects.toThrow(/duplicate role id planner/);
  });

  it("rejects definitions without a version field", async () => {
    const workflowDir = await createWorkflowDir();
    await writeWorkflowDefinition(
      workflowDir,
      "missing-version.yaml",
      `
id: missing-version
defaults:
  modelProfile: balanced
  validationProfile: node-pnpm-standard
states: []
actions: []
`.trimStart(),
    );

    await expect(
      loadWorkflowDefinitionRegistry({ workflowDir, globalDefaults: DEFAULT_WORKFLOW_RESOLUTION_DEFAULTS }),
    ).rejects.toThrow(/version/);
  });
});
