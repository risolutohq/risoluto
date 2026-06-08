import type { CapabilityManifest, CapabilityManifestEntry, IntakeAdapterId } from "./capability-manifest.js";

/** Non-test and test caller modules of a capability symbol (repo-relative module paths). */
export interface CapabilityCallers {
  readonly nonTest: readonly string[];
  readonly test: readonly string[];
}

/**
 * Injected port over the import/call graph. The real implementation (NIN-152) computes these from madge
 * plus a call-site scan and knip; tests inject a fixture so the verdict logic stays pure — no real
 * filesystem and no madge subprocess.
 */
export interface ReachabilityGraphProvider {
  /**
   * Import path from an intake-adapter entry module to `module`, or `undefined` when `module` is not in
   * that entry's import closure.
   */
  readonly importPathFrom: (entryModule: string, module: string) => readonly string[] | undefined;
  /** Modules referencing `symbol` exported from `module`, split into non-test and test callers. */
  readonly callersOf: (symbol: string, module: string) => CapabilityCallers;
  /** True when `symbol` exported from `module` is a fully-dead export (nothing imports it). */
  readonly isDeadExport: (symbol: string, module: string) => boolean;
}

export type ReachabilityGapReason = "module-unreachable" | "no-nontest-caller" | "dead-export";

export type ReachabilityVerdict =
  | {
      readonly capability: string;
      readonly status: "reachable";
      readonly via: IntakeAdapterId;
      readonly chain: readonly string[];
      readonly nonTestCallers: readonly string[];
    }
  | { readonly capability: string; readonly status: "deferred"; readonly reason: string }
  | {
      readonly capability: string;
      readonly status: "gap";
      readonly reason: ReachabilityGapReason;
      readonly detail: string;
    };

export interface AnalyzeReachabilityInput {
  readonly manifest: CapabilityManifest;
  /** Production entry module per intake adapter (CLI command entry, HTTP route registry, Slack webhook route). */
  readonly entryModules: Readonly<Record<IntakeAdapterId, string>>;
  readonly graph: ReachabilityGraphProvider;
}

/**
 * Return a reachability verdict per manifested capability. Pure: every graph fact comes from the
 * injected provider, so the verdict logic is unit-testable against fixtures with no filesystem.
 *
 * Precedence: `deferred` → `dead-export` → `module-unreachable` → `reachable` (with its caller chain) →
 * `no-nontest-caller`. A deferred capability is reported as deferred — neither a pass nor a gate failure.
 */
export function analyzeReachability(input: AnalyzeReachabilityInput): readonly ReachabilityVerdict[] {
  return input.manifest.map((entry) => verdictFor(entry, input.entryModules, input.graph));
}

function verdictFor(
  entry: CapabilityManifestEntry,
  entryModules: Readonly<Record<IntakeAdapterId, string>>,
  graph: ReachabilityGraphProvider,
): ReachabilityVerdict {
  if (entry.deferred) {
    return { capability: entry.name, status: "deferred", reason: entry.deferred.reason };
  }
  if (graph.isDeadExport(entry.symbol, entry.module)) {
    return gap(entry, "dead-export", `${entry.symbol} (${entry.module}) is exported but nothing imports it`);
  }
  const reached = firstReachableAdapter(entry, entryModules, graph);
  if (!reached) {
    return gap(
      entry,
      "module-unreachable",
      `${entry.module} is not in the import graph of any intake adapter (${entry.intakeAdapters.join(", ")})`,
    );
  }
  const callers = graph.callersOf(entry.symbol, entry.module);
  if (callers.nonTest.length > 0) {
    return {
      capability: entry.name,
      status: "reachable",
      via: reached.adapter,
      chain: reached.chain,
      nonTestCallers: callers.nonTest,
    };
  }
  return gap(entry, "no-nontest-caller", describeNoNonTestCaller(entry, reached.adapter, callers));
}

interface ReachedAdapter {
  readonly adapter: IntakeAdapterId;
  readonly chain: readonly string[];
}

function firstReachableAdapter(
  entry: CapabilityManifestEntry,
  entryModules: Readonly<Record<IntakeAdapterId, string>>,
  graph: ReachabilityGraphProvider,
): ReachedAdapter | undefined {
  for (const adapter of entry.intakeAdapters) {
    const chain = graph.importPathFrom(entryModules[adapter], entry.module);
    if (chain) {
      return { adapter, chain };
    }
  }
  return undefined;
}

function describeNoNonTestCaller(
  entry: CapabilityManifestEntry,
  adapter: IntakeAdapterId,
  callers: CapabilityCallers,
): string {
  if (callers.test.length > 0) {
    return `${entry.symbol} is reachable from ${adapter} but only called under tests/ (${callers.test.join(", ")})`;
  }
  return `${entry.symbol} is reachable from ${adapter} but has no non-test caller`;
}

function gap(entry: CapabilityManifestEntry, reason: ReachabilityGapReason, detail: string): ReachabilityVerdict {
  return { capability: entry.name, status: "gap", reason, detail };
}
