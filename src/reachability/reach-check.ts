import { analyzeReachability, type ReachabilityGraphProvider, type ReachabilityVerdict } from "./analyzer.js";
import type { CapabilityManifest, IntakeAdapterId } from "./capability-manifest.js";

export interface ReachCheckInput {
  readonly manifest: CapabilityManifest;
  readonly entryModules: Readonly<Record<IntakeAdapterId, string>>;
  readonly graph: ReachabilityGraphProvider;
}

export interface ReachCheckResult {
  readonly verdicts: readonly ReachabilityVerdict[];
  /** Diff-friendly report listing every manifested capability with its verdict. */
  readonly report: string;
  /** 0 when no capability is a gap (deferred is neither a pass nor a failure); 1 otherwise. */
  readonly exitCode: number;
}

/**
 * Run the reachability analyzer over the manifest and render a diff-friendly report. A deferred
 * capability is neither a pass nor a gate failure, so only `gap` verdicts drive a non-zero exit.
 */
export function runReachCheck(input: ReachCheckInput): ReachCheckResult {
  const verdicts = analyzeReachability(input);
  const gapCount = verdicts.filter((verdict) => verdict.status === "gap").length;
  return { verdicts, report: renderReachReport(verdicts), exitCode: gapCount > 0 ? 1 : 0 };
}

/** Render every capability with its verdict, then a FAIL block naming each gap and its missing link. */
export function renderReachReport(verdicts: readonly ReachabilityVerdict[]): string {
  const lines = [`reach:check — ${verdicts.length} capabilities (${summarize(verdicts)})`];
  for (const verdict of verdicts) {
    lines.push(renderVerdictLine(verdict));
  }
  const gaps = verdicts.filter((verdict) => verdict.status === "gap");
  if (gaps.length > 0) {
    lines.push("");
    lines.push(`FAIL — ${gaps.length} unreachable ${gaps.length === 1 ? "capability" : "capabilities"}:`);
    for (const gap of gaps) {
      if (gap.status === "gap") {
        lines.push(`  - ${gap.capability} [${gap.reason}]: ${gap.detail}`);
      }
    }
  }
  return lines.join("\n");
}

function renderVerdictLine(verdict: ReachabilityVerdict): string {
  if (verdict.status === "reachable") {
    return `  ✓ ${verdict.capability} — reachable via ${verdict.via} (${verdict.chain.join(" → ")})`;
  }
  if (verdict.status === "deferred") {
    return `  ~ ${verdict.capability} — deferred (${verdict.reason})`;
  }
  return `  ✗ ${verdict.capability} — ${verdict.reason}: ${verdict.detail}`;
}

function summarize(verdicts: readonly ReachabilityVerdict[]): string {
  let reachable = 0;
  let gap = 0;
  let deferred = 0;
  for (const verdict of verdicts) {
    if (verdict.status === "reachable") {
      reachable += 1;
    } else if (verdict.status === "deferred") {
      deferred += 1;
    } else {
      gap += 1;
    }
  }
  return `${reachable} reachable, ${gap} gap, ${deferred} deferred`;
}
