import { stat } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { loadLiveEnvFile, resolveLivePreflightConfig } from "../config/live-preflight-config.js";
import { runLivePreflight, type LivePreflightReport } from "../live/preflight.js";
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
      "live-env-file": { type: "string", default: ".env.live.local" },
      live: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
  });

  const workflowDir = path.resolve(parsed.values["workflow-dir"] ?? path.join(".risoluto", "workflows"));
  const livePreflight = parsed.values.live ? await runDoctorLivePreflight(parsed.values["live-env-file"]) : undefined;
  const result = await runDoctor({
    workflowDir,
    ...(parsed.values["evidence-dir"] ? { evidenceDir: path.resolve(parsed.values["evidence-dir"]) } : {}),
    ...(livePreflight ? { livePreflight } : {}),
  });

  if (parsed.values.json) {
    console.log(JSON.stringify(result));
  } else {
    printTextResult(result);
  }
  return result.status === "passed" ? 0 : 1;
}

async function runDoctorLivePreflight(envFile: string): Promise<LivePreflightReport> {
  console.warn("doctor --live will perform provider write probes against configured live integrations.");
  const env = await resolveDoctorLiveEnv(envFile);
  const config = await resolveLivePreflightConfig(env);
  return runLivePreflight(config);
}

async function resolveDoctorLiveEnv(envFile: string): Promise<NodeJS.ProcessEnv> {
  if (!(await fileExists(envFile))) {
    return { ...process.env };
  }
  const fileEnv = await loadLiveEnvFile(envFile);
  const env = { ...process.env, ...fileEnv };
  if (!Object.hasOwn(fileEnv, "CLIPROXY_API_KEY")) {
    delete env.CLIPROXY_API_KEY;
  }
  return env;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function printTextResult(result: Awaited<ReturnType<typeof runDoctor>>): void {
  console.log(`Doctor ${result.status}`);
  for (const check of result.checks) {
    console.log(`${check.status}: ${check.id} - ${check.message}`);
  }
}
