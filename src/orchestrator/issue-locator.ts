import { projectRetryIssueView, projectRunningIssueView } from "./core/snapshot-projection.js";
import type { ModelSelection, RuntimeIssueView } from "../core/types.js";
import type { RunningEntry, RetryRuntimeEntry } from "./runtime-types.js";

export type IssueLocation =
  | { kind: "running"; entry: RunningEntry }
  | { kind: "retry"; entry: RetryRuntimeEntry }
  | { kind: "completed"; view: RuntimeIssueView }
  | { kind: "detail"; view: RuntimeIssueView };

export interface IssueLocatorCallbacks {
  getRunningEntries: () => Map<string, RunningEntry>;
  getRetryEntries: () => Map<string, RetryRuntimeEntry>;
  getCompletedViews: () => Map<string, RuntimeIssueView>;
  getDetailViews: () => Map<string, RuntimeIssueView>;
  resolveModelSelection: (identifier: string) => ModelSelection;
  /**
   * Optional pre-built identifier-keyed secondary indexes to avoid O(n)
   * allocation per lookup in hot-path callers (e.g. snapshot builder).
   * When non-null, resolveIssue uses these directly instead of scanning
   * the full running/retry entry maps.
   */
  runningEntriesByIdentifier?: Map<string, RunningEntry>;
  retryEntriesByIdentifier?: Map<string, RetryRuntimeEntry>;
}

function buildRunningEntryIndex(entries: Map<string, RunningEntry>): Map<string, RunningEntry> {
  const index = new Map<string, RunningEntry>();
  for (const entry of entries.values()) {
    index.set(entry.issue.identifier, entry);
  }
  return index;
}

function buildRetryEntryIndex(entries: Map<string, RetryRuntimeEntry>): Map<string, RetryRuntimeEntry> {
  const index = new Map<string, RetryRuntimeEntry>();
  for (const entry of entries.values()) {
    index.set(entry.identifier, entry);
  }
  return index;
}

/**
 * Resolves an issue identifier to its authoritative runtime location.
 * Single point of resolution — callers use the returned location instead of
 * re-searching multiple state maps.
 */
export function resolveIssue(identifier: string, callbacks: IssueLocatorCallbacks): IssueLocation | null {
  // Use pre-built identifier-keyed secondary indexes when available (hot-path), falling
  // back to per-call index construction for callers that don't maintain them.
  const runningByIdentifier = callbacks.runningEntriesByIdentifier ?? buildRunningEntryIndex(callbacks.getRunningEntries());
  const runningEntry = runningByIdentifier.get(identifier);
  if (runningEntry) {
    return { kind: "running", entry: runningEntry };
  }

  const retryByIdentifier = callbacks.retryEntriesByIdentifier ?? buildRetryEntryIndex(callbacks.getRetryEntries());
  const retryEntry = retryByIdentifier.get(identifier);
  if (retryEntry) {
    return { kind: "retry", entry: retryEntry };
  }

  const completedView = callbacks.getCompletedViews().get(identifier);
  if (completedView) {
    return { kind: "completed", view: completedView };
  }

  const detailView = callbacks.getDetailViews().get(identifier);
  if (detailView) {
    return { kind: "detail", view: detailView };
  }

  return null;
}

/**
 * Converts an IssueLocation to a RuntimeIssueView.
 */
export function toIssueView(location: IssueLocation, callbacks: IssueLocatorCallbacks): RuntimeIssueView {
  switch (location.kind) {
    case "running":
      return projectRunningIssueView(location.entry, callbacks.resolveModelSelection);
    case "retry":
      return projectRetryIssueView(location.entry, callbacks.resolveModelSelection);
    case "completed":
    case "detail":
      return location.view;
  }
}
