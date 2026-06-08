import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import madge from "madge";
import { beforeAll, describe, expect, it } from "vitest";

import type { ReachabilityGraphProvider } from "../../src/reachability/analyzer.js";
import { createGraphProvider } from "../../src/reachability/graph-provider.js";

const REPO_ROOT = process.cwd();
const ENTRY_MODULES = ["src/cli/index.ts", "src/http/server.ts", "src/http/routes/webhooks.ts"];

async function collectTsFiles(root: string, dirs: readonly string[]): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const walk = async (relDir: string): Promise<void> => {
    const entries = await readdir(path.join(root, relDir), { withFileTypes: true });
    for (const entry of entries) {
      const rel = path.join(relDir, entry.name);
      if (entry.isDirectory()) {
        await walk(rel);
      } else if (entry.name.endsWith(".ts")) {
        files.set(rel, await readFile(path.join(root, rel), "utf8"));
      }
    }
  };
  for (const dir of dirs) {
    await walk(dir);
  }
  return files;
}

// Proves the pure graph provider works against real madge output + a real call-site scan, so the thin
// reach:check script is reachable end to end (not a stub).
describe("reach:check graph provider over real madge output (integration)", () => {
  let provider: ReachabilityGraphProvider | undefined;

  beforeAll(async () => {
    const madgeResult = await madge(ENTRY_MODULES, {
      baseDir: REPO_ROOT,
      fileExtensions: ["ts"],
      tsConfig: path.join(REPO_ROOT, "tsconfig.json"),
    });
    const sourceFiles = await collectTsFiles(REPO_ROOT, ["src", "tests"]);
    provider = createGraphProvider({ importGraph: madgeResult.obj(), sourceFiles });
  }, 30_000);

  it("resolves a real import path from the CLI entry to run-start-command", () => {
    const chain = provider?.importPathFrom("src/cli/index.ts", "src/cli/run-start-command.ts");
    expect(chain).toBeDefined();
    expect(chain?.[0]).toBe("src/cli/index.ts");
    expect(chain?.[(chain?.length ?? 0) - 1]).toBe("src/cli/run-start-command.ts");
  });

  it("finds a real non-test caller of a wired production symbol", () => {
    const callers = provider?.callersOf("driveAcceptedWorkflowRun", "src/workflow-run/drive-accepted-run.ts");
    expect(callers?.nonTest.length ?? 0).toBeGreaterThan(0);
  });
});
