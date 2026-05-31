import path from "node:path";
import { parseArgs } from "node:util";

import { runDoctor } from "../workflow-run/doctor.js";

export async function tryHandleDoctorCommand(argv: string[]): Promise<number | null> {
  if (argv[0] !== "doctor") {
    return null;
  }
  return doctorCommand(argv.slice(1));
}

async function doctorCommand(argv: string[]): Promise<number> {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      "workflow-dir": { type: "string" },
      "evidence-dir": { type: "string" },
      json: { type: "boolean", default: false },
    },
  });

  const workflowDir = path.resolve(parsed.values["workflow-dir"] ?? path.join(".risoluto", "workflows"));
  const result = await runDoctor({
    workflowDir,
    ...(parsed.values["evidence-dir"] ? { evidenceDir: path.resolve(parsed.values["evidence-dir"]) } : {}),
  });

  if (parsed.values.json) {
    console.log(JSON.stringify(result));
  } else {
    printTextResult(result);
  }
  return result.status === "passed" ? 0 : 1;
}

function printTextResult(result: Awaited<ReturnType<typeof runDoctor>>): void {
  console.log(`Doctor ${result.status}`);
  for (const check of result.checks) {
    console.log(`${check.status}: ${check.id} - ${check.message}`);
  }
}
