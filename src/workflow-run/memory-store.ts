import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type { WorkflowRunArchiveLocation } from "./archive.js";

const SAFE_ARCHIVE_ID = /^[A-Za-z0-9._-]+$/;

const evidenceReferenceSchema = z
  .object({
    evidenceId: z.string().min(1),
    path: z.string().min(1),
  })
  .strict();

const projectMemoryPromotionModeSchema = z.enum(["auto_promote", "propose_only"]);

const workflowRunAttemptMemoryRecordSchema = z
  .object({
    workflowRunId: z.string().min(1),
    attemptId: z.string().min(1),
    attemptNumber: z.number().int().positive(),
    createdAt: z.string().min(1),
    summary: z.string().min(1),
    evidenceRefs: z.array(evidenceReferenceSchema),
    path: z.string().min(1),
    visibility: z.literal("local_private"),
    commitPolicy: z.literal("exclude"),
    includeInCommittedOutput: z.literal(false),
  })
  .strict();

const projectMemoryCandidateRecordSchema = z
  .object({
    workflowRunId: z.string().min(1),
    candidateId: z.string().min(1),
    createdAt: z.string().min(1),
    text: z.string().min(1),
    path: z.string().min(1),
    visibility: z.literal("local_private"),
    promotionMode: projectMemoryPromotionModeSchema,
    commitPolicy: z.literal("exclude"),
    includeInCommittedOutput: z.literal(false),
    provenance: z.array(evidenceReferenceSchema).min(1),
  })
  .strict();

export type WorkflowRunMemoryEvidenceReference = z.infer<typeof evidenceReferenceSchema>;
export type ProjectMemoryPromotionMode = z.infer<typeof projectMemoryPromotionModeSchema>;

export interface WriteWorkflowRunAttemptMemoryInput {
  readonly workflowRunId: string;
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly createdAt: string;
  readonly summary: string;
  readonly evidenceRefs: readonly WorkflowRunMemoryEvidenceReference[];
}

export interface ReadPriorWorkflowRunAttemptMemoryInput {
  readonly workflowRunId: string;
  readonly beforeAttemptNumber: number;
}

export interface WorkflowRunAttemptMemoryRecord extends WriteWorkflowRunAttemptMemoryInput {
  readonly path: string;
  readonly visibility: "local_private";
  readonly commitPolicy: "exclude";
  readonly includeInCommittedOutput: false;
}

export interface WriteProjectMemoryCandidateInput {
  readonly workflowRunId: string;
  readonly candidateId: string;
  readonly createdAt: string;
  readonly text: string;
  readonly sourceEvidence: WorkflowRunMemoryEvidenceReference;
  readonly promotionMode?: ProjectMemoryPromotionMode;
}

export interface ProjectMemoryCandidateRecord {
  readonly workflowRunId: string;
  readonly candidateId: string;
  readonly createdAt: string;
  readonly text: string;
  readonly path: string;
  readonly visibility: "local_private";
  readonly promotionMode: ProjectMemoryPromotionMode;
  readonly commitPolicy: "exclude";
  readonly includeInCommittedOutput: false;
  readonly provenance: readonly WorkflowRunMemoryEvidenceReference[];
}

export interface WorkflowRunMemoryStore {
  readonly writeAttemptMemory: (input: WriteWorkflowRunAttemptMemoryInput) => Promise<WorkflowRunAttemptMemoryRecord>;
  readonly readPriorAttemptMemory: (
    input: ReadPriorWorkflowRunAttemptMemoryInput,
  ) => Promise<readonly WorkflowRunAttemptMemoryRecord[]>;
  readonly writeProjectMemoryCandidate: (
    input: WriteProjectMemoryCandidateInput,
  ) => Promise<ProjectMemoryCandidateRecord>;
}

export function createWorkflowRunMemoryStore(location: WorkflowRunArchiveLocation): WorkflowRunMemoryStore {
  const archiveRoot = resolveArchiveRoot(location);
  return {
    writeAttemptMemory: (input) => writeAttemptMemoryRecord(archiveRoot, input),
    readPriorAttemptMemory: (input) => readPriorAttemptMemoryRecords(archiveRoot, input),
    writeProjectMemoryCandidate: (input) => writeProjectMemoryCandidateRecord(archiveRoot, input),
  };
}

async function writeAttemptMemoryRecord(
  archiveRoot: string,
  input: WriteWorkflowRunAttemptMemoryInput,
): Promise<WorkflowRunAttemptMemoryRecord> {
  const memoryPath = attemptMemoryPath(archiveRoot, input.workflowRunId, input.attemptId);
  const record: WorkflowRunAttemptMemoryRecord = {
    ...input,
    path: memoryPath,
    visibility: "local_private",
    commitPolicy: "exclude",
    includeInCommittedOutput: false,
  };
  await writeJson(memoryPath, record);
  return record;
}

async function readPriorAttemptMemoryRecords(
  archiveRoot: string,
  input: ReadPriorWorkflowRunAttemptMemoryInput,
): Promise<readonly WorkflowRunAttemptMemoryRecord[]> {
  const attemptMemoryDir = workflowRunAttemptMemoryDir(archiveRoot, input.workflowRunId);
  const attemptFiles = await readJsonFilenames(attemptMemoryDir);
  const records = await Promise.all(
    attemptFiles.map(async (filename) => readAttemptMemoryRecord(path.join(attemptMemoryDir, filename))),
  );
  return records
    .filter((record) => record.workflowRunId === input.workflowRunId)
    .filter((record) => record.attemptNumber < input.beforeAttemptNumber)
    .sort(compareAttemptMemoryRecords);
}

async function writeProjectMemoryCandidateRecord(
  archiveRoot: string,
  input: WriteProjectMemoryCandidateInput,
): Promise<ProjectMemoryCandidateRecord> {
  const candidatePath = projectMemoryCandidatePath(archiveRoot, input.workflowRunId, input.candidateId);
  const record: ProjectMemoryCandidateRecord = {
    workflowRunId: input.workflowRunId,
    candidateId: input.candidateId,
    createdAt: input.createdAt,
    text: input.text,
    path: candidatePath,
    visibility: "local_private",
    promotionMode: input.promotionMode ?? "propose_only",
    commitPolicy: "exclude",
    includeInCommittedOutput: false,
    provenance: [input.sourceEvidence],
  };
  const parsedRecord = projectMemoryCandidateRecordSchema.parse(record);
  await writeJson(candidatePath, parsedRecord);
  return parsedRecord;
}

async function readAttemptMemoryRecord(memoryPath: string): Promise<WorkflowRunAttemptMemoryRecord> {
  const parsed: unknown = JSON.parse(await readFile(memoryPath, "utf8"));
  return workflowRunAttemptMemoryRecordSchema.parse(parsed);
}

async function readJsonFilenames(dir: string): Promise<readonly string[]> {
  try {
    return (await readdir(dir)).filter((entry) => entry.endsWith(".json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function compareAttemptMemoryRecords(
  left: WorkflowRunAttemptMemoryRecord,
  right: WorkflowRunAttemptMemoryRecord,
): number {
  if (left.attemptNumber !== right.attemptNumber) {
    return left.attemptNumber - right.attemptNumber;
  }
  return left.attemptId.localeCompare(right.attemptId);
}

function resolveArchiveRoot(location: WorkflowRunArchiveLocation): string {
  if (location.archiveDir) {
    return location.archiveDir;
  }
  if (location.dataDir) {
    return path.join(location.dataDir, "archives");
  }
  throw new TypeError("dataDir or archiveDir is required for the Workflow Run memory store");
}

function assertSafeArchiveId(id: string, kind: string): void {
  if (id === "." || id === ".." || !SAFE_ARCHIVE_ID.test(id)) {
    throw new TypeError(`unsafe ${kind} for the Workflow Run memory store: ${JSON.stringify(id)}`);
  }
}

function workflowRunMemoryDir(archiveRoot: string, workflowRunId: string): string {
  assertSafeArchiveId(workflowRunId, "workflowRunId");
  return path.join(archiveRoot, "workflow-runs", workflowRunId, "memory");
}

function workflowRunAttemptMemoryDir(archiveRoot: string, workflowRunId: string): string {
  return path.join(workflowRunMemoryDir(archiveRoot, workflowRunId), "attempts");
}

function attemptMemoryPath(archiveRoot: string, workflowRunId: string, attemptId: string): string {
  assertSafeArchiveId(attemptId, "attemptId");
  return path.join(workflowRunAttemptMemoryDir(archiveRoot, workflowRunId), `${attemptId}.json`);
}

function projectMemoryCandidatePath(archiveRoot: string, workflowRunId: string, candidateId: string): string {
  assertSafeArchiveId(candidateId, "candidateId");
  return path.join(workflowRunMemoryDir(archiveRoot, workflowRunId), "project-candidates", `${candidateId}.json`);
}
