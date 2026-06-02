import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { parse as parseYaml } from "yaml";
import { z, ZodError } from "zod";

import { isWorkflowRunArtifactContractId } from "../workflow-run/artifact-contracts.js";
import type { WorkflowRunResolvedDefinitionConfig } from "../workflow-run/contracts.js";

export interface WorkflowResolutionDefaults {
  readonly modelProfile: string;
  readonly validationProfile: string;
}

export interface LoadWorkflowDefinitionRegistryInput {
  readonly workflowDir: string;
  readonly globalDefaults: WorkflowResolutionDefaults;
}

export interface ResolvedWorkflowState {
  readonly id: string;
  readonly gates: readonly string[];
  readonly hooks: readonly string[];
}

export interface ResolvedWorkflowRole {
  readonly id: string;
  readonly stateId: string;
  readonly modelProfile: string;
  readonly consumes: readonly string[];
  readonly produces: readonly string[];
  readonly dependsOn: readonly string[];
}

export interface ResolvedWorkflowDefinition {
  readonly id: string;
  readonly validationProfile: string;
  readonly states: readonly ResolvedWorkflowState[];
  readonly roles: readonly ResolvedWorkflowRole[];
  readonly actions: readonly string[];
}

export interface WorkflowDefinitionRegistry {
  readonly resolve: (id: string) => ResolvedWorkflowDefinition;
}

export class WorkflowDefinitionRegistryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorkflowDefinitionRegistryError";
  }
}

export const DEFAULT_WORKFLOW_RESOLUTION_DEFAULTS: WorkflowResolutionDefaults = {
  modelProfile: "balanced",
  validationProfile: "node-pnpm-standard",
};

const BUILTIN_ROLE_IDS = new Set(["planner", "implementer", "reviewer", "verifier", "ci_babysitter"]);
const BUILTIN_GATE_IDS = new Set(["artifacts-valid", "budget-available", "validation-passed", "verifier-satisfied"]);
const BUILTIN_HOOK_IDS = new Set(["collect-evidence", "notify-operator", "persist-artifact"]);
const BUILTIN_ACTION_IDS = new Set([
  "create-worktree",
  "run-validation-profile",
  "publish-pr",
  "poll-ci",
  "write-handoff",
]);
const BUILTIN_MODEL_PROFILE_IDS = new Set(["balanced", "fast", "strong", "verifier"]);
const BUILTIN_VALIDATION_PROFILE_IDS = new Set(["node-pnpm-standard", "offline-smoke"]);

const roleSchema = z
  .object({
    id: z.string().min(1),
    modelProfile: z.string().min(1).optional(),
    consumes: z.array(z.string().min(1)),
    produces: z.array(z.string().min(1)),
    dependsOn: z.array(z.string().min(1)),
  })
  .strict();

const workflowDefinitionSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1),
    defaults: z
      .object({
        modelProfile: z.string().min(1).optional(),
        validationProfile: z.string().min(1).optional(),
      })
      .strict(),
    states: z.array(
      z
        .object({
          id: z.string().min(1),
          roles: z.array(roleSchema),
          gates: z.array(z.string().min(1)),
          hooks: z.array(z.string().min(1)),
        })
        .strict(),
    ),
    actions: z.array(z.string().min(1)),
  })
  .strict();

type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
type WorkflowRoleDefinition = z.infer<typeof roleSchema>;

export async function loadWorkflowDefinitionRegistry(
  input: LoadWorkflowDefinitionRegistryInput,
): Promise<WorkflowDefinitionRegistry> {
  const definitions = await loadWorkflowDefinitions(input.workflowDir);
  const resolvedDefinitions = new Map(
    definitions.map((definition) => [definition.id, resolveWorkflowDefinition(definition, input.globalDefaults)]),
  );
  return {
    resolve: (id) => resolveRegisteredWorkflowDefinition(resolvedDefinitions, id),
  };
}

export function toWorkflowRunResolvedDefinitionConfig(
  definition: ResolvedWorkflowDefinition,
): WorkflowRunResolvedDefinitionConfig {
  const modelProfiles: Record<string, string> = {};
  for (const role of definition.roles) {
    modelProfiles[role.id] = role.modelProfile;
  }
  return {
    workflowDefinitionId: definition.id,
    validationProfile: definition.validationProfile,
    modelProfiles,
  };
}

async function loadWorkflowDefinitions(workflowDir: string): Promise<WorkflowDefinition[]> {
  const entries = (await readdir(workflowDir)).filter((entry) => entry.endsWith(".yaml") || entry.endsWith(".yml"));
  const definitions = await Promise.all(entries.map((entry) => loadWorkflowDefinition(path.join(workflowDir, entry))));
  return definitions;
}

async function loadWorkflowDefinition(filePath: string): Promise<WorkflowDefinition> {
  const parsed = parseYaml(await readFile(filePath, "utf8"));
  try {
    const definition = workflowDefinitionSchema.parse(parsed);
    validateWorkflowDefinitionReferences(definition);
    return definition;
  } catch (error) {
    if (error instanceof ZodError) {
      throw new WorkflowDefinitionRegistryError(formatSchemaError(filePath, error), { cause: error });
    }
    throw error;
  }
}

function validateWorkflowDefinitionReferences(definition: WorkflowDefinition): void {
  assertKnownId(BUILTIN_MODEL_PROFILE_IDS, definition.defaults.modelProfile, "model profile");
  assertKnownId(BUILTIN_VALIDATION_PROFILE_IDS, definition.defaults.validationProfile, "validation profile");
  for (const actionId of definition.actions) {
    assertKnownId(BUILTIN_ACTION_IDS, actionId, "action");
  }
  for (const state of definition.states) {
    for (const gateId of state.gates) {
      assertKnownId(BUILTIN_GATE_IDS, gateId, "gate");
    }
    for (const hookId of state.hooks) {
      assertKnownId(BUILTIN_HOOK_IDS, hookId, "hook");
    }
    for (const role of state.roles) {
      validateRoleReferences(role);
    }
  }
  validateRoleGraph(definition);
}

function validateRoleReferences(role: WorkflowRoleDefinition): void {
  assertKnownId(BUILTIN_ROLE_IDS, role.id, "role");
  assertKnownId(BUILTIN_MODEL_PROFILE_IDS, role.modelProfile, "model profile");
  for (const contractId of [...role.consumes, ...role.produces]) {
    if (!isWorkflowRunArtifactContractId(contractId)) {
      throw new WorkflowDefinitionRegistryError(`unknown artifact contract id ${contractId}`);
    }
  }
}

function validateRoleGraph(definition: WorkflowDefinition): void {
  const roles = definition.states.flatMap((state) => state.roles);
  const roleIds = new Set<string>();
  for (const role of roles) {
    if (roleIds.has(role.id)) {
      throw new WorkflowDefinitionRegistryError(`duplicate role id ${role.id}`);
    }
    roleIds.add(role.id);
  }
  for (const role of roles) {
    for (const dependency of role.dependsOn) {
      if (!roleIds.has(dependency)) {
        throw new WorkflowDefinitionRegistryError(`unknown role dependency ${dependency}`);
      }
    }
  }
}

function resolveWorkflowDefinition(
  definition: WorkflowDefinition,
  globalDefaults: WorkflowResolutionDefaults,
): ResolvedWorkflowDefinition {
  const modelProfile = definition.defaults.modelProfile ?? globalDefaults.modelProfile;
  const validationProfile = definition.defaults.validationProfile ?? globalDefaults.validationProfile;
  return {
    id: definition.id,
    validationProfile,
    states: definition.states.map((state) => ({ id: state.id, gates: state.gates, hooks: state.hooks })),
    roles: definition.states.flatMap((state) =>
      state.roles.map((role) => ({
        id: role.id,
        stateId: state.id,
        modelProfile: role.modelProfile ?? modelProfile,
        consumes: role.consumes,
        produces: role.produces,
        dependsOn: role.dependsOn,
      })),
    ),
    actions: definition.actions,
  };
}

function resolveRegisteredWorkflowDefinition(
  definitions: ReadonlyMap<string, ResolvedWorkflowDefinition>,
  id: string,
): ResolvedWorkflowDefinition {
  const definition = definitions.get(id);
  if (!definition) {
    throw new WorkflowDefinitionRegistryError(`unknown workflow definition ${id}`);
  }
  return definition;
}

function assertKnownId(ids: ReadonlySet<string>, value: string | undefined, kind: string): void {
  // `value === undefined` means the referencing field is optional and unset — intentionally skip
  // validation so optional ids need no value. Only a present-but-unknown id is rejected.
  if (value && !ids.has(value)) {
    throw new WorkflowDefinitionRegistryError(`unknown ${kind} id ${value}`);
  }
}

function formatSchemaError(filePath: string, error: ZodError): string {
  return error.issues.map((issue) => formatIssue(filePath, issue)).join("; ");
}

function formatIssue(filePath: string, issue: z.core.$ZodIssue): string {
  if (issue.code === "unrecognized_keys") {
    return `unsupported workflow definition field ${issue.keys.join(", ")} in ${filePath}`;
  }
  const issuePath = issue.path.map(String).join(".") || "<root>";
  return `invalid workflow definition ${filePath} at ${issuePath}: ${issue.message}`;
}
