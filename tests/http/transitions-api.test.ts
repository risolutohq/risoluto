import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";

import { makeMockResponse } from "../helpers.js";
import { handleGetTransitions } from "../../src/http/transitions-api.js";

const topologyMocks = vi.hoisted(() => ({
  listWorkflowStateStages: vi.fn(),
  canTransitionWorkflowState: vi.fn(),
}));

vi.mock("../../src/state/topology.js", () => ({
  canTransitionWorkflowState: topologyMocks.canTransitionWorkflowState,
  listWorkflowStateStages: topologyMocks.listWorkflowStateStages,
}));

type TransitionsDeps = Parameters<typeof handleGetTransitions>[0];
type TestStage = {
  key: string;
  label: string;
  kind: "backlog" | "active" | "gate" | "todo" | "terminal" | "other";
  terminal: boolean;
};

function makeRequest(): Request {
  const req: Partial<Request> = { get: vi.fn() };
  return req as Request;
}

function makeDeps(configStore?: { getConfig: () => unknown }): TransitionsDeps {
  if (configStore) {
    return {
      orchestrator: {} as TransitionsDeps["orchestrator"],
      configStore: configStore as TransitionsDeps["configStore"],
    };
  }
  return { orchestrator: {} as TransitionsDeps["orchestrator"] };
}

function setMockMachine(stages: TestStage[], allowedTransitions: Record<string, string[]>): void {
  topologyMocks.listWorkflowStateStages.mockReturnValue(stages);
  topologyMocks.canTransitionWorkflowState.mockImplementation((from: string, to: string) => {
    return allowedTransitions[from]?.includes(to) ?? false;
  });
}

describe("handleGetTransitions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    topologyMocks.listWorkflowStateStages.mockReset();
    topologyMocks.canTransitionWorkflowState.mockReset();
  });

  it("returns empty transitions when configStore is not configured", () => {
    const res = makeMockResponse();

    handleGetTransitions(makeDeps(), makeRequest(), res);

    expect(res._status).toBe(200);
    expect(res._body).toEqual({ transitions: {} });
    expect(topologyMocks.listWorkflowStateStages).not.toHaveBeenCalled();
  });

  it("builds transitions from tracker activeStates and terminalStates when stateMachine config is absent", () => {
    const res = makeMockResponse();
    const config = {
      tracker: {
        activeStates: ["Todo", "In Progress"],
        terminalStates: ["Done", "Canceled"],
      },
      stateMachine: null,
    };
    const configStore = {
      getConfig: vi.fn().mockReturnValue(config),
    };

    setMockMachine(
      [
        { key: "todo", label: "Todo", kind: "todo", terminal: false },
        { key: "in progress", label: "In Progress", kind: "active", terminal: false },
        { key: "done", label: "Done", kind: "terminal", terminal: true },
      ],
      {
        todo: ["todo", "in progress"],
        "in progress": ["todo", "in progress", "done"],
        done: ["done"],
      },
    );

    handleGetTransitions(makeDeps(configStore), makeRequest(), res);

    expect(configStore.getConfig).toHaveBeenCalledTimes(1);
    expect(topologyMocks.listWorkflowStateStages).toHaveBeenCalledWith(config);
    expect(topologyMocks.canTransitionWorkflowState).toHaveBeenCalledWith("todo", "todo", config);
    expect(res._body).toEqual({
      transitions: {
        todo: ["todo", "in progress"],
        "in progress": ["todo", "in progress", "done"],
        done: ["done"],
      },
    });
  });

  it("builds transitions from stateMachine config when present", () => {
    const res = makeMockResponse();
    const config = {
      tracker: {
        activeStates: ["Backlog", "Working"],
        terminalStates: ["Done"],
      },
      stateMachine: {
        stages: [
          { name: "Backlog", kind: "backlog" as const },
          { name: "Working", kind: "active" as const },
          { name: "Done", kind: "terminal" as const },
        ],
        transitions: {
          Backlog: ["Backlog", "Working"],
          Working: ["Working", "Done"],
          Done: ["Done"],
        },
      },
    };
    const configStore = {
      getConfig: vi.fn().mockReturnValue(config),
    };

    setMockMachine(
      [
        { key: "backlog", label: "Backlog", kind: "backlog", terminal: false },
        { key: "working", label: "Working", kind: "active", terminal: false },
        { key: "done", label: "Done", kind: "terminal", terminal: true },
      ],
      {
        backlog: ["backlog", "working"],
        working: ["working", "done"],
        done: ["done"],
      },
    );

    handleGetTransitions(makeDeps(configStore), makeRequest(), res);

    expect(topologyMocks.listWorkflowStateStages).toHaveBeenCalledWith(config);
    expect(topologyMocks.canTransitionWorkflowState).toHaveBeenCalledWith("working", "done", config);
    expect(res._body).toEqual({
      transitions: {
        backlog: ["backlog", "working"],
        working: ["working", "done"],
        done: ["done"],
      },
    });
  });
});
