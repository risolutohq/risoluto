import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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

export async function storeWorkflowRunRecord(workflowRun: WorkflowRunStartRecord): Promise<void> {
  await mkdir(workflowRun.artifactDir, { recursive: true });
  await writeFile(metadataPathForRunDir(workflowRun.artifactDir), `${JSON.stringify(workflowRun, null, 2)}\n`, "utf8");
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

  const workflowRuns = await Promise.all(
    entries.map(async (entry) => readWorkflowRunMetadataFromDir(path.join(workflowRunsDir, entry))),
  );
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

  const firstSequence = await nextWorkflowRunEventSequenceForRunDir(artifactDir);
  const sequencedEvents = events.map((event, index) => ({
    ...event,
    sequence: firstSequence + index,
  }));
  await appendFile(
    runLogPathForRunDir(artifactDir),
    `${sequencedEvents.map((event) => JSON.stringify(event)).join("\n")}\n`,
    "utf8",
  );
  return sequencedEvents;
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
  const content = await readFile(runLogPath(archiveRoot, workflowRunId), "utf8");
  return content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as WorkflowRunEventRecord);
}

async function nextWorkflowRunEventSequenceForRunDir(artifactDir: string): Promise<number> {
  const events = await readWorkflowRunEventsFromRunDir(artifactDir);
  const sequences = events.map((event, index) => (typeof event.sequence === "number" ? event.sequence : index + 1));
  return Math.max(0, ...sequences) + 1;
}

async function readWorkflowRunEventsFromRunDir(artifactDir: string): Promise<WorkflowRunEventRecord[]> {
  const content = await readFile(runLogPathForRunDir(artifactDir), "utf8");
  return content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as WorkflowRunEventRecord);
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

async function updateWorkflowRunStatusInArchive(
  archiveRoot: string,
  workflowRunId: string,
  status: WorkflowRunStartRecord["status"],
): Promise<WorkflowRunStartRecord> {
  const workflowRun = await readWorkflowRunMetadataFromDir(workflowRunDir(archiveRoot, workflowRunId));
  const updated = { ...workflowRun, status };
  await writeFile(metadataPathForRunDir(updated.artifactDir), `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  return updated;
}

async function readWorkflowRunArtifactFromArchive(
  archiveRoot: string,
  input: ReadWorkflowRunArtifactInput,
): Promise<WorkflowRunArtifactPayload> {
  return JSON.parse(
    await readFile(artifactPath(archiveRoot, input.workflowRunId, input.artifactId), "utf8"),
  ) as WorkflowRunArtifactPayload;
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

function runLogPath(archiveRoot: string, workflowRunId: string): string {
  return path.join(workflowRunDir(archiveRoot, workflowRunId), "events.jsonl");
}

function artifactPath(archiveRoot: string, workflowRunId: string, artifactId: string): string {
  assertSafeArchiveId(artifactId, "artifactId");
  return path.join(workflowRunDir(archiveRoot, workflowRunId), "artifacts", `${artifactId}.json`);
}

async function readWorkflowRunMetadataFromDir(artifactDir: string): Promise<WorkflowRunStartRecord> {
  return JSON.parse(await readFile(metadataPathForRunDir(artifactDir), "utf8")) as WorkflowRunStartRecord;
}

function metadataPathForRunDir(artifactDir: string): string {
  return path.join(artifactDir, "metadata.json");
}

function runLogPathForRunDir(artifactDir: string): string {
  return path.join(artifactDir, "events.jsonl");
}
