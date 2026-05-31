import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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

export async function claimExternalMapping(input: {
  readonly location: WorkflowRunArchiveLocation;
  readonly externalObject: WorkflowRunIntakeExternalObject | null;
  readonly workflowRunId: string;
  readonly ruleId: string | null;
}): Promise<WorkflowRunIntakeClaimResult> {
  if (!input.externalObject) {
    return { status: "claimed" };
  }
  return claimMapping(
    externalMappingPath(input.location, input.externalObject),
    input.externalObject,
    input.workflowRunId,
    input.ruleId,
  );
}

export async function claimDeliveryMapping(input: {
  readonly location: WorkflowRunArchiveLocation;
  readonly provider: WorkflowRunIntakeSource;
  readonly deliveryId?: string | null;
  readonly workflowRunId: string;
  readonly ruleId: string | null;
}): Promise<void> {
  const deliveryId = input.deliveryId?.trim();
  if (!deliveryId) {
    return;
  }
  await claimMapping(
    deliveryMappingPath(input.location, input.provider, deliveryId),
    { provider: input.provider, id: deliveryId },
    input.workflowRunId,
    input.ruleId,
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
): Promise<WorkflowRunIntakeClaimResult> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const record = { provider: key.provider, externalObjectId: key.id, workflowRunId, ruleId };
  try {
    await writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    return { status: "claimed" };
  } catch (error) {
    if (isErrorCode(error, "EEXIST")) {
      const mapping = await readMapping(filePath);
      if (mapping) {
        return { status: "existing", mapping };
      }
    }
    throw error;
  }
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
