import { describe, expect, it } from "vitest";

import { analyzeReachability, type ReachabilityGraphProvider } from "../../src/reachability/analyzer.js";
import type {
  CapabilityManifest,
  CapabilityManifestEntry,
  IntakeAdapterId,
} from "../../src/reachability/capability-manifest.js";

const ENTRY_MODULES: Readonly<Record<IntakeAdapterId, string>> = {
  cli: "src/cli/index.ts",
  http: "src/http/server.ts",
  slack: "src/http/routes/webhooks.ts",
};

const ENTRY: CapabilityManifestEntry = {
  name: "run-start-dispatch",
  symbol: "driveAcceptedWorkflowRun",
  module: "src/cli/run-start-command.ts",
  intakeAdapters: ["cli"],
  reason: "CLI run start drives the executor end to end",
};

const MANIFEST: CapabilityManifest = [ENTRY];

function graph(overrides: Partial<ReachabilityGraphProvider>): ReachabilityGraphProvider {
  return {
    importPathFrom: () => undefined,
    callersOf: () => ({ nonTest: [], test: [] }),
    isDeadExport: () => false,
    ...overrides,
  };
}

describe("reachability analyzer", () => {
  it("returns reachable with the caller chain when the module is reachable and has a non-test caller", () => {
    const verdicts = analyzeReachability({
      manifest: MANIFEST,
      entryModules: ENTRY_MODULES,
      graph: graph({
        importPathFrom: (entryModule, module) =>
          entryModule === ENTRY_MODULES.cli && module === ENTRY.module ? [entryModule, module] : undefined,
        callersOf: () => ({ nonTest: ["src/cli/index.ts"], test: [] }),
      }),
    });
    expect(verdicts[0]).toMatchObject({
      status: "reachable",
      via: "cli",
      chain: [ENTRY_MODULES.cli, ENTRY.module],
      nonTestCallers: ["src/cli/index.ts"],
    });
  });

  it("returns a no-nontest-caller gap when the symbol is exported but never called from production", () => {
    const verdicts = analyzeReachability({
      manifest: MANIFEST,
      entryModules: ENTRY_MODULES,
      graph: graph({
        importPathFrom: () => [ENTRY_MODULES.cli, ENTRY.module],
        callersOf: () => ({ nonTest: [], test: [] }),
      }),
    });
    expect(verdicts[0]).toMatchObject({ status: "gap", reason: "no-nontest-caller" });
  });

  it("flags test-only wiring as a no-nontest-caller gap naming the test callers", () => {
    const verdicts = analyzeReachability({
      manifest: MANIFEST,
      entryModules: ENTRY_MODULES,
      graph: graph({
        importPathFrom: () => [ENTRY_MODULES.cli, ENTRY.module],
        callersOf: () => ({ nonTest: [], test: ["tests/cli/run-start.test.ts"] }),
      }),
    });
    const verdict = verdicts[0];
    expect(verdict).toMatchObject({ status: "gap", reason: "no-nontest-caller" });
    if (verdict?.status === "gap") {
      expect(verdict.detail).toMatch(/tests\//);
    }
  });

  it("returns module-unreachable when the module is absent from every intake root's import graph", () => {
    const verdicts = analyzeReachability({
      manifest: MANIFEST,
      entryModules: ENTRY_MODULES,
      // has a non-test caller, but that caller chain never reaches an intake root
      graph: graph({ importPathFrom: () => undefined, callersOf: () => ({ nonTest: ["src/orphan.ts"], test: [] }) }),
    });
    expect(verdicts[0]).toMatchObject({ status: "gap", reason: "module-unreachable" });
  });

  it("reports a deferred capability as deferred — neither a pass nor a gate failure", () => {
    const deferred: CapabilityManifest = [{ ...ENTRY, deferred: { reason: "live tier — wired in NIN-75" } }];
    const verdicts = analyzeReachability({ manifest: deferred, entryModules: ENTRY_MODULES, graph: graph({}) });
    expect(verdicts[0]).toMatchObject({ status: "deferred", reason: "live tier — wired in NIN-75" });
  });

  it("returns a dead-export gap when nothing imports the symbol", () => {
    const verdicts = analyzeReachability({
      manifest: MANIFEST,
      entryModules: ENTRY_MODULES,
      graph: graph({ isDeadExport: () => true }),
    });
    expect(verdicts[0]).toMatchObject({ status: "gap", reason: "dead-export" });
  });

  it("runs purely against the injected fixture graph with no filesystem access", () => {
    // The fixture provider is a plain in-memory object; a populated manifest yields one verdict per entry.
    const verdicts = analyzeReachability({ manifest: MANIFEST, entryModules: ENTRY_MODULES, graph: graph({}) });
    expect(verdicts).toHaveLength(1);
  });
});
