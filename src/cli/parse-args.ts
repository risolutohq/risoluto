import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import { createLogger } from "../core/logger.js";
import { initErrorTracking } from "../core/error-tracking.js";
import type { RisolutoLogger } from "../core/types.js";

/**
 * Bad CLI input (unknown flag, malformed --port). The top-level handler renders this as a single
 * concise line instead of a full stack trace, since it's user error not an internal fault (NIN-266).
 */
export class CliArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliArgumentError";
  }
}

function parsePortValue(rawPort: string | undefined): number | undefined {
  if (rawPort === undefined) return undefined;
  // Reject empty, non-digit, and leading-zero forms (e.g. "00000004000")
  // which would otherwise pass the old \d+ check and silently coerce. Also
  // enforce a real TCP port range (1–65535) — 0 means "any free port" and
  // must be explicit, not inherited from a parent process unintentionally.
  if (!/^[1-9]\d*$/.test(rawPort)) {
    throw new CliArgumentError(
      `invalid --port value: ${rawPort}. Expected an integer between 1 and 65535 with no leading zeros.`,
    );
  }
  const value = Number(rawPort);
  if (value < 1 || value > 65535) {
    throw new CliArgumentError(`invalid --port value: ${rawPort}. Expected an integer between 1 and 65535.`);
  }
  return value;
}

// Wrap node:util parseArgs so its TypeError for an unknown/malformed flag becomes a CliArgumentError
// (concise top-level rendering), while preserving the precisely-inferred values type (NIN-266).
function parseRawCliArgs(argv: string[]) {
  try {
    return parseArgs({
      args: argv,
      allowPositionals: false,
      options: {
        port: { type: "string" },
        "data-dir": { type: "string" },
      },
    });
  } catch (error) {
    throw new CliArgumentError(error instanceof Error ? error.message : String(error));
  }
}

export function parseCliArgs(argv: string[]): {
  dataDir: string;
  archiveDir: string;
  selectedPort: number | undefined;
  logger: RisolutoLogger;
} {
  const parsed = parseRawCliArgs(argv);

  const logger = createLogger();
  initErrorTracking(logger.child({ component: "error-tracking" }));
  const dataDir = path.resolve(parsed.values["data-dir"] ?? process.env.DATA_DIR ?? path.join(homedir(), ".risoluto"));
  const archiveDir = path.resolve(path.join(dataDir, "archives"));
  // Precedence: explicit --port CLI flag > config.server.port (read elsewhere).
  const selectedPort = parsePortValue(parsed.values.port);
  return { dataDir, archiveDir, selectedPort, logger };
}
