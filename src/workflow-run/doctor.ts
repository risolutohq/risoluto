import { constants } from "node:fs";
import { access } from "node:fs/promises";

import {
  DEFAULT_WORKFLOW_RESOLUTION_DEFAULTS,
  loadWorkflowDefinitionRegistry,
} from "../workflow-definition/registry.js";
import type { LivePreflightCheck, LivePreflightReport } from "../live/preflight.js";

export type DoctorCheckStatus = "passed" | "failed" | "skipped";

export interface DoctorCheck {
  readonly id: string;
  readonly status: DoctorCheckStatus;
  readonly message: string;
}

export interface RunDoctorInput {
  readonly workflowDir: string;
  readonly evidenceDir?: string;
  readonly livePreflight?: LivePreflightReport;
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
    ...(input.livePreflight ? liveDoctorChecks(input.livePreflight) : []),
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

function liveDoctorChecks(report: LivePreflightReport): readonly DoctorCheck[] {
  return [
    {
      id: "live_write_intent",
      status: "passed",
      message: "doctor --live explicitly enabled provider write probes",
    },
    ...report.checks.map(livePreflightCheckToDoctorCheck),
  ];
}

function livePreflightCheckToDoctorCheck(check: LivePreflightCheck): DoctorCheck {
  return {
    id: `live_${check.name}`,
    status: check.status,
    message: livePreflightMessage(check),
  };
}

function livePreflightMessage(check: LivePreflightCheck): string {
  const permission = livePreflightPermission(check.name);
  const provider = livePreflightProvider(check.name);
  return permission
    ? `provider=${provider} permission=${permission} ${check.detail}`
    : `provider=${provider} ${check.detail}`;
}

function livePreflightProvider(name: LivePreflightCheck["name"]): string {
  switch (name) {
    case "config":
      return "config";
    case "github_app":
    case "github_app_sandbox_lifecycle":
      return "github_app";
    case "linear":
      return "linear";
    case "model_proxy":
      return "model_proxy";
  }
}

function livePreflightPermission(name: LivePreflightCheck["name"]): string | null {
  return name === "github_app_sandbox_lifecycle" ? "sandbox_write" : null;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
