import { runLivePreflightCli } from "../src/live/preflight-cli.js";

try {
  process.exitCode = await runLivePreflightCli(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
