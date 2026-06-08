import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createWorkflowRunEvidenceStore } from "../../src/workflow-run/evidence-store.js";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "risoluto-ev-show-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("run evidence show is reachable from the real CLI (NIN-108 reachability)", () => {
  it("redacts a secret-classified field on display while preserving the raw stored record", async () => {
    const dataDir = await createTempDir();
    const store = createWorkflowRunEvidenceStore({ dataDir });

    const written = await store.writeEvidence({
      workflowRunId: "wr_ev_show_test",
      evidenceId: "codex-session",
      kind: "role_transcript",
      source: "codex",
      createdAt: "2026-06-08T10:00:00.000Z",
      content: {
        sessionTrace: "sensitive-output-value",
        publicNote: "nothing to hide",
      },
      classifiedFields: [{ path: ["sessionTrace"], classification: "secret" }],
    });

    const stdout: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => {
      stdout.push(line);
    });

    const { main } = await import("../../src/cli/index.js");

    await expect(
      main([
        "run",
        "evidence",
        "show",
        written.workflowRunId,
        "--evidence-id",
        written.evidenceId,
        "--data-dir",
        dataDir,
        "--json",
      ]),
    ).resolves.toBe(0);

    // Display output: secret-classified field is redacted
    const output = JSON.parse(stdout[0] ?? "{}") as {
      type: string;
      evidence: {
        content: { sessionTrace: string; publicNote: string };
        redactions: Array<{ path: string[]; classification: string }>;
      };
    };
    expect(output.type).toBe("workflow_run.evidence.display");
    expect(output.evidence.content.sessionTrace).toBe("[REDACTED]");
    expect(output.evidence.content.publicNote).toBe("nothing to hide");
    expect(output.evidence.redactions).toEqual([{ path: ["sessionTrace"], classification: "secret" }]);

    // Raw stored record: original value is preserved
    const raw = await store.readEvidence({
      workflowRunId: written.workflowRunId,
      evidenceId: written.evidenceId,
    });
    const rawContent = raw.content as { sessionTrace: string };
    expect(rawContent.sessionTrace).toBe("sensitive-output-value");
  });
});
