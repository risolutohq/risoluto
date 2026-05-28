/** Shared stop-signal detection used by both the turn executor and worker-outcome handler. */

export type StopSignal = "done" | "blocked";

const DONE_MARKERS = [
  "risoluto_status: done",
  "risoluto status: done",
  "symphony_status: done",
  "symphony status: done",
] as const;

const BLOCKED_MARKERS = [
  "risoluto_status: blocked",
  "risoluto status: blocked",
  "symphony_status: blocked",
  "symphony status: blocked",
] as const;

function normalizeForDetection(content: string): string {
  return content.toLowerCase().replaceAll(/\s+/g, " ");
}

/**
 * Compiles markers into boundary-aware patterns: a marker matches only when it
 * is not immediately followed by another word character, so `...: done` is not
 * found inside `...: done_uploading`. Matched against normalized text.
 */
function compileMarkerPatterns(markers: readonly string[]): RegExp[] {
  return markers.map((marker) => new RegExp(`${marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9_])`));
}

const DONE_PATTERNS = compileMarkerPatterns(DONE_MARKERS);
const BLOCKED_PATTERNS = compileMarkerPatterns(BLOCKED_MARKERS);

function detectStructuredStatus(content: string): StopSignal | null {
  try {
    const parsed: unknown = JSON.parse(content);
    const statusValue = (Object(parsed ?? {}) as Record<string, unknown>).status;
    const status = typeof statusValue === "string" ? statusValue.toUpperCase() : null;

    if (status === "DONE") return "done";
    if (status === "BLOCKED") return "blocked";
  } catch {
    // Not JSON — fall through to text pattern matching
  }

  return null;
}

export function detectStopSignal(content: string | null): StopSignal | null {
  if (!content) {
    return null;
  }

  const structuredStatus = detectStructuredStatus(content);
  if (structuredStatus) {
    return structuredStatus;
  }

  const normalized = normalizeForDetection(content);
  if (DONE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "done";
  }
  if (BLOCKED_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "blocked";
  }
  return null;
}
