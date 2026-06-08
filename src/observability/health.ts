export type ObservabilityHealthStatus = "ok" | "warn" | "error";

export interface ObservabilityHealthSurface {
  surface: string;
  component: string;
  status: ObservabilityHealthStatus;
  updatedAt: string;
  reason?: string;
  details?: Record<string, unknown>;
}

export interface ObservabilityHealthSummary {
  status: ObservabilityHealthStatus;
  counts: {
    ok: number;
    warn: number;
    error: number;
  };
  surfaces: ObservabilityHealthSurface[];
}

/**
 * Aggregates a list of per-surface health statuses into a single overall status.
 * - If any surface is `"error"`, returns `"error"`.
 * - Else if any surface is `"warn"`, returns `"warn"`.
 * - Otherwise returns `"ok"` (including the empty-list case, which is trivially healthy).
 */
export function summarizeHealthStatus(statuses: ObservabilityHealthStatus[]): ObservabilityHealthStatus {
  if (statuses.includes("error")) {
    return "error";
  }
  if (statuses.includes("warn")) {
    return "warn";
  }
  return "ok";
}

/**
 * Creates a sorted summary from a collection of health surfaces.
 * Sorting order: errors first, then warns, then ok. Within the same status level,
 * surfaces are sorted alphabetically by name. Returns status, counts, and the
 * sorted surface list.
 */
export function summarizeHealthSurfaces(surfaces: ObservabilityHealthSurface[]): ObservabilityHealthSummary {
  const sorted = [...surfaces].sort((left, right) => {
    const statusOrder = healthStatusRank(right.status) - healthStatusRank(left.status);
    if (statusOrder !== 0) {
      return statusOrder;
    }
    return left.surface.localeCompare(right.surface);
  });
  const counts = {
    ok: sorted.filter((surface) => surface.status === "ok").length,
    warn: sorted.filter((surface) => surface.status === "warn").length,
    error: sorted.filter((surface) => surface.status === "error").length,
  };
  return {
    status: summarizeHealthStatus(sorted.map((surface) => surface.status)),
    counts,
    surfaces: sorted,
  };
}

function healthStatusRank(status: ObservabilityHealthStatus): number {
  if (status === "error") {
    return 3;
  }
  if (status === "warn") {
    return 2;
  }
  return 1;
}
