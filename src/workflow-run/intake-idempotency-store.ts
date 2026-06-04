import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type { WorkflowRunArchiveLocation } from "./archive.js";
import type { WorkflowRunIntakeExternalObject, WorkflowRunIntakeSource } from "./intake-core.js";

const mappingSchema = z.object({
  provider: z.string().min(1),
  externalObjectId: z.string().min(1),
  workflowRunId: z.string().min(1),
  ruleId: z.string().min(1).nullable(),
});

export type WorkflowRunIntakeMapping = z.infer<typeof mappingSchema>;
export type WorkflowRunIntakeClaimResult =
  | { readonly status: "claimed" }
  | { readonly status: "existing"; readonly mapping: WorkflowRunIntakeMapping };

export async function readExternalMapping(input: {
  readonly location: WorkflowRunArchiveLocation;
  readonly externalObject: WorkflowRunIntakeExternalObject | null;
}): Promise<WorkflowRunIntakeMapping | null> {
  if (!input.externalObject) {
    return null;
  }
  return readMapping(externalMappingPath(input.location, input.externalObject));
}

export async function readDeliveryMapping(input: {
  readonly location: WorkflowRunArchiveLocation;
  readonly provider: WorkflowRunIntakeSource;
  readonly deliveryId?: string | null;
}): Promise<WorkflowRunIntakeMapping | null> {
  const deliveryId = input.deliveryId?.trim();
  if (!deliveryId) {
    return null;
  }
  return readMapping(deliveryMappingPath(input.location, input.provider, deliveryId));
}

/**
 * Predicate that reports whether an existing mapping is stale — i.e., it points to a run record
 * that never landed because intake crashed between claiming the mapping and writing the run. A
 * stale mapping is overwritten and re-claimed instead of poisoning future duplicate intake (RIS-261).
 */
export type StaleMappingRecovery = (mapping: WorkflowRunIntakeMapping) => Promise<boolean>;

export async function claimExternalMapping(input: {
  readonly location: WorkflowRunArchiveLocation;
  readonly externalObject: WorkflowRunIntakeExternalObject | null;
  readonly workflowRunId: string;
  readonly ruleId: string | null;
  readonly recoverStaleMapping?: StaleMappingRecovery;
}): Promise<WorkflowRunIntakeClaimResult> {
  if (!input.externalObject) {
    return { status: "claimed" };
  }
  return claimMapping(
    externalMappingPath(input.location, input.externalObject),
    input.externalObject,
    input.workflowRunId,
    input.ruleId,
    input.recoverStaleMapping,
  );
}

export async function claimDeliveryMapping(input: {
  readonly location: WorkflowRunArchiveLocation;
  readonly provider: WorkflowRunIntakeSource;
  readonly deliveryId?: string | null;
  readonly workflowRunId: string;
  readonly ruleId: string | null;
  readonly recoverStaleMapping?: StaleMappingRecovery;
}): Promise<WorkflowRunIntakeClaimResult> {
  const deliveryId = input.deliveryId?.trim();
  if (!deliveryId) {
    return { status: "claimed" };
  }
  return claimMapping(
    deliveryMappingPath(input.location, input.provider, deliveryId),
    { provider: input.provider, id: deliveryId },
    input.workflowRunId,
    input.ruleId,
    input.recoverStaleMapping,
  );
}

async function readMapping(filePath: string): Promise<WorkflowRunIntakeMapping | null> {
  try {
    return mappingSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

async function claimMapping(
  filePath: string,
  key: { readonly provider: string; readonly id: string },
  workflowRunId: string,
  ruleId: string | null,
  recoverStaleMapping?: StaleMappingRecovery,
): Promise<WorkflowRunIntakeClaimResult> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const record = { provider: key.provider, externalObjectId: key.id, workflowRunId, ruleId };
  const payload = `${JSON.stringify(record, null, 2)}\n`;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await writeFile(filePath, payload, { encoding: "utf8", flag: "wx" });
      return { status: "claimed" };
    } catch (error) {
      if (isErrorCode(error, "EEXIST")) {
        const mapping = await readMapping(filePath);
        if (mapping) {
          // A mapping whose run record never landed (crash between claim and run write) would
          // otherwise poison every future duplicate intake with an ENOENT loop. Overwrite it and
          // claim afresh for this run instead (RIS-261).
          if (recoverStaleMapping && (await recoverStaleMapping(mapping))) {
            // Overwrite atomically (temp file + rename) so a crash mid-write can't leave a torn or
            // empty mapping that would ENOENT-loop every future intake (RIS-266).
            await atomicOverwrite(filePath, payload);
            return { status: "claimed" };
          }
          return { status: "existing", mapping };
        }
        lastError = error;
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

// Write to a unique temp file then rename over the target — rename is atomic within a filesystem,
// so a reader never observes a partially-written mapping (RIS-266).
async function atomicOverwrite(filePath: string, payload: string): Promise<void> {
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(tempPath, payload, { encoding: "utf8", flag: "wx" });
  await rename(tempPath, filePath);
}

function externalMappingPath(
  location: WorkflowRunArchiveLocation,
  externalObject: WorkflowRunIntakeExternalObject,
): string {
  return path.join(
    intakeRoot(location),
    "external-objects",
    externalObject.provider,
    stableFileName(externalObject.id),
  );
}

function deliveryMappingPath(
  location: WorkflowRunArchiveLocation,
  provider: WorkflowRunIntakeSource,
  deliveryId: string,
): string {
  return path.join(intakeRoot(location), "deliveries", provider, stableFileName(deliveryId));
}

function intakeRoot(location: WorkflowRunArchiveLocation): string {
  if (location.archiveDir) {
    return path.join(location.archiveDir, "intake");
  }
  if (location.dataDir) {
    return path.join(location.dataDir, "archives", "intake");
  }
  throw new TypeError("dataDir or archiveDir is required for Workflow Run intake");
}

function stableFileName(value: string): string {
  return `${createHash("sha256").update(value).digest("hex")}.json`;
}

function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
