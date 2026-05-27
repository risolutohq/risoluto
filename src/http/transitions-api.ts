import type { Request, Response } from "express";

import { canTransitionWorkflowState, listWorkflowStateStages } from "../state/topology.js";
import type { ConfigStore } from "../config/store.js";
import type { OrchestratorPort } from "../orchestrator/port.js";

interface TransitionsDeps {
  orchestrator: OrchestratorPort;
  configStore?: ConfigStore;
}

export function handleGetTransitions(deps: TransitionsDeps, _req: Request, res: Response): void {
  if (!deps.configStore) {
    res.json({ transitions: {} });
    return;
  }

  const config = deps.configStore.getConfig();
  const stages = listWorkflowStateStages(config);
  const transitions: Record<string, string[]> = {};
  for (const from of stages) {
    transitions[from.key] = stages
      .filter((to) => canTransitionWorkflowState(from.key, to.key, config))
      .map((to) => to.key);
  }

  res.json({ transitions });
}
