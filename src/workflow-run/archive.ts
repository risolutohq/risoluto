import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { withKeyedSerialChain } from "../utils/serial-chain.js";
import { DEFAULT_WORKFLOW_DEFINITION_ID } from "./contracts.js";
import { parseWorkflowRunArtifact, type WorkflowRunArtifactProducer } from "./artifact-contracts.js";
import type {
  WorkflowRunArtifactReference,
  WorkflowRunEventRecord,
  WorkflowRunResolvedDefinitionConfig,
  WorkflowRunSource,
  WorkflowRunStartRecord,
  WorkflowRunTrigger,
} from "./contracts.js";

export { DEFAULT_WORKFLOW_DEFINITION_ID } from "./contracts.js";

export class WorkflowRunArchiveParseError extends Error {
  constructor(
    readonly filePath: string,
    readonly runId: string,
    cause: unknown,
  ) {
    const message = `failed to parse ${filePath} for run ${runId}: ${String(cause)}`;
    super(message, { cause: cause instanceof Error ? cause : undefined });
    this.name = "WorkflowRunArchiveParseError";
  }
}

export interface WorkflowRunArchiveLocation {
  dataDir?: string;
  archiveDir?: string;
}

export interface CreateWorkflowRunRecordInput {
  title: string;
  intent: string;
  source: WorkflowRunSource;
  workflowDefinitionId?: string;
  workspaceKey?: string;
  resolvedWorkflowDefinition?: WorkflowRunResolvedDefinitionConfig;
  trigger?: WorkflowRunTrigger;
  now?: () => string;
  id?: () => string;
}

export interface WorkflowRunArchive {
  createWorkflowRunRecord: (input: CreateWorkflowRunRecordInput) => WorkflowRunStartRecord;
  storeWorkflowRun: (workflowRun: WorkflowRunStartRecord) => Promise<void>;
  loadWorkflowRun: (workflowRunId: string) => Promise<WorkflowRunStartRecord>;
  listWorkflowRuns: () => Promise<WorkflowRunStartRecord[]>;
  appendWorkflowRunEvents: (
    workflowRunId: string,
    events: WorkflowRunEventRecord[],
  ) => Promise<WorkflowRunEventRecord[]>;
  readWorkflowRunEvents: (workflowRunId: string) => Promise<WorkflowRunEventRecord[]>;
  writeWorkflowRunArtifact: (input: WriteWorkflowRunArtifactInput) => Promise<WorkflowRunArtifactReference>;
  readWorkflowRunArtifact: (input: ReadWorkflowRunArtifactInput) => Promise<WorkflowRunArtifactPayload>;
  updateWorkflowRunStatus: (
    workflowRunId: string,
    status: WorkflowRunStartRecord["status"],
  ) => Promise<WorkflowRunStartRecord>;
}

export interface WriteWorkflowRunArtifactInput {
  workflowRunId: string;
  contractId: string;
  data: unknown;
  producer?: WorkflowRunArtifactProducer;
  artifactId?: string;
  ifNotExists?: boolean;
}

export interface ReadWorkflowRunArtifactInput {
  workflowRunId: string;
  artifactId: string;
}

export interface WorkflowRunArtifactPayload {
  contractId: string;
  data: unknown;
}

export function createWorkflowRunArchive(location: WorkflowRunArchiveLocation): WorkflowRunArchive {
  const archiveRoot = resolveArchiveRoot(location);
  return {
    createWorkflowRunRecord: (input) => createWorkflowRunRecordInArchive(archiveRoot, input),
    storeWorkflowRun: (workflowRun) => storeWorkflowRunRecord(workflowRun),
    loadWorkflowRun: (workflowRunId) => readWorkflowRunMetadataFromDir(workflowRunDir(archiveRoot, workflowRunId)),
    listWorkflowRuns: () => listWorkflowRunsInArchive(archiveRoot),
    appendWorkflowRunEvents: (workflowRunId, events) =>
      appendWorkflowRunEventsToArchive(archiveRoot, workflowRunId, events),
    readWorkflowRunEvents: (workflowRunId) => readWorkflowRunEventsFromArchive(archiveRoot, workflowRunId),
    writeWorkflowRunArtifact: (input) => writeWorkflowRunArtifactToArchive(archiveRoot, input),
    readWorkflowRunArtifact: (input) => readWorkflowRunArtifactFromArchive(archiveRoot, input),
    updateWorkflowRunStatus: (workflowRunId, status) =>
      updateWorkflowRunStatusInArchive(archiveRoot, workflowRunId, status),
  };
}

function createWorkflowRunRecordInArchive(
  archiveRoot: string,
  input: CreateWorkflowRunRecordInput,
): WorkflowRunStartRecord {
  const id = input.id?.() ?? `wr_${randomUUID()}`;
  return {
    id,
    source: input.source,
    status: "accepted",
    title: input.title,
    intent: input.intent,
    workflowDefinitionId: input.workflowDefinitionId ?? DEFAULT_WORKFLOW_DEFINITION_ID,
    ...(input.workspaceKey ? { workspaceKey: input.workspaceKey } : {}),
    ...(input.resolvedWorkflowDefinition ? { resolvedWorkflowDefinition: input.resolvedWorkflowDefinition } : {}),
    createdAt: input.now?.() ?? new Date().toISOString(),
    artifactDir: workflowRunDir(archiveRoot, id),
    ...(input.trigger ? { trigger: input.trigger } : {}),
  };
}

/**
 * Write `data` to `filePath` atomically: write a sibling temp file then rename over the target.
 * rename(2) within the same directory is atomic on POSIX, so a crash mid-write can never leave a
 * partial file that {@link listWorkflowRunsInArchive} would then silently drop from listings.
 */
async function writeFileAtomic(filePath: string, data: string): Promise<void> {
  const tmpPath = `${filePath}.tmp-${randomUUID()}`;
  await writeFile(tmpPath, data, "utf8");
  await rename(tmpPath, filePath);
}

async function storeWorkflowRunRecord(workflowRun: WorkflowRunStartRecord): Promise<void> {
  await mkdir(workflowRun.artifactDir, { recursive: true });
  await writeFileAtomic(metadataPathForRunDir(workflowRun.artifactDir), `${JSON.stringify(workflowRun, null, 2)}\n`);
  await writeFile(
    runLogPathForRunDir(workflowRun.artifactDir),
    `${JSON.stringify(toWorkflowRunAcceptedEvent(workflowRun))}\n`,
    "utf8",
  );
}

async function listWorkflowRunsInArchive(archiveRoot: string): Promise<WorkflowRunStartRecord[]> {
  const workflowRunsDir = path.join(archiveRoot, "workflow-runs");
  let entries: string[];
  try {
    entries = await readdir(workflowRunsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const workflowRuns = (
    await Promise.all(
      entries.map(async (entry) => {
        try {
          return await readWorkflowRunMetadataFromDir(path.join(workflowRunsDir, entry));
        } catch (error) {
          if (error instanceof WorkflowRunArchiveParseError || (error as NodeJS.ErrnoException).code === "ENOENT") {
            return null;
          }
          throw error;
        }
      }),
    )
  ).filter((item): item is WorkflowRunStartRecord => item !== null);
  return [...workflowRuns].sort(
    (left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id),
  );
}

async function appendWorkflowRunEventsToRunDir(
  artifactDir: string,
  events: WorkflowRunEventRecord[],
): Promise<WorkflowRunEventRecord[]> {
  if (events.length === 0) {
    return [];
  }

  // Serialize the read-then-append per run directory so two concurrent appends can't read the same
  // next-sequence and emit duplicate sequence numbers / attempt indices (RIS-263).
  return withKeyedSerialChain(runEventAppendChains, artifactDir, () => appendSequencedEvents(artifactDir, events));
}

/**
 * Sequence and persist `events` under the single-writer guarantee of the per-dir serial chain.
 *
 * Steady state (cache hit): the log was last written by us and ends cleanly, so a fast appendFile is
 * safe and avoids re-reading the whole log just to compute max(sequence)+1. First touch / recovery
 * (cache miss, e.g. after a restart): the log may end in a torn line from a crash mid-append, so read
 * the valid events (the reader drops the torn final line) and rewrite the whole log atomically — this
 * removes the torn line and prevents the next append from concatenating onto a newline-less tail.
 */
async function appendSequencedEvents(
  artifactDir: string,
  events: WorkflowRunEventRecord[],
): Promise<WorkflowRunEventRecord[]> {
  const logPath = runLogPathForRunDir(artifactDir);
  const cachedNext = nextSequenceCache.get(artifactDir);
  if (cachedNext !== undefined) {
    const sequencedEvents = sequenceEvents(events, cachedNext);
    await appendFile(logPath, `${serializeEvents(sequencedEvents)}\n`, "utf8");
    nextSequenceCache.set(artifactDir, cachedNext + sequencedEvents.length);
    return sequencedEvents;
  }
  const existing = await readWorkflowRunEventsFromRunDir(artifactDir);
  const firstSequence = nextSequenceFromEvents(existing);
  const sequencedEvents = sequenceEvents(events, firstSequence);
  await writeFileAtomic(logPath, `${serializeEvents([...existing, ...sequencedEvents])}\n`);
  nextSequenceCache.set(artifactDir, firstSequence + sequencedEvents.length);
  return sequencedEvents;
}

function sequenceEvents(events: readonly WorkflowRunEventRecord[], firstSequence: number): WorkflowRunEventRecord[] {
  return events.map((event, index) => ({ ...event, sequence: firstSequence + index }));
}

function serializeEvents(events: readonly WorkflowRunEventRecord[]): string {
  return events.map((event) => JSON.stringify(event)).join("\n");
}

function nextSequenceFromEvents(events: readonly WorkflowRunEventRecord[]): number {
  const sequences = events.map((event, index) => (typeof event.sequence === "number" ? event.sequence : index + 1));
  return Math.max(0, ...sequences) + 1;
}

async function appendWorkflowRunEventsToArchive(
  archiveRoot: string,
  workflowRunId: string,
  events: WorkflowRunEventRecord[],
): Promise<WorkflowRunEventRecord[]> {
  return appendWorkflowRunEventsToRunDir(workflowRunDir(archiveRoot, workflowRunId), events);
}

async function readWorkflowRunEventsFromArchive(
  archiveRoot: string,
  workflowRunId: string,
): Promise<WorkflowRunEventRecord[]> {
  const runDir = workflowRunDir(archiveRoot, workflowRunId);
  const logPath = runLogPathForRunDir(runDir);
  const raw = await readFile(logPath, "utf8");
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as WorkflowRunEventRecord;
      } catch (error) {
        throw new WorkflowRunArchiveParseError(logPath, workflowRunId, error);
      }
    });
}

export class WorkflowRunArchiveError extends Error {
  constructor(
    message: string,
    public readonly artifactDir: string,
    public readonly runId?: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
  }
}

async function readWorkflowRunEventsFromRunDir(artifactDir: string): Promise<WorkflowRunEventRecord[]> {
  const logPath = runLogPathForRunDir(artifactDir);
  let content: string;
  try {
    content = await readFile(logPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new WorkflowRunArchiveError("events log not found in run dir", artifactDir, undefined, error);
    }
    throw error;
  }
  const lines = content.trim().split("\n").filter(Boolean);
  return lines
    .map((line, index) => {
      try {
        return JSON.parse(line) as WorkflowRunEventRecord;
      } catch (error) {
        // A torn FINAL line is an unacknowledged append — the process crashed mid-appendFile before
        // the write returned, so no caller ever saw those events. Drop it so the next append's
        // sequence computation isn't poisoned by a raw SyntaxError. A malformed line anywhere earlier
        // is real corruption — surface it like the archive-keyed reader does.
        if (index === lines.length - 1) {
          return null;
        }
        throw new WorkflowRunArchiveParseError(logPath, artifactDir, error);
      }
    })
    .filter((event): event is WorkflowRunEventRecord => event !== null);
}

async function writeWorkflowRunArtifactToArchive(
  archiveRoot: string,
  input: WriteWorkflowRunArtifactInput,
): Promise<WorkflowRunArtifactReference> {
  const data = parseWorkflowRunArtifact({ contractId: input.contractId, data: input.data, producer: input.producer });
  const artifactId = input.artifactId ?? `art_${randomUUID()}`;
  const artifact: WorkflowRunArtifactReference = {
    artifactId,
    contractId: input.contractId,
    path: artifactPath(archiveRoot, input.workflowRunId, artifactId),
  };
  await mkdir(path.dirname(artifact.path), { recursive: true });
  await writeFile(artifact.path, `${JSON.stringify({ contractId: input.contractId, data }, null, 2)}\n`, {
    encoding: "utf8",
    flag: input.ifNotExists ? "wx" : "w",
  });
  return artifact;
}

// blocked / done / cancelled are terminal: a run that has reached one of them refuses
// any further status write (RIS-255).
const TERMINAL_RUN_STATUSES: ReadonlySet<WorkflowRunStartRecord["status"]> = new Set(["blocked", "done", "cancelled"]);

// Status writes are serialized per Workflow Run so a cancel racing a done can no longer
// interleave (RIS-255).
const runStatusUpdateChains = new Map<string, Promise<unknown>>();

function withRunStatusLock<T>(workflowRunId: string, operation: () => Promise<T>): Promise<T> {
  return withKeyedSerialChain(runStatusUpdateChains, workflowRunId, operation);
}

// Event appends are serialized per run directory so concurrent appends can't collide on the
// next event sequence (RIS-263).
const runEventAppendChains = new Map<string, Promise<unknown>>();

// Cache of the next event sequence per run directory, maintained inside the per-dir serial chain so
// steady-state appends don't re-read the whole log to compute it. Keyed by artifactDir; self-heals
// from the log on first touch after a restart.
const nextSequenceCache = new Map<string, number>();

async function updateWorkflowRunStatusInArchive(
  archiveRoot: string,
  workflowRunId: string,
  status: WorkflowRunStartRecord["status"],
): Promise<WorkflowRunStartRecord> {
  return withRunStatusLock(workflowRunId, async () => {
    const workflowRun = await readWorkflowRunMetadataFromDir(workflowRunDir(archiveRoot, workflowRunId));
    // Terminal states are final — refuse the write (return the run unchanged) so a
    // concurrent done/blocked can never overwrite a cancel, and no write lands on an
    // already-terminal run (RIS-255).
    if (TERMINAL_RUN_STATUSES.has(workflowRun.status) && workflowRun.status !== status) {
      return workflowRun;
    }
    const updated = { ...workflowRun, status };
    await writeFileAtomic(metadataPathForRunDir(updated.artifactDir), `${JSON.stringify(updated, null, 2)}\n`);
    return updated;
  });
}

async function readWorkflowRunArtifactFromArchive(
  archiveRoot: string,
  input: ReadWorkflowRunArtifactInput,
): Promise<WorkflowRunArtifactPayload> {
  const artifactFilePath = artifactPath(archiveRoot, input.workflowRunId, input.artifactId);
  const raw = await readFile(artifactFilePath, "utf8");
  try {
    return JSON.parse(raw) as WorkflowRunArtifactPayload;
  } catch (error) {
    throw new WorkflowRunArchiveParseError(artifactFilePath, input.workflowRunId, error);
  }
}

function toWorkflowRunAcceptedEvent(workflowRun: WorkflowRunStartRecord): WorkflowRunEventRecord {
  return {
    at: workflowRun.createdAt,
    sequence: 1,
    eventType: "workflow_run.accepted",
    workflowRunId: workflowRun.id,
    source: workflowRun.source,
    workflowDefinitionId: workflowRun.workflowDefinitionId,
    ...(workflowRun.trigger ? { trigger: workflowRun.trigger } : {}),
  };
}

function resolveArchiveRoot(location: WorkflowRunArchiveLocation): string {
  if (location.archiveDir) {
    return location.archiveDir;
  }
  if (location.dataDir) {
    return path.join(location.dataDir, "archives");
  }
  throw new TypeError("dataDir or archiveDir is required for the Workflow Run archive");
}

// Archive ids become path segments, so reject anything that could escape the
// archive root (separators, "." / "..") before joining.
const SAFE_ARCHIVE_ID = /^[A-Za-z0-9._-]+$/;

function assertSafeArchiveId(id: string, kind: string): void {
  if (id === "." || id === ".." || !SAFE_ARCHIVE_ID.test(id)) {
    throw new TypeError(`unsafe ${kind} for the Workflow Run archive: ${JSON.stringify(id)}`);
  }
}

function workflowRunDir(archiveRoot: string, workflowRunId: string): string {
  assertSafeArchiveId(workflowRunId, "workflowRunId");
  return path.join(archiveRoot, "workflow-runs", workflowRunId);
}

function artifactPath(archiveRoot: string, workflowRunId: string, artifactId: string): string {
  assertSafeArchiveId(artifactId, "artifactId");
  return path.join(workflowRunDir(archiveRoot, workflowRunId), "artifacts", `${artifactId}.json`);
}

async function readWorkflowRunMetadataFromDir(artifactDir: string): Promise<WorkflowRunStartRecord> {
  const metadataPath = metadataPathForRunDir(artifactDir);
  const raw = await readFile(metadataPath, "utf8");
  try {
    return JSON.parse(raw) as WorkflowRunStartRecord;
  } catch (error) {
    const runId = path.basename(artifactDir);
    throw new WorkflowRunArchiveParseError(metadataPath, runId, error);
  }
}

function metadataPathForRunDir(artifactDir: string): string {
  return path.join(artifactDir, "metadata.json");
}

function runLogPathForRunDir(artifactDir: string): string {
  return path.join(artifactDir, "events.jsonl");
}
