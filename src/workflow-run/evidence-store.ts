import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { redactSensitiveValue } from "../core/content-sanitizer.js";
import { isRecord } from "../utils/type-guards.js";
import type { WorkflowRunArchiveLocation } from "./archive.js";

const REDACTED = "[REDACTED]";
const SAFE_ARCHIVE_ID = /^[A-Za-z0-9._-]+$/;
const workflowRunEvidenceClassificationSchema = z.enum(["cost", "freeform", "pii", "public", "secret"]);

const classifiedFieldSchema = z
  .object({
    path: z.array(z.string().min(1)).min(1),
    classification: workflowRunEvidenceClassificationSchema,
  })
  .strict();

const workflowRunEvidenceRecordSchema = z
  .object({
    workflowRunId: z.string().min(1),
    evidenceId: z.string().min(1),
    kind: z.string().min(1),
    source: z.string().min(1),
    createdAt: z.string().min(1),
    content: z.unknown(),
    classifiedFields: z.array(classifiedFieldSchema),
    path: z.string().min(1),
    commitPolicy: z.literal("exclude"),
    includeInCommittedOutput: z.literal(false),
  })
  .strict();

export type WorkflowRunEvidenceClassification = z.infer<typeof workflowRunEvidenceClassificationSchema>;

export interface WorkflowRunEvidenceClassifiedField {
  readonly path: readonly string[];
  readonly classification: WorkflowRunEvidenceClassification;
}

export interface WriteWorkflowRunEvidenceInput {
  readonly workflowRunId: string;
  readonly evidenceId: string;
  readonly kind: string;
  readonly source: string;
  readonly createdAt: string;
  readonly content: unknown;
  readonly classifiedFields: readonly WorkflowRunEvidenceClassifiedField[];
}

export interface ReadWorkflowRunEvidenceInput {
  readonly workflowRunId: string;
  readonly evidenceId: string;
}

export interface WorkflowRunEvidenceRecord extends WriteWorkflowRunEvidenceInput {
  readonly path: string;
  readonly commitPolicy: "exclude";
  readonly includeInCommittedOutput: false;
}

export interface WorkflowRunEvidenceRedaction {
  readonly path: readonly string[];
  readonly classification: Exclude<WorkflowRunEvidenceClassification, "public">;
}

export interface WorkflowRunEvidenceDisplay extends WorkflowRunEvidenceRecord {
  readonly content: unknown;
  readonly redactions: readonly WorkflowRunEvidenceRedaction[];
}

export interface WorkflowRunEvidenceStore {
  readonly writeEvidence: (input: WriteWorkflowRunEvidenceInput) => Promise<WorkflowRunEvidenceRecord>;
  readonly readEvidence: (input: ReadWorkflowRunEvidenceInput) => Promise<WorkflowRunEvidenceRecord>;
  readonly readEvidenceForDisplay: (input: ReadWorkflowRunEvidenceInput) => Promise<WorkflowRunEvidenceDisplay>;
}

export function createWorkflowRunEvidenceStore(location: WorkflowRunArchiveLocation): WorkflowRunEvidenceStore {
  const archiveRoot = resolveArchiveRoot(location);
  return {
    writeEvidence: (input) => writeEvidenceRecord(archiveRoot, input),
    readEvidence: (input) => readEvidenceRecord(archiveRoot, input),
    readEvidenceForDisplay: async (input) => redactEvidenceForDisplay(await readEvidenceRecord(archiveRoot, input)),
  };
}

export function redactEvidenceForDisplay(record: WorkflowRunEvidenceRecord): WorkflowRunEvidenceDisplay {
  const content = structuredClone(record.content);
  const redactions = applyClassifiedRedactions(content, record.classifiedFields);
  return { ...record, content: redactSensitiveValue(content), redactions };
}

async function writeEvidenceRecord(
  archiveRoot: string,
  input: WriteWorkflowRunEvidenceInput,
): Promise<WorkflowRunEvidenceRecord> {
  const evidencePath = rawEvidencePath(archiveRoot, input.workflowRunId, input.evidenceId);
  const record: WorkflowRunEvidenceRecord = {
    ...input,
    path: evidencePath,
    commitPolicy: "exclude",
    includeInCommittedOutput: false,
  };
  await mkdir(path.dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return record;
}

async function readEvidenceRecord(
  archiveRoot: string,
  input: ReadWorkflowRunEvidenceInput,
): Promise<WorkflowRunEvidenceRecord> {
  const parsed: unknown = JSON.parse(
    await readFile(rawEvidencePath(archiveRoot, input.workflowRunId, input.evidenceId), "utf8"),
  );
  return workflowRunEvidenceRecordSchema.parse(parsed);
}

function applyClassifiedRedactions(
  content: unknown,
  fields: readonly WorkflowRunEvidenceClassifiedField[],
): WorkflowRunEvidenceRedaction[] {
  const redactions: WorkflowRunEvidenceRedaction[] = [];
  for (const field of fields) {
    if (field.classification === "public") {
      continue;
    }
    if (redactPath(content, field.path)) {
      redactions.push({ path: field.path, classification: field.classification });
    }
  }
  return redactions;
}

function redactPath(content: unknown, fieldPath: readonly string[]): boolean {
  const field = fieldPath.at(-1);
  if (!field) {
    return false;
  }
  const parent = parentRecordAtPath(content, fieldPath.slice(0, -1));
  if (!parent || !(field in parent)) {
    return false;
  }
  parent[field] = REDACTED;
  return true;
}

function parentRecordAtPath(content: unknown, parentPath: readonly string[]): Record<string, unknown> | null {
  let current = content;
  for (const segment of parentPath) {
    if (!isRecord(current)) {
      return null;
    }
    current = current[segment];
  }
  return isRecord(current) ? current : null;
}

function resolveArchiveRoot(location: WorkflowRunArchiveLocation): string {
  if (location.archiveDir) {
    return location.archiveDir;
  }
  if (location.dataDir) {
    return path.join(location.dataDir, "archives");
  }
  throw new TypeError("dataDir or archiveDir is required for the Workflow Run evidence store");
}

function assertSafeArchiveId(id: string, kind: string): void {
  if (id === "." || id === ".." || !SAFE_ARCHIVE_ID.test(id)) {
    throw new TypeError(`unsafe ${kind} for the Workflow Run evidence store: ${JSON.stringify(id)}`);
  }
}

function rawEvidencePath(archiveRoot: string, workflowRunId: string, evidenceId: string): string {
  assertSafeArchiveId(workflowRunId, "workflowRunId");
  assertSafeArchiveId(evidenceId, "evidenceId");
  return path.join(archiveRoot, "workflow-runs", workflowRunId, "evidence", "raw", `${evidenceId}.json`);
}
