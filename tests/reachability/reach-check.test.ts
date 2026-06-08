import { describe, expect, it } from "vitest";

import type { ReachabilityGraphProvider } from "../../src/reachability/analyzer.js";
import type {
  CapabilityManifest,
  CapabilityManifestEntry,
  IntakeAdapterId,
} from "../../src/reachability/capability-manifest.js";
import { runReachCheck } from "../../src/reachability/reach-check.js";

const ENTRY_MODULES: Readonly<Record<IntakeAdapterId, string>> = {
  cli: "src/cli/index.ts",
  http: "src/http/server.ts",
  slack: "src/http/routes/webhooks.ts",
};

function cap(
  name: string,
  symbol: string,
  module: string,
  extra: Partial<CapabilityManifestEntry> = {},
): CapabilityManifestEntry {
  return { name, symbol, module, intakeAdapters: ["cli"], reason: `${name} is load-bearing`, ...extra };
}

// A graph fixture yielding one of each verdict by module/symbol.
const MIXED_GRAPH: ReachabilityGraphProvider = {
  importPathFrom: (_entry, module) =>
    module === "src/reachable.ts"
      ? ["src/cli/index.ts", "src/reachable.ts"]
      : module === "src/test-only.ts"
        ? ["src/cli/index.ts", "src/test-only.ts"]
        : module === "src/dead.ts"
          ? ["src/cli/index.ts", "src/dead.ts"]
          : undefined,
  callersOf: (symbol) => {
    if (symbol === "reachableFn") {
      return { nonTest: ["src/cli/index.ts"], test: [] };
    }
    if (symbol === "testOnlyFn") {
      return { nonTest: [], test: ["tests/foo.test.ts"] };
    }
    if (symbol === "unreachableFn") {
      return { nonTest: ["src/orphan.ts"], test: [] };
    }
    return { nonTest: [], test: [] };
  },
  isDeadExport: (symbol) => symbol === "deadFn",
};

const MIXED_MANIFEST: CapabilityManifest = [
  cap("cap-reachable", "reachableFn", "src/reachable.ts"),
  cap("cap-unreachable", "unreachableFn", "src/unreachable.ts"),
  cap("cap-test-only", "testOnlyFn", "src/test-only.ts"),
  cap("cap-dead", "deadFn", "src/dead.ts"),
  cap("cap-deferred", "laterFn", "src/later.ts", { deferred: { reason: "live tier" } }),
];

describe("runReachCheck", () => {
  it("exits 0 when every capability is reachable or deferred", () => {
    const allGood: CapabilityManifest = [
      cap("cap-reachable", "reachableFn", "src/reachable.ts"),
      cap("cap-deferred", "laterFn", "src/later.ts", { deferred: { reason: "live tier" } }),
    ];
    const result = runReachCheck({ manifest: allGood, entryModules: ENTRY_MODULES, graph: MIXED_GRAPH });
    expect(result.exitCode).toBe(0);
  });

  it("exits non-zero and names the capability and missing link when one is unreachable", () => {
    const result = runReachCheck({ manifest: MIXED_MANIFEST, entryModules: ENTRY_MODULES, graph: MIXED_GRAPH });
    expect(result.exitCode).toBe(1);
    expect(result.report).toContain("cap-unreachable");
    expect(result.report).toMatch(/cap-unreachable \[module-unreachable\]/);
  });

  it("distinguishes module-unreachable, no-nontest-caller, and dead-export in the report", () => {
    const result = runReachCheck({ manifest: MIXED_MANIFEST, entryModules: ENTRY_MODULES, graph: MIXED_GRAPH });
    expect(result.report).toContain("module-unreachable");
    expect(result.report).toContain("no-nontest-caller");
    expect(result.report).toContain("dead-export");
  });

  it("surfaces a fully-dead export via the dead-export reason", () => {
    const result = runReachCheck({ manifest: MIXED_MANIFEST, entryModules: ENTRY_MODULES, graph: MIXED_GRAPH });
    expect(result.report).toMatch(/cap-dead \[dead-export\]/);
  });

  it("lists every manifested capability with its verdict", () => {
    const result = runReachCheck({ manifest: MIXED_MANIFEST, entryModules: ENTRY_MODULES, graph: MIXED_GRAPH });
    for (const entry of MIXED_MANIFEST) {
      expect(result.report).toContain(entry.name);
    }
  });

  it("treats a deferred capability as neither pass nor failure (no non-zero exit on its own)", () => {
    const deferredOnly: CapabilityManifest = [
      cap("cap-deferred", "laterFn", "src/later.ts", { deferred: { reason: "x" } }),
    ];
    expect(runReachCheck({ manifest: deferredOnly, entryModules: ENTRY_MODULES, graph: MIXED_GRAPH }).exitCode).toBe(0);
  });
});
