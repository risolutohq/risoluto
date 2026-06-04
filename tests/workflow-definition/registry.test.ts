import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
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

  function validBody(id: string): string {
    return `
version: 1
id: ${id}
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
    gates: []
    hooks: []
actions: []
`.trimStart();
  }

  it("rejects a symlinked workflow-definition file (RIS-265)", async () => {
    const workflowDir = await createWorkflowDir();
    // Real target kept as a non-.yaml file so readdir only surfaces the symlink itself.
    await writeWorkflowDefinition(workflowDir, "target.txt", validBody("linked"));
    await symlink(path.join(workflowDir, "target.txt"), path.join(workflowDir, "evil.yaml"));

    await expect(
      loadWorkflowDefinitionRegistry({ workflowDir, globalDefaults: DEFAULT_WORKFLOW_RESOLUTION_DEFAULTS }),
    ).rejects.toThrow(/is not a regular file/);
  });

  it("rejects a workflow-definition file exceeding the size cap (RIS-265)", async () => {
    const workflowDir = await createWorkflowDir();
    // The size check runs before parsing, so the bytes need not be valid YAML.
    await writeWorkflowDefinition(workflowDir, "huge.yaml", `# ${"x".repeat(300_000)}`);

    await expect(
      loadWorkflowDefinitionRegistry({ workflowDir, globalDefaults: DEFAULT_WORKFLOW_RESOLUTION_DEFAULTS }),
    ).rejects.toThrow(/exceeds the .* byte size cap/);
  });

  it("rejects duplicate workflow definition IDs across files (RIS-265)", async () => {
    const workflowDir = await createWorkflowDir();
    await writeWorkflowDefinition(workflowDir, "a.yaml", validBody("dup"));
    await writeWorkflowDefinition(workflowDir, "b.yaml", validBody("dup"));

    await expect(
      loadWorkflowDefinitionRegistry({ workflowDir, globalDefaults: DEFAULT_WORKFLOW_RESOLUTION_DEFAULTS }),
    ).rejects.toThrow(/duplicate workflow definition id dup/);
  });

  it("rejects duplicate state IDs within a definition (RIS-265)", async () => {
    const workflowDir = await createWorkflowDir();
    await writeWorkflowDefinition(
      workflowDir,
      "dup-state.yaml",
      `
version: 1
id: dup-state
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
    gates: []
    hooks: []
  - id: plan
    roles:
      - id: implementer
        consumes: [intent.v1, plan.v1]
        produces: [change_summary.v1]
        dependsOn: [planner]
    gates: []
    hooks: []
actions: []
`.trimStart(),
    );

    await expect(
      loadWorkflowDefinitionRegistry({ workflowDir, globalDefaults: DEFAULT_WORKFLOW_RESOLUTION_DEFAULTS }),
    ).rejects.toThrow(/duplicate state id plan/);
  });

  it("rejects a definition with empty states (RIS-265)", async () => {
    const workflowDir = await createWorkflowDir();
    await writeWorkflowDefinition(
      workflowDir,
      "no-states.yaml",
      `
version: 1
id: no-states
defaults:
  modelProfile: balanced
  validationProfile: node-pnpm-standard
states: []
actions: []
`.trimStart(),
    );

    await expect(
      loadWorkflowDefinitionRegistry({ workflowDir, globalDefaults: DEFAULT_WORKFLOW_RESOLUTION_DEFAULTS }),
    ).rejects.toThrow(/declares no states/);
  });

  it("rejects a definition with states but no roles (RIS-265)", async () => {
    const workflowDir = await createWorkflowDir();
    await writeWorkflowDefinition(
      workflowDir,
      "no-roles.yaml",
      `
version: 1
id: no-roles
defaults:
  modelProfile: balanced
  validationProfile: node-pnpm-standard
states:
  - id: plan
    roles: []
    gates: []
    hooks: []
actions: []
`.trimStart(),
    );

    await expect(
      loadWorkflowDefinitionRegistry({ workflowDir, globalDefaults: DEFAULT_WORKFLOW_RESOLUTION_DEFAULTS }),
    ).rejects.toThrow(/declares no roles/);
  });

  it("rejects a role dependency cycle (RIS-266)", async () => {
    const workflowDir = await createWorkflowDir();
    await writeWorkflowDefinition(
      workflowDir,
      "cycle.yaml",
      `
version: 1
id: cycle
defaults:
  modelProfile: balanced
  validationProfile: node-pnpm-standard
states:
  - id: loop
    roles:
      - id: planner
        consumes: [intent.v1]
        produces: [plan.v1]
        dependsOn: [reviewer]
      - id: reviewer
        consumes: [change_summary.v1]
        produces: [review.v1]
        dependsOn: [planner]
    gates: []
    hooks: []
actions: []
`.trimStart(),
    );

    await expect(
      loadWorkflowDefinitionRegistry({ workflowDir, globalDefaults: DEFAULT_WORKFLOW_RESOLUTION_DEFAULTS }),
    ).rejects.toThrow(/role dependency cycle detected/);
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
