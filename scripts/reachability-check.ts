/**
 * reach:check — fail the build when a manifested capability is not reachable from a real intake adapter.
 *
 * Reads the committed capability manifest, builds the import graph with madge over the intake-adapter
 * entry modules (CLI command entry, HTTP route registry, Slack webhook route) plus an in-memory non-test
 * call-site scan of src/ and tests/, runs the reachability analyzer, prints a diff-friendly report to
 * stderr, and exits non-zero on any reachability gap. A deferred capability is neither a pass nor a
 * failure. No new dependency — madge is already present.
 *
 * Usage:  tsx scripts/reachability-check.ts   (alias: pnpm reach:check)
 * Exit:   0 = every manifested capability reachable or deferred; 1 = at least one gap; 2 = load error.
 * Env:    none.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import madge from "madge";

import type { IntakeAdapterId } from "../src/reachability/capability-manifest.js";
import { createGraphProvider } from "../src/reachability/graph-provider.js";
import { readCapabilityManifest } from "../src/reachability/manifest-file.js";
import { runReachCheck } from "../src/reachability/reach-check.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ENTRY_MODULES: Readonly<Record<IntakeAdapterId, string>> = {
  cli: "src/cli/index.ts",
  http: "src/http/server.ts",
  slack: "src/http/routes/webhooks.ts",
};

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

try {
  const manifest = readCapabilityManifest(path.join(REPO_ROOT, "src/reachability/capability-manifest.json"));
  const madgeResult = await madge(Object.values(ENTRY_MODULES), {
    baseDir: REPO_ROOT,
    fileExtensions: ["ts"],
    tsConfig: path.join(REPO_ROOT, "tsconfig.json"),
  });
  const importGraph = madgeResult.obj();
  const sourceFiles = await collectTsFiles(REPO_ROOT, ["src", "tests"]);
  const result = runReachCheck({
    manifest,
    entryModules: ENTRY_MODULES,
    graph: createGraphProvider({ importGraph, sourceFiles }),
  });
  process.stderr.write(`${result.report}\n`);
  process.exit(result.exitCode);
} catch (error) {
  process.stderr.write(`reach:check failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(2);
}
