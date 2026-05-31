import { constants } from "node:fs";
import { access } from "node:fs/promises";

import {
  DEFAULT_WORKFLOW_RESOLUTION_DEFAULTS,
  loadWorkflowDefinitionRegistry,
} from "../workflow-definition/registry.js";

export type DoctorCheckStatus = "passed" | "failed";

export interface DoctorCheck {
  readonly id: "workflow_definitions" | "evidence_path";
  readonly status: DoctorCheckStatus;
  readonly message: string;
}

export interface RunDoctorInput {
  readonly workflowDir: string;
  readonly evidenceDir?: string;
}

export interface DoctorResult {
  readonly type: "doctor.result";
  readonly status: DoctorCheckStatus;
  readonly checks: readonly DoctorCheck[];
}

export async function runDoctor(input: RunDoctorInput): Promise<DoctorResult> {
  const checks = [
    await checkWorkflowDefinitions(input.workflowDir),
    ...(input.evidenceDir ? [await checkEvidencePath(input.evidenceDir)] : []),
  ];
  return {
    type: "doctor.result",
    status: checks.every((check) => check.status === "passed") ? "passed" : "failed",
    checks,
  };
}

async function checkWorkflowDefinitions(workflowDir: string): Promise<DoctorCheck> {
  try {
    await loadWorkflowDefinitionRegistry({
      workflowDir,
      globalDefaults: DEFAULT_WORKFLOW_RESOLUTION_DEFAULTS,
    });
    return { id: "workflow_definitions", status: "passed", message: `validated ${workflowDir}` };
  } catch (error) {
    return { id: "workflow_definitions", status: "failed", message: toErrorMessage(error) };
  }
}

async function checkEvidencePath(evidenceDir: string): Promise<DoctorCheck> {
  try {
    await access(evidenceDir, constants.R_OK);
    return { id: "evidence_path", status: "passed", message: `readable ${evidenceDir}` };
  } catch (error) {
    return {
      id: "evidence_path",
      status: "failed",
      message: `missing or unreadable ${evidenceDir}: ${toErrorMessage(error)}`,
    };
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
