import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { claimExternalMapping, readExternalMapping } from "../../src/workflow-run/intake-idempotency-store.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createDataDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "risoluto-intake-idempotency-"));
  tempDirs.push(dir);
  return dir;
}

describe("intake idempotency store", () => {
  it("atomically overwrites a stale mapping and leaves no partial temp file (RIS-266)", async () => {
    const dataDir = await createDataDir();
    const location = { dataDir };
    const externalObject = { provider: "github" as const, id: "acme/repo#7", url: null };

    const first = await claimExternalMapping({ location, externalObject, workflowRunId: "wr_old", ruleId: null });
    expect(first.status).toBe("claimed");

    // The second claim finds the existing mapping stale and overwrites it via temp-file + rename.
    const second = await claimExternalMapping({
      location,
      externalObject,
      workflowRunId: "wr_new",
      ruleId: null,
      recoverStaleMapping: async () => true,
    });
    expect(second.status).toBe("claimed");

    const mapping = await readExternalMapping({ location, externalObject });
    expect(mapping?.workflowRunId).toBe("wr_new");

    // The rename cleaned up after itself: the mapping dir holds exactly the mapping file, no *.tmp.
    const mappingDir = path.join(dataDir, "archives", "intake", "external-objects", "github");
    const files = await readdir(mappingDir);
    expect(files.filter((file) => file.endsWith(".tmp"))).toEqual([]);
    expect(files).toHaveLength(1);
  });
});
