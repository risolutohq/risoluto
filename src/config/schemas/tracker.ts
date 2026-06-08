/**
 * Zod schema for the tracker configuration subsection.
 */

import { z } from "zod";
import { RUN_STATUS_VALUES } from "../../workflow-run/run-status.js";
import { DEFAULT_ACTIVE_STATES, DEFAULT_TERMINAL_STATES } from "../../state/topology.js";

const workflowRunStatusKeySchema = z.enum(RUN_STATUS_VALUES);

export const trackerConfigSchema = z.object({
  kind: z.string().default("linear"),
  apiKey: z.string().default(""),
  endpoint: z.string().default("https://api.linear.app/graphql"),
  projectSlug: z.string().nullable().default(null),
  owner: z.string().default(""),
  repo: z.string().default(""),
  activeStates: z.array(z.string()).default(DEFAULT_ACTIVE_STATES),
  terminalStates: z.array(z.string()).default(DEFAULT_TERMINAL_STATES),
  // Workspace-level canonical Run Status → external board state mapping (NIN-270). Keys are canonical
  // Run Status values; an unknown/missing key surfaces a clear projection error at mirror time rather
  // than silently choosing a state.
  statusMapping: z.partialRecord(workflowRunStatusKeySchema, z.string()).optional(),
});
