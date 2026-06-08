import { describe, expect, it } from "vitest";

import { createGraphProvider } from "../../src/reachability/graph-provider.js";

const IMPORT_GRAPH: Readonly<Record<string, readonly string[]>> = {
  "src/cli/index.ts": ["src/cli/run-start-command.ts"],
  "src/cli/run-start-command.ts": ["src/workflow-run/drive-accepted-run.ts"],
  "src/workflow-run/drive-accepted-run.ts": [],
  "src/orphan.ts": ["src/unreached.ts"],
  "src/unreached.ts": [],
};

const SOURCE_FILES = new Map<string, string>([
  [
    "src/cli/run-start-command.ts",
    "import { driveAcceptedWorkflowRun } from '../workflow-run/drive-accepted-run.js';\ndriveAcceptedWorkflowRun();",
  ],
  [
    "src/workflow-run/drive-accepted-run.ts",
    "export function driveAcceptedWorkflowRun() {}\nexport function deadFn() {}",
  ],
  [
    "tests/cli/run-start.test.ts",
    "import { driveAcceptedWorkflowRun } from '../../src/workflow-run/drive-accepted-run.js';",
  ],
]);

describe("createGraphProvider", () => {
  const provider = createGraphProvider({ importGraph: IMPORT_GRAPH, sourceFiles: SOURCE_FILES });

  it("finds the shortest import path from an entry module to a target", () => {
    expect(provider.importPathFrom("src/cli/index.ts", "src/workflow-run/drive-accepted-run.ts")).toEqual([
      "src/cli/index.ts",
      "src/cli/run-start-command.ts",
      "src/workflow-run/drive-accepted-run.ts",
    ]);
  });

  it("returns undefined when the target is not in the entry module's import closure", () => {
    expect(provider.importPathFrom("src/cli/index.ts", "src/unreached.ts")).toBeUndefined();
  });

  it("classifies callers into non-test and test, excluding the defining module", () => {
    const callers = provider.callersOf("driveAcceptedWorkflowRun", "src/workflow-run/drive-accepted-run.ts");
    expect(callers.nonTest).toEqual(["src/cli/run-start-command.ts"]);
    expect(callers.test).toEqual(["tests/cli/run-start.test.ts"]);
  });

  it("reports a symbol referenced nowhere as a dead export", () => {
    expect(provider.isDeadExport("deadFn", "src/workflow-run/drive-accepted-run.ts")).toBe(true);
  });

  it("does not report a referenced symbol as a dead export", () => {
    expect(provider.isDeadExport("driveAcceptedWorkflowRun", "src/workflow-run/drive-accepted-run.ts")).toBe(false);
  });
});
