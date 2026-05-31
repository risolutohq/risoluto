import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "risoluto-cli-run-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("run CLI walking skeleton", () => {
  it("starts a Workflow Run from local intent and reports persisted Run Status", async () => {
    const dataDir = await createTempDir();
    const stdout: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => {
      stdout.push(line);
    });

    const { main } = await import("../../src/cli/index.js");

    await expect(
      main([
        "run",
        "start",
        "--title",
        "Patch flaky status",
        "--intent",
        "Patch the flaky status command.",
        "--data-dir",
        dataDir,
        "--json",
      ]),
    ).resolves.toBe(0);

    const started = JSON.parse(stdout[0]) as { workflowRun: { id: string; status: string } };
    expect(started.workflowRun.id).toMatch(/^wr_/);
    expect(started.workflowRun.status).toBe("accepted");

    await expect(main(["run", "status", started.workflowRun.id, "--data-dir", dataDir, "--json"])).resolves.toBe(0);

    const status = JSON.parse(stdout[1]) as { type: string; workflowRun: { id: string; status: string } };
    expect(status).toEqual({
      type: "workflow_run.status",
      workflowRun: {
        id: started.workflowRun.id,
        status: "accepted",
      },
    });
  });

  it("rejects invalid workflow definitions through workflow validate", async () => {
    const workflowDir = path.join(await createTempDir(), ".risoluto", "workflows");
    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "bad.yaml"),
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
      "utf8",
    );

    const { main } = await import("../../src/cli/index.js");

    await expect(main(["workflow", "validate", "--workflow-dir", workflowDir])).rejects.toThrow(
      /unknown role id ghost/,
    );
  });

  it("reports read-only doctor failures for invalid workflows and missing evidence paths", async () => {
    const tempDir = await createTempDir();
    const workflowDir = path.join(tempDir, ".risoluto", "workflows");
    const evidenceDir = path.join(tempDir, "missing-evidence");
    const stdout: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => {
      stdout.push(line);
    });
    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "bad.yaml"),
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
      "utf8",
    );

    const { main } = await import("../../src/cli/index.js");

    await expect(
      main(["doctor", "--workflow-dir", workflowDir, "--evidence-dir", evidenceDir, "--json"]),
    ).resolves.toBe(1);

    const result = JSON.parse(stdout[0]) as {
      type: string;
      status: string;
      checks: Array<{ id: string; status: string; message: string }>;
    };
    expect(result).toMatchObject({
      type: "doctor.result",
      status: "failed",
      checks: [
        { id: "workflow_definitions", status: "failed" },
        { id: "evidence_path", status: "failed" },
      ],
    });
    expect(result.checks[0]?.message).toContain("unknown role id ghost");
    await expect(access(evidenceDir)).rejects.toThrow();
  });
});
