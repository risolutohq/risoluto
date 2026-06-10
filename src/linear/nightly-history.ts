import { readFileSync, writeFileSync, renameSync } from "node:fs";

interface FailureHistoryEntry {
  fingerprint: string;
  consecutiveFailures: number;
  recentResults: boolean[];
  issueId: string | null;
  issueIdentifier: string | null;
  attachmentId: string | null;
  lastSeenAt: string;
}

export interface FailureHistoryStore {
  entries: Record<string, FailureHistoryEntry>;
}

export function readFailureHistory(filePath: string): FailureHistoryStore {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as FailureHistoryStore;
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") {
      throw error;
    }
    return { entries: {} };
  }
}

export function writeFailureHistory(filePath: string, store: FailureHistoryStore): void {
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(store, null, 2) + "\n", "utf8");
  renameSync(tmpPath, filePath);
}

export function updateHistoryForFailure(
  store: FailureHistoryStore,
  input: {
    fingerprint: string;
    issueId: string | null;
    issueIdentifier: string | null;
    attachmentId: string | null;
    occurredAt: string;
  },
): FailureHistoryEntry {
  const existing = store.entries[input.fingerprint] ?? {
    fingerprint: input.fingerprint,
    consecutiveFailures: 0,
    recentResults: [],
    issueId: null,
    issueIdentifier: null,
    attachmentId: null,
    lastSeenAt: input.occurredAt,
  };
  const recentResults = [...existing.recentResults, true].slice(-3);
  const next: FailureHistoryEntry = {
    ...existing,
    consecutiveFailures: existing.consecutiveFailures + 1,
    recentResults,
    issueId: input.issueId,
    issueIdentifier: input.issueIdentifier,
    attachmentId: input.attachmentId,
    lastSeenAt: input.occurredAt,
  };
  store.entries[input.fingerprint] = next;
  return next;
}

export function updateHistoryForSuccesses(
  store: FailureHistoryStore,
  occurredAt: string,
  activeFingerprints: string[],
): void {
  const active = new Set(activeFingerprints);
  for (const entry of Object.values(store.entries)) {
    if (active.has(entry.fingerprint)) {
      continue;
    }
    entry.consecutiveFailures = 0;
    entry.recentResults = [...entry.recentResults, false].slice(-3);
    entry.lastSeenAt = occurredAt;
  }
}

export function shouldCreateOrUpdateIssue(entry: FailureHistoryEntry): boolean {
  if (entry.consecutiveFailures >= 2) {
    return true;
  }
  return entry.recentResults.filter(Boolean).length >= 2;
}

export function shouldAutoCloseIssue(entry: FailureHistoryEntry): boolean {
  return (
    entry.issueId !== null &&
    entry.recentResults.length >= 3 &&
    entry.recentResults.slice(-3).every((value) => value === false)
  );
}
