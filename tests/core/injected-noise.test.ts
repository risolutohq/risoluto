import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

// The spurious "[JSON PARSE ERROR — IMMEDIATE ACTION REQUIRED]" string flagged in the code review was
// injected by the external review harness, not produced by any Risoluto code path (the agent-output
// JSON parse in src/core/signal-detection.ts swallows parse failures silently and emits no
// placeholder). This guard asserts the noise never leaks into the source — any agent/tool output path
// lives under src/, so its absence there proves the AC and catches a regression if anyone adds it
// (RIS-267). Matched on the distinctive ASCII fragments so an em-dash encoding change can't slip past.
const INJECTED_NOISE_FRAGMENTS = ["JSON PARSE ERROR", "IMMEDIATE ACTION REQUIRED"] as const;

async function collectTsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return collectTsFiles(fullPath);
      }
      return entry.isFile() && fullPath.endsWith(".ts") ? [fullPath] : [];
    }),
  );
  return nested.flat();
}

describe("injected-noise guard (RIS-267)", () => {
  it("no source file emits the spurious [JSON PARSE ERROR …] string", async () => {
    const srcDir = path.resolve("src");
    const files = await collectTsFiles(srcDir);
    const offenders: string[] = [];
    for (const file of files) {
      const content = await readFile(file, "utf8");
      if (INJECTED_NOISE_FRAGMENTS.some((fragment) => content.includes(fragment))) {
        offenders.push(path.relative(srcDir, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
