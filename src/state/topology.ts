import type { ServiceConfig, StateStageKind } from "../core/types.js";
import { StateMachine, normalizeState, uniqueStates } from "./machine.js";

export { DEFAULT_ACTIVE_STATES, DEFAULT_TERMINAL_STATES } from "./machine.js";

const STATE_MACHINE_TOPOLOGY_CACHE = new WeakMap<object, WorkflowStateTopology>();
const TRACKER_STATE_CACHE = new WeakMap<ServiceConfig, { active: Set<string> }>();
const TRACKER_TOPOLOGY_CACHE = new WeakMap<ServiceConfig, WorkflowStateTopology>();

export interface WorkflowStageDefinition {
  key: string;
  label: string;
  kind: StateStageKind | "other";
  terminal: boolean;
}

interface WorkflowStateTopology {
  activeOrTodo: ReadonlySet<string>;
  gate: ReadonlySet<string>;
  todo: ReadonlySet<string>;
  machine: StateMachine;
}

export function normalizeWorkflowStateKey(state: string): string {
  return normalizeState(state);
}

export function normalizeWorkflowStateList(states: string[]): string[] {
  return uniqueStates(states);
}

export function isTerminalWorkflowState(state: string, config: ServiceConfig): boolean {
  return getWorkflowStateMachine(config).isTerminalState(state);
}

export function isActiveWorkflowState(state: string, config: ServiceConfig): boolean {
  return getWorkflowStateTopology(config).activeOrTodo.has(normalizeWorkflowStateKey(state));
}

export function isGateWorkflowState(state: string, config: ServiceConfig): boolean {
  return getWorkflowStateTopology(config).gate.has(normalizeWorkflowStateKey(state));
}

export function isTodoWorkflowState(state: string, config?: ServiceConfig): boolean {
  if (!config) {
    return normalizeWorkflowStateKey(state) === "todo";
  }
  return getWorkflowStateTopology(config).todo.has(normalizeWorkflowStateKey(state));
}

export function canTransitionWorkflowState(from: string, to: string, config: ServiceConfig): boolean {
  return getWorkflowStateMachine(config).canTransition(from, to);
}

export function assertWorkflowStateTransition(
  from: string,
  to: string,
  config: ServiceConfig,
): { ok: true } | { ok: false; reason: string } {
  return getWorkflowStateMachine(config).assertTransition(from, to);
}

export function getWorkflowStateMachine(config: ServiceConfig): StateMachine {
  return getWorkflowStateTopology(config).machine;
}

export function listWorkflowStateStages(config: ServiceConfig): WorkflowStageDefinition[] {
  const stages: WorkflowStageDefinition[] = [];
  const seen = new Set<string>();

  if (config.stateMachine?.stages?.length) {
    for (const stage of config.stateMachine.stages) {
      appendStage(stages, seen, {
        key: normalizeWorkflowStateKey(stage.name),
        label: stage.name,
        kind: stage.kind,
        terminal: stage.kind === "terminal",
      });
    }
    return stages;
  }

  for (const state of config.tracker.activeStates) {
    const key = normalizeWorkflowStateKey(state);
    const kindIfNotBacklog: StateStageKind = key === "todo" ? "todo" : "active";
    const kind: StateStageKind = key === "backlog" ? "backlog" : kindIfNotBacklog;
    appendStage(stages, seen, { key, label: state, kind, terminal: false });
  }

  for (const terminalLabel of config.tracker.terminalStates) {
    appendStage(stages, seen, {
      key: normalizeWorkflowStateKey(terminalLabel),
      label: terminalLabel,
      kind: "terminal",
      terminal: true,
    });
  }

  return stages;
}

export {
  isActiveWorkflowState as isActiveState,
  isGateWorkflowState as isGateState,
  isTerminalWorkflowState as isTerminalState,
  isTodoWorkflowState as isTodoState,
  listWorkflowStateStages as listWorkflowStages,
  normalizeWorkflowStateKey as normalizeStateKey,
  normalizeWorkflowStateList as normalizeStateList,
};

function getWorkflowStateTopology(config: ServiceConfig): WorkflowStateTopology {
  if (!config.stateMachine) {
    const cached = TRACKER_TOPOLOGY_CACHE.get(config);
    if (cached) {
      return cached;
    }
    const topology = buildTrackerTopology(config);
    TRACKER_TOPOLOGY_CACHE.set(config, topology);
    return topology;
  }

  const cached = STATE_MACHINE_TOPOLOGY_CACHE.get(config.stateMachine);
  if (cached) {
    return cached;
  }

  const topology = buildStateMachineTopology(config);
  STATE_MACHINE_TOPOLOGY_CACHE.set(config.stateMachine, topology);
  return topology;
}

function buildTrackerTopology(config: ServiceConfig): WorkflowStateTopology {
  const trackerStateSets = getTrackerStateSets(config);
  return {
    activeOrTodo: trackerStateSets.active,
    gate: new Set<string>(),
    todo: new Set(["todo"]),
    machine: new StateMachine({
      activeStates: config.tracker.activeStates,
      terminalStates: config.tracker.terminalStates,
    }),
  };
}

function buildStateMachineTopology(config: ServiceConfig): WorkflowStateTopology {
  const activeOrTodo = new Set<string>();
  const gate = new Set<string>();
  const todo = new Set<string>();
  for (const stage of config.stateMachine?.stages ?? []) {
    const normalizedStage = normalizeWorkflowStateKey(stage.name);
    if (stage.kind === "active" || stage.kind === "todo") {
      activeOrTodo.add(normalizedStage);
    }
    if (stage.kind === "gate") {
      gate.add(normalizedStage);
    }
    if (stage.kind === "todo") {
      todo.add(normalizedStage);
    }
  }

  return {
    activeOrTodo,
    gate,
    todo,
    machine: new StateMachine({
      stages: (config.stateMachine?.stages ?? []).map((stage) => ({
        key: stage.name,
        terminal: stage.kind === "terminal",
      })),
      transitions: config.stateMachine?.transitions,
      activeStates: config.tracker.activeStates,
      terminalStates: config.tracker.terminalStates,
    }),
  };
}

function getTrackerStateSets(config: ServiceConfig): { active: Set<string> } {
  const cached = TRACKER_STATE_CACHE.get(config);
  if (cached) {
    return cached;
  }

  const computed = { active: new Set(normalizeWorkflowStateList(config.tracker.activeStates)) };
  TRACKER_STATE_CACHE.set(config, computed);
  return computed;
}

function appendStage(stages: WorkflowStageDefinition[], seen: Set<string>, stage: WorkflowStageDefinition): void {
  if (!stage.key || seen.has(stage.key)) {
    return;
  }
  seen.add(stage.key);
  stages.push(stage);
}
