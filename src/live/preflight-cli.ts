import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { loadLiveEnvFile, resolveLivePreflightConfig } from "../config/live-preflight-config.js";
import { runLivePreflight, type LivePreflightDeps, type LivePreflightReport } from "./preflight.js";

export interface LivePreflightCliDeps extends LivePreflightDeps {
  env?: NodeJS.ProcessEnv;
}

export async function runLivePreflightCli(argv: string[], deps: LivePreflightCliDeps = {}): Promise<number> {
  const parsed = parseArgs({
    args: normalizeArgv(argv),
    allowPositionals: false,
    options: {
      "env-file": { type: "string", default: ".env.live.local" },
      "output-dir": { type: "string", default: ".codex/goals/v1-test-migration/live-results" },
      json: { type: "boolean", default: false },
    },
  });

  const env = await resolveEnv(parsed.values["env-file"], deps.env ?? process.env);
  const config = await resolveLivePreflightConfig(env);
  const report = await runLivePreflight(config, deps);
  const artifactPath = await writeLivePreflightReport(report, parsed.values["output-dir"]);
  const output = { artifactPath, report };

  if (parsed.values.json) {
    console.log(JSON.stringify(output));
  } else {
    console.log(`live preflight ${report.overall}; artifact: ${artifactPath}`);
  }
  return report.overall === "failed" ? 1 : 0;
}

function normalizeArgv(argv: string[]): string[] {
  return argv[0] === "--" ? argv.slice(1) : argv;
}

async function resolveEnv(envFile: string, fallbackEnv: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
  if (await fileExists(envFile)) {
    const fileEnv = await loadLiveEnvFile(envFile);
    const env = { ...fallbackEnv, ...fileEnv };
    if (!Object.hasOwn(fileEnv, "CLIPROXY_API_KEY")) {
      delete env.CLIPROXY_API_KEY;
    }
    return env;
  }
  return fallbackEnv;
}

export async function writeLivePreflightReport(report: LivePreflightReport, outputDir: string): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const timestamp = report.generatedAt.replace(/[:.]/gu, "-");
  const artifactPath = path.join(outputDir, `live-preflight-${timestamp}.json`);
  await writeFile(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return artifactPath;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}
