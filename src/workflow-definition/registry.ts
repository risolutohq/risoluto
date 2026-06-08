import { constants as fsConstants } from "node:fs";
import { open, readdir, type FileHandle } from "node:fs/promises";
import path from "node:path";

import { parse as parseYaml } from "yaml";
import { z, ZodError } from "zod";

import { isWorkflowRunArtifactContractId } from "../workflow-run/artifact-contracts.js";
import type { WorkflowRunResolvedDefinitionConfig } from "../workflow-run/contracts.js";
import { RUN_STATUS_VALUES } from "../workflow-run/run-status.js";
import type { WorkflowRunStatusMapping } from "../workflow-run/status-projection.js";
import type { CouncilVerifier } from "../workflow-run/verifier.js";

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
  /** Verifier dispatch mode (NIN-271). `council` routes the verifier role through `runCouncilVerifier`. */
  readonly verifierMode?: "single" | "council";
  /** Council members dispatched when `verifierMode === "council"`; each carries its model profile and lens. */
  readonly councillors?: readonly CouncilVerifier[];
}

export interface ResolvedWorkflowDefinition {
  readonly id: string;
  readonly validationProfile: string;
  readonly states: readonly ResolvedWorkflowState[];
  readonly roles: readonly ResolvedWorkflowRole[];
  readonly actions: readonly string[];
  /** Workflow-level status mapping override (NIN-270); beats the workspace-level tracker mapping. */
  readonly statusMapping?: WorkflowRunStatusMapping;
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

// Workflow definitions are small declarative YAML; cap the file at 256 KiB so a symlink-swapped or
// runaway file can't be slurped into memory before parsing (RIS-265).
const MAX_WORKFLOW_DEFINITION_BYTES = 256 * 1024;

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

const workflowRunStatusKeySchema = z.enum(RUN_STATUS_VALUES);

const councillorSchema = z
  .object({
    id: z.string().min(1),
    modelProfile: z.string().min(1).optional(),
    lens: z.string().min(1),
  })
  .strict();

const roleSchema = z
  .object({
    id: z.string().min(1),
    modelProfile: z.string().min(1).optional(),
    consumes: z.array(z.string().min(1)),
    produces: z.array(z.string().min(1)),
    dependsOn: z.array(z.string().min(1)),
    // Optional council verifier config (NIN-271). `council` routes the verifier role through
    // `runCouncilVerifier`; councillors each declare a model profile (defaults to the role's) and a lens.
    verifierMode: z.enum(["single", "council"]).optional(),
    councillors: z.array(councillorSchema).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.verifierMode === "council" && (val.councillors == null || val.councillors.length === 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["councillors"],
        message: `verifierMode "council" requires at least one councillor`,
      });
    }
  });

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
          id: z
            .string()
            .min(1)
            .regex(/^[a-zA-Z0-9_-]+$/),
          roles: z.array(roleSchema),
          gates: z.array(z.string().min(1)),
          hooks: z.array(z.string().min(1)),
        })
        .strict(),
    ),
    actions: z.array(z.string().min(1)),
    // Optional workflow-level status mapping override (NIN-270). Keys are canonical Run Status values;
    // present keys beat the workspace-level tracker.statusMapping during projection.
    statusMapping: z.partialRecord(workflowRunStatusKeySchema, z.string()).optional(),
  })
  .strict();

type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
type WorkflowRoleDefinition = z.infer<typeof roleSchema>;

export async function loadWorkflowDefinitionRegistry(
  input: LoadWorkflowDefinitionRegistryInput,
): Promise<WorkflowDefinitionRegistry> {
  const definitions = await loadWorkflowDefinitions(input.workflowDir);
  const resolvedDefinitions = new Map<string, ResolvedWorkflowDefinition>();
  for (const definition of definitions) {
    // Map.set would silently let a second file shadow the first — reject so a duplicate id can't
    // ambiguously resolve depending on directory read order (RIS-265).
    if (resolvedDefinitions.has(definition.id)) {
      throw new WorkflowDefinitionRegistryError(`duplicate workflow definition id ${definition.id}`);
    }
    resolvedDefinitions.set(definition.id, resolveWorkflowDefinition(definition, input.globalDefaults));
  }
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
    ...(definition.statusMapping ? { statusMapping: definition.statusMapping } : {}),
  };
}

async function loadWorkflowDefinitions(workflowDir: string): Promise<WorkflowDefinition[]> {
  const entries = (await readdir(workflowDir)).filter((entry) => entry.endsWith(".yaml") || entry.endsWith(".yml"));
  const definitions = await Promise.all(entries.map((entry) => loadWorkflowDefinition(path.join(workflowDir, entry))));
  return definitions;
}

async function loadWorkflowDefinition(filePath: string): Promise<WorkflowDefinition> {
  const parsed = parseYaml(await readSafeDefinitionFile(filePath));
  try {
    const definition = workflowDefinitionSchema.parse(parsed);
    validateWorkflowDefinitionStructure(definition);
    validateWorkflowDefinitionReferences(definition);
    return definition;
  } catch (error) {
    if (error instanceof ZodError) {
      throw new WorkflowDefinitionRegistryError(formatSchemaError(filePath, error), { cause: error });
    }
    throw error;
  }
}

// Open with O_NOFOLLOW so a symlink at the path is rejected (ELOOP), then fstat the *same* handle for the
// regular-file + size checks and read the bytes through it. Doing the check and the read on one fd closes
// the TOCTOU window where a regular file validated by lstat is swapped for a symlink before readFile
// follows it (RIS-265). O_NOFOLLOW is POSIX-only: where it is undefined (e.g. Windows) the `?? 0` makes
// the open follow symlinks, which is acceptable because the production runtime is Linux-only (Node 22+).
async function readSafeDefinitionFile(filePath: string): Promise<string> {
  const notRegularFileError = (): WorkflowDefinitionRegistryError =>
    new WorkflowDefinitionRegistryError(
      `workflow definition ${filePath} is not a regular file (symlinks and special files are rejected)`,
    );
  let handle: FileHandle;
  try {
    handle = await open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOOP") {
      throw notRegularFileError();
    }
    throw error;
  }
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) {
      throw notRegularFileError();
    }
    if (stats.size > MAX_WORKFLOW_DEFINITION_BYTES) {
      throw new WorkflowDefinitionRegistryError(
        `workflow definition ${filePath} exceeds the ${MAX_WORKFLOW_DEFINITION_BYTES} byte size cap (${stats.size} bytes)`,
      );
    }
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

// Structural invariants the zod schema can't express on its own: a definition must declare at least
// one state and one role, and every state id must be unique (RIS-265).
function validateWorkflowDefinitionStructure(definition: WorkflowDefinition): void {
  if (definition.states.length === 0) {
    throw new WorkflowDefinitionRegistryError(`workflow definition ${definition.id} declares no states`);
  }
  const stateIds = new Set<string>();
  for (const state of definition.states) {
    if (stateIds.has(state.id)) {
      throw new WorkflowDefinitionRegistryError(`duplicate state id ${state.id}`);
    }
    stateIds.add(state.id);
  }
  const roleCount = definition.states.reduce((total, state) => total + state.roles.length, 0);
  if (roleCount === 0) {
    throw new WorkflowDefinitionRegistryError(`workflow definition ${definition.id} declares no roles`);
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
  for (const councillor of role.councillors ?? []) {
    assertKnownId(BUILTIN_MODEL_PROFILE_IDS, councillor.modelProfile, "model profile");
  }
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
  assertAcyclicRoleGraph(roles);
}

// Depth-first colouring: a back-edge to a node already on the current path is a cycle. Without this a
// definition whose roles depend on each other in a loop would deadlock the role DAG executor (RIS-266).
function assertAcyclicRoleGraph(roles: readonly WorkflowRoleDefinition[]): void {
  const dependenciesById = new Map(roles.map((role) => [role.id, role.dependsOn]));
  const visitState = new Map<string, "visiting" | "visited">();

  const visit = (id: string, pathToHere: readonly string[]): void => {
    const status = visitState.get(id);
    if (status === "visited") {
      return;
    }
    if (status === "visiting") {
      const cyclePath = [...pathToHere.slice(pathToHere.indexOf(id)), id].join(" -> ");
      throw new WorkflowDefinitionRegistryError(`role dependency cycle detected: ${cyclePath}`);
    }
    visitState.set(id, "visiting");
    for (const dependency of dependenciesById.get(id) ?? []) {
      visit(dependency, [...pathToHere, id]);
    }
    visitState.set(id, "visited");
  };

  for (const role of roles) {
    visit(role.id, []);
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
        ...(role.verifierMode ? { verifierMode: role.verifierMode } : {}),
        ...(role.councillors ? { councillors: resolveCouncillors(role, modelProfile) } : {}),
      })),
    ),
    actions: definition.actions,
    ...(definition.statusMapping ? { statusMapping: definition.statusMapping } : {}),
  };
}

/** Resolve each councillor's model profile to its explicit value or the verifier role's default (NIN-271). */
function resolveCouncillors(role: WorkflowRoleDefinition, definitionModelProfile: string): CouncilVerifier[] {
  const roleModelProfile = role.modelProfile ?? definitionModelProfile;
  return (role.councillors ?? []).map((councillor) => ({
    id: councillor.id,
    modelProfile: councillor.modelProfile ?? roleModelProfile,
    lens: councillor.lens,
  }));
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
