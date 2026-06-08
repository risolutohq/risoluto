import { parseArgs } from "node:util";

import { createWorkflowRunEvidenceStore } from "../workflow-run/evidence-store.js";
import { resolveDataDir, requireNonEmpty } from "./cli-helpers.js";

/**
 * Handles `run evidence show <runId> --evidence-id <id> [--data-dir <dir>] [--json]`.
 * Reads evidence through `readEvidenceForDisplay`, which applies both key-based and
 * classification-based redaction before returning the display view.
 */
export async function runEvidenceShowCommand(argv: string[]): Promise<number> {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "evidence-id": { type: "string" },
      "data-dir": { type: "string" },
      json: { type: "boolean", default: false },
    },
  });

  const workflowRunId = requireEvidenceRunId(parsed.positionals[0]);
  const evidenceId = requireNonEmpty(parsed.values["evidence-id"], "--evidence-id");
  const store = createWorkflowRunEvidenceStore({
    dataDir: resolveDataDir(parsed.values["data-dir"]),
  });
  const display = await store.readEvidenceForDisplay({ workflowRunId, evidenceId });

  if (parsed.values.json) {
    console.log(JSON.stringify({ type: "workflow_run.evidence.display", evidence: display }));
  } else {
    console.log(`Evidence ${display.evidenceId} for Workflow Run ${display.workflowRunId}`);
    console.log(JSON.stringify(display.content, null, 2));
  }
  return 0;
}

function requireEvidenceRunId(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new TypeError("run evidence show requires a Workflow Run id");
  }
  return trimmed;
}
