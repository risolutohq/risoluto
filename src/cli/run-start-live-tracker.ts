import type { Issue } from "../core/types.js";
import type { TrackerPort, TrackerProvisionInput } from "../tracker/port.js";

/**
 * Tracker shim for the live `run start` path. A `run start` Workflow Run is synthetic — it has no backing
 * tracker issue — so the real adapter's `fetchIssueStatesByIds` would return `[]`, and the agent-runner
 * turn loop (`turn-executor.ts`) would `stop` after a single turn. This shim answers that one call with a
 * synthetic issue pinned to an active state so multi-turn role work proceeds. No other method is reached
 * during a run-start agent attempt (the agent gets a {@link NullTrackerToolProvider}, so it has no tracker
 * tools), so the remaining methods reject rather than fabricate tracker behavior.
 */
export function createRunStartTracker(activeState: string): TrackerPort {
  const syntheticIssue = (id: string): Issue => ({
    id,
    identifier: id,
    workflowRunId: id,
    title: id,
    description: null,
    priority: null,
    state: activeState,
    branchName: null,
    url: null,
    labels: [],
    blockedBy: [],
    createdAt: null,
    updatedAt: null,
  });
  const unsupported = (method: string): Promise<never> =>
    Promise.reject(new Error(`tracker.${method} is not supported in the live run-start path`));
  return {
    fetchIssueStatesByIds: (ids) => Promise.resolve(ids.map(syntheticIssue)),
    fetchCandidateIssues: () => Promise.resolve([]),
    fetchIssuesByStates: () => Promise.resolve([]),
    resolveStateId: () => Promise.resolve(null),
    updateIssueState: () => unsupported("updateIssueState"),
    createComment: () => unsupported("createComment"),
    createIssue: () => unsupported("createIssue"),
    transitionIssue: () => Promise.resolve({ success: false }),
    provision: (_input: TrackerProvisionInput): Promise<never> => unsupported("provision"),
  };
}
