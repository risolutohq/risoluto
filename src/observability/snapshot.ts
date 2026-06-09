import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ObservabilityHealthSummary, ObservabilityHealthSurface } from "./health.js";
import type { ObservabilityMetricCounter } from "./metrics.js";
import type { ObservabilityTraceRecord } from "./tracing.js";

export interface ObservabilitySessionRecord {
  key: string;
  component: string;
  status: string;
  updatedAt: string;
  correlationId: string | null;
  metadata?: Record<string, unknown>;
}

export interface ComponentObservabilitySnapshot {
  component: string;
  pid: number;
  updatedAt: string;
  metrics: Record<string, ObservabilityMetricCounter>;
  health: Record<string, ObservabilityHealthSurface>;
  traces: ObservabilityTraceRecord[];
  sessions: Record<string, ObservabilitySessionRecord>;
}

export interface ObservabilitySummary {
  generatedAt: string;
  snapshotRoot: string;
  components: ComponentObservabilitySnapshot[];
  health: ObservabilityHealthSummary;
  traces: ObservabilityTraceRecord[];
  sessionState: ObservabilitySessionRecord[];
  runtimeState: Record<string, unknown>;
  rawMetrics: string;
}

const PROCESS_SNAPSHOT_DIR = "processes";

export function resolveObservabilityRoot(archiveDir?: string): string {
  const configured = process.env.RISOLUTO_OBSERVABILITY_DIR?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.resolve(archiveDir ?? path.join(os.tmpdir(), "risoluto-observability"), "observability");
}

export function buildProcessSnapshotPath(root: string, component: string, pid = process.pid): string {
  const safeComponent = component.replaceAll(/[^\w.-]+/g, "-");
  return path.join(root, PROCESS_SNAPSHOT_DIR, `${safeComponent}-${pid}.json`);
}

export async function writeComponentSnapshot(
  root: string,
  snapshot: ComponentObservabilitySnapshot,
  pid = snapshot.pid,
): Promise<void> {
  const targetPath = buildProcessSnapshotPath(root, snapshot.component, pid);
  await mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.${randomUUID()}.tmp`;
  const content = JSON.stringify(snapshot, null, 2);
  await writeFile(tempPath, content, "utf8");
  try {
    await rename(tempPath, targetPath);
  } catch {
    try {
      await unlink(tempPath);
    } catch {
      /* Best effort — if unlink also fails the .tmp will be cleaned on next readdir pass. */
    }
    throw new Error(`failed to commit snapshot for ${snapshot.component}: rename failed`);
  }
}

export async function readComponentSnapshots(root: string): Promise<ComponentObservabilitySnapshot[]> {
  const dir = path.join(root, PROCESS_SNAPSHOT_DIR);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const snapshots = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .map(async (entry) => {
        const snapshotPath = path.join(dir, entry);
        try {
          const raw = await readFile(snapshotPath, "utf8");
          const snapshot = JSON.parse(raw) as ComponentObservabilitySnapshot;
          if (
            typeof snapshot.pid !== "number" ||
            snapshot.pid <= 0 ||
            typeof snapshot.component !== "string" ||
            snapshot.component.length === 0
          ) {
            await unlink(snapshotPath).catch(() => undefined);
            return null;
          }
          if (!isProcessAlive(snapshot.pid)) {
            await unlink(snapshotPath).catch(() => undefined);
            return null;
          }
          return snapshot;
        } catch {
          return null;
        }
      }),
  );
  return snapshots.filter((snapshot): snapshot is ComponentObservabilitySnapshot => snapshot !== null);
}

/**
 * Check whether a process with the given PID is alive.
 *
 * Uses `process.kill(pid, 0)` which only confirms *some* process with that
 * PID is alive — it does not verify it is the same Risoluto component that
 * wrote the snapshot. Linux recycles PIDs, so a short-lived original process
 * that died could be replaced by an unrelated process with the same PID.
 * Stale snapshots will persist until evicted by the next periodic write from
 * the original component (which overwrites the snapshot file) or by manual
 * cleanup of the observability directory.
 */
function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}
